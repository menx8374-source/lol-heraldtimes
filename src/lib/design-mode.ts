/**
 * デザイン軸（classic/news、拡張E14）の状態決定ロジック。
 * テーマ（light/dark、theme-toggle.tsx）とは独立した第2軸で、<html> に付け外しする
 * `design-news` クラスと localStorage キーをこのモジュールで一元管理する
 * （DesignToggle・layout.tsxのフラッシュ防止スクリプト双方から参照し、キー名/クラス名がずれないようにする）。
 * 既定（初回・未保存）は classic（現行デザイン）。
 */

export const DESIGN_STORAGE_KEY = "lol-matome:design";
export const DESIGN_CLASS = "design-news";

export type DesignMode = "classic" | "news";

/**
 * localStorage から読んだ生の値（未保存は null）から初期デザインを決定する純関数。
 * 保存値が "news" のときだけ news、それ以外（null・空文字・"classic"・不正値）は既定の classic。
 */
export function decideInitialDesign(storedValue: string | null): DesignMode {
  return storedValue === "news" ? "news" : "classic";
}
