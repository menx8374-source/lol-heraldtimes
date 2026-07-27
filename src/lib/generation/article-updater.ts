/**
 * 記事更新サービス（リファクタリングS6 F-S6-3）。公開後もPostを監視し、Scoreが大きく伸びた／
 * コメントが急増したときだけ記事を再AI更新する。判定は数値ルール（AI不使用、`shouldUpdateArticle`）
 * のみで行い、通常は再実行しない（cooldown・maxCount・maxAgeで抑制）。多重更新の防止は
 * `ArticleUpdateHistory`（S1）に記録した更新回数・前回更新日時で行う（DBスキーマ変更なし）。
 *
 * 不変条件:
 * - 更新対象は「articleが紐付き（記事化済み）かつ monitoring=true」のPostのみ。免除ソース
 *   （既定riot、`getExemptSourceTypes`）は"伸び"で測るべきでないため対象外。
 * - 既存Articleは in-place 更新（body/title/thumbnailUrl/SEO列/tags）し、
 *   slug・id・postId・publishedAt は一切変更しない。
 * - moderation（NG/出典/中傷）不通過なら更新自体を行わない（公開中の内容を壊さない）。
 *   重複判定（duplicate）は、更新対象記事自身の「伸びる前の内容」と比較すると自己重複で
 *   誤検出してしまうため、この更新経路では適用しない（NG/出典/中傷は従来どおり適用する）。
 * - 1件の失敗（fetch/生成/DB）は握り潰してログし、他Postの処理を継続する。全体としても
 *   例外を投げない。リクエスト間はディレイ（sleep注入可）を挟み直列で処理する
 *   （metrics-updater.ts / 各収集アダプタと同方針）。
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { SourceAdapter, SourceType } from "@/lib/collection/types";
import { getAllAdapters } from "@/lib/collection/adapters";
import { getArticleUpdateConfig, getExemptSourceTypes } from "@/lib/hotness/config";
import { resolveBaselineMetrics, shouldUpdateArticle } from "@/lib/hotness/update-trigger";
import type { HotnessMetricsPoint } from "@/lib/hotness/evaluator";
import { generateArticleForCandidate, type GenerationCandidate } from "@/lib/generation/generate-article";
import { getLLMClient, type LLMClient } from "@/lib/generation/llm-client";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { bodyBlocksToText } from "@/lib/search";

const DEFAULT_MAX_POSTS_PER_RUN = 20;
const DEFAULT_REQUEST_DELAY_MS = 1000;

function envIntLocal(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** sourceType→adapter のレジストリ。fetchContent 未実装のソース（riot等）は含まれていても素通りする。 */
function buildAdapterMap(): Partial<Record<SourceType, SourceAdapter>> {
  const map: Partial<Record<SourceType, SourceAdapter>> = {};
  for (const adapter of getAllAdapters()) {
    map[adapter.sourceType] = adapter;
  }
  return map;
}

type PostWithArticleAndMetrics = Prisma.PostGetPayload<{
  include: { article: true; metrics: true };
}>;

export type UpdateHotArticlesOptions = {
  /** 現在時刻（テスト注入用）。省略時は new Date()。 */
  now?: Date;
  /** 省略時は getLLMClient()。 */
  llmClient?: LLMClient;
  /** sourceType→adapter。省略時は getAllAdapters() から構築する（テストは注入可）。 */
  adapters?: Partial<Record<SourceType, SourceAdapter>>;
  /** 1回の実行で調べる最大Post数（有界化）。省略時は env `UPDATE_MAX_POSTS_PER_RUN`（既定20）。 */
  maxPostsPerRun?: number;
  /** ディレイの実処理の注入点（テスト用）。既定は実 setTimeout ベースの sleep。 */
  sleep?: (ms: number) => Promise<void>;
  /** 連続fetch間のディレイ(ms)。既定は env `UPDATE_REQUEST_DELAY_MS`（既定1000）。 */
  delayMs?: number;
};

export type UpdateHotArticlesResult = {
  /** 監視対象として調べたPost数。 */
  checked: number;
  /** 実際に再AI更新した件数。 */
  updated: number;
  /** トリガしなかった／取得失敗／moderation不通過等でスキップした件数。 */
  skipped: number;
};

/**
 * 監視中Postのうち「伸びた」もの（shouldUpdateArticleがtrue）だけ、現在の内容を再取得して
 * 再AI更新する（F-S6-3）。1件の失敗は握り潰してログし、他Postの処理を継続する。
 * 全体としても例外を投げない。
 */
export async function updateHotArticles(options: UpdateHotArticlesOptions = {}): Promise<UpdateHotArticlesResult> {
  const now = options.now ?? new Date();
  const llmClient = options.llmClient ?? getLLMClient();
  const adapters = options.adapters ?? buildAdapterMap();
  const maxPostsPerRun = options.maxPostsPerRun ?? envIntLocal("UPDATE_MAX_POSTS_PER_RUN", DEFAULT_MAX_POSTS_PER_RUN);
  const delayMs = options.delayMs ?? envIntLocal("UPDATE_REQUEST_DELAY_MS", DEFAULT_REQUEST_DELAY_MS);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const config = getArticleUpdateConfig();
  const exemptSourceTypes = getExemptSourceTypes();

  let checked = 0;
  let updated = 0;
  let skipped = 0;
  let firstFetchDone = false;

  const posts = (await prisma.post.findMany({
    where: {
      monitoring: true,
      article: { isNot: null },
      sourceType: { notIn: exemptSourceTypes },
    },
    include: { article: true, metrics: { orderBy: { capturedAt: "asc" } } },
    orderBy: { updatedAt: "asc" },
    take: maxPostsPerRun,
  })) as PostWithArticleAndMetrics[];

  for (const post of posts) {
    checked += 1;
    const article = post.article;
    if (!article) {
      // article: { isNot: null } で絞り込み済みのため通常起こらないが、型安全のためのガード。
      skipped += 1;
      continue;
    }

    try {
      const history = await prisma.articleUpdateHistory.findMany({
        where: { articleId: article.id },
        orderBy: { updatedAt: "desc" },
      });
      const updateCount = history.length;
      const lastUpdatedAt = history[0]?.updatedAt ?? article.createdAt;

      const metricsHistory: HotnessMetricsPoint[] = post.metrics.map((m) => ({
        score: m.score,
        commentCount: m.commentCount,
        capturedAt: m.capturedAt,
      }));
      const baseline = resolveBaselineMetrics(metricsHistory, lastUpdatedAt);

      const decision = shouldUpdateArticle(
        {
          sourceType: post.sourceType as SourceType,
          postedAt: post.postedAt,
          metricsHistory,
          baselineScore: baseline.score,
          baselineComments: baseline.comments,
          lastUpdatedAt,
          updateCount,
        },
        now,
        config,
      );

      if (!decision.shouldUpdate || !decision.reason) {
        skipped += 1;
        continue;
      }

      const adapter = adapters[post.sourceType as SourceType];
      if (!adapter?.fetchContent) {
        skipped += 1;
        continue;
      }

      if (firstFetchDone) {
        await sleep(delayMs);
      } else {
        firstFetchDone = true;
      }

      const fetched = await adapter.fetchContent(post.externalId);
      if (!fetched) {
        skipped += 1;
        continue;
      }

      const candidate: GenerationCandidate = {
        id: post.id,
        sourceType: post.sourceType as SourceType,
        sourceUrl: post.url,
        title: fetched.title,
        content: fetched.content,
        imageUrl: fetched.imageUrl,
      };

      const generated = await generateArticleForCandidate(candidate, llmClient);
      const bodyText = bodyBlocksToText(generated.body);

      // 重複判定(duplicate)は既存公開記事プールとの比較が前提のため、更新対象記事自身の
      // 「伸びる前の内容」と比較すると自己重複と誤検出してしまう。この経路では適用しない
      // （NGワード・出典欠落・個人中傷は従来どおり適用する）。
      const moderation = moderateArticleContent({
        title: generated.title,
        bodyText,
        sourceCount: generated.sources.length,
      });

      if (moderation.status !== "published") {
        skipped += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.article.update({
          where: { id: article.id },
          data: {
            title: generated.title,
            body: generated.body,
            thumbnailUrl: generated.thumbnailUrl,
            ...(generated.seo
              ? {
                  seoTitle: generated.seo.seoTitle,
                  metaDescription: generated.seo.metaDescription,
                  ogTitle: generated.seo.ogTitle,
                  ogDescription: generated.seo.ogDescription,
                  tags: {
                    deleteMany: {},
                    create: generated.seo.tags.map((name) => ({
                      tag: { connectOrCreate: { where: { name }, create: { name } } },
                    })),
                  },
                }
              : {}),
          },
        });
        await tx.articleUpdateHistory.create({
          data: { articleId: article.id, reason: decision.reason!, updatedAt: now },
        });
      });

      updated += 1;
    } catch (err) {
      console.error(`記事更新に失敗しました(postId=${post.id}, articleId=${article.id})。この1件をスキップして続行します:`, err);
      skipped += 1;
    }
  }

  return { checked, updated, skipped };
}
