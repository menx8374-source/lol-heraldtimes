/**
 * Postベースの記事生成パイプライン（リファクタリング S5a F-S5a-1）。
 * S1〜S4で用意したPost／時系列メトリクス／HotnessEvaluator（S3・AI不使用の数値ルール）を結線し、
 * 「hot判定された未記事化Post」だけをAIで記事化する新フロー。旧CollectedItem経路
 * （generateArticlesForQueue、generation/pipeline.ts）は比較用に残り、本モジュールとは独立に動く
 * （run-pipeline.tsのGENERATION_SOURCEフラグで切替）。
 *
 * 不変条件:
 * - 話題性判定はAI不使用の数値ルール（evaluateHotness）のみで行う。AIは生成/翻訳にのみ使う
 *   （generateArticleForCandidateが内部で呼ぶタイトル生成LLM等）。カテゴリ分類もAIを使わず
 *   既存 CATEGORY_BY_SOURCE（generate-article.ts、ルールベース）をそのまま使う。
 * - 1投稿1回: 対象Postの抽出クエリ自体が `where: { article: null }` のため、既にArticleが
 *   紐付いたPostはそもそも対象にならない（Article.postId は @unique）。
 * - moderation（NG/出典/中傷/重複）は旧経路と同じ moderateArticleContent を必ず通す。
 * - 1件の生成失敗は記録して他Postの処理を継続する。全体としても例外を投げない（呼び出し側
 *   run-pipeline.tsの最終安全網がさらに保護するため、ここでは想定内失敗の握り潰しのみ担当する）。
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { CategoryLabel } from "@/lib/categories";
import { SOURCE_TYPES, type SourceType } from "@/lib/collection/types";
import {
  generateArticleForCandidate,
  GenerationError,
  type GenerationCandidate,
} from "@/lib/generation/generate-article";
import { getLLMClient, type LLMClient } from "@/lib/generation/llm-client";
import { loadPublishedContentPool } from "@/lib/generation/pipeline";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { bodyBlocksToText } from "@/lib/search";
import { fetchChampionNameToIdMap, type ChampionNameToIdMap } from "@/lib/generation/champion-thumbnail";
import {
  evaluateHotness,
  type HotnessMetricsPoint,
  type HotnessMetricsSummary,
  type HotnessResult,
} from "@/lib/hotness/evaluator";
import { getExemptSourceTypes, getHotnessConfig } from "@/lib/hotness/config";
import { getPipelineConfig } from "@/lib/pipeline/config";

/** metricsをincludeしたPostの型（Prismaの生成型から導出、DB非依存の純関数にも渡せる）。 */
type PostWithMetrics = Prisma.PostGetPayload<{ include: { metrics: true } }>;

export type PostGenerationRunResult =
  | {
      postId: string;
      status: "success";
      articleId: string;
      slug: string;
      /** F9の安全フィルタ判定結果。held のときは heldReason に理由コードが入る。 */
      publicationStatus: "published" | "held";
      heldReason?: string;
    }
  | { postId: string; status: "failure"; errorMessage: string };

export type PostGenerationRunSummary = {
  succeededCount: number;
  failedCount: number;
  results: PostGenerationRunResult[];
};

export type PostGenerationOptions = {
  /**
   * カテゴリ(=ソース種別)別の1回の実行あたり記事化数上限（拡張E48踏襲）。
   * 未指定時は getPipelineConfig().maxPublishPerCategory（既定2）。
   */
  maxPerCategory?: number;
  /** hotness判定の基準時刻（テスト注入用）。未指定時は new Date()。 */
  now?: Date;
  /**
   * チャンピオン検出（拡張E31 F-E31-1）用Map。generateArticlesForQueueと同じ意味論:
   * 未指定(undefined)ならrun開始時に1回だけ実フェッチ、明示的にnullならフェッチ自体をスキップする。
   */
  championMap?: ChampionNameToIdMap | null;
};

/** Postのslug（本格的なSEOスラッグ生成はS5bのため、暫定的にpostIdから決定論的に組む）。 */
function slugForPost(postId: string): string {
  return `post-gen-${postId}`;
}

/** Post.media（JSON、形は収集アダプタ依存の`{ imageUrl, url }`等）からimageUrlだけを安全に取り出す。 */
function extractPostImageUrl(media: Prisma.JsonValue | null): string | null {
  if (media && typeof media === "object" && !Array.isArray(media)) {
    const value = (media as Record<string, unknown>).imageUrl;
    if (typeof value === "string") return value;
  }
  return null;
}

/**
 * hotnessの強さをカテゴリ内ソートに使う1つの数値にまとめる（決定論・AI不使用）。
 * 現在値(score/comments)と増加率のいずれの条件でhotになった場合でも一貫して比較できるよう、
 * 4指標を単純合算する（reddit=score優勢・5ch=comments優勢という各ソースの特性を吸収する）。
 */
function hotnessStrength(metrics: HotnessMetricsSummary): number {
  return metrics.score + metrics.comments + metrics.scoreGrowthPerHour + metrics.commentGrowthPerHour;
}

/**
 * hotness免除ソース（既定riot、リファクタリング S5c F-S5c-1）向けの擬似HotnessResultを組み立てる。
 * 免除ソースはhotness判定そのものを経ない（age窓判定も含めて評価しない）ため常にisHot=trueとし、
 * metricsは参考情報として最新の実測値をそのまま入れる（hotnessStrengthのソートに使うが、免除ソースの
 * 実際の並び順は後段のpostedAt降順タイブレークで決める。カテゴリ内順序の決定論のため）。
 */
function buildExemptHotnessResult(post: PostWithMetrics): HotnessResult {
  const latest = post.metrics[post.metrics.length - 1];
  const metrics: HotnessMetricsSummary = {
    score: latest?.score ?? 0,
    comments: latest?.commentCount ?? 0,
    ageMinutes: 0,
    scoreGrowthPerHour: 0,
    commentGrowthPerHour: 0,
  };
  return {
    isHot: true,
    reasons: ["免除ソース（exemptSourceTypes）のためhotness判定を経ずに常に記事化対象"],
    metrics,
    // 成長G1: 免除ソース（公式パッチ/ニュース）は賛否が割れる概念に馴染まないため論争判定の対象外とする。
    controversyScore: 0,
    isControversial: false,
  };
}

/**
 * hot判定された（または免除された）Postを、カテゴリ(=ソース種別)ごとに独立してhotnessの強さ降順・
 * 同hotnessStrength時はisControversial優先（成長G1 F-G1-4。論争スレが選ばれやすくする）・
 * さらに同点はpostedAt降順（新しい投稿優先）で最大maxPerCategory件選ぶ
 * （拡張E48のカテゴリ別上限と同じ考え方。純関数・DB非依存・決定論）。
 * 後続のタイトル生成（isControversialを渡す）のため、選ばれたhotness結果も一緒に返す。
 */
function selectTopHotPosts(
  evaluated: { post: PostWithMetrics; hotness: HotnessResult }[],
  maxPerCategory: number,
): { post: PostWithMetrics; hotness: HotnessResult }[] {
  const bySource = new Map<SourceType, { post: PostWithMetrics; hotness: HotnessResult }[]>();
  for (const e of evaluated) {
    const sourceType = e.post.sourceType as SourceType;
    const list = bySource.get(sourceType) ?? [];
    list.push(e);
    bySource.set(sourceType, list);
  }

  const selected: { post: PostWithMetrics; hotness: HotnessResult }[] = [];
  for (const sourceType of SOURCE_TYPES) {
    const list = bySource.get(sourceType) ?? [];
    const sorted = [...list].sort((a, b) => {
      const diff = hotnessStrength(b.hotness.metrics) - hotnessStrength(a.hotness.metrics);
      if (diff !== 0) return diff;
      const controversyDiff = Number(b.hotness.isControversial) - Number(a.hotness.isControversial);
      if (controversyDiff !== 0) return controversyDiff;
      const postedAtDiff = b.post.postedAt.getTime() - a.post.postedAt.getTime();
      if (postedAtDiff !== 0) return postedAtDiff;
      return a.post.id.localeCompare(b.post.id); // 決定論のための最終タイブレーク
    });
    selected.push(...sorted.slice(0, maxPerCategory));
  }
  return selected;
}

/**
 * hot判定された未記事化Postだけを取得し、カテゴリ別上限で絞ってからAIで記事化する（F-S5a-1）。
 * 1件の生成失敗は記録して他Postの処理を継続する。全体としても例外を投げない。
 */
export async function generateArticlesFromHotPosts(
  llmClient: LLMClient = getLLMClient(),
  options: PostGenerationOptions = {},
): Promise<PostGenerationRunSummary> {
  const now = options.now ?? new Date();
  const maxPerCategory = options.maxPerCategory ?? getPipelineConfig().maxPublishPerCategory;
  const results: PostGenerationRunResult[] = [];

  // 未記事化(article無し)のPostのみを対象にする。Article.postId(@unique)により、既にarticleがある
  // Postはこの時点で除外される(=1投稿1回のAI実行を保証する)。
  const posts = await prisma.post.findMany({
    where: { article: null },
    include: { metrics: { orderBy: { capturedAt: "asc" } } },
  });

  if (posts.length === 0) {
    return { succeededCount: 0, failedCount: 0, results };
  }

  // 話題性判定(数値ルール・AI不使用): sourceType別の閾値でisHot判定し、非hotは記事化対象から外す。
  // ただしexemptSourceTypes(既定riot、リファクタリングS5c F-S5c-1)に含まれるsourceTypeは、
  // 公式ニュース等"話題性"で測るべきでないためhotness判定そのものを経ず常に記事化対象にする。
  const exemptSourceTypes = getExemptSourceTypes();
  const evaluated = posts
    .map((post) => {
      const sourceType = post.sourceType as SourceType;
      if (exemptSourceTypes.includes(sourceType)) {
        return { post, hotness: buildExemptHotnessResult(post) };
      }
      const metricsHistory: HotnessMetricsPoint[] = post.metrics.map((m) => ({
        score: m.score,
        commentCount: m.commentCount,
        capturedAt: m.capturedAt,
      }));
      const hotness = evaluateHotness(
        // 成長G1（F-G1-4）: upvoteRatioが未取得(null)のときはundefinedのまま渡す(comment比のみで判定)。
        { sourceType, postedAt: post.postedAt, metricsHistory, upvoteRatio: post.upvoteRatio ?? undefined },
        now,
        getHotnessConfig(sourceType),
      );
      return { post, hotness };
    })
    .filter((e) => e.hotness.isHot);

  const targetPosts = selectTopHotPosts(evaluated, maxPerCategory);

  if (targetPosts.length === 0) {
    return { succeededCount: 0, failedCount: 0, results };
  }

  // 重複判定の比較プールはこの実行中に公開された記事も随時追加し、同一実行内での重複も検出する。
  const contentPool = await loadPublishedContentPool();

  // チャンピオン検出用Mapはrun開始時に1回だけ取得し、Postごとにはフェッチしない
  // (generateArticlesForQueueと同じ方針。拡張E31 F-E31-1)。
  const championMap: ChampionNameToIdMap | undefined =
    options.championMap === null ? undefined : options.championMap ?? (await fetchChampionNameToIdMap());

  for (const { post, hotness } of targetPosts) {
    const candidate: GenerationCandidate = {
      id: post.id,
      sourceType: post.sourceType as SourceType,
      sourceUrl: post.url,
      title: post.title,
      content: post.body,
      imageUrl: extractPostImageUrl(post.media),
      // リファクタリングS7a（F-S7a-3）: 取得元ルールで付与されたPost.categoryがあればそれを、
      // 無ければ従来どおり generateArticleForCandidate 側でソース既定にフォールバックする。
      category: (post.category as CategoryLabel | null) ?? undefined,
      // 成長G1（F-G1-4）: 論争フラグをタイトル生成（generateHookTitleLLM/generateHookTitle）に渡す。
      isControversial: hotness.isControversial,
    };

    try {
      const generated = await generateArticleForCandidate(candidate, llmClient, championMap);
      const slug = slugForPost(post.id);
      const bodyText = bodyBlocksToText(generated.body);

      const moderation = moderateArticleContent(
        { title: generated.title, bodyText, sourceCount: generated.sources.length },
        { candidate: { title: generated.title, content: bodyText }, existing: contentPool },
      );
      const isPublished = moderation.status === "published";

      // Article作成＋Post紐付け(postId)を1つのトランザクションで原子的に行う。postIdは@uniqueのため、
      // 万一同一Postに対する多重実行があってもDB制約が二重記事化を防ぐ最後の砦になる。
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
            postId: post.id,
            // SEOメタ・タグ（リファクタリングS5b F-S5b-2）: 旧経路(pipeline.ts)と同じ方針。
            // generated.seoがnull(mock/失敗)ならSEO列・タグとも未設定のまま(従来メタにフォールバック)。
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
        return article.id;
      });

      if (isPublished) {
        // 同一実行内の後続Postが、今公開したばかりの記事と重複判定されるようにプールへ追加する。
        contentPool.unshift({ title: generated.title, content: bodyText });
      }

      results.push({
        postId: post.id,
        status: "success",
        articleId,
        slug,
        publicationStatus: isPublished ? "published" : "held",
        ...(isPublished ? {} : { heldReason: moderation.reason }),
      });
    } catch (err) {
      const errorMessage =
        err instanceof GenerationError || err instanceof Error ? err.message : String(err);
      console.error(`Post記事生成に失敗しました (postId=${post.id}):`, errorMessage);
      // 旧経路(CollectedItem)と異なりPostには生成失敗を記録する専用列が無い(スキーマ変更なしの方針)。
      // 次回実行時も再びhot判定されれば同じPostが対象になり得るが、Article.postId(@unique)により
      // 二重公開は起きないため、失敗の記録漏れが不変条件を壊すことはない。
      results.push({ postId: post.id, status: "failure", errorMessage });
    }
  }

  const succeededCount = results.filter((r) => r.status === "success").length;
  const failedCount = results.filter((r) => r.status === "failure").length;
  return { succeededCount, failedCount, results };
}
