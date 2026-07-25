/**
 * SEO出力の純関数群（F13）。LLM非依存・DB非依存で、メタディスクリプション生成と
 * JSON-LD の安全な直列化だけを担う（ページ側の generateMetadata/構造化データ埋め込みから使う）。
 */
import { blockText, type ArticleBodyBlock } from "@/lib/article-body";

const DESCRIPTION_MAX_LENGTH = 120;
/** 記事カードの本文抜粋（拡張E1）はメタディスクリプションより短く、先頭〜80字程度にする。 */
const EXCERPT_MAX_LENGTH = 80;

/**
 * 記事本文ブロックから要約テキストを作る。最初の段落（無ければ最初のブロック）の
 * テキストを空白正規化し、`maxLength` で省略する。メタディスクリプション（120字）と
 * 記事カードの本文抜粋（80字）の両方でこの共通ロジックを使う。
 */
export function buildArticleDescription(
  blocks: ArticleBodyBlock[],
  maxLength: number = DESCRIPTION_MAX_LENGTH,
): string {
  const firstParagraph = blocks.find((b) => b.type === "paragraph");
  const text = (firstParagraph ? blockText(firstParagraph) : blocks[0] ? blockText(blocks[0]) : "");
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

/** 記事カード用の短い本文抜粋（拡張E1）。`buildArticleDescription` を短い上限長で流用する。 */
export function buildArticleExcerpt(blocks: ArticleBodyBlock[]): string {
  return buildArticleDescription(blocks, EXCERPT_MAX_LENGTH);
}

/**
 * JSON-LD を `<script type="application/ld+json">` に埋め込むための安全な直列化。
 * 記事タイトル等（LLM生成・元は掲示板由来のテキスト）に `</script>` のような文字列が
 * 混入していてもスクリプトタグを早期終了させられないよう、"<" を Unicode エスケープする。
 */
export function toSafeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
