/**
 * 重複排除・正規化（F6）。収集アイテム間および既存記事との重複を検出し、
 * 「記事化候補キュー」に積む一意な話題だけを残す純関数群。DBには一切依存しない。
 */
import { isSameTopic, DEFAULT_SIMILARITY_THRESHOLD, type SimilarityComparable } from "@/lib/collection/similarity";

type DedupableItem = SimilarityComparable & { normalizedUrl: string; fetchedAt: Date };

/**
 * 正規化後URLが同一のアイテムを1件にまとめる。複数ある場合は最新の fetchedAt を採用する
 * （同一URLの再取込みで内容が更新された場合を想定）。
 */
export function dedupeByNormalizedUrl<T extends DedupableItem>(items: T[]): T[] {
  const byUrl = new Map<string, T>();
  for (const item of items) {
    const existing = byUrl.get(item.normalizedUrl);
    if (!existing || item.fetchedAt.getTime() > existing.fetchedAt.getTime()) {
      byUrl.set(item.normalizedUrl, item);
    }
  }
  return Array.from(byUrl.values());
}

export type SimilarityCluster<T> = { canonical: T; duplicates: T[] };

/**
 * タイトル・本文が高い類似度を持つアイテム同士を同一話題としてクラスタリングする。
 * 各クラスタの代表（canonical）は最も早く取得された（fetchedAt が最も古い）アイテムとし、
 * 残りは duplicates として記事化候補から外す対象にする。
 */
export function clusterBySimilarTopic<T extends DedupableItem>(
  items: T[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): SimilarityCluster<T>[] {
  const sortedByFetchedAt = [...items].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const clusters: SimilarityCluster<T>[] = [];

  for (const item of sortedByFetchedAt) {
    const cluster = clusters.find((c) => isSameTopic(c.canonical, item, threshold));
    if (cluster) {
      cluster.duplicates.push(item);
    } else {
      clusters.push({ canonical: item, duplicates: [] });
    }
  }
  return clusters;
}

/** 既に記事化済み（正規化URLが一致）のアイテムを除外する。 */
export function excludeArticledUrls<T extends { normalizedUrl: string }>(
  items: T[],
  articledNormalizedUrls: ReadonlySet<string>,
): T[] {
  return items.filter((item) => !articledNormalizedUrls.has(item.normalizedUrl));
}

export type CandidateQueueResult<T> = {
  /** 記事化候補キュー（一意な話題のみ）。 */
  queued: T[];
  /** 候補から外れた重複アイテム（類似話題クラスタの敗者）。 */
  duplicates: T[];
  /** 既存記事の出典URLと一致したため候補から除外されたアイテム。 */
  alreadyArticled: T[];
};

/**
 * 収集アイテム集合から記事化候補キューを組み立てる（F6）。
 * 手順: ①同一URL重複を1件化 → ②既に記事化済みのURLを除外 → ③類似話題をクラスタリングし代表のみ残す。
 */
export function buildCandidateQueue<T extends DedupableItem>(
  items: T[],
  articledNormalizedUrls: ReadonlySet<string>,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): CandidateQueueResult<T> {
  const deduped = dedupeByNormalizedUrl(items);
  const notArticled = excludeArticledUrls(deduped, articledNormalizedUrls);
  const alreadyArticled = deduped.filter((item) => articledNormalizedUrls.has(item.normalizedUrl));
  const clusters = clusterBySimilarTopic(notArticled, threshold);

  return {
    queued: clusters.map((c) => c.canonical),
    duplicates: clusters.flatMap((c) => c.duplicates),
    alreadyArticled,
  };
}
