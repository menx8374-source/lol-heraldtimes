/**
 * 話題性判定（HotnessEvaluator）の閾値設定ファイル（リファクタリング S3 F-S3-1）。
 * 要件「AIによる話題性判定・分類・スコアリングは禁止／判定は数値ルール、閾値は設定ファイルで変更可能」を
 * 実現するため、判定に使う全ての閾値をここに集約する（`pipeline/config.ts` と同じ envInt 方式）。
 * 秘密情報ではないため `.env.example` にキー名と既定値を記載する。
 *
 * ソース差の吸収: reddit は score が実質的な指標になる一方、5ch はスコア機構が無く常に0のため
 * comment 数が主指標になる。`getHotnessConfig(sourceType)` でソースごとに適切な既定値を返す
 * （env で個別に上書き可能）。
 *
 * 本モジュールはまだパイプラインに結線しない（S4でメトリクス更新、S5で記事化判定に使用）。
 */
import { SOURCE_TYPES, type SourceType } from "@/lib/collection/types";

export type HotnessConfig = {
  /** 現在値ルールで使うスコア下限。 */
  minScore: number;
  /** 現在値ルールで使うコメント数下限。 */
  minComments: number;
  /** スコア増加率（1時間あたり）の下限。これを超えたら増加率ルールでhot。 */
  minScoreGrowthPerHour: number;
  /** コメント増加率（1時間あたり）の下限。これを超えたら増加率ルールでhot。 */
  minCommentGrowthPerHour: number;
  /** 判定対象とする投稿経過時間の下限（分）。新しすぎる投稿は判定しない。 */
  minAgeMinutes: number;
  /** 判定対象とする投稿経過時間の上限（時間）。古すぎる投稿は判定しない。 */
  maxAgeHours: number;
  /**
   * Hot/Risingランキング順位を判定に使うかどうかのフラグ。Arctic Shiftはランキング順位を
   * 持たないため本スプリントでは常にfalse（未使用）。将来公式OAuth併用時にtrueへ切替える想定。
   */
  useRankSignal: boolean;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

/** ソース別の現在値ルール既定（reddit=score主体、5ch=score恒常0のためcomment主体）。 */
const SOURCE_CURRENT_VALUE_DEFAULTS = {
  reddit: { minScore: 100, minComments: 30 },
  "5ch": { minScore: 0, minComments: 30 },
  riot: { minScore: 100, minComments: 30 },
} as const satisfies Record<SourceType, { minScore: number; minComments: number }>;

/**
 * 話題性判定の閾値設定を返す（env上書き可能）。`sourceType` を指定すると、そのソースに応じた
 * 現在値ルールの既定（reddit=score主体／5ch=comment主体）＋ソース別env（`HOTNESS_5CH_*` /
 * `HOTNESS_REDDIT_*` / `HOTNESS_RIOT_*`）を優先する。省略時は汎用既定（`HOTNESS_MIN_SCORE`等）を使う。
 */
export function getHotnessConfig(sourceType?: SourceType): HotnessConfig {
  const base: Omit<HotnessConfig, "minScore" | "minComments"> = {
    minScoreGrowthPerHour: envInt("HOTNESS_MIN_SCORE_GROWTH_PER_HOUR", 50),
    minCommentGrowthPerHour: envInt("HOTNESS_MIN_COMMENT_GROWTH_PER_HOUR", 10),
    minAgeMinutes: envInt("HOTNESS_MIN_AGE_MINUTES", 30),
    maxAgeHours: envInt("HOTNESS_MAX_AGE_HOURS", 72),
    useRankSignal: envBool("HOTNESS_USE_RANK_SIGNAL", false),
  };

  if (sourceType === "5ch") {
    return {
      ...base,
      minScore: envInt("HOTNESS_5CH_MIN_SCORE", SOURCE_CURRENT_VALUE_DEFAULTS["5ch"].minScore),
      minComments: envInt("HOTNESS_5CH_MIN_COMMENTS", SOURCE_CURRENT_VALUE_DEFAULTS["5ch"].minComments),
    };
  }
  if (sourceType === "reddit") {
    return {
      ...base,
      minScore: envInt("HOTNESS_REDDIT_MIN_SCORE", SOURCE_CURRENT_VALUE_DEFAULTS.reddit.minScore),
      minComments: envInt("HOTNESS_REDDIT_MIN_COMMENTS", SOURCE_CURRENT_VALUE_DEFAULTS.reddit.minComments),
    };
  }
  if (sourceType === "riot") {
    return {
      ...base,
      minScore: envInt("HOTNESS_RIOT_MIN_SCORE", SOURCE_CURRENT_VALUE_DEFAULTS.riot.minScore),
      minComments: envInt("HOTNESS_RIOT_MIN_COMMENTS", SOURCE_CURRENT_VALUE_DEFAULTS.riot.minComments),
    };
  }
  // sourceType省略時: 汎用既定値（reddit相当の値をそのまま使う）。
  return {
    ...base,
    minScore: envInt("HOTNESS_MIN_SCORE", 100),
    minComments: envInt("HOTNESS_MIN_COMMENTS", 30),
  };
}

/** hotness免除ソース種別の既定値（リファクタリング S5c F-S5c-1）。 */
const DEFAULT_EXEMPT_SOURCE_TYPES: SourceType[] = ["riot"];

/**
 * hotness判定を経ずに常に記事化対象とする免除ソース種別の一覧を返す（リファクタリング S5c F-S5c-1）。
 * 公式パッチノート（riot）のように"話題性"で測るべきでない公式ニュースをhotness判定の対象外にするための
 * 設定。既定は `["riot"]`。env `HOTNESS_EXEMPT_SOURCE_TYPES` にカンマ区切りで指定すると上書きできる
 * （前後空白は除去し、`SourceType` として無効な値は無視する。有効な値が1つも無ければ既定値にフォールバックする）。
 */
export function getExemptSourceTypes(): SourceType[] {
  const raw = process.env.HOTNESS_EXEMPT_SOURCE_TYPES;
  if (!raw) return DEFAULT_EXEMPT_SOURCE_TYPES;
  const validSourceTypes: readonly string[] = SOURCE_TYPES;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SourceType => validSourceTypes.includes(s));
  return parsed.length > 0 ? parsed : DEFAULT_EXEMPT_SOURCE_TYPES;
}
