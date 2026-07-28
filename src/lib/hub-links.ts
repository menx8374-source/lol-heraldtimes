/**
 * 記事末のハブ導線（成長G2 F-G2-3/F-G2-4）用の純関数。
 * AIは使わずテンプレ（純ルール）でアンカーテキストを組み立てる。アンカーテキストには対象キーワード
 * （カテゴリ名／タグ名）を必ず含め、`こちら`・`詳しくは`・`リンク`単体のような無意味な文言は使わない（R7）。
 */

export type HubLink = {
  href: string;
  label: string;
};

/**
 * アンカーテキストが禁止語（こちら／詳しくは／リンク単体）に該当するかどうかを判定する。
 * 「リンク」は完全一致（前後空白のみ許容）のときだけ禁止とし、「外部リンク一覧」のような
 * 複合語は許容する（禁止したいのは無意味な単体アンカーであって「リンク」という語そのものではない）。
 */
export function isForbiddenAnchorText(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed === "リンク") return true;
  return trimmed.includes("こちら") || trimmed.includes("詳しくは");
}

/** カテゴリのハブ（/category/<slug>）へのアンカー。ラベルに必ずカテゴリ名を含める。 */
export function buildCategoryHubLink(categoryLabel: string, categorySlug: string): HubLink {
  return { href: `/category/${categorySlug}`, label: `${categoryLabel}の記事一覧` };
}

/** タグのハブ（/tags/<tag>）へのアンカー。ラベルに必ずタグ名を含める。 */
export function buildTagHubLink(tagName: string): HubLink {
  return { href: `/tags/${tagName}`, label: `${tagName}のまとめをもっと見る` };
}

/**
 * 記事末の「まとめて見る」導線一覧を組み立てる。カテゴリ→タグの順に並べる。
 * カテゴリの URL スラッグが未定義（未知カテゴリ）の場合はカテゴリリンクを省略する。
 */
export function buildHubLinks(params: {
  category: string;
  categorySlug: string | undefined;
  tags: string[];
}): HubLink[] {
  const links: HubLink[] = [];
  if (params.categorySlug) {
    links.push(buildCategoryHubLink(params.category, params.categorySlug));
  }
  for (const tag of params.tags) {
    links.push(buildTagHubLink(tag));
  }
  return links;
}
