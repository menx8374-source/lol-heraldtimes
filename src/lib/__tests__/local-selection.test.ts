/**
 * localStorageラッパー（拡張E13）のテスト。未定義環境・読み書き失敗時でも例外を投げず
 * nullフォールバックすることを検証する（UIをブロックしない要件）。
 * 拡張E13再実装（試行2）: `subscribeLocalSelection`が`useSyncExternalStore`のsubscribe/getSnapshot
 * 契約通りに動作すること（write時の通知・unsubscribe後は通知が来ない・別キーは影響しない）も検証する。
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { readLocalSelection, writeLocalSelection, subscribeLocalSelection } from "@/lib/local-selection";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("local-selection（拡張E13）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("localStorage未定義環境（SSR相当）では例外を投げず、読み取りはnullを返す", () => {
    expect(readLocalSelection("reaction:slug")).toBeNull();
    expect(() => writeLocalSelection("reaction:slug", "👍")).not.toThrow();
  });

  it("書き込んだ値を読み出せる", () => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    writeLocalSelection("reaction:slug", "👍");
    expect(readLocalSelection("reaction:slug")).toBe("👍");
  });

  it("nullを書き込むとキーを削除する", () => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    writeLocalSelection("vote:slug:1", "good");
    writeLocalSelection("vote:slug:1", null);
    expect(readLocalSelection("vote:slug:1")).toBeNull();
  });

  it("getItem/setItemが例外を投げる環境（プライベートモード等）でもUIを壊さない", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
      removeItem: () => {
        throw new Error("private mode");
      },
    } as unknown as Storage);
    expect(readLocalSelection("k")).toBeNull();
    expect(() => writeLocalSelection("k", "v")).not.toThrow();
    expect(() => writeLocalSelection("k", null)).not.toThrow();
  });
});

describe("subscribeLocalSelection（拡張E13再実装: useSyncExternalStore用のpub/sub）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("同一キーへの書き込みで購読者に通知される（hydration後の再レンダーに相当）", () => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    const listener = vi.fn();
    subscribeLocalSelection("reaction:slug", listener);

    writeLocalSelection("reaction:slug", "👍");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(readLocalSelection("reaction:slug")).toBe("👍");
  });

  it("unsubscribe後は通知されない", () => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    const listener = vi.fn();
    const unsubscribe = subscribeLocalSelection("reaction:slug", listener);
    unsubscribe();

    writeLocalSelection("reaction:slug", "👍");

    expect(listener).not.toHaveBeenCalled();
  });

  it("別キーへの書き込みでは通知されない（記事ごと・コメントごとに独立）", () => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    const listener = vi.fn();
    subscribeLocalSelection("vote:slug:1", listener);

    writeLocalSelection("vote:slug:2", "good");

    expect(listener).not.toHaveBeenCalled();
  });

  it("write失敗時（プライベートモード等）でも購読者への通知自体は行われる（値は変化しないため実質無害）", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("private mode");
      },
      removeItem: () => {
        throw new Error("private mode");
      },
    } as unknown as Storage);
    const listener = vi.fn();
    subscribeLocalSelection("reaction:slug", listener);

    expect(() => writeLocalSelection("reaction:slug", "👍")).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
