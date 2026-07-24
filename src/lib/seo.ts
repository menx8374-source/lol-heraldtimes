/**
 * SEO出力の純関数群（F13）。LLM非依存・DB非依存で、メタディスクリプション生成と
 * JSON-LD の安全な直列化だけを担う（ページ側の generateMetadata/構造化データ埋め込みから使う）。
 */
import type { ArticleBodyBlock } from "@/lib/article-body";

const DESCRIPTION_MAX_LENGTH = 120;

/**
 * 記事本文ブロックからメタディスクリプション用の要約を作る。
 * 最初の段落（無ければ最初のブロック）のテキストを空白正規化し、上限長で省略する。
 */
export function buildArticleDescription(blocks: ArticleBodyBlock[]): string {
  const firstParagraph = blocks.find((b) => b.type === "paragraph");
  const text = firstParagraph?.text ?? blocks[0]?.text ?? "";
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= DESCRIPTION_MAX_LENGTH
    ? normalized
    : `${normalized.slice(0, DESCRIPTION_MAX_LENGTH)}…`;
}

/**
 * JSON-LD を `<script type="application/ld+json">` に埋め込むための安全な直列化。
 * 記事タイトル等（LLM生成・元は掲示板由来のテキスト）に `</script>` のような文字列が
 * 混入していてもスクリプトタグを早期終了させられないよう、"<" を Unicode エスケープする。
 */
export function toSafeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
