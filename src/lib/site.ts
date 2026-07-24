/**
 * サイトの絶対URLベース（F13）。OGP・構造化データ・サイトマップ・robots の絶対URL生成に使う。
 * 秘密情報ではなく任意の環境変数。未設定時はローカル開発既定値にフォールバックする。
 */
export function getSiteUrl(): string {
  const raw = process.env.SITE_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : "http://localhost:3000";
}

/**
 * 記事の正規URL。canonical・OGP(og:url)・JSON-LD・サイトマップで必ず一致させる必要があるため、
 * `/articles/<slug>` の組み立てをここに一元化する（各所でのベタ書きによるズレを防ぐ）。
 */
export function articleUrl(slug: string): string {
  return `${getSiteUrl()}/articles/${slug}`;
}
