/**
 * メトリクス定期更新サービス（リファクタリングS4 F-S4-3）。監視中（`Post.monitoring=true`）の
 * Postについて、経過時間帯に応じたバックオフ間隔（`isMetricsDue`）が来たものだけ
 * `SourceAdapter.fetchMetrics` で現在値を再取得し `PostMetricsHistory` に追記する。
 * `maxMonitorHours` を超えた Post は監視終了（`monitoring=false`）にする。
 *
 * 信頼境界: 1件の失敗（DB更新・外部fetch）は握り潰してログし、他Postの処理を継続する。
 * 呼び出し側（scripts/update-metrics.ts）を含め、この関数全体が例外で収集本体を止めることはない。
 * リクエスト間はディレイ（sleep）を挟み直列で処理する（reddit/5chアダプタと同方針）。
 */
import { prisma } from "@/lib/prisma";
import type { SourceAdapter, SourceType } from "@/lib/collection/types";
import { getAllAdapters } from "@/lib/collection/adapters";
import {
  getMetricsScheduleConfig,
  isMetricsDue,
  type MetricsScheduleConfig,
} from "@/lib/collection/metrics-schedule";

const DEFAULT_REQUEST_DELAY_MS = 1000;

function envIntLocal(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** sourceType→adapter のレジストリ。fetchMetrics 未実装のソース（riot等）は含まれない。 */
function buildAdapterMap(): Partial<Record<SourceType, SourceAdapter>> {
  const map: Partial<Record<SourceType, SourceAdapter>> = {};
  for (const adapter of getAllAdapters()) {
    map[adapter.sourceType] = adapter;
  }
  return map;
}

export type UpdateDueMetricsOptions = {
  /** 現在時刻（テスト注入用）。 */
  now: Date;
  /** sourceType→adapter。省略時は `getAllAdapters()` から構築する（テストは注入可）。 */
  adapters?: Partial<Record<SourceType, SourceAdapter>>;
  /** スケジュール設定。省略時は `getMetricsScheduleConfig()`。 */
  scheduleConfig?: MetricsScheduleConfig;
  /** 連続fetch間のディレイ(ms)。既定は env `METRICS_REQUEST_DELAY_MS`（既定1000）。 */
  delayMs?: number;
  /** ディレイの実処理の注入点（テスト用）。既定は実 setTimeout ベースの sleep。 */
  sleep?: (ms: number) => Promise<void>;
};

export type UpdateDueMetricsResult = {
  /** 監視対象として調べたPost数。 */
  checked: number;
  /** メトリクスを取得しPostMetricsHistoryへ追記した件数。 */
  updated: number;
  /** maxMonitorHours超で監視終了にした件数。 */
  retired: number;
};

/**
 * 監視中Postのうちdueなものだけメトリクスを再取得し履歴に追記する（F-S4-3）。
 * 1件の失敗は握り潰してログし、他Postの処理を継続する。全体としても例外を投げない。
 */
export async function updateDueMetrics(options: UpdateDueMetricsOptions): Promise<UpdateDueMetricsResult> {
  const { now } = options;
  const config = options.scheduleConfig ?? getMetricsScheduleConfig();
  const delayMs = options.delayMs ?? envIntLocal("METRICS_REQUEST_DELAY_MS", DEFAULT_REQUEST_DELAY_MS);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const adapters = options.adapters ?? buildAdapterMap();

  let checked = 0;
  let updated = 0;
  let retired = 0;
  let firstFetchDone = false;

  const posts = await prisma.post.findMany({
    where: { monitoring: true },
    orderBy: { lastCheckedAt: "asc" },
    take: config.maxPostsPerRun,
  });

  for (const post of posts) {
    checked += 1;
    try {
      const ageHours = (now.getTime() - post.postedAt.getTime()) / 3600000;
      if (ageHours > config.maxMonitorHours) {
        await prisma.post.update({ where: { id: post.id }, data: { monitoring: false } });
        retired += 1;
        continue;
      }

      if (!isMetricsDue({ postedAt: post.postedAt, lastCheckedAt: post.lastCheckedAt }, now, config)) {
        continue;
      }

      const adapter = adapters[post.sourceType as SourceType];
      if (!adapter?.fetchMetrics) {
        // 非対応ソース（riot等）はメトリクス取得できないため、次回同じdue判定を繰り返さないよう
        // lastCheckedAtだけ進める（監視自体は継続。maxMonitorHours到達でいずれ自然に終了する）。
        await prisma.post.update({ where: { id: post.id }, data: { lastCheckedAt: now } });
        continue;
      }

      if (firstFetchDone) {
        await sleep(delayMs);
      } else {
        firstFetchDone = true;
      }

      const metrics = await adapter.fetchMetrics(post.externalId);
      if (metrics) {
        await prisma.postMetricsHistory.create({
          data: { postId: post.id, score: metrics.score, commentCount: metrics.commentCount, capturedAt: now },
        });
        await prisma.post.update({ where: { id: post.id }, data: { lastCheckedAt: now } });
        updated += 1;
      } else {
        await prisma.post.update({ where: { id: post.id }, data: { lastCheckedAt: now } });
      }
    } catch (err) {
      console.error(
        `メトリクス更新に失敗しました(postId=${post.id}, sourceType=${post.sourceType})。この1件をスキップして続行します:`,
        err,
      );
    }
  }

  return { checked, updated, retired };
}
