/**
 * 記事レベルの重複検出（F9）。収集アイテム段階の重複排除（F6, collection/similarity.ts）と
 * 同じ考え方（文字bi-gramのJaccard係数）を流用し、生成済み記事のタイトル+本文が既存の
 * 公開済み記事群のいずれかと同一話題とみなせるほど類似していれば重複と判定する。
 */
import { isSameTopic, DEFAULT_SIMILARITY_THRESHOLD, type SimilarityComparable } from "@/lib/collection/similarity";

/** 既存記事群の中に、候補記事と同一話題とみなせるほど類似したものがあれば、その1件を返す。無ければ null。 */
export function findDuplicateArticle<T extends SimilarityComparable>(
  candidate: SimilarityComparable,
  existing: readonly T[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): T | null {
  return existing.find((e) => isSameTopic(candidate, e, threshold)) ?? null;
}
