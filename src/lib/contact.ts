/**
 * 掲載削除依頼（オプトアウト）・お問い合わせ用の連絡先メールアドレスを解決する純関数（F15）。
 * `CONTACT_EMAIL` 環境変数（秘密情報ではない）が設定されていればそれを使う。未設定時は
 * サイトURLのホスト名から `contact@<host>` を組み立てて既定値とする（運営者が実アドレスを
 * 用意し次第 `.env` に設定すれば即座に反映される）。
 */
export function resolveContactEmail(siteUrl: string): string {
  const envEmail = process.env.CONTACT_EMAIL?.trim();
  if (envEmail) return envEmail;

  try {
    const host = new URL(siteUrl).hostname;
    return `contact@${host}`;
  } catch {
    // siteUrl が不正な形式でもページ描画自体は止めない（フォールバック）。
    return "contact@example.com";
  }
}
