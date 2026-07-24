/**
 * サイト内検索（F4）。タイトル・本文の双方をキーワード一致対象にする。
 * 本文は見出し/段落/引用のブロック配列（JSON）のため、ブロックの text を連結してから
 * 一致判定する（architecture.md 記載の「無理なく実装する」方針）。
 * 判定ロジック自体は DB に依存しない純関数として切り出し、Vitest で検証する。
 */
import { prisma } from "@/lib/prisma";
import { parseArticleBody, type ArticleBodyBlock } from "@/lib/article-body";
import { summarySelect, toSummary, PUBLISHED_ONLY, type ArticleSummary } from "@/lib/articles";

/** 本文ブロック配列から検索対象テキストを連結して作る純関数。 */
export function bodyBlocksToText(blocks: ArticleBodyBlock[]): string {
  return blocks.map((b) => b.text).join(" ");
}

/**
 * タイトル・本文テキストのいずれかにキーワードが部分一致するか（大小文字を無視）。
 * クエリが空・空白のみの場合は一致なし扱いにする。
 */
export function matchesQuery(title: string, bodyText: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return title.toLowerCase().includes(q) || bodyText.toLowerCase().includes(q);
}

/**
 * キーワードでタイトル・本文を検索し、一致した記事を新しい順で返す。
 * 空クエリは空配列を返す（呼び出し側で「未検索」と「0件」を区別する）。
 */
export async function searchArticles(query: string): Promise<ArticleSummary[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const articles = await prisma.article.findMany({
    where: { ...PUBLISHED_ONLY },
    select: { ...summarySelect, body: true },
    orderBy: { publishedAt: "desc" },
  });

  return articles
    .filter((a) => {
      let bodyText = "";
      try {
        bodyText = bodyBlocksToText(parseArticleBody(a.body));
      } catch {
        // 不正な本文データは検索対象から除外するだけにし、検索自体を失敗させない。
        bodyText = "";
      }
      return matchesQuery(a.title, bodyText, trimmed);
    })
    .map(toSummary);
}
