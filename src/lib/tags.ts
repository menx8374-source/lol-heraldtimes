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
