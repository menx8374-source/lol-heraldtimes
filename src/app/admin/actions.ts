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
import { createManualArticleFromUrl, type ManualArticleResult } from "@/lib/admin/manual-article";
import { draftsToRawBlocks, type BlockDraft } from "@/lib/admin/article-editor-form";
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

/**
 * 指定URLからの手動記事化（admincms-S2 F5/F6）。`useActionState` から呼ばれる想定のため、
 * 他アクションと異なり結果（成功/失敗と表示用メッセージ）をそのまま返す（redirectしない。
 * クライアント側で実行中表示・結果表示・二重送信防止を行うため）。
 */
export async function manualArticleAction(
  _prevState: ManualArticleResult | null,
  formData: FormData,
): Promise<ManualArticleResult> {
  const auth = await currentAuthContext();
  const url = typeof formData.get("url") === "string" ? (formData.get("url") as string) : "";
  const result = await createManualArticleFromUrl(url, auth);
  // 手動記事化は常にreview/held（非公開）で作られるため、公開一覧("/")の再検証は不要。
  if (result.success) {
    revalidatePath("/admin");
  }
  return result;
}

/** `updateArticleAction`の実行結果（admincms-S3補完）。失敗時は`ArticleEditor`が自身のReact state
 * （編集中のブロック/メタ）を保持したまま、このエラーメッセージだけを表示できるようにするため
 * redirectせず戻り値として返す（`useActionState`で受け取る想定）。 */
export type UpdateArticleActionState = { success: true } | { success: false; error: string };

/**
 * 構造化エディタ（admincms-S3）の保存アクション。`ArticleEditor.tsx` がブロックドラフト配列・タグ配列を
 * JSON文字列にシリアライズしてhidden inputに詰めて送信し、`useActionState`経由で呼び出す。
 * ここではFormDataの取り出しとJSONパースのみを行い、ブロックドラフト→本文の変換(`draftsToRawBlocks`)と
 * 検証(`parseArticleBody`＋アンカー整合)は`updateArticleContent`（と内部で使う純関数）に委譲する。
 * 検証NG・不正なJSON等は例外を投げず`{success:false, error}`を返す（DBは一切変更しない＝記事不変）。
 * これによりクライアント側は編集中の入力内容を保ったままエラーメッセージだけを表示できる
 * （旧実装のredirectはDB再取得でフォームをリセットしてしまうため、成功時のみredirectする）。
 */
export async function updateArticleAction(
  _prevState: UpdateArticleActionState | null,
  formData: FormData,
): Promise<UpdateArticleActionState> {
  const auth = await currentAuthContext();
  const articleId = requiredString(formData, "articleId");
  const title = requiredString(formData, "title");
  const category = requiredString(formData, "category");
  const metaDescription = (formData.get("metaDescription") as string | null) ?? "";
  const thumbnailUrl = (formData.get("thumbnailUrl") as string | null) ?? "";
  const tagsJson = (formData.get("tagsJson") as string | null) ?? "[]";
  const blocksJson = requiredString(formData, "blocksJson");
  const statusRaw = formData.get("status");
  const status = statusRaw === "review" || statusRaw === "published" ? statusRaw : undefined;

  let tags: string[];
  let drafts: BlockDraft[];
  try {
    tags = JSON.parse(tagsJson);
    drafts = JSON.parse(blocksJson);
  } catch {
    return { success: false, error: "フォームの内容が不正です" };
  }

  try {
    await updateArticleContent(
      articleId,
      { title, metaDescription, category, tags, thumbnailUrl, status, body: draftsToRawBlocks(drafts) },
      auth,
    );
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  revalidatePath("/admin");
  revalidatePath("/");
  redirect("/admin");
}
