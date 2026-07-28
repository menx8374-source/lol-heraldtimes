/**
 * SEO出力の純関数群（F13）。LLM非依存・DB非依存で、メタディスクリプション生成と
 * JSON-LD の安全な直列化だけを担う（ページ側の generateMetadata/構造化データ埋め込みから使う）。
 */
import {
  blockText,
  type ArticleBodyBlock,
  type ArticleBodyReactionBlock,
} from "@/lib/article-body";

const DESCRIPTION_MAX_LENGTH = 120;
/**
 * 記事カードの本文抜粋（拡張E1、拡張E9でおばにゅー風レイアウトに合わせ80→100字へ拡張）は
 * メタディスクリプションより短く、先頭〜100字程度にする。
 */
const EXCERPT_MAX_LENGTH = 100;

/** 空白（改行含む）を1つの半角スペースに正規化し、`maxLength` を超える場合は省略記号付きで切り詰める。 */
function truncate(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

/** 最初の段落ブロック（無ければ最初のブロック）のテキストを返す。ブロックが空なら空文字。 */
function firstParagraphText(blocks: ArticleBodyBlock[]): string {
  const firstParagraph = blocks.find((b) => b.type === "paragraph");
  return firstParagraph ? blockText(firstParagraph) : blocks[0] ? blockText(blocks[0]) : "";
}

/**
 * 記事本文ブロックから要約テキストを作る。最初の段落（無ければ最初のブロック）の
 * テキストを空白正規化し、`maxLength` で省略する。メタディスクリプション（120字）で使う
 * （記事カードの本文抜粋は拡張E9で `buildArticleExcerpt` に分岐ロジックが分かれたため、
 * こちらは常に段落先頭を使う従来どおりの挙動を維持する）。
 */
export function buildArticleDescription(
  blocks: ArticleBodyBlock[],
  maxLength: number = DESCRIPTION_MAX_LENGTH,
): string {
  return truncate(firstParagraphText(blocks), maxLength);
}

/**
 * 反応まとめ記事（拡張E9・まとめ速報型/5ch・reddit）の「1レス目」の本文テキストを取り出す。
 * レス番号（number）が最小の reaction ブロックを1レス目とみなす（本文中の出現順とは限らないため）。
 * `>>N` のみのアンカー行は本文として不自然なため除外する。reaction ブロックが無い記事（Riot公式形式）
 * では null を返し、呼び出し側で段落抜粋にフォールバックさせる。
 */
function firstReactionLineText(blocks: ArticleBodyBlock[]): string | null {
  const reactionBlocks = blocks.filter(
    (b): b is ArticleBodyReactionBlock => b.type === "reaction",
  );
  if (reactionBlocks.length === 0) return null;

  const firstRes = reactionBlocks.reduce((min, b) => (b.number < min.number ? b : min));
  const text = firstRes.lines
    .map((line) => line.text)
    .filter((line) => !/^>>\d+$/.test(line.trim()))
    .join(" ")
    .trim();
  return text.length > 0 ? text : null;
}

/**
 * 記事カード用の短い本文抜粋（拡張E1、拡張E9で反応まとめの1レス目本文に対応）。
 * reaction ブロックを含む記事（まとめ速報型）は「1レス目の本文」から、含まない記事
 * （Riot公式形式）は従来どおり本文冒頭段落からの抜粋にフォールバックして生成する。
 */
export function buildArticleExcerpt(blocks: ArticleBodyBlock[]): string {
  const source = firstReactionLineText(blocks) ?? firstParagraphText(blocks);
  return truncate(source, EXCERPT_MAX_LENGTH);
}

/**
 * JSON-LD を `<script type="application/ld+json">` に埋め込むための安全な直列化。
 * 記事タイトル等（LLM生成・元は掲示板由来のテキスト）に `</script>` のような文字列が
 * 混入していてもスクリプトタグを早期終了させられないよう、"<" を Unicode エスケープする。
 */
export function toSafeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * パンくずリスト（拡張E4）1項目。`path` はサイト内相対パス（"/", "/category/patch-meta" 等）で、
 * 可視のパンくずナビ（<Link>）にはそのまま使い、構造化データ用の絶対URLは
 * `buildBreadcrumbJsonLd` 側で `siteUrl` と組み合わせて作る。
 */
export type BreadcrumbItem = { name: string; path: string };

/**
 * BreadcrumbList の JSON-LD オブジェクトを組み立てる純関数（F13拡張）。
 * schema.org の推奨に沿い `item` は絶対URLにする。埋め込み時は必ず `toSafeJsonLd` を通すこと
 * （記事タイトル等の閲覧者/収集由来テキストが `name` に入り得るため）。
 */
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[], siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.path === "/" ? siteUrl : `${siteUrl}${item.path}`,
    })),
  };
}

/** buildNewsArticleJsonLd の入力（記事メタ情報のみ。DB/フレームワーク非依存）。 */
export type NewsArticleJsonLdInput = {
  title: string;
  category: string;
  articleUrl: string;
  publishedAt: Date;
  updatedAt: Date;
  images: string[];
};

/**
 * 記事ページの NewsArticle 構造化データを組み立てる純関数（成長G5 F-G5-2）。
 * 既存フィールド（headline/datePublished/articleSection/mainEntityOfPage/image）に加え、
 * `dateModified`・`author`（まとめサイトのため運営組織名を返す。個人名は作らない）・
 * `publisher.logo`（サイト既定のOGP画像をロゴ代わりに利用）を追加する。
 * 埋め込み時は必ず `toSafeJsonLd` を通すこと（headline等に閲覧者/収集由来テキストが入り得るため）。
 */
export function buildNewsArticleJsonLd(
  input: NewsArticleJsonLdInput,
  siteUrl: string,
  siteName: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: input.title,
    datePublished: input.publishedAt.toISOString(),
    dateModified: input.updatedAt.toISOString(),
    articleSection: input.category,
    mainEntityOfPage: { "@type": "WebPage", "@id": input.articleUrl },
    image: input.images,
    author: { "@type": "Organization", name: siteName },
    publisher: {
      "@type": "Organization",
      name: siteName,
      logo: { "@type": "ImageObject", url: `${siteUrl}/og-default.svg` },
    },
  };
}
