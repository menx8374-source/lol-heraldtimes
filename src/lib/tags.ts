import { prisma } from "@/lib/prisma";
import { PUBLISHED_ONLY } from "@/lib/articles";

/**
 * タグ動的セグメント（`/tags/[tag]`）用のデコードヘルパ。
 *
 * ブラウザ／Next の `<Link>` は日本語等の非ASCIIタグ名を含む href を生成する際、
 * 自動的に URL エンコードして遷移する（例: `#ヤスオ` → `/tags/%E3%83%A4%E3%82%B9%E3%82%AA`）。
 * ページコンポーネントが受け取る動的セグメントの値はそのエンコード済み文字列のままなので、
 * DB クエリ・見出し表示の前に必ずこの関数でデコードしてから使う。
 *
 * `decodeURIComponent` は不正なパーセントエンコード列（例: 途中で途切れた `%E3%82`）に対して
 * 例外を投げるため、その場合は安全側にフォールバックして受け取った生の文字列をそのまま返す
 * （0件ヒットにはなるが、ページ全体がクラッシュすることは防ぐ）。
 */
export function decodeTagParam(rawTag: string): string {
  try {
    return decodeURIComponent(rawTag);
  } catch {
    return rawTag;
  }
}

/**
 * タグクラウド/人気タグ（拡張E4）。DB非依存の集計・表示サイズ算出の純関数はここに集約し、
 * DB問い合わせ（listPopularTags/listAllTagNames）から分離してテストしやすくする。
 */
export type TagCount = { name: string; count: number };

/**
 * タグ名ごとの記事数から、0件タグを除外し記事数の多い順（同数は名前順）に上位 limit 件を選ぶ。
 */
export function rankTags(rows: TagCount[], limit: number): TagCount[] {
  return rows
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

const TAG_CLOUD_SIZE_CLASSES = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl"] as const;

/**
 * タグクラウドの文字サイズ用Tailwindクラスを、最大件数に対する相対比率から段階的に決める。
 * maxCount が0以下（タグが無い等）は最小サイズにフォールバックする。
 */
export function tagCloudSizeClass(count: number, maxCount: number): string {
  if (maxCount <= 0) return TAG_CLOUD_SIZE_CLASSES[0];
  const ratio = count / maxCount;
  const index = Math.min(
    TAG_CLOUD_SIZE_CLASSES.length - 1,
    Math.floor(ratio * TAG_CLOUD_SIZE_CLASSES.length),
  );
  return TAG_CLOUD_SIZE_CLASSES[index];
}

/**
 * 人気タグ集計（拡張E4）。公開記事のみを対象に、タグごとの記事数を数え、多い順に上位 limit 件を返す。
 * タグの総数は語彙（チャンピオン名・トピック等）に自然に有界なため、記事数とは独立に全タグを
 * 1クエリで取得しアプリ側でランキングする（N+1にはならない）。limit 省略/Infinity で全件。
 */
export async function listPopularTags(limit: number = 20): Promise<TagCount[]> {
  const rows = await prisma.tag.findMany({
    select: {
      name: true,
      _count: { select: { articles: { where: { article: PUBLISHED_ONLY } } } },
    },
  });
  return rankTags(
    rows.map((r) => ({ name: r.name, count: r._count.articles })),
    limit,
  );
}

/** サイトマップ用: 公開記事が1件以上付いている全タグ名を返す（件数上限なし。語彙として有界）。 */
export async function listAllTagNames(): Promise<string[]> {
  const rows = await prisma.tag.findMany({
    where: { articles: { some: { article: PUBLISHED_ONLY } } },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

/**
 * タグ一覧ページ（`/tags`, 拡張E10）用: 公開記事が1件以上付いている全タグを、記事数の多い順
 * （同数は名前順）で返す。件数上限なし＝`listPopularTags` を上限なしで呼ぶだけ（集計は同一）。
 */
export function listAllTagsWithCounts(): Promise<TagCount[]> {
  return listPopularTags(Number.POSITIVE_INFINITY);
}
