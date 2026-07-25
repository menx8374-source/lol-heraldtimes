/**
 * 運営お知らせバー（拡張E1）の設定読み込み。秘密情報ではなく任意の環境変数。
 * 未設定・空文字時は undefined を返し、呼び出し側（NoticeBar）が非表示にする。
 */
export function getSiteNotice(): string | undefined {
  const raw = process.env.SITE_NOTICE?.trim();
  return raw ? raw : undefined;
}
