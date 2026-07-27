/**
 * カテゴリの「一覧導線への露出」を、公開記事の有無で絞り込む（リファクタリングS7a F-S7a-2）。
 * カテゴリを追加しても記事がまだ無いうち（今回のRiot公式/eスポーツ再追加のように）は
 * ヘッダーナビ・sitemap に出さない（拡張E45が嫌った「空カテゴリ」の露出を防ぐ）。
 * カテゴリ個別ページ（/category/<slug>）自体は従来どおり存在し、直リンクは可能なまま
 * （このモジュールが絞るのは一覧導線のみ）。
 */
import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS, type CategoryLabel } from "@/lib/categories";

/**
 * 純関数: 定義済みカテゴリラベル一覧のうち、公開記事があるカテゴリラベル集合に含まれるものだけを、
 * 定義順を保って返す。DB非依存でテストしやすい。
 */
export function filterVisibleCategories(
  definedLabels: readonly CategoryLabel[],
  labelsWithPublishedArticles: readonly string[],
): CategoryLabel[] {
  const withArticles = new Set(labelsWithPublishedArticles);
  return definedLabels.filter((label) => withArticles.has(label));
}

/** 公開記事(status="published")が1件以上あるカテゴリラベルの一覧をDBから求める。 */
export async function listCategoryLabelsWithPublishedArticles(): Promise<string[]> {
  const rows = await prisma.article.groupBy({
    by: ["category"],
    where: { status: "published" },
  });
  return rows.map((row) => row.category);
}

/**
 * ヘッダーナビ・sitemap 等の一覧導線に出す、公開記事があるカテゴリラベルの一覧（結線込み）。
 * 「定義済みカテゴリ ∩ 公開記事があるカテゴリ」を定義順で返す。
 */
export async function listVisibleCategoryLabels(): Promise<CategoryLabel[]> {
  const labelsWithPublishedArticles = await listCategoryLabelsWithPublishedArticles();
  return filterVisibleCategories(CATEGORY_LABELS, labelsWithPublishedArticles);
}
