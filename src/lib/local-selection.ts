/**
 * localStorageで「1記事/1コメントにつき1つの選択」を保持する薄いラッパー（拡張E13）。
 * SSR実行時（localStorage未定義）・プライベートモード等での読み書き失敗はtry/catchで
 * 握りつぶし、呼び出し元（クライアントコンポーネント）はその場限りの選択状態で動作を継続する
 * （UIをブロックしない）。
 *
 * 拡張E13再実装（試行2）: 呼び出し元コンポーネントは `useSyncExternalStore` でこのモジュールを
 * 購読する。`writeLocalSelection` のたびに同一キーの購読者へ同期的に通知し（同タブ内限定、
 * 他タブとの `storage` イベント同期は対象外＝スコープ外）、SSR/初回クライアント描画は
 * `getServerSnapshot`（常にnull）で一致させつつ、hydration後の再レンダーで実際の選択値を
 * 確実にDOMへ反映させる。
 */
type Listener = () => void;

const listenersByKey = new Map<string, Set<Listener>>();

function notify(key: string): void {
  listenersByKey.get(key)?.forEach((listener) => listener());
}

/** 指定キーの選択状態の変化を購読する（useSyncExternalStoreのsubscribe用）。 */
export function subscribeLocalSelection(key: string, onStoreChange: Listener): () => void {
  let listeners = listenersByKey.get(key);
  if (!listeners) {
    listeners = new Set();
    listenersByKey.set(key, listeners);
  }
  listeners.add(onStoreChange);
  return () => {
    listeners?.delete(onStoreChange);
  };
}

export function readLocalSelection(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalSelection(key: string, value: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // 読み書き失敗時は何もしない。
  } finally {
    notify(key);
  }
}
