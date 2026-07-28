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
  /**
   * 論争度判定（成長G1）: `commentCount/max(score,1)` がこれ以上で論争サイン（既定0.15）。
   * 主にreddit向け。5chはscoreが常時0のためこの比が収集数だけで発散し判定として無意味になるため、
   * `getHotnessConfig("5ch")` では実質無効化（Infinity）する（既存のcomment主体判定で足りる。F-G1-1）。
   */
  minControversyRatio: number;
  /**
   * 論争度判定（成長G1）: `upvote_ratio` がこれ以下で賛否が割れている（既定0.80。1.0に近いほど平和）。
   */
  maxUpvoteRatio: number;
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

/** 非負の小数env値をパースする（不正・未設定はfallback。論争度の比率設定に使う）。 */
function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * ソース別の現在値ルール既定（reddit=score主体、5ch=score恒常0のためcomment主体）。
 * riot-news（リファクタリングS7b）は既定でhotness免除（getExemptSourceTypes）のため通常は未使用だが、
 * env `HOTNESS_EXEMPT_SOURCE_TYPES` で免除から外された場合に備えてriotと同じ既定値を用意する。
 */
const SOURCE_CURRENT_VALUE_DEFAULTS = {
  reddit: { minScore: 100, minComments: 30 },
  "5ch": { minScore: 0, minComments: 30 },
  riot: { minScore: 100, minComments: 30 },
  "riot-news": { minScore: 100, minComments: 30 },
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
    // 成長G1（F-G1-1）: 汎用・reddit/riot向けの既定（0.15）。5ch分岐では下記で上書きし実質無効化する。
    minControversyRatio: envFloat("HOTNESS_MIN_CONTROVERSY_RATIO", 0.15),
    maxUpvoteRatio: envFloat("HOTNESS_MAX_UPVOTE_RATIO", 0.8),
  };

  if (sourceType === "5ch") {
    return {
      ...base,
      minScore: envInt("HOTNESS_5CH_MIN_SCORE", SOURCE_CURRENT_VALUE_DEFAULTS["5ch"].minScore),
      minComments: envInt("HOTNESS_5CH_MIN_COMMENTS", SOURCE_CURRENT_VALUE_DEFAULTS["5ch"].minComments),
      // F-G1-1修正: 5chはscoreが常時0のためcomment比(controversyScore=comments/max(score,1))が
      // resCount収集数だけで発散し(既定minComments=30収集で常時30超)、論争判定として無意味になる
      // (5ch反応記事が実質常時isControversial=trueになりタイトル多様性を損なう不具合)。
      // 5chはupvote_ratioも持たないため、comment比を実質無効化(Infinity)してisControversialを常にfalseにする
      // (envで明示的に上書きされた場合のみ有効な値を使う。既存のソース別上書きパターンを踏襲)。
      minControversyRatio: envFloat("HOTNESS_5CH_MIN_CONTROVERSY_RATIO", Number.POSITIVE_INFINITY),
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
  if (sourceType === "riot-news") {
    return {
      ...base,
      minScore: envInt("HOTNESS_RIOT_NEWS_MIN_SCORE", SOURCE_CURRENT_VALUE_DEFAULTS["riot-news"].minScore),
      minComments: envInt("HOTNESS_RIOT_NEWS_MIN_COMMENTS", SOURCE_CURRENT_VALUE_DEFAULTS["riot-news"].minComments),
    };
  }
  // sourceType省略時: 汎用既定値（reddit相当の値をそのまま使う）。
  return {
    ...base,
    minScore: envInt("HOTNESS_MIN_SCORE", 100),
    minComments: envInt("HOTNESS_MIN_COMMENTS", 30),
  };
}

/**
 * 記事更新トリガ（再AI更新、リファクタリングS6 F-S6-1）の閾値設定。公開後もPostを監視し、
 * ここで定めた条件（更新回数上限・cooldown・経過時間上限・スコア/コメント増加量）を
 * すべて満たしたときだけ `shouldUpdateArticle`（`update-trigger.ts`）がtrueを返す。
 */
export type ArticleUpdateConfig = {
  /** baselineからのScore増加量の下限。これ以上増えたら更新トリガ対象（既定100。reddit主体）。 */
  updateMinScoreDelta: number;
  /** baselineからのコメント数増加量の下限（既定30。5ch/reddit共通）。5chはscoreが常に0のため
   *  scoreDeltaが常に0となり、実質このコメント増加量のみで判定される（設定を分けなくても吸収できる）。 */
  updateMinCommentDelta: number;
  /** 前回更新（無ければ記事化）からの最短間隔（時間、既定6）。 */
  updateCooldownHours: number;
  /** 1記事あたりの最大更新回数（既定2）。これに達したら以後は更新しない（多重更新の歯止め）。 */
  updateMaxCount: number;
  /** 投稿からの経過時間がこれを超えたら更新対象外（既定48。`METRICS_MAX_MONITOR_HOURS`既定と整合）。 */
  updateMaxAgeHours: number;
};

/** 記事更新トリガの設定を返す（env上書き可能）。 */
export function getArticleUpdateConfig(): ArticleUpdateConfig {
  return {
    updateMinScoreDelta: envInt("UPDATE_MIN_SCORE_DELTA", 100),
    updateMinCommentDelta: envInt("UPDATE_MIN_COMMENT_DELTA", 30),
    updateCooldownHours: envInt("UPDATE_COOLDOWN_HOURS", 6),
    updateMaxCount: envInt("UPDATE_MAX_COUNT", 2),
    updateMaxAgeHours: envInt("UPDATE_MAX_AGE_HOURS", 48),
  };
}

/**
 * hotness免除ソース種別の既定値（リファクタリング S5c F-S5c-1、S7bで riot-news を追加）。
 */
const DEFAULT_EXEMPT_SOURCE_TYPES: SourceType[] = ["riot", "riot-news"];

/**
 * hotness判定を経ずに常に記事化対象とする免除ソース種別の一覧を返す（リファクタリング S5c F-S5c-1）。
 * 公式パッチノート（riot）・公式ニュース（riot-news、リファクタリングS7b）のように"話題性"で測るべきで
 * ない公式情報をhotness判定の対象外にするための設定。既定は `["riot", "riot-news"]`。env
 * `HOTNESS_EXEMPT_SOURCE_TYPES` にカンマ区切りで指定すると上書きできる（前後空白は除去し、
 * `SourceType` として無効な値は無視する。有効な値が1つも無ければ既定値にフォールバックする）。
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
