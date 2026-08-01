"use server";

/**
 * 運営CMS（拡張E7）のサーバーアクション。/admin ページ・編集ページのフォームから呼ばれる。
 * 実データの読み書きは lib/admin/*.ts に委譲し、ここでは「リクエストの Authorization ヘッダーを
 * 取り出して認可コンテキストを作る」「FormData をパースする」「完了後に /admin を再検証する」だけを担う。
 *
 * ⚠ middleware.ts が /admin へのアクセス自体を既にBasic認証で守っているが、
 * lib/admin/*.ts の各関数はここから渡された authorizationHeader を使って独立に再チェックする
 * （UIを隠すだけの対策にしない）。
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  approveHeldArticle,
  rejectHeldArticle,
  updateArticleContent,
  toggleArticlePinned,
  scheduleArticlePublish,
  cancelScheduledPublish,
  approveReviewArticle,
  rejectReviewArticle,
} from "@/lib/admin/articles-admin";
import { approveHeldComment, rejectHeldComment } from "@/lib/admin/comments-admin";
import { setCategoryAutoPublish } from "@/lib/admin/category-policy";
import type { AdminAuthContext } from "@/lib/admin/auth-context";

async function currentAuthContext(): Promise<AdminAuthContext> {
  const hdrs = await headers();
  return { authorizationHeader: hdrs.get("authorization") };
}

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} が指定されていません`);
  }
  return value;
}

export async function approveArticleAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  await approveHeldArticle(requiredString(formData, "articleId"), auth);
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function rejectArticleAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  await rejectHeldArticle(requiredString(formData, "articleId"), auth);
  revalidatePath("/admin");
}

export async function pinArticleAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  const articleId = requiredString(formData, "articleId");
  const pinned = formData.get("pinned") === "true";
  await toggleArticlePinned(articleId, pinned, auth);
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function scheduleArticleAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  const articleId = requiredString(formData, "articleId");
  const scheduledAt = new Date(requiredString(formData, "scheduledAt"));
  await scheduleArticlePublish(articleId, scheduledAt, auth);
  revalidatePath("/admin");
}

export async function cancelScheduleAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  await cancelScheduledPublish(requiredString(formData, "articleId"), auth);
  revalidatePath("/admin");
}

export async function approveReviewArticleAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  await approveReviewArticle(requiredString(formData, "articleId"), auth);
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function rejectReviewArticleAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  await rejectReviewArticle(requiredString(formData, "articleId"), auth);
  revalidatePath("/admin");
}

export async function setCategoryPolicyAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  const category = requiredString(formData, "category");
  const autoPublish = formData.get("autoPublish") === "true";
  await setCategoryAutoPublish(category, autoPublish, auth);
  revalidatePath("/admin");
}

export async function approveCommentAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  await approveHeldComment(requiredString(formData, "commentId"), auth);
  revalidatePath("/admin");
}

export async function rejectCommentAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  await rejectHeldComment(requiredString(formData, "commentId"), auth);
  revalidatePath("/admin");
}

export async function updateArticleAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  const articleId = requiredString(formData, "articleId");
  const title = requiredString(formData, "title");
  const bodyText = requiredString(formData, "bodyText");

  try {
    await updateArticleContent(articleId, { title, bodyText }, auth);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/admin/articles/${articleId}/edit?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/admin");
  revalidatePath("/");
  redirect("/admin");
}
