/**
 * 統合パイプライン（F10）の設定。1回の実行で公開する記事本数の上限と、
 * 繰り返し実行の目安間隔（スケジュール設定）を env から読む。
 * 実際のcron常駐は本スプリントの必須要件ではないため、ここでは値の提供と
 * 「次回実行予定時刻」を計算する純関数のみを持つ（scripts/pipeline.tsが表示に使う）。
 * 秘密情報ではないため `.env.example` にはキー名と既定値のみ記載する。
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type PipelineConfig = {
  /** 1回の実行で公開する記事本数の上限（F10）。この本数を超えて一度に公開しない。 */
  maxPublishPerRun: number;
  /**
   * カテゴリ(=ソース種別)別の1回の実行あたり公開本数上限（拡張E48）。パッチ/メタ・5chの反応・
   * 海外の反応をそれぞれ独立に最大この本数まで公開する。run-pipelineではこちらを主制御に使う。
   */
  maxPublishPerCategory: number;
  /** 繰り返し実行の目安間隔（ミリ秒）。まとめサイトとして自然な更新頻度（既定4時間）。 */
  intervalMs: number;
};

export function getPipelineConfig(): PipelineConfig {
  return {
    maxPublishPerRun: envInt("PIPELINE_MAX_PUBLISH_PER_RUN", 5),
    maxPublishPerCategory: envInt("PIPELINE_MAX_PUBLISH_PER_CATEGORY", 2),
    intervalMs: envInt("PIPELINE_INTERVAL_MS", 4 * 60 * 60 * 1000),
  };
}

/** 前回実行時刻と間隔から、次回のスケジュール実行予定時刻を計算する（純関数）。 */
export function computeNextRunAt(lastRunAt: Date, intervalMs: number): Date {
  return new Date(lastRunAt.getTime() + intervalMs);
}
