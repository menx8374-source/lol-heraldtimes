/**
 * AIまとめ記事生成パイプラインのDB連携部分（F7）。生成ロジック自体（構成分岐・逐語一致率・
 * 引用比率の判定）は generate-article.ts / compose.ts の純関数に委譲し、ここでは
 * 「記事化候補キューの取得」「生成結果の永続化(Article+ArticleSource)」
 * 「CollectedItemの状態同期(articleId/statusを原子的に揃える)」「失敗時の記録」のみを担当する。
 *
 * ⚠ Sprint 3からの申し送り: 候補から記事を生成したら、その CollectedItem の articleId をセットし、
 * status も "articled" に必ず同期する（原子的に）。これを怠ると listCandidateQueue（status=queued抽出）
 * が同アイテムを再提示して二重記事化を招く。
 */
import { prisma } from "@/lib/prisma";
import { listCandidateQueue } from "@/lib/collection/queue";
import { generateArticleForCandidate, GenerationError, type GenerationCandidate } from "@/lib/generation/generate-article";
import { getLLMClient, type LLMClient } from "@/lib/generation/llm-client";
import { generateHookTitle } from "@/lib/generation/title";
import { parseArticleBody } from "@/lib/article-body";

export type GenerationRunResult =
  | { collectedItemId: string; status: "success"; articleId: string; slug: string }
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

/**
 * 記事化候補キュー（status="queued"）を1件ずつ処理し、Article(+ArticleSource)を作成する。
 * 1件の生成に失敗しても他候補の処理は継続する（F7受け入れ基準:「生成に失敗した候補は
 * 生成失敗として記録され、他候補の生成は継続する」）。
 */
export async function generateArticlesForQueue(
  llmClient: LLMClient = getLLMClient(),
): Promise<GenerationRunSummary> {
  const candidates = await listCandidateQueue();
  const results: GenerationRunResult[] = [];

  for (const item of candidates) {
    const candidate: GenerationCandidate = {
      id: item.id,
      sourceType: item.sourceType as GenerationCandidate["sourceType"],
      sourceUrl: item.sourceUrl,
      title: item.title,
      content: item.content,
    };

    try {
      const generated = await generateArticleForCandidate(candidate, llmClient);
      const slug = slugForCandidate(item.id);

      // Article作成・ArticleSource作成・CollectedItemの状態同期(articleId+status)は
      // 一貫性が崩れると二重記事化を招くため、必ず1つのトランザクションで原子的に行う。
      const articleId = await prisma.$transaction(async (tx) => {
        const article = await tx.article.create({
          data: {
            slug,
            title: generated.title,
            category: generated.category,
            body: generated.body,
            publishedAt: new Date(),
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

      results.push({ collectedItemId: item.id, status: "success", articleId, slug });
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
    ? { title: source.title, content: source.content }
    : { title: article.title, content: parseArticleBody(article.body).map((b) => b.text).join("") };

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
