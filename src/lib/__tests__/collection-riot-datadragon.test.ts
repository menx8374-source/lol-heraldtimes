import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RiotDataDragonAdapter,
  buildPatchItem,
  buildPatchNoteUrl,
} from "@/lib/collection/adapters/riot-datadragon";

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("純関数: buildPatchNoteUrl / buildPatchItem", () => {
  it("バージョンからmajor.minor単位で一意・安定なパッチノートURLを構築する", () => {
    expect(buildPatchNoteUrl("14.6.1")).toBe("https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-14-6-notes/");
    // revision(3番目)が違っても同一パッチとして同じURLになる(dedupが効く)
    expect(buildPatchNoteUrl("14.6.2")).toBe(buildPatchNoteUrl("14.6.1"));
  });

  it("新パッチ検知アイテムはパッチ事実のタイトル・contentを持ちキーワード「パッチ」を含む", () => {
    const now = new Date("2026-07-25T00:00:00+09:00");
    const item = buildPatchItem("14.6.1", now);
    expect(item.title).toContain("パッチ");
    expect(item.title).toContain("14.6");
    expect(item.sourceUrl).toBe(buildPatchNoteUrl("14.6.1"));
    expect(item.fetchedAt).toBe(now);
  });

  it("新パッチ検知アイテムには画像を設定しない", () => {
    const item = buildPatchItem("14.6.1", new Date());
    expect(item.imageUrl).toBeFalsy();
  });
});

describe("RiotDataDragonAdapter.fetchItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("versionsのみを取得し、新パッチ検知1件のみを返す(拡張E20 F-E20-2: チャンピオン紹介は廃止)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === VERSIONS_URL) return jsonResponse(["14.6.1", "14.5.1"]);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RiotDataDragonAdapter({ now: () => new Date("2026-07-25T00:00:00Z") });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("パッチ");
    expect(items[0].sourceUrl).toBe("https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-14-6-notes/");

    // champion.json へのfetchは発生しない
    const championCall = fetchMock.mock.calls.find(([url]) => (url as string).includes("/champion.json"));
    expect(championCall).toBeUndefined();
  });

  it("versions取得がHTTPエラーの場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(null, 500)),
    );
    const adapter = new RiotDataDragonAdapter();
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("versions取得が不正JSON(パース失敗)の場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("invalid json");
        },
      })),
    );
    const adapter = new RiotDataDragonAdapter();
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("ネットワーク断(fetchがreject)の場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const adapter = new RiotDataDragonAdapter();
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });
});
