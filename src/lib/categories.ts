/**
 * カテゴリの単一定義（表示ラベル → サムネイル配色）。
 * サムネイルのプレースホルダー配色・シードのカテゴリラベルはここを唯一の source of truth として参照し、
 * ラベルの表記ズレ（→ 無言のグレーフォールバック）を防ぐ。後続スプリントのカテゴリ機能もここを基点にする。
 */
export const CATEGORY_GRADIENTS = {
  "パッチ/メタ": "from-sky-600 to-sky-800",
  "5chの反応": "from-amber-600 to-amber-800",
  "海外の反応": "from-emerald-600 to-emerald-800",
  "eスポーツ": "from-rose-600 to-rose-800",
} as const;

/** 定義済みカテゴリの表示ラベル。 */
export type CategoryLabel = keyof typeof CATEGORY_GRADIENTS;

/** 全カテゴリの表示ラベル一覧。 */
export const CATEGORY_LABELS = Object.keys(CATEGORY_GRADIENTS) as CategoryLabel[];

/** 未定義カテゴリ用のフォールバック配色。 */
export const DEFAULT_CATEGORY_GRADIENT = "from-neutral-600 to-neutral-800";

/**
 * カテゴリ表示ラベル → URL 用スラッグ（ASCII安全）。
 * 「パッチ/メタ」のようにラベルに `/` を含むものがあり、そのまま動的セグメントに使うと
 * URLパスの区切りと衝突しうるため、カテゴリ一覧ページのルーティングは必ずこのスラッグ経由にする。
 */
export const CATEGORY_SLUGS: Record<CategoryLabel, string> = {
  "パッチ/メタ": "patch-meta",
  "5chの反応": "5ch",
  "海外の反応": "overseas",
  "eスポーツ": "esports",
};

const SLUG_TO_CATEGORY_LABEL: Record<string, CategoryLabel> = Object.fromEntries(
  CATEGORY_LABELS.map((label) => [CATEGORY_SLUGS[label], label]),
);

/** カテゴリ表示ラベルから URL 用スラッグを引く。未定義カテゴリは undefined。 */
export function categorySlugFor(category: string): string | undefined {
  return CATEGORY_SLUGS[category as CategoryLabel];
}

/** URL 用スラッグからカテゴリ表示ラベルを引く。未知のスラッグは undefined。 */
export function categoryLabelForSlug(slug: string): CategoryLabel | undefined {
  return SLUG_TO_CATEGORY_LABEL[slug];
}

/**
 * 反応記事（掲示板/SNSの反応をまとめた記事）のカテゴリラベル一覧（拡張E38 F-E38-2）。
 * `CATEGORY_GRADIENTS` のラベルを唯一の source of truth とし、反応カテゴリ判定のための
 * マジック文字列の散在を防ぐ。
 */
export const REACTION_CATEGORY_LABELS: readonly CategoryLabel[] = ["5chの反応", "海外の反応"];

/** category が反応カテゴリ（5chの反応/海外の反応）かどうかを判定する。 */
export function isReactionCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return (REACTION_CATEGORY_LABELS as readonly string[]).includes(category);
}
