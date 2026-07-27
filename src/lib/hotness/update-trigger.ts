/**
 * 記事更新トリガの判定（リファクタリングS6 F-S6-1）。公開後も監視を続けるPostについて、
 * 「Scoreが大きく伸びた／コメントが急増した」ときだけ再AI更新すべきか（そして通常時は
 * 再実行しない）を数値ルールのみで判定する（AI不使用・純関数・DB非依存。evaluator.ts と同じ書き方）。
 * 更新回数の多重防止（updateMaxCount）とcooldownはこの純関数側で保証し、呼び出し側
 * （generation/article-updater.ts）は DB から求めた updateCount/lastUpdatedAt/baseline を渡すだけでよい。
 */
import type { SourceType } from "@/lib/collection/types";
import type { HotnessMetricsPoint } from "@/lib/hotness/evaluator";
import type { ArticleUpdateConfig } from "@/lib/hotness/config";

export type ArticleUpdateInput = {
  sourceType: SourceType;
  postedAt: Date;
  /** 時系列の履歴（古い→新しいの昇順）。空配列も許容する。最新（末尾）を現在値として使う。 */
  metricsHistory: HotnessMetricsPoint[];
  /** 記事化時点（または直近更新時点）のscore。 */
  baselineScore: number;
  /** 記事化時点（または直近更新時点）のコメント数。 */
  baselineComments: number;
  /** 前回更新日時（一度も更新されていなければ記事の作成日時）。 */
  lastUpdatedAt: Date;
  /** これまでの更新回数（ArticleUpdateHistoryの件数）。 */
  updateCount: number;
};

export type ArticleUpdateDecision = {
  shouldUpdate: boolean;
  /** shouldUpdate=trueのときのみ設定される（"score_surge" | "comment_surge"）。falseのときは null。 */
  reason: "score_surge" | "comment_surge" | null;
};

/**
 * 更新すべきか（そして理由）を判定する（純関数・AI不使用）。すべて満たす場合のみ true:
 * - `updateCount < updateMaxCount`（多重更新の歯止め）
 * - 投稿からの経過時間が `updateMaxAgeHours` 以内
 * - 前回更新（`lastUpdatedAt`）から `updateCooldownHours` 以上経過（cooldown）
 * - 「Score増加量（現在値-baseline） >= updateMinScoreDelta」または
 *   「コメント増加量（現在値-baseline） >= updateMinCommentDelta」
 * 5ch は score が常に0のため scoreDelta は常に0となり、実質コメント増加量のみで判定される
 * （config・ロジックを5ch専用に分ける必要がない）。
 */
export function shouldUpdateArticle(
  input: ArticleUpdateInput,
  now: Date,
  config: ArticleUpdateConfig,
): ArticleUpdateDecision {
  if (input.updateCount >= config.updateMaxCount) {
    return { shouldUpdate: false, reason: null };
  }

  const ageHours = (now.getTime() - input.postedAt.getTime()) / 3600000;
  if (ageHours > config.updateMaxAgeHours) {
    return { shouldUpdate: false, reason: null };
  }

  const hoursSinceLastUpdate = (now.getTime() - input.lastUpdatedAt.getTime()) / 3600000;
  if (hoursSinceLastUpdate < config.updateCooldownHours) {
    return { shouldUpdate: false, reason: null };
  }

  const latest = input.metricsHistory[input.metricsHistory.length - 1];
  const currentScore = latest?.score ?? 0;
  const currentComments = latest?.commentCount ?? 0;
  const scoreDelta = currentScore - input.baselineScore;
  const commentDelta = currentComments - input.baselineComments;

  if (scoreDelta >= config.updateMinScoreDelta) {
    return { shouldUpdate: true, reason: "score_surge" };
  }
  if (commentDelta >= config.updateMinCommentDelta) {
    return { shouldUpdate: true, reason: "comment_surge" };
  }
  return { shouldUpdate: false, reason: null };
}

/**
 * baseline（記事化 or 直近更新時点のscore/comment）を、Postの時系列メトリクス履歴（昇順）から
 * 求める純関数。`lastUpdatedAt` 以前の最も新しいスナップショットをbaselineとする
 * （＝そのタイミングで記事はそのスコア/コメント数を前提に生成/更新されたとみなす）。
 * `lastUpdatedAt` 以前のスナップショットが1つも無い場合（例: 記事化直後でまだ1点しか無い）は
 * 履歴の先頭（最古）にフォールバックする。履歴が空なら 0/0。
 */
export function resolveBaselineMetrics(
  metricsHistory: HotnessMetricsPoint[],
  lastUpdatedAt: Date,
): { score: number; comments: number } {
  let baseline: HotnessMetricsPoint | undefined;
  for (const point of metricsHistory) {
    if (point.capturedAt.getTime() <= lastUpdatedAt.getTime()) {
      baseline = point;
    } else {
      break;
    }
  }
  if (!baseline) baseline = metricsHistory[0];
  return { score: baseline?.score ?? 0, comments: baseline?.commentCount ?? 0 };
}
