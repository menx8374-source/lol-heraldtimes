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
  /** 判定根拠（isHotがtrueのときに満たした条件の説明）。falseのときは空配列。 */
  reasons: string[];
  metrics: HotnessMetricsSummary;
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
  const { metricsHistory, postedAt } = input;
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

  const withinAgeWindow = ageMinutes >= config.minAgeMinutes && ageMinutes <= config.maxAgeHours * 60;
  if (!withinAgeWindow) {
    return { isHot: false, reasons: ["経過時間が判定窓外（minAgeMinutes〜maxAgeHoursの範囲外）"], metrics };
  }

  const meetsCurrentValue = score >= config.minScore && comments >= config.minComments;
  const meetsScoreGrowth = scoreGrowthPerHour >= config.minScoreGrowthPerHour;
  const meetsCommentGrowth = commentGrowthPerHour >= config.minCommentGrowthPerHour;

  const reasons: string[] = [];
  if (meetsCurrentValue) reasons.push(`現在値が閾値超（score=${score}/comments=${comments}）`);
  if (meetsScoreGrowth) reasons.push(`スコア増加率が閾値超（${scoreGrowthPerHour.toFixed(1)}/h）`);
  if (meetsCommentGrowth) reasons.push(`コメント増加率が閾値超（${commentGrowthPerHour.toFixed(1)}/h）`);

  const isHot = meetsCurrentValue || meetsScoreGrowth || meetsCommentGrowth;
  return { isHot, reasons: isHot ? reasons : [], metrics };
}
