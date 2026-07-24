/**
 * 逐語一致率の判定（F7）。生成本文が元ソース本文の「単なる複製」になっていないかを、
 * LLMに依存しない文字n-gramの被覆率で判定する純関数。
 *
 * similarity.ts（F6の同一話題判定）とは目的が異なるため別モジュールにする:
 * similarity.ts は短いbi-gramのJaccard係数で「話題として近いか」を緩く見るのに対し、
 * こちらは十分長いn-gram(既定12文字)を使い、「元ソースの連続した文字列が生成文にそのまま
 * 含まれているか(＝逐語コピーか)」を検出する。
 */

/** 逐語一致判定に使うn-gramの長さ。短すぎると無関係な文でも偶然一致し誤検知するため、
 * ある程度長い連続文字列の一致だけを「コピー」とみなす。 */
export const VERBATIM_NGRAM_SIZE = 12;

/** 既定の逐語一致率しきい値。これを超えたら「逐語コピー」とみなす。 */
export const DEFAULT_VERBATIM_THRESHOLD = 0.5;

function normalizeForVerbatim(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function charNGrams(text: string, n: number): Set<string> {
  if (text.length === 0) return new Set();
  if (text.length < n) return new Set([text]);
  const grams = new Set<string>();
  for (let i = 0; i <= text.length - n; i++) {
    grams.add(text.slice(i, i + n));
  }
  return grams;
}

/**
 * 元ソース本文の n-gram のうち、生成本文にそのまま(連続文字列として)含まれる割合(0〜1)を返す。
 * 元ソースが短い(n未満)場合はソース全体を1つの単位とみなす。
 */
export function computeVerbatimMatchRatio(
  generatedText: string,
  sourceText: string,
  n: number = VERBATIM_NGRAM_SIZE,
): number {
  const sourceNorm = normalizeForVerbatim(sourceText);
  const generatedNorm = normalizeForVerbatim(generatedText);
  const sourceGrams = charNGrams(sourceNorm, n);
  if (sourceGrams.size === 0) return 0;

  // ソースが n 文字以上なら、生成側も同じ長さの n-gram 集合を一度だけ構築し、集合メンバシップで判定する
  // （source グラムごとの includes 反復 = O(|source|×|generated|) を O(|source|+|generated|) に落とす）。
  // ソースが n 未満の短文のとき sourceGrams は1件だけ（＝グラム長がずれる）なので includes のままにする。
  const generatedLookup = sourceNorm.length >= n ? charNGrams(generatedNorm, n) : null;

  let matched = 0;
  for (const gram of sourceGrams) {
    const hit = generatedLookup ? generatedLookup.has(gram) : generatedNorm.includes(gram);
    if (hit) matched += 1;
  }
  return matched / sourceGrams.size;
}

/** 生成本文が元ソースの逐語コピーとみなせるほど一致しているか。 */
export function isVerbatimCopy(
  generatedText: string,
  sourceText: string,
  threshold: number = DEFAULT_VERBATIM_THRESHOLD,
): boolean {
  return computeVerbatimMatchRatio(generatedText, sourceText) > threshold;
}
