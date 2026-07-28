/**
 * 収集パイプライン（F5）共通の型定義。
 * architecture.md の `SourceAdapter` 抽象（reddit/5ch/riot、mock↔live 切替）に対応する。
 */
import type { CategoryLabel } from "@/lib/categories";

/**
 * 収集元ソースの全種別。**この配列が単一の source of truth** で、`SourceType` はここから導出する。
 * ソースを増やすときはこの配列に足すだけで `SourceType` が更新され、`Record<SourceType,...>`（config・
 * mock・カテゴリ対応表等）に網羅漏れがあればコンパイルエラーになる（拡張E17 自浄で導入）。
 * 拡張E45: 「eスポーツ」単独ソース（clip、YouTube/Twitch無差別検索型）は質が低いため削除した。
 * 反応記事内の動画埋め込み（別機能）は不変。
 * リファクタリングS7b: `riot-news`（Riot公式ニュース、`RiotNewsAdapter`）を追加。パッチノート以外の
 * 公式ニュース（Dev Blog/チャンピオン・スキン/eスポーツ/ゲームアップデート）を取得元ルールで分類し記事化する。
 * 成長G7: `x`（X/旧Twitter、`XAdapter`）を追加。GetXAPI（advanced_search）でmin_favesを満たす
 * LoL関連tweetを収集し、カテゴリ「Xの反応」として記事化する。
 */
export const SOURCE_TYPES = ["reddit", "5ch", "riot", "riot-news", "x"] as const;

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
  /**
   * リファクタリングS2（収集の履歴化）: Post永続化用の外部ID（ソース内で安定・一意）。
   * 未設定の場合、そのアイテムは Post に保存されない（後方互換。既存アダプタ/mockの挙動は不変）。
   * reddit=投稿id、5ch="<server>/<board>/<threadId>"、riot=パッチ識別子（publicPatchNumber）。
   */
  externalId?: string;
  /** メトリクス: スコア（Reddit upvote等）。5ch/riotは0固定・未使用のためundefinedのまま（persist側で0扱い）。 */
  score?: number;
  /** メトリクス: コメント数（Redditのnum_comments・5chのresCount等）。 */
  commentCount?: number;
  /**
   * 成長G1（F-G1-3）: Redditのupvote_ratio（0〜1）。取得できない/概念が無いソースは未設定。
   * 論争度判定（HotnessEvaluator）でupvote_ratioが低いほど賛否が割れているサインとして使う。
   */
  upvoteRatio?: number;
  /** 投稿者。取得できない/概念が無いソースは未設定またはnull。 */
  author?: string | null;
  /** flair（Redditのlink_flair_text等）。取得できない/概念が無いソースは未設定またはnull。 */
  flair?: string | null;
  /** 画像/動画等のメディア情報（JSONとしてPostに保存）。未設定/nullでよい。 */
  media?: unknown;
  /**
   * リファクタリングS7a（F-S7a-3）: 取得元ルール（URLパス等）でアダプタが明示するカテゴリ
   * （AI分類はしない）。未設定の場合は生成時にソース既定（CATEGORY_BY_SOURCE）にフォールバックする。
   */
  category?: CategoryLabel;
  /**
   * パッチ記事刷新S2（F-S2-2）: riot由来の平テキスト化前の生HTML（`riot-datadragon.ts`の
   * `fetchPatchNotesData().html`）。DOM構造パーサ（`patch-notes-parser.ts`）が誤帰属ゼロで
   * 対象・スキルキー・変更前後を抽出するために必要。他ソースは未設定のまま（後方互換）。
   * Post永続化ではDBスキーマ変更を避けるため`Post.media`（既存JSON列）に格納する。
   */
  html?: string;
  /**
   * パッチ記事刷新S5（F-S5-1・opt-in、既定未設定）: 未適用（本番未反映）の次パッチの
   * 先行速報アイテムであることを示すフラグ。`riot-datadragon.ts`が`PATCH_PREVIEW_MODE=on`の
   * ときのみ設定する。他ソース・offのときは未設定のまま（後方互換）。Post永続化ではDBスキーマ
   * 変更を避けるため`Post.media`（既存JSON列）に格納する。
   */
  patchPreview?: boolean;
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
  /** リファクタリングS2: Post永続化用の外部ID。RawCollectionItem からそのまま引き継ぐ。 */
  externalId?: string;
  /** メトリクス: スコア。 */
  score?: number;
  /** メトリクス: コメント数。 */
  commentCount?: number;
  /** 成長G1（F-G1-3）: Redditのupvote_ratio（0〜1）。取得できない/概念が無いソースは未設定。 */
  upvoteRatio?: number;
  /** 投稿者。 */
  author?: string | null;
  /** flair。 */
  flair?: string | null;
  /** 画像/動画等のメディア情報。 */
  media?: unknown;
  /** リファクタリングS7: 取得元ルールで付与したカテゴリ（Post.category→Article.category へ伝播）。 */
  category?: CategoryLabel;
  /** パッチ記事刷新S2（F-S2-2）: riot由来の平テキスト化前の生HTML。RawCollectionItemからそのまま引き継ぐ。 */
  html?: string;
  /** パッチ記事刷新S5（F-S5-1・opt-in）: 未適用パッチの先行速報アイテムか。RawCollectionItemからそのまま引き継ぐ。 */
  patchPreview?: boolean;
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
  /**
   * リファクタリングS4（F-S4-1）: 監視中Postの現在のスコア/コメント数を再取得する任意メソッド。
   * 非対応ソース（riot）は実装しなくてよい。失敗・非対応時は例外を投げず null を返す。
   */
  fetchMetrics?(externalId: string): Promise<{ score: number; commentCount: number } | null>;
  /**
   * リファクタリングS6（F-S6-2）: 記事更新（伸びたら条件付き再AI）用に、投稿の「現在の内容」を
   * 再取得する任意メソッド。reddit/5chは現在の上位コメント/レスで内容を作り直したスレッドダンプを
   * 返す。非対応ソース（riot）は実装しなくてよい。失敗・非対応時は例外を投げず null を返す。
   */
  fetchContent?(externalId: string): Promise<{ title: string; content: string; imageUrl?: string | null } | null>;
}
