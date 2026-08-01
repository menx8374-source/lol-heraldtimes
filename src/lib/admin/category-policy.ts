/**
 * カテゴリ別 公開ポリシー（admincms-S1 F1）。カテゴリごとに「自動公開」か「要レビュー」かをDBに
 * 永続化する（再起動後も保持される要件のため）。既定値は「全カテゴリ要レビュー」で、未保存・未知の
 * カテゴリ名はすべてこの既定にフォールバックする（安全側＝取りこぼしで誤って自動公開されない）。
 */
import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS, type CategoryLabel } from "@/lib/categories";
import { requireAuthorized, type AdminAuthContext } from "@/lib/admin/auth-context";

export type CategoryPolicyRow = { category: string; autoPublish: boolean };

/** 未保存・未知カテゴリの既定値（要レビュー）。 */
export const DEFAULT_AUTO_PUBLISH = false;

/**
 * 純関数: 保存済みポリシー行から指定カテゴリの自動公開可否を解決する。
 * 該当行が無ければ（未保存・未知のカテゴリ名を含む）既定値(DEFAULT_AUTO_PUBLISH)にフォールバックする。
 */
export function resolveAutoPublish(rows: readonly CategoryPolicyRow[], category: string): boolean {
  return rows.find((r) => r.category === category)?.autoPublish ?? DEFAULT_AUTO_PUBLISH;
}

/** DBに保存済みの全ポリシー行をそのまま返す（パイプライン実行中に1回だけ取得して使う想定）。 */
export async function loadCategoryPolicyRows(): Promise<CategoryPolicyRow[]> {
  return prisma.categoryPublishPolicy.findMany({ select: { category: true, autoPublish: true } });
}

export type CategoryPolicyDisplayRow = { category: CategoryLabel; autoPublish: boolean };

/**
 * 管理画面の「公開ポリシー」パネル用: 定義済み全カテゴリ（6件）を、保存済み設定とマージし
 * CATEGORY_LABELS の定義順で返す（未保存カテゴリも「要レビュー」として必ず1行表示される）。
 */
export async function getCategoryPoliciesForDisplay(): Promise<CategoryPolicyDisplayRow[]> {
  const rows = await loadCategoryPolicyRows();
  return CATEGORY_LABELS.map((category) => ({ category, autoPublish: resolveAutoPublish(rows, category) }));
}

/** カテゴリの公開ポリシーを保存する（未認証は拒否・DBを変更しない）。 */
export async function setCategoryAutoPublish(
  category: string,
  autoPublish: boolean,
  auth: AdminAuthContext,
): Promise<void> {
  requireAuthorized(auth);
  await prisma.categoryPublishPolicy.upsert({
    where: { category },
    create: { category, autoPublish },
    update: { autoPublish },
  });
}
