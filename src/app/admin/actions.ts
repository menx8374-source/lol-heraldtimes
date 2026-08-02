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
  bulkApproveReviewArticles,
} from "@/lib/admin/articles-admin";
import { approveHeldComment, rejectHeldComment } from "@/lib/admin/comments-admin";
import { setCategoryAutoPublish } from "@/lib/admin/category-policy";
import { createManualArticleFromUrl, type ManualArticleResult } from "@/lib/admin/manual-article";
import { draftsToRawBlocks, type BlockDraft } from "@/lib/admin/article-editor-form";
import { revalidateListingPathsInProcess } from "@/lib/generation/revalidate-listings";
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

/**
 * レビューキューの個別承認（admincms-S1 F2、admincms-S5設計整理で反映経路を整理）。承認後、
 * 一覧ページ群＋当該記事の個別詳細ページを同一プロセス内で直接`revalidatePath`する
 * （`bulkApproveReviewArticlesAction`と対称にするため。旧実装は`/admin`と`/`のみの再検証だった
 * ため、`REVALIDATE_SECRET`未設定の既定構成ではカテゴリ/タグ一覧に反映されない非対称があった）。
 */
export async function approveReviewArticleAction(formData: FormData): Promise<void> {
  const auth = await currentAuthContext();
  const { slug } = await approveReviewArticle(requiredString(formData, "articleId"), auth);
  revalidatePath("/admin");
  revalidateListingPathsInProcess();
  revalidatePath(`/articles/${slug}`);
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

/** `updateArticleAction`の実行結果（admincms-S3補完、admincms-S5 F10で`revalidateWarning`を追加・
 * S5設計整理で警告条件を見直し）。失敗時は`ArticleEditor`が自身のReact state（編集中のブロック/
 * メタ）を保持したまま、このエラーメッセージだけを表示できるようにするためredirectせず戻り値として
 * 返す（`useActionState`で受け取る想定）。保存成功後の一覧/詳細反映は同一プロセス内の直接
 * `revalidatePath`（`revalidateListingPathsInProcess`）で行い、これは通常失敗しない（=既定構成でも
 * 反映は保証される）。`revalidateWarning:true`は、その直接呼び出し自体が例外を投げた**真の失敗時
 * のみ**セットされ、redirectしない（DB保存は既に確定しており巻き戻さない。エディタが警告バナーを
 * 表示する）。 */
export type UpdateArticleActionState =
  | { success: true; revalidateWarning: boolean }
  | { success: false; error: string };

/**
 * 構造化エディタ（admincms-S3）の保存アクション。`ArticleEditor.tsx` がブロックドラフト配列・タグ配列を
 * JSON文字列にシリアライズしてhidden inputに詰めて送信し、`useActionState`経由で呼び出す。
 * ここではFormDataの取り出しとJSONパースのみを行い、ブロックドラフト→本文の変換(`draftsToRawBlocks`)と
 * 検証(`parseArticleBody`＋アンカー整合)は`updateArticleContent`（と内部で使う純関数）に委譲する。
 * 検証NG・不正なJSON等は例外を投げず`{success:false, error}`を返す（DBは一切変更しない＝記事不変）。
 * これによりクライアント側は編集中の入力内容を保ったままエラーメッセージだけを表示できる。
 *
 * 保存成功後（admincms-S5 F10、S5設計整理）: 一覧ページ群＋当該記事の個別詳細ページ(`/articles/[slug]`)
 * を同一プロセス内で直接`revalidatePath`し、公開状態の遷移（review⇄published）・カテゴリ変更・
 * タグ変更のいずれでも保存直後に一覧/詳細へ反映されるようにする（single VPS/同一プロセス前提。
 * HTTPループバック=機能Bはパイプライン専用のため、ここでは呼ばない）。この直接呼び出しが例外を
 * 投げた場合のみ`{success:true, revalidateWarning:true}`を返しredirectしない（保存自体は既に成功
 * しておりDBは巻き戻さない）。通常この呼び出しは失敗しないため、既定構成では警告は出ずredirectする。
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

  let slug: string;
  try {
    const result = await updateArticleContent(
      articleId,
      { title, metaDescription, category, tags, thumbnailUrl, status, body: draftsToRawBlocks(drafts) },
      auth,
    );
    slug = result.slug;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    revalidatePath("/admin");
    revalidateListingPathsInProcess();
    revalidatePath(`/articles/${slug}`);
  } catch (err) {
    console.error("一覧ページの即時反映(in-process)に失敗しました:", err instanceof Error ? err.message : err);
    return { success: true, revalidateWarning: true };
  }

  redirect("/admin");
}

/** `bulkApproveReviewArticlesAction`の実行結果（admincms-S5 F11）。`useActionState`で受け取る。
 * "idle"=未実行、"no_selection"=0件選択で実行された、"done"=集計結果あり。 */
export type BulkApproveActionState =
  | { status: "idle" }
  | { status: "no_selection" }
  | { status: "done"; succeededCount: number; failed: { id: string; reason: string }[] };

/**
 * レビューキューの一括承認（admincms-S5 F11、S5設計整理でHTTPループバックを撤去）。
 * `ReviewQueueList`（クライアント）のチェックボックス（`name="selectedIds"`）で選択された記事IDを
 * `formData.getAll`で受け取り、`bulkApproveReviewArticles`に委譲する。0件選択時はDBを一切変更せず
 * `{status:"no_selection"}`を返す（エラーにしない）。反映はループ内では行わず、**最後に1回だけ**
 * 一覧ページ群＋承認に成功した各記事の個別詳細ページ(`/articles/[slug]`)を同一プロセス内で直接
 * `revalidatePath`する（evaluatorフィードバック対応: 個別承認(`approveReviewArticleAction`)が
 * 詳細ページも再検証するのに対し、一括承認だけがそれをしない非対称を解消。N件承認してもHTTP往復は
 * 0回のまま、一覧の再検証だけ1回にまとめる）。
 */
export async function bulkApproveReviewArticlesAction(
  _prevState: BulkApproveActionState,
  formData: FormData,
): Promise<BulkApproveActionState> {
  const auth = await currentAuthContext();
  const articleIds = formData
    .getAll("selectedIds")
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  if (articleIds.length === 0) {
    return { status: "no_selection" };
  }

  const result = await bulkApproveReviewArticles(articleIds, auth);

  revalidatePath("/admin");
  revalidateListingPathsInProcess();
  for (const { slug } of result.succeeded) {
    revalidatePath(`/articles/${slug}`);
  }

  return { status: "done", succeededCount: result.succeeded.length, failed: result.failed };
}
