/**
 * デザイン軸（classic/news/hextech、拡張E14・拡張E45）の状態決定ロジック。
 * テーマ（light/dark、theme-toggle.tsx）とは独立した第2軸で、<html> に付け外しする
 * デザインクラス（`design-news`／`design-hextech`）と localStorage キーをこのモジュールで
 * 一元管理する（DesignToggle・layout.tsxのフラッシュ防止スクリプト双方から参照し、
 * キー名/クラス名がずれないようにする）。既定（初回・未保存）は classic（現行デザイン）。
 *
 * デザインクラスは相互排他（classic=クラス無し／news=design-news／hextech=design-hextech）で、
 * 同時に2つ以上付かない。切替UI（HtmlClassToggle）とフラッシュ防止スクリプトはこの
 * 「排他クラス群（ALL_DESIGN_CLASSES）」を単一の真実として扱う。
 */

export const DESIGN_STORAGE_KEY = "lol-matome:design";

/** news デザイン（ニュースメディア調、拡張E14）を表す <html> クラス。 */
export const DESIGN_NEWS_CLASS = "design-news";
/** hextech デザイン（LoL Hextech調ダーク、拡張E45）を表す <html> クラス。 */
export const DESIGN_HEXTECH_CLASS = "design-hextech";

/**
 * 後方互換のための別名（従来 news 専用だった定数）。design-news を指す。
 * 既存の参照箇所・テストが壊れないよう残す（新規コードは用途に応じた命名の定数を使う）。
 */
export const DESIGN_CLASS = DESIGN_NEWS_CLASS;

/** デザイン軸の相互排他クラス群。classic のときはこのいずれも付かない。 */
export const ALL_DESIGN_CLASSES = [DESIGN_NEWS_CLASS, DESIGN_HEXTECH_CLASS] as const;

export type DesignMode = "classic" | "news" | "hextech";

/**
 * localStorage から読んだ生の値（未保存は null）から初期デザインを決定する純関数。
 * 保存値が "news"/"hextech" のときだけそのモード、それ以外（null・空文字・"classic"・
 * 不正値・大文字違い）は既定の classic にフォールバックする。
 */
export function decideInitialDesign(storedValue: string | null): DesignMode {
  if (storedValue === "news") return "news";
  if (storedValue === "hextech") return "hextech";
  return "classic";
}

/**
 * デザインモードに対応する <html> クラス名（classic は付与するクラスが無いので null）。
 * 相互排他クラスの決定を一箇所に集約する。
 */
export function designClassForMode(mode: DesignMode): string | null {
  if (mode === "news") return DESIGN_NEWS_CLASS;
  if (mode === "hextech") return DESIGN_HEXTECH_CLASS;
  return null;
}
