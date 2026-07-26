/**
 * 収集パイプラインの設定（F5）。ソースごとの取得件数上限・実行間隔（レート制限）と
 * LoL関連フィルタのキーワード/サブレディットをここに集約する。
 *
 * 個別の数値は環境変数で上書き可能にする（本番運用でレート制限を調整できるように）。
 * シークレットではないため `.env.example` には既定値の説明としてキー名のみ記載する。
 */
import type { SourceConfig, SourceType } from "@/lib/collection/types";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** LoL関連判定に使う既定キーワード（大小文字無視・部分一致）。 */
export const DEFAULT_LOL_KEYWORDS = [
  "lol",
  "league of legends",
  "patch",
  "jungle",
  "adc",
  "yasuo",
  "worlds",
  "summoner",
  "riot games",
  "esports",
  "tier list",
  "champion",
  "パッチ",
  "ジャングル",
  "ヤスオ",
  "サモナー",
  "チャンピオン",
  "リーグ・オブ・レジェンド",
  // 拡張E39 A3: 5chの日本語スレタイに当たる語を追加（過度に一般的な誤検出語は避ける）。
  "リーグオブレジェンド",
  "LJL",
  "LCK",
  "LEC",
  "LPL",
  "MSI",
  "世界大会",
  "ソロキュー",
  "ランク戦",
  "ナーフ",
  "バフ",
  "集団戦",
  "ガンク",
  "レーン",
  "対面",
  // 主要チャンピオン（カタカナ・厳選。誤検出増を避けるため全チャンピオンは入れない）。
  "アーリ",
  "ゼド",
  "ジンクス",
  "リー・シン",
  "ルシアン",
  "カタリナ",
  "イレリア",
  "ヴェイン",
  "セト",
  "ヨネ",
  "アカリ",
];

/** reddit 収集で許可するサブレディット（先頭の r/ は無くてもよい）。 */
export const DEFAULT_ALLOWED_SUBREDDITS = ["leagueoflegends"];

/** ソース種別ごとの既定収集設定。環境変数で件数上限・実行間隔のみ上書き可能。 */
export function getDefaultSourceConfigs(): Record<SourceType, SourceConfig> {
  return {
    reddit: {
      sourceType: "reddit",
      rateLimit: {
        maxItemsPerRun: envInt("COLLECTION_REDDIT_MAX_ITEMS", 10),
        minIntervalMsBetweenRuns: envInt("COLLECTION_REDDIT_MIN_INTERVAL_MS", 10 * 60 * 1000),
      },
      relevance: { allowedSubreddits: DEFAULT_ALLOWED_SUBREDDITS, keywords: DEFAULT_LOL_KEYWORDS },
    },
    "5ch": {
      sourceType: "5ch",
      rateLimit: {
        maxItemsPerRun: envInt("COLLECTION_5CH_MAX_ITEMS", 10),
        minIntervalMsBetweenRuns: envInt("COLLECTION_5CH_MIN_INTERVAL_MS", 10 * 60 * 1000),
      },
      relevance: { keywords: DEFAULT_LOL_KEYWORDS },
    },
    riot: {
      sourceType: "riot",
      rateLimit: {
        maxItemsPerRun: envInt("COLLECTION_RIOT_MAX_ITEMS", 20),
        minIntervalMsBetweenRuns: envInt("COLLECTION_RIOT_MIN_INTERVAL_MS", 30 * 60 * 1000),
      },
      relevance: { keywords: DEFAULT_LOL_KEYWORDS },
    },
  };
}

/** 収集モード。mock: fixture読込（既定）。live: 本接続アダプタ（後日実装、現時点では未対応）。 */
export function getCollectionMode(): "mock" | "live" {
  return process.env.COLLECTION_MODE === "live" ? "live" : "mock";
}
