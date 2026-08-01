/**
 * 運営CMS v2（admincms-S2 F5/F6）: 指定URLからの手動記事化。
 * 運営者がX投稿URL・RedditスレッドURLを貼ると、Hotness（盛り上がり判定）を無視して
 * 常に要レビュー（status="review"）の下書き記事を生成する（安全フィルタ不通過ならheld）。
 * 5chの手動記事化は対象外。
 *
 * 流れ:
 * 1. URLパース（manual-article-url.ts、純関数）。
 * 2. 二重防止: 同じ (sourceType, externalId) の Post に既にArticleが紐付いていれば再フェッチせず
 *    既存記事への導線を返す（Post.@@unique/Article.postId@uniqueをキーに使う）。
 * 3. 単発取得（manual-article-fetch.ts）。取得失敗は記事を作らず日本語メッセージを返す。
 * 4. 既存の `persistPosts`/`generateArticleForCandidate`/`moderateArticleContent` を再利用して
 *    Post→Article を作る。Hotness評価は一切通さない。カテゴリポリシーも参照せず常にreview
 *    （安全フィルタ不通過時のみheld）。
 */
import { prisma } from "@/lib/prisma";
import { persistPosts } from "@/lib/collection/persist-posts";
import type { RawCollectionItem } from "@/lib/collection/types";
import type { XReplyItem } from "@/lib/collection/adapters/x";
import { parseManualArticleUrl } from "@/lib/admin/manual-article-url";
import { fetchRedditThreadById, fetchTweetById, isXApiKeyConfigured } from "@/lib/admin/manual-article-fetch";
import {
  generateArticleForCandidate,
  GenerationError,
  type GenerationCandidate,
} from "@/lib/generation/generate-article";
import { getLLMClient, type LLMClient } from "@/lib/generation/llm-client";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { bodyBlocksToText } from "@/lib/search";
import { requireAuthorized, type AdminAuthContext } from "@/lib/admin/auth-context";

const MSG_INVALID = "有効なURLを入力してください";
const MSG_UNSUPPORTED = "この URL 形式には対応していません";
const MSG_X_API_KEY_MISSING = "X の API キーが未設定のため利用できません";
const MSG_ALREADY_EXISTS = "この URL は記事化済みです";

export type ManualArticleResult =
  | {
      success: true;
      kind: "created";
      articleId: string;
      slug: string;
      status: "review" | "held";
      message: string;
    }
  | {
      success: true;
      kind: "already_exists";
      articleId: string;
      slug: string;
      message: string;
    }
  | {
      success: false;
      kind: "invalid" | "unsupported" | "x_api_key_missing" | "fetch_failed" | "generation_failed";
      message: string;
    };

/** Prisma のユニーク制約違反(P2002)か（同時多重実行等でArticle.postIdの衝突が起きた場合の保険）。 */
function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/** slug を post.id から決定論的に組む（記事1件=1Postの1対1が保証されるため衝突しない）。 */
function slugForManualPost(postId: string): string {
  return `manual-${postId}`;
}

async function findExistingArticleForPost(
  sourceType: "reddit" | "x",
  externalId: string,
): Promise<{ articleId: string; slug: string } | null> {
  const post = await prisma.post.findUnique({
    where: { sourceType_externalId: { sourceType, externalId } },
    include: { article: { select: { id: true, slug: true } } },
  });
  if (post?.article) return { articleId: post.article.id, slug: post.article.slug };
  return null;
}

/**
 * 指定URLから手動記事化する。認可（`AdminAuthContext`）が無ければ何もせず例外を投げる
 * （他の運営CMS関数と同じ defense-in-depth 方針）。
 */
export async function createManualArticleFromUrl(
  rawUrl: string,
  auth: AdminAuthContext,
  llmClient: LLMClient = getLLMClient(),
): Promise<ManualArticleResult> {
  requireAuthorized(auth);

  const parsed = parseManualArticleUrl(rawUrl);
  if ("error" in parsed) {
    return {
      success: false,
      kind: parsed.error,
      message: parsed.error === "invalid" ? MSG_INVALID : MSG_UNSUPPORTED,
    };
  }

  // 二重防止（記事化済み判定）: 既存Articleがあれば再フェッチせず導線だけ返す。
  // X_API_KEYチェックより前に置くことで、キーを外した後に記事化済みのX URLを再投入しても
  // 「キー未設定」ではなく既存記事への導線を返せる（取得は発生しないためキー要否に依らない）。
  const existing = await findExistingArticleForPost(parsed.source, parsed.externalId);
  if (existing) {
    return { success: true, kind: "already_exists", ...existing, message: MSG_ALREADY_EXISTS };
  }

  // 新規のX URLでキー未設定なら、取得の前にここで弾く（AC: 実行しようとした時点で明示して弾く）。
  if (parsed.source === "x" && !isXApiKeyConfigured()) {
    return { success: false, kind: "x_api_key_missing", message: MSG_X_API_KEY_MISSING };
  }

  const originalUrl = rawUrl.trim();
  const now = new Date();

  let title: string;
  let content: string;
  let imageUrl: string | null = null;
  let author: string | null = null;
  let flair: string | null = null;
  let score = 0;
  let commentCount = 0;
  let xReplies: XReplyItem[] = [];

  if (parsed.source === "reddit") {
    const result = await fetchRedditThreadById(parsed.externalId);
    if (!result.ok) return { success: false, kind: "fetch_failed", message: result.message };
    title = result.data.title;
    content = result.data.content;
    imageUrl = result.data.imageUrl;
    score = result.data.score;
    commentCount = result.data.commentCount;
    author = result.data.author;
    flair = result.data.flair;
  } else {
    const result = await fetchTweetById(parsed.externalId);
    if (!result.ok) return { success: false, kind: "fetch_failed", message: result.message };
    title = result.data.title;
    content = result.data.content;
    author = result.data.author;
    xReplies = result.data.xReplies;
    commentCount = xReplies.length;
  }

  const item: RawCollectionItem = {
    sourceUrl: originalUrl,
    title,
    content,
    fetchedAt: now,
    externalId: parsed.externalId,
    imageUrl,
    score,
    commentCount,
    author,
    flair,
    media: parsed.source === "x" && xReplies.length > 0 ? { xReplies } : undefined,
  };

  await persistPosts([item], parsed.source, now);

  const post = await prisma.post.findUnique({
    where: { sourceType_externalId: { sourceType: parsed.source, externalId: parsed.externalId } },
  });
  if (!post) {
    return { success: false, kind: "fetch_failed", message: "投稿の保存に失敗しました" };
  }

  const candidate: GenerationCandidate = {
    id: post.id,
    sourceType: parsed.source,
    sourceUrl: originalUrl,
    title,
    content,
    imageUrl,
    author: author ?? undefined,
    xReplies: parsed.source === "x" ? xReplies : undefined,
  };

  try {
    const generated = await generateArticleForCandidate(candidate, llmClient);
    const bodyText = bodyBlocksToText(generated.body);
    const moderation = moderateArticleContent({
      title: generated.title,
      bodyText,
      sourceCount: generated.sources.length,
    });
    const isPublished = moderation.status === "published";
    // 手動記事化はカテゴリ公開ポリシーを参照せず、安全フィルタ通過時は常に要レビュー(review)にする
    // （手動は必ず運営確認を挟む方針。Hotness評価も一切通していない）。
    const status: "review" | "held" = isPublished ? "review" : "held";
    const slug = slugForManualPost(post.id);

    const articleId = await prisma.$transaction(async (tx) => {
      const article = await tx.article.create({
        data: {
          slug,
          title: generated.title,
          category: generated.category,
          body: generated.body,
          thumbnailUrl: generated.thumbnailUrl,
          publishedAt: now,
          status,
          heldReason: isPublished ? null : moderation.reason,
          heldDetail: isPublished ? null : moderation.detail,
          unconfirmed: isPublished ? moderation.unconfirmed : false,
          postId: post.id,
          // SEOメタ・タグ: 本流(post-pipeline)と同方針。generated.seoがnull(mock/失敗)なら
          // SEO列・タグとも未設定のまま（従来メタにフォールバック）。手動記事もタグ一覧に載るようにする。
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
          sources: { create: generated.sources },
        },
      });
      return article.id;
    });

    const heldSuffix =
      !isPublished && moderation.status === "held" ? `（安全フィルタにより保留: ${moderation.detail}）` : "";
    return {
      success: true,
      kind: "created",
      articleId,
      slug,
      status,
      message: `記事を作成しました${heldSuffix}`,
    };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // 同時多重実行等でArticle.postId(@unique)の衝突が起きた場合、既存記事への導線を返す。
      const raceExisting = await findExistingArticleForPost(parsed.source, parsed.externalId);
      if (raceExisting) {
        return { success: true, kind: "already_exists", ...raceExisting, message: MSG_ALREADY_EXISTS };
      }
    }
    const message = err instanceof GenerationError || err instanceof Error ? err.message : String(err);
    return { success: false, kind: "generation_failed", message };
  }
}
