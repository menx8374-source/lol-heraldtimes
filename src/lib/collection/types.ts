/**
 * 収集パイプライン（F5）共通の型定義。
 * architecture.md の `SourceAdapter` 抽象（reddit/5ch/riot、mock↔live 切替）に対応する。
 */

/**
 * 収集元ソースの全種別。**この配列が単一の source of truth** で、`SourceType` はここから導出する。
 * ソースを増やすときはこの配列に足すだけで `SourceType` が更新され、`Record<SourceType,...>`（config・
 * mock・カテゴリ対応表等）に網羅漏れがあればコンパイルエラーになる（拡張E17 自浄で導入）。
 * clip: YouTube/Twitchクリップ（拡張E17、埋め込み紹介記事）。
 */
export const SOURCE_TYPES = ["reddit", "5ch", "riot", "clip"] as const;

/** 収集元ソースの種別。`SOURCE_TYPES` から導出。 */
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * アダプタが返す生の収集アイテム。出典URLが無い場合は `sourceUrl` を省略してよく、
 * パイプライン側（filterHasSourceUrl）で弾かれ保存されない（F5 受け入れ基準）。
 */
export type RawCollectionItem = {
  sourceUrl?: string | null;
  title: string;
  /** 取得本文、または反応の抜粋。 */
  content: string;
  fetchedAt: Date;
  /**
   * 記事サムネイルに使う画像URL（拡張E19 F-E19-3）。Riotチャンピオンのスプラッシュ画像・
   * Redditの投稿画像・YouTube/Twitchのサムネイルなど。無ければ未設定/nullでよい
   * （表示側 article-thumbnail.tsx が既定画像にフォールバックする）。
   */
  imageUrl?: string | null;
};

/** 出典URLを必ず持つ、保存可能な収集アイテム（共通フォーマット）。 */
export type CollectionItem = {
  sourceType: SourceType;
  sourceUrl: string;
  title: string;
  content: string;
  fetchedAt: Date;
  /** サムネイル画像URL（拡張E19）。未設定/nullは既定画像にフォールバックする。 */
  imageUrl?: string | null;
};

/** ソースごとのレート制限設定（F5: 取得件数上限・実行間隔）。 */
export type SourceRateLimitConfig = {
  /** 1回の収集実行で取得する最大件数。 */
  maxItemsPerRun: number;
  /** 前回実行からこの間隔（ミリ秒）を空けないと再取得しない。 */
  minIntervalMsBetweenRuns: number;
};

/** LoL関連に限定するフィルタ設定（F5）。 */
export type RelevanceFilterConfig = {
  /** reddit のみ: 許可するサブレディット名（大小文字無視、先頭の r/ は除いて比較）。 */
  allowedSubreddits?: string[];
  /** タイトルに含まれていれば関連ありとみなすキーワード（大小文字無視、いずれか1つで可）。 */
  keywords: string[];
};

/** ソース1件分の収集設定。 */
export type SourceConfig = {
  sourceType: SourceType;
  rateLimit: SourceRateLimitConfig;
  relevance: RelevanceFilterConfig;
};

/**
 * 収集アダプタ抽象。実装は reddit/5ch/riot それぞれの mock（fixture）／live で提供する。
 * mock↔live の切替は `getAdapter`（adapters/index.ts）の1箇所に閉じ込める。
 */
export interface SourceAdapter {
  readonly sourceType: SourceType;
  /** 生の収集アイテムを返す。件数の上限は呼び出し側（pipeline）が適用する。 */
  fetchItems(): Promise<RawCollectionItem[]>;
}
