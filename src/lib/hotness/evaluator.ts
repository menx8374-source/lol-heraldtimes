/**
 * 話題性のルールベース判定（HotnessEvaluator、リファクタリング S3 F-S3-2）。
 * 要件「AIによる話題性判定・分類・スコアリングは禁止」を満たすため、AIを一切使わない純関数として
 * 実装する（DBにも触れない）。DBからPost＋履歴を読む薄いラッパは本スプリントでは作らず、S4/S5で
 * 使う想定。まだパイプラインには結線しない（挙動不変）。
 */
import type { SourceType } from "@/lib/collection/types";
import type { HotnessConfig } from "@/lib/hotness/config";

/** PostMetricsHistoryの1点分（時系列・昇順で渡す）。 */
export type HotnessMetricsPoint = {
  score: number;
  commentCount: number;
  capturedAt: Date;
};

export type HotnessInput = {
  sourceType: SourceType;
  postedAt: Date;
  /** 時系列の履歴（古い→新しいの昇順）。空配列も許容する。 */
  metricsHistory: HotnessMetricsPoint[];
  /**
   * 成長G1（F-G1-2）: Redditのupvote_ratio（0〜1）。取得できないソース/取得失敗時はundefined。
   */
  upvoteRatio?: number;
};

export type HotnessMetricsSummary = {
  score: number;
  comments: number;
  ageMinutes: number;
  scoreGrowthPerHour: number;
  commentGrowthPerHour: number;
};

export type HotnessResult = {
  isHot: boolean;
  /**
   * 判定根拠。isHotがtrueのときに満たした条件の説明に加え、成長G1（F-G1-2）で
   * isControversialがtrueのときの論争根拠も追記する（isHotがfalseでも論争根拠は残る＝独立フラグ）。
   */
  reasons: string[];
  metrics: HotnessMetricsSummary;
  /** 成長G1（F-G1-2）: `comments/max(score,1)`。5chはscore常時0のため発散しやすい参考値。 */
  controversyScore: number;
  /**
   * 成長G1（F-G1-2）: 賛否が割れている（論争）と判定されたか。isHotとは独立のフラグで、
   * isHotを置き換えない（hotなPostのうちcontroversialなものを記事化優先・タイトルに反映する）。
   */
  isControversial: boolean;
};

/**
 * 話題性を数値ルールで判定する（純関数・AI不使用）。
 * - 最新（履歴末尾）のscore/commentCountを現在値とする（履歴が空なら0）。
 * - 増加量/増加率(毎時)は履歴の最古〜最新の差分/経過時間。履歴が1点のみ（差分算出不可）または
 *   空の場合は増加率0扱い（現在値ルールのみで判定）。
 * - 判定: 経過時間が [minAgeMinutes, maxAgeHours] の窓内で、かつ
 *   「現在値が閾値超（score>=minScore かつ comments>=minComments）」または
 *   「増加率が閾値超（score/コメントいずれか）」なら isHot。窓外は常にfalse。
 */
export function evaluateHotness(input: HotnessInput, now: Date, config: HotnessConfig): HotnessResult {
  const { metricsHistory, postedAt, upvoteRatio } = input;
  const latest = metricsHistory[metricsHistory.length - 1];
  const score = latest?.score ?? 0;
  const comments = latest?.commentCount ?? 0;
  const ageMinutes = (now.getTime() - postedAt.getTime()) / 60000;

  let scoreGrowthPerHour = 0;
  let commentGrowthPerHour = 0;
  if (metricsHistory.length >= 2) {
    const oldest = metricsHistory[0];
    const elapsedHours = (latest.capturedAt.getTime() - oldest.capturedAt.getTime()) / 3600000;
    if (elapsedHours > 0) {
      scoreGrowthPerHour = (latest.score - oldest.score) / elapsedHours;
      commentGrowthPerHour = (latest.commentCount - oldest.commentCount) / elapsedHours;
    }
  }

  const metrics: HotnessMetricsSummary = { score, comments, ageMinutes, scoreGrowthPerHour, commentGrowthPerHour };

  // 成長G1（F-G1-2）: 論争度は経過時間窓・isHot判定とは独立に、常に計算する。
  const controversyScore = comments / Math.max(score, 1);
  const meetsControversyRatio = controversyScore >= config.minControversyRatio;
  const meetsLowUpvoteRatio = upvoteRatio != null && upvoteRatio <= config.maxUpvoteRatio;
  const isControversial = meetsControversyRatio || meetsLowUpvoteRatio;
  const controversyReasons: string[] = [];
  if (meetsControversyRatio) {
    controversyReasons.push(`コメント/スコア比が閾値超（論争サイン、${controversyScore.toFixed(2)}）`);
  }
  if (meetsLowUpvoteRatio) {
    controversyReasons.push(`upvote_ratioが閾値以下（賛否が割れている、${(upvoteRatio as number).toFixed(2)}）`);
  }

  const withinAgeWindow = ageMinutes >= config.minAgeMinutes && ageMinutes <= config.maxAgeHours * 60;
  if (!withinAgeWindow) {
    return {
      isHot: false,
      reasons: ["経過時間が判定窓外（minAgeMinutes〜maxAgeHoursの範囲外）", ...controversyReasons],
      metrics,
      controversyScore,
      isControversial,
    };
  }

  const meetsCurrentValue = score >= config.minScore && comments >= config.minComments;
  const meetsScoreGrowth = scoreGrowthPerHour >= config.minScoreGrowthPerHour;
  const meetsCommentGrowth = commentGrowthPerHour >= config.minCommentGrowthPerHour;

  const hotReasons: string[] = [];
  if (meetsCurrentValue) hotReasons.push(`現在値が閾値超（score=${score}/comments=${comments}）`);
  if (meetsScoreGrowth) hotReasons.push(`スコア増加率が閾値超（${scoreGrowthPerHour.toFixed(1)}/h）`);
  if (meetsCommentGrowth) hotReasons.push(`コメント増加率が閾値超（${commentGrowthPerHour.toFixed(1)}/h）`);

  const isHot = meetsCurrentValue || meetsScoreGrowth || meetsCommentGrowth;
  const reasons = [...(isHot ? hotReasons : []), ...controversyReasons];
  return { isHot, reasons, metrics, controversyScore, isControversial };
}
