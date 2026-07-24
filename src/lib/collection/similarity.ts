/**
 * タイトル・本文の類似度判定（F6）。日本語は単語分かち書きをしないため、
 * 文字bi-gram（2文字連続）のJaccard係数という決定論的かつ言語非依存な指標で近似する。
 * LLMに依存しないため、テストで完全に再現可能。
 */

/** 類似度計算の前処理: 全角/半角統一・小文字化・空白/句読点除去。 */
function normalizeForSimilarity(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[!-/:-@[-`{-~。、！？「」『』・…—―\-]/g, "");
}

function charBigrams(text: string): Set<string> {
  const normalized = normalizeForSimilarity(text);
  if (normalized.length === 0) return new Set();
  if (normalized.length === 1) return new Set([normalized]);
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    grams.add(normalized.slice(i, i + 2));
  }
  return grams;
}

/** 2つの文字列の文字bi-gram Jaccard係数（0〜1）。両方空文字なら1、片方だけ空なら0。 */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = charBigrams(a);
  const setB = charBigrams(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

export type SimilarityComparable = { title: string; content: string };

/** 既定の同一話題判定しきい値。タイトルを本文より重視した加重平均で判定する。 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

/**
 * 2つの収集アイテムが「同一話題」とみなせるほど類似しているか判定する（F6）。
 * タイトル一致を重視（重み0.7）しつつ本文（重み0.3）も加味する。
 */
export function isSameTopic(
  a: SimilarityComparable,
  b: SimilarityComparable,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): boolean {
  const titleSim = jaccardSimilarity(a.title, b.title);
  const contentSim = jaccardSimilarity(a.content, b.content);
  const combined = titleSim * 0.7 + contentSim * 0.3;
  return combined >= threshold;
}
