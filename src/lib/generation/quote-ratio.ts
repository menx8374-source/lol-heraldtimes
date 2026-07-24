/**
 * 引用の主従関係チェック（F7）。生成本文に引用(quote)ブロックを含む場合、
 * 引用が記事全体に占める文字数割合が過大でない(自サイト生成文が主・引用が従)ことを
 * LLMに依存せず判定する純関数。
 */
import type { ArticleBodyBlock } from "@/lib/article-body";

/** 既定の引用比率しきい値。これ以下であれば「引用が従」とみなす。 */
export const DEFAULT_QUOTE_RATIO_THRESHOLD = 0.4;

/** 本文ブロック配列全体に対する引用(quote)ブロックの文字数割合(0〜1)を返す。 */
export function computeQuoteRatio(blocks: ArticleBodyBlock[]): number {
  const totalLength = blocks.reduce((sum, b) => sum + b.text.length, 0);
  if (totalLength === 0) return 0;
  const quoteLength = blocks
    .filter((b) => b.type === "quote")
    .reduce((sum, b) => sum + b.text.length, 0);
  return quoteLength / totalLength;
}

/** 引用比率がしきい値以下(主従関係を満たす)か。引用ブロックが無ければ常に true。 */
export function hasAcceptableQuoteRatio(
  blocks: ArticleBodyBlock[],
  threshold: number = DEFAULT_QUOTE_RATIO_THRESHOLD,
): boolean {
  return computeQuoteRatio(blocks) <= threshold;
}
