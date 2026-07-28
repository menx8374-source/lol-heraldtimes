/**
 * 未適用パッチpreview記事の、本番反映後の自動確定（パッチ記事刷新S5 F-S5-3・opt-in）。
 * `PATCH_PREVIEW_MODE=on` のときのみ動作する。off/未設定では即座に no-op を返し、DBへは一切
 * アクセスしない（既存挙動を1バイトも変えない・回帰ゼロ）。
 *
 * 対象: sourceType="riot" かつ Article が紐付き、かつ現在のArticle本文が速報バッジ付き(preview)だが
 * Post側は既に本番反映済みの内容で再persistされている（`Post.media.patchPreview` フラグが外れている）
 * Post。既存の記事更新機構（`generateArticleForCandidate` + `Article.update` + `ArticleUpdateHistory`、
 * `article-updater.ts` と同じ発想）を流用し、同一Articleをin-place更新する（slug・id・postId・
 * publishedAt は変更せず、重複記事を作らない）。DBスキーマは変更しない
 * （patchStageは本文先頭の速報バッジブロックの有無で表現する）。
 *
 * 不変条件（article-updater.tsと同方針）:
 * - moderation（NG/出典/中傷）不通過なら更新自体を行わない。
 * - 重複判定（duplicate）は、更新対象記事自身の「preview版の内容」と比較すると自己重複で
 *   誤検出するため、この更新経路では適用しない。
 * - 1件の失敗（parse/生成/DB）は握り潰してログし、他Postの処理を継続する。全体としても
 *   例外を投げない。
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { CategoryLabel } from "@/lib/categories";
import { isPatchPreviewModeEnabled } from "@/lib/collection/adapters/riot-datadragon";
import { generateArticleForCandidate, type GenerationCandidate } from "@/lib/generation/generate-article";
import { getLLMClient, type LLMClient } from "@/lib/generation/llm-client";
import { isPatchPreviewArticleBody, parseArticleBody } from "@/lib/article-body";
import { extractPostImageUrl, extractPostHtml, extractPostPatchPreview } from "@/lib/generation/post-pipeline";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { bodyBlocksToText } from "@/lib/search";

type PostWithArticle = Prisma.PostGetPayload<{ include: { article: true } }>;

export type ConfirmPatchPreviewOptions = {
  /** 更新日時（テスト注入用）。省略時は new Date()。 */
  now?: Date;
  /** 省略時は getLLMClient()。 */
  llmClient?: LLMClient;
};

export type ConfirmPatchPreviewResult = {
  /** preview判定の対象として調べたPost数（riot由来かつArticleが紐付くもの）。 */
  checked: number;
  /** 確定版へ更新した件数。 */
  confirmed: number;
  /** まだ本番未反映・既に確定済み・moderation不通過等でスキップした件数。 */
  skipped: number;
};

/**
 * preview記事を確定版へ自動更新する（F-S5-3）。`PATCH_PREVIEW_MODE`が無効（既定）なら
 * 即座に no-op（DBアクセスなし）で返す。1件の失敗は握り潰して他Postの処理を継続し、
 * 全体としても例外を投げない。
 */
export async function confirmPatchPreviewArticles(
  options: ConfirmPatchPreviewOptions = {},
): Promise<ConfirmPatchPreviewResult> {
  if (!isPatchPreviewModeEnabled()) {
    return { checked: 0, confirmed: 0, skipped: 0 };
  }

  const now = options.now ?? new Date();
  const llmClient = options.llmClient ?? getLLMClient();

  const posts = (await prisma.post.findMany({
    where: { sourceType: "riot", article: { isNot: null } },
    include: { article: true },
  })) as PostWithArticle[];

  let checked = 0;
  let confirmed = 0;
  let skipped = 0;

  for (const post of posts) {
    checked += 1;
    const article = post.article;
    if (!article) {
      // article: { isNot: null } で絞り込み済みのため通常起こらないが、型安全のためのガード。
      skipped += 1;
      continue;
    }

    try {
      // Post側がまだpreviewのまま（本番未反映）なら確定させず何もしない。
      if (extractPostPatchPreview(post.media)) {
        skipped += 1;
        continue;
      }

      const currentBody = parseArticleBody(article.body);
      if (!isPatchPreviewArticleBody(currentBody)) {
        // 既に確定版(バッジ無し)、またはそもそもpreview形式でない記事は対象外。
        skipped += 1;
        continue;
      }

      const candidate: GenerationCandidate = {
        id: post.id,
        sourceType: "riot",
        sourceUrl: post.url,
        title: post.title,
        content: post.body,
        imageUrl: extractPostImageUrl(post.media),
        html: extractPostHtml(post.media),
        category: (post.category as CategoryLabel | null) ?? undefined,
        isPatchPreview: false,
      };

      const generated = await generateArticleForCandidate(candidate, llmClient);
      const bodyText = bodyBlocksToText(generated.body);

      // 重複判定(duplicate)は既存公開記事プールとの比較が前提のため、更新対象記事自身の
      // 「preview版の内容」と比較すると自己重複と誤検出してしまう。この経路では適用しない
      // （NGワード・出典欠落・個人中傷は従来どおり適用する、article-updater.tsと同方針）。
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
          data: { articleId: article.id, reason: "patch_preview_confirmed", updatedAt: now },
        });
      });

      confirmed += 1;
    } catch (err) {
      console.error(
        `preview記事の確定更新に失敗しました(postId=${post.id}, articleId=${article.id})。この1件をスキップして続行します:`,
        err,
      );
      skipped += 1;
    }
  }

  return { checked, confirmed, skipped };
}
