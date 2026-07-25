/**
 * 収集 live アダプタ共通の外部fetchヘルパ（拡張E16 自浄で抽出）。
 * 各アダプタ（riot/reddit/今後のyoutube等）が同じ「タイムアウト付きfetch＋失敗の握り潰し」を
 * 重複実装していたため一元化する。
 *
 * 方針: HTTPエラー・不正JSON・ネットワーク断・タイムアウトはいずれも例外を投げず `null` を返す
 * （1ソースの失敗が収集パイプライン全体を止めない）。呼び出し側は null を空扱いにする。
 * ログにはステータスと `context`（URL・サブレディット名等の非秘密情報）のみを出し、
 * 認証ヘッダ・トークン等のシークレットは出さない（呼び出し側で context に秘密を渡さないこと）。
 */

/** 1回のfetchあたりのタイムアウト（外部が応答しない場合に収集全体を止めないため）。 */
export const COLLECTION_FETCH_TIMEOUT_MS = 8000;

export type FetchJsonOptions = {
  /** ログ接頭辞（例 "riot-datadragon" / "reddit"）。 */
  logLabel?: string;
  /** ログに出す非秘密の識別情報（URL・サブレディット名等）。シークレットを渡さないこと。 */
  context?: string;
  timeoutMs?: number;
};

/**
 * 外部APIのJSONをタイムアウト付きで安全に取得する。`init` はメソッド・ヘッダ・ボディをそのまま
 * 渡せる（GET/POST両対応）。失敗（HTTPエラー・不正JSON・ネット断・タイムアウト）は `null` を返す。
 */
export async function fetchJsonSafe<T>(
  url: string,
  init: RequestInit = {},
  opts: FetchJsonOptions = {},
): Promise<T | null> {
  const { logLabel = "collection", context, timeoutMs = COLLECTION_FETCH_TIMEOUT_MS } = opts;
  const suffix = context ? ` (${context})` : "";
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.error(`[${logLabel}] HTTPエラー: status=${res.status}${suffix}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[${logLabel}] 取得に失敗しました${suffix}`, err instanceof Error ? err.message : err);
    return null;
  }
}
