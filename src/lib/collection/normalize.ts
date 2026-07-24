/**
 * URL正規化（F6）。表記ゆれ（トラッキングパラメータ・末尾スラッシュ・大文字小文字のホスト名等）を
 * 吸収し、同一ページを指す異なる文字列表現を同じキーに畳み込むための純関数。
 */

/** 正規化時に除去するトラッキング用クエリパラメータの前方一致プレフィックス。 */
const TRACKING_PARAM_PREFIXES = ["utm_"];

/** 正規化時に除去するトラッキング用クエリパラメータの完全一致名。 */
const TRACKING_PARAM_EXACT = new Set(["ref", "fbclid", "gclid", "igshid"]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return TRACKING_PARAM_EXACT.has(lower) || TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * URLを正規化する。パース不能な文字列は前後空白除去・小文字化した文字列をそのまま返す
 * （正規URLでない値でも重複判定キーとして最低限機能させるフォールバック）。
 *
 * 正規化内容:
 * - ホスト名を小文字化
 * - ハッシュフラグメントを除去
 * - トラッキングクエリパラメータ（utm_*, ref, fbclid 等）を除去し、残りをキー順にソート
 * - 末尾スラッシュを除去（ルートパス "/" は除く）
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    u.hostname = u.hostname.toLowerCase();
    u.hash = "";

    const remainingParams = Array.from(u.searchParams.entries())
      .filter(([key]) => !isTrackingParam(key))
      .sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    for (const [key, value] of remainingParams) {
      u.searchParams.append(key, value);
    }

    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }

    return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
  } catch {
    return trimmed.toLowerCase();
  }
}
