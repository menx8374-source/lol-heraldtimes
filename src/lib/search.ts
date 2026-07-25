/**
 * サイト内検索（F4）。タイトル・本文の双方をキーワード一致対象にする。
 * 本文は見出し/段落/引用のブロック配列（JSON）のため、ブロックの text を連結してから
 * 一致判定する（architecture.md 記載の「無理なく実装する」方針）。
 * 判定ロジック自体は DB に依存しない純関数として切り出し、Vitest で検証する。
 */
import { prisma } from "@/lib/prisma";
import { parseArticleBody, blockText, type ArticleBodyBlock } from "@/lib/article-body";
import { summarySelect, toSummary, PUBLISHED_ONLY, type ArticleSummary } from "@/lib/articles";
import { DEFAULT_PAGE_SIZE, paginateArray, type PaginationResult } from "@/lib/pagination";

/** 本文ブロック配列から検索対象テキストを連結して作る純関数（reactionブロックのレス本文も対象に含む）。 */
export function bodyBlocksToText(blocks: ArticleBodyBlock[]): string {
  return blocks.map(blockText).join(" ");
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
 * キーワードでタイトル・本文を検索し、一致した記事を新しい順・ページ単位で返す（拡張E1: ページネーション）。
 * 本文一致判定がDBのWHEREで表現できない（JSON本文をブロックごとに連結してから判定する）ため、
 * 一致判定まではアプリ側で行い、その後のページ分割は `paginateArray`（メモリ上配列）に委ねる。
 * 空クエリは0件扱い（1ページ目・空配列）を返す（呼び出し側で「未検索」と「0件」を区別する）。
 */
export async function searchArticles(
  query: string,
  page = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PaginationResult<ArticleSummary>> {
  const trimmed = query.trim();
  if (!trimmed) return { items: [], page: 1, pageSize, totalCount: 0, totalPages: 1 };

  const articles = await prisma.article.findMany({
    where: { ...PUBLISHED_ONLY },
    select: summarySelect, // summarySelect は既に body を含む（抜粋・本文検索の双方に使う）
    orderBy: { publishedAt: "desc" },
  });

  const matched = articles
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

  return paginateArray(matched, page, pageSize);
}
