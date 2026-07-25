/**
 * Cookie同意（CMP、拡張E5）の状態管理ロジック。初回訪問時にバナーを表示し、
 * 「同意する」「拒否/後で」の選択をlocalStorageに保存して次回以降は再表示しない。
 * 同意状態は「解析/広告のCookieを使うタグ（GA4等）を読み込んでよいか」の判定にも使う
 * （＝同意前トラッキング禁止。src/lib/analytics.ts の shouldLoadAnalytics 参照）。
 *
 * DOM/localStorageに直接触れる箇所は呼び出し側（クライアントコンポーネント）に閉じ込め、
 * ここでは読み取った生の値からの状態判定・表示可否判定のみを純関数で扱う（テスト容易性のため）。
 */

export type ConsentStatus = "unknown" | "accepted" | "rejected";

export const CONSENT_STORAGE_KEY = "lol-matome:cookie-consent";

/** localStorageから読んだ生値をConsentStatusに正規化する。不正・未設定値は"unknown"扱い。 */
export function parseConsentStatus(rawValue: string | null | undefined): ConsentStatus {
  if (rawValue === "accepted" || rawValue === "rejected") return rawValue;
  return "unknown";
}

/** 同意バナーを表示すべきか（＝まだ意思表示していない場合のみ）。 */
export function shouldShowConsentBanner(status: ConsentStatus): boolean {
  return status === "unknown";
}

/** 解析/広告のCookieを使うタグ（GA4等）を読み込んでよいか（＝明示的に同意した場合のみ）。 */
export function isTrackingAllowed(status: ConsentStatus): boolean {
  return status === "accepted";
}
