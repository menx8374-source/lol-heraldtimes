/**
 * 記事サムネイル等に使う画像URLの安全性検証（拡張E19 F-E19-3）。
 * 収集アダプタが外部API（Reddit/YouTube/Twitch/Riot Data Dragon）から拾う画像URLは
 * 信頼できるサービスのものだが、保存/表示前に念のため形式を検証し、不正な値は
 * 呼び出し側で既定画像へフォールバックできるようにする（純関数、副作用なし）。
 *
 * 許可する値:
 * - `https://` の絶対URL
 * - `/` から始まるルート相対パス（自サイト `public/` 配下のローカル資産。既存のモック画像
 *   （`/mock-images/...`）・既定サムネイル（`/default-thumb.svg`）用）。ただし `//`（プロトコル相対URL、
 *   任意ホストへ誘導されうる）は拒否する。
 * それ以外（`http://`・`javascript:`・`data:`等）はすべて拒否する。
 */
/**
 * ルート相対のローカル資産パス（`public/` 配下）として安全か（純関数）。`//`（プロトコル相対URL）や
 * `/\`（ブラウザが `//` に正規化するバックスラッシュトリック）は外部ホスト読み込みになるため除外する。
 * 記事本文の画像ブロック検証（article-body.ts）とサムネイル検証（本ファイル）で共用する。
 */
export function isSafeLocalAssetPath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");
}

export function isSafeImageUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;

  if (trimmed.startsWith("/")) {
    return isSafeLocalAssetPath(trimmed);
  }

  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}
