/**
 * 収集パイプラインのDB連携部分(F5)。ソース非依存の判定ロジックは collect-source.ts / filter.ts /
 * rate-limit.ts の純関数に委譲し、ここでは「前回実行時刻の取得」「収集アイテムの永続化(URL正規化キーで
 * upsert)」「実行ログの記録」のみを担当する。1ソースの失敗は記録するだけで他ソースの収集を止めない。
 */
import { prisma } from "@/lib/prisma";
import { collectFromSource } from "@/lib/collection/collect-source";
import { normalizeUrl } from "@/lib/collection/normalize";
import { getDefaultSourceConfigs } from "@/lib/collection/config";
import type { CollectionItem, SourceAdapter, SourceConfig, SourceType } from "@/lib/collection/types";

export type SourceRunSummary = {
  sourceType: SourceType;
  status: "success" | "failure" | "skipped-rate-limited";
  fetchedCount: number;
  savedCount: number;
  errorMessage?: string;
};

async function getLastRunAt(sourceType: SourceType): Promise<Date | null> {
  const last = await prisma.sourceFetchLog.findFirst({
    where: { sourceType },
    orderBy: { runAt: "desc" },
  });
  return last?.runAt ?? null;
}

/**
 * 実行ログを記録する。ログ記録の失敗は収集全体を止めてはいけないため、失敗してもコンソールに残すだけにする。
 */
async function logFetch(data: {
  sourceType: SourceType;
  runAt: Date;
  status: "success" | "failure";
  itemCount: number;
  errorMessage?: string;
}): Promise<void> {
  await prisma.sourceFetchLog
    .create({ data })
    .catch((logErr) =>
      console.error(`SourceFetchLogの保存に失敗しました (sourceType=${data.sourceType}):`, logErr),
    );
}

async function persistItem(item: CollectionItem): Promise<void> {
  const normalizedUrl = normalizeUrl(item.sourceUrl);
  await prisma.collectedItem.upsert({
    where: { normalizedUrl },
    create: {
      sourceType: item.sourceType,
      sourceUrl: item.sourceUrl,
      normalizedUrl,
      title: item.title,
      content: item.content,
      fetchedAt: item.fetchedAt,
    },
    update: {
      sourceUrl: item.sourceUrl,
      title: item.title,
      content: item.content,
      fetchedAt: item.fetchedAt,
    },
  });
}

/**
 * 1ソース分の収集を実行してDBへ保存し、実行ログを記録する。
 * ログ記録自体の失敗も収集全体を止めてはいけないため、その場合はコンソールに残すだけにする。
 */
async function runAndPersistSource(adapter: SourceAdapter, config: SourceConfig, now: Date): Promise<SourceRunSummary> {
  const sourceType = adapter.sourceType;
  const lastRunAt = await getLastRunAt(sourceType);
  const result = await collectFromSource(adapter, config, now, lastRunAt);

  if (result.status === "skipped-rate-limited") {
    return { sourceType, status: "skipped-rate-limited", fetchedCount: 0, savedCount: 0 };
  }

  if (result.status === "failure") {
    await logFetch({ sourceType, runAt: now, status: "failure", itemCount: 0, errorMessage: result.errorMessage });
    return { sourceType, status: "failure", fetchedCount: 0, savedCount: 0, errorMessage: result.errorMessage };
  }

  for (const item of result.items) {
    await persistItem(item);
  }
  await logFetch({ sourceType, runAt: now, status: "success", itemCount: result.items.length });

  return { sourceType, status: "success", fetchedCount: result.fetchedCount, savedCount: result.items.length };
}

/**
 * 全アダプタの収集を順に実行する。個々のアダプタは collect-source.ts 側で例外を捕捉済みだが、
 * 万一ここで想定外の例外が漏れても他ソースを止めないよう try/catch で二重に保護する。
 */
export async function runCollectionPipeline(
  adapters: SourceAdapter[],
  configs: Record<SourceType, SourceConfig> = getDefaultSourceConfigs(),
  now: Date = new Date(),
): Promise<SourceRunSummary[]> {
  const summaries: SourceRunSummary[] = [];
  for (const adapter of adapters) {
    try {
      summaries.push(await runAndPersistSource(adapter, configs[adapter.sourceType], now));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`収集パイプラインで想定外のエラー (sourceType=${adapter.sourceType}):`, err);
      summaries.push({ sourceType: adapter.sourceType, status: "failure", fetchedCount: 0, savedCount: 0, errorMessage });
    }
  }
  return summaries;
}
