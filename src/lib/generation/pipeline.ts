/**
 * AIまとめ記事生成パイプラインのDB連携部分（F7）。生成ロジック自体（構成分岐・逐語一致率・
 * 引用比率の判定）は generate-article.ts / compose.ts の純関数に委譲し、ここでは
 * 「記事化候補キューの取得」「生成結果の永続化(Article+ArticleSource)」
 * 「CollectedItemの状態同期(articleId/statusを原子的に揃える)」「失敗時の記録」のみを担当する。
 *
 * ⚠ Sprint 3からの申し送り: 候補から記事を生成したら、その CollectedItem の articleId をセットし、
 * status も "articled" に必ず同期する（原子的に）。これを怠ると listCandidateQueue（status=queued抽出）
 * が同アイテムを再提示して二重記事化を招く。
 *
 * ⚠ F9（安全フィルタ）: 生成した本文＋タイトルは必ず moderateArticleContent を通してから
 * Article.status を決める。フィルタ通過(published)のときのみ公開状態にし、不通過は
 * status="held"（保留・保留理由付き）にして CollectedItem は articled のまま公開キューには入れない
 * （「公開記事は必ずフィルタ通過済み」という不変条件をここで担保する）。
 */
import { prisma } from "@/lib/prisma";
import { listCandidateQueue } from "@/lib/collection/queue";
import { SOURCE_TYPES } from "@/lib/collection/types";
import { generateArticleForCandidate, GenerationError, type GenerationCandidate } from "@/lib/generation/generate-article";
import { getLLMClient, type LLMClient } from "@/lib/generation/llm-client";
import { generateHookTitle } from "@/lib/generation/title";
import { threadBodyText } from "@/lib/generation/thread-format";
import { parseArticleBody } from "@/lib/article-body";
import { bodyBlocksToText } from "@/lib/search";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { fetchChampionNameToIdMap, type ChampionNameToIdMap } from "@/lib/generation/champion-thumbnail";

/** 重複判定の比較対象にする既存公開記事の上限件数（記事数増加時のコスト有界化。related-articles.ts と同じ考え方）。 */
const DUPLICATE_CHECK_POOL = 200;

/**
 * 重複判定用に、直近の公開済み記事のタイトル+本文テキストを取得する。
 * リファクタリングS5a: Postベースの新フロー（generation/post-pipeline.ts）でも同じ重複判定プールを
 * 使うため export する（新旧経路で重複判定ロジックを二重管理しない）。
 */
export async function loadPublishedContentPool(): Promise<{ title: string; content: string }[]> {
  const rows = await prisma.article.findMany({
    where: { status: "published" },
    select: { title: true, body: true },
    orderBy: { publishedAt: "desc" },
    take: DUPLICATE_CHECK_POOL,
  });
  return rows.map((r) => {
    try {
      return { title: r.title, content: bodyBlocksToText(parseArticleBody(r.body)) };
    } catch {
      // 不正な本文データは重複判定の比較対象から除外するだけにし、生成パイプライン自体は止めない。
      return { title: r.title, content: "" };
    }
  });
}

export type GenerationRunResult =
  | {
      collectedItemId: string;
      status: "success";
      articleId: string;
      slug: string;
      /** F9の安全フィルタ判定結果。held のときは heldReason に理由コードが入る。 */
      publicationStatus: "published" | "held";
      heldReason?: string;
    }
  | { collectedItemId: string; status: "failure"; errorMessage: string };

export type GenerationRunSummary = {
  succeededCount: number;
  failedCount: number;
  results: GenerationRunResult[];
};

/** CollectedItem の slug 用にそのままURL安全なIDを使う（本格タイトル/スラッグ生成はSprint 5のF8）。 */
function slugForCandidate(candidateId: string): string {
  return `gen-${candidateId}`;
}

export type GenerationRunOptions = {
  /**
   * 1回の実行で処理する候補数の上限（F10: 公開本数上限）。公開されない候補（held/failure）が
   * 混ざりうるため「公開数の上限」そのものではなく「処理する候補数の上限」だが、
   * 処理数を上限以下に抑えることで公開数も必ず上限以下になる。未指定時は無制限（全件処理、既存挙動）。
   * 上限を超えた残りの候補はDBの状態(queued)を変更しないため、次回実行時に再度処理対象になる。
   */
  maxCandidates?: number;
  /**
   * カテゴリ(=ソース種別)別の1回の実行あたり処理数上限（拡張E48）。指定時は `maxCandidates`（総数上限）
   * より優先され、ソース種別（`SOURCE_TYPES`）ごとに独立して最大 `maxPerCategory` 件ずつ取得・処理する
   * （あるソースの候補が多くても他ソースの取得件数を圧迫しない）。未指定時は従来どおり `maxCandidates` で動く。
   */
  maxPerCategory?: number;
  /**
   * チャンピオン検出（拡張E31 F-E31-1）に使う「表示名→championId」Map。
   * - 未指定(undefined): run開始時に fetchChampionNameToIdMap() を1回だけ取得して使う
   *   （候補が0件のときは取得しない。取得失敗時はフォールバック表を返すため例外にはならない）。
   * - 明示的に null: フェッチ自体を行わずチャンピオン検出をスキップする
   *   （実APIを叩きたくないテスト等で使う。candidate.imageUrlのみ判定、従来どおりの挙動になる）。
   * - Mapを直接渡す: そのMapをそのまま使う（テストでのスタブ差し替え用）。
   */
  championMap?: ChampionNameToIdMap | null;
};

/**
 * 記事化候補キュー（status="queued"）を1件ずつ処理し、Article(+ArticleSource)を作成する。
 * 1件の生成に失敗しても他候補の処理は継続する（F7受け入れ基準:「生成に失敗した候補は
 * 生成失敗として記録され、他候補の生成は継続する」）。
 */
export async function generateArticlesForQueue(
  llmClient: LLMClient = getLLMClient(),
  options: GenerationRunOptions = {},
): Promise<GenerationRunSummary> {
  // 上限は DB 側の take で絞る（全 queued を取得してから捨てる無駄を避ける）。
  // maxPerCategory 指定時は、ソース種別ごとに独立した上限で取得し連結する（拡張E48）。
  // 未指定時は従来どおり maxCandidates（総数上限、後方互換）で1回の取得に絞る。
  const candidates =
    options.maxPerCategory != null
      ? (
          await Promise.all(
            SOURCE_TYPES.map((sourceType) =>
              listCandidateQueue({ take: options.maxPerCategory, sourceType }),
            ),
          )
        ).flat()
      : await listCandidateQueue(options.maxCandidates != null ? { take: options.maxCandidates } : {});
  const results: GenerationRunResult[] = [];

  // 候補が枯渇しているときは、重複判定プールのクエリも含め何もせず正常終了する（F10:「今回は新規公開なし」）。
  if (candidates.length === 0) {
    return { succeededCount: 0, failedCount: 0, results };
  }

  // 重複判定の比較プールはこの実行中に公開された記事も随時追加し、同一実行内での重複も検出する。
  const contentPool = await loadPublishedContentPool();

  // チャンピオン検出用Mapはrun開始時に1回だけ取得し、記事ごとにはフェッチしない（拡張E31 F-E31-1）。
  // 明示的にnullが渡された場合はフェッチ自体を行わずチャンピオン検出をスキップする。
  const championMap: ChampionNameToIdMap | undefined =
    options.championMap === null ? undefined : options.championMap ?? (await fetchChampionNameToIdMap());

  for (const item of candidates) {
    const candidate: GenerationCandidate = {
      id: item.id,
      sourceType: item.sourceType as GenerationCandidate["sourceType"],
      sourceUrl: item.sourceUrl,
      title: item.title,
      content: item.content,
      imageUrl: item.imageUrl,
    };

    try {
      const generated = await generateArticleForCandidate(candidate, llmClient, championMap);
      const slug = slugForCandidate(item.id);
      const bodyText = bodyBlocksToText(generated.body);

      const moderation = moderateArticleContent(
        { title: generated.title, bodyText, sourceCount: generated.sources.length },
        { candidate: { title: generated.title, content: bodyText }, existing: contentPool },
      );
      const isPublished = moderation.status === "published";

      // Article作成・ArticleSource作成・CollectedItemの状態同期(articleId+status)は
      // 一貫性が崩れると二重記事化を招くため、必ず1つのトランザクションで原子的に行う。
      // 安全フィルタ不通過(held)でも Article 自体は作成し、CollectedItem は articled のまま
      // （保留理由付きで保留キューに記録し、再度キューへ戻って重複生成されないようにする）。
      const articleId = await prisma.$transaction(async (tx) => {
        const article = await tx.article.create({
          data: {
            slug,
            title: generated.title,
            category: generated.category,
            body: generated.body,
            thumbnailUrl: generated.thumbnailUrl,
            publishedAt: new Date(),
            status: isPublished ? "published" : "held",
            heldReason: isPublished ? null : moderation.reason,
            heldDetail: isPublished ? null : moderation.detail,
            unconfirmed: isPublished ? moderation.unconfirmed : false,
            // SEOメタ・タグ（リファクタリングS5b F-S5b-2）: AI生成できた(generated.seoが非null)場合のみ
            // SEO列を保存し、tagsをTag/ArticleTagにconnectOrCreateで紐付ける。null(mock/失敗)時は
            // SEO列・タグとも未設定のままにする(表示は従来メタにフォールバック、回帰なし)。
            ...(generated.seo
              ? {
                  seoTitle: generated.seo.seoTitle,
                  metaDescription: generated.seo.metaDescription,
                  ogTitle: generated.seo.ogTitle,
                  ogDescription: generated.seo.ogDescription,
                  tags: {
                    create: generated.seo.tags.map((name) => ({
                      tag: { connectOrCreate: { where: { name }, create: { name } } },
                    })),
                  },
                }
              : {}),
            sources: {
              create: generated.sources,
            },
          },
        });
        await tx.collectedItem.update({
          where: { id: item.id },
          data: { articleId: article.id, status: "articled", generationError: null },
        });
        return article.id;
      });

      if (isPublished) {
        // 同一実行内の後続候補が、今公開したばかりの記事と重複判定されるようにプールへ追加する。
        contentPool.unshift({ title: generated.title, content: bodyText });
      }

      results.push({
        collectedItemId: item.id,
        status: "success",
        articleId,
        slug,
        publicationStatus: isPublished ? "published" : "held",
        ...(isPublished ? {} : { heldReason: moderation.reason }),
      });
    } catch (err) {
      const errorMessage =
        err instanceof GenerationError || err instanceof Error ? err.message : String(err);
      console.error(`記事生成に失敗しました (collectedItemId=${item.id}):`, errorMessage);

      // 生成失敗の記録自体が失敗しても、他候補の生成ループを止めてはいけない。
      await prisma.collectedItem
        .update({
          where: { id: item.id },
          data: { status: "generation_failed", generationError: errorMessage },
        })
        .catch((updateErr) =>
          console.error(`生成失敗の記録に失敗しました (collectedItemId=${item.id}):`, updateErr),
        );

      results.push({ collectedItemId: item.id, status: "failure", errorMessage });
    }
  }

  const succeededCount = results.filter((r) => r.status === "success").length;
  const failedCount = results.filter((r) => r.status === "failure").length;
  return { succeededCount, failedCount, results };
}

export type TitleRegenerationResult = { articleId: string; oldTitle: string; newTitle: string };

/**
 * 既存記事1件のタイトルを煽り速報タイトル(F8)で再生成する（Sprint4以前に仮タイトルで
 * 生成された記事、および静的シード記事にも後から適用できるようにする）。
 * 生成元の CollectedItem（原題+本文）が残っていればそれを、無ければ記事のタイトル+本文テキストを
 * ソースとして使う（具体要素の捏造を避けるため、いずれの場合も実在するテキストから抽出する）。
 */
export async function regenerateArticleTitle(articleId: string): Promise<TitleRegenerationResult> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    // ソースは先頭1件の title/content しか使わないので、全 collectedItem・全カラムは取らない。
    include: { collectedItems: { take: 1, select: { title: true, content: true } } },
  });
  if (!article) {
    throw new Error(`記事が見つかりません (articleId=${articleId})`);
  }

  const source = article.collectedItems[0];
  const sourceInput = source
    ? { title: source.title, content: threadBodyText(source.content) }
    : { title: article.title, content: bodyBlocksToText(parseArticleBody(article.body)) };

  const newTitle = generateHookTitle(sourceInput);
  await prisma.article.update({ where: { id: articleId }, data: { title: newTitle } });
  return { articleId, oldTitle: article.title, newTitle };
}

/**
 * 全記事のタイトルを一括で再生成する。1件の失敗が他記事の再生成を止めないようにする
 * （F7の生成失敗継続方針と同様の考え方）。
 */
export async function regenerateAllArticleTitles(): Promise<TitleRegenerationResult[]> {
  const articles = await prisma.article.findMany({ select: { id: true } });
  const results: TitleRegenerationResult[] = [];
  for (const a of articles) {
    try {
      results.push(await regenerateArticleTitle(a.id));
    } catch (err) {
      console.error(`タイトル再生成に失敗しました (articleId=${a.id}):`, err);
    }
  }
  return results;
}
