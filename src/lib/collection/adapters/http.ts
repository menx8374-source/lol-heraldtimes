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

import type { RawCollectionItem } from "@/lib/collection/types";

/** 1回のfetchあたりのタイムアウト（外部が応答しない場合に収集全体を止めないため）。 */
export const COLLECTION_FETCH_TIMEOUT_MS = 8000;

/**
 * `sourceUrl` をキーに重複を除いた「順序保持」の配列を返す（`sourceUrl` 無しは除外）。
 * 複数エンドポイント/サブレディット/プロバイダから集めた候補の run 内重複を落とすため、各アダプタで共用する
 * （最終的な永続化時の重複排除は normalizedUrl 一意制約が担うが、ここで run 内の無駄も先に除く）。
 */
export function dedupeBySourceUrl(items: RawCollectionItem[]): RawCollectionItem[] {
  const seen = new Set<string>();
  const result: RawCollectionItem[] = [];
  for (const item of items) {
    if (!item.sourceUrl || seen.has(item.sourceUrl)) continue;
    seen.add(item.sourceUrl);
    result.push(item);
  }
  return result;
}

export type FetchSafeOptions = {
  /** ログ接頭辞（例 "riot-datadragon" / "reddit"）。 */
  logLabel?: string;
  /** ログに出す非秘密の識別情報（URL・サブレディット名等）。シークレットを渡さないこと。 */
  context?: string;
  timeoutMs?: number;
};

/**
 * タイムアウト付きで外部を取得し、レスポンス本文を `extract` で取り出す共通実装。
 * 失敗（HTTPエラー・ネット断・タイムアウト・本文抽出失敗）は例外を投げず `null` を返す。
 * JSON/テキストの違いは `extract`（res.json()/res.text()）だけなので、骨格はここに一元化する。
 */
async function fetchSafe<T>(
  url: string,
  init: RequestInit,
  opts: FetchSafeOptions,
  extract: (res: Response) => Promise<T>,
): Promise<T | null> {
  const { logLabel = "collection", context, timeoutMs = COLLECTION_FETCH_TIMEOUT_MS } = opts;
  const suffix = context ? ` (${context})` : "";
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.error(`[${logLabel}] HTTPエラー: status=${res.status}${suffix}`);
      return null;
    }
    return await extract(res);
  } catch (err) {
    console.error(`[${logLabel}] 取得に失敗しました${suffix}`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 外部APIのJSONをタイムアウト付きで安全に取得する。`init` はメソッド・ヘッダ・ボディをそのまま
 * 渡せる（GET/POST両対応）。失敗（HTTPエラー・不正JSON・ネット断・タイムアウト）は `null` を返す。
 */
export function fetchJsonSafe<T>(
  url: string,
  init: RequestInit = {},
  opts: FetchSafeOptions = {},
): Promise<T | null> {
  return fetchSafe<T>(url, init, opts, (res) => res.json() as Promise<T>);
}

/**
 * 外部エンドポイントのプレーンテキスト（JSONではないレスポンス。例: 5chのsubject.txt/dat）を
 * タイムアウト付きで安全に取得する。`fetchJsonSafe` と同型で、失敗時は `null` を返す。
 */
export function fetchTextSafe(
  url: string,
  init: RequestInit = {},
  opts: FetchSafeOptions = {},
): Promise<string | null> {
  return fetchSafe<string>(url, init, opts, (res) => res.text());
}
