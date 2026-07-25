import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RiotDataDragonAdapter,
  buildChampionItem,
  buildChampionPageUrl,
  buildPatchItem,
  buildPatchNoteUrl,
  selectRotatedChampionIds,
} from "@/lib/collection/adapters/riot-datadragon";

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const CHAMPION_DATA = {
  Aatrox: { id: "Aatrox", name: "エイトロックス", title: "ダーキンの剣士", blurb: "ダーキンに乗っ取られた剣士。", tags: ["Fighter", "Tank"] },
  Ahri: { id: "Ahri", name: "アーリ", title: "九尾の狐", blurb: "九つの尾を持つ半人半狐の存在。", tags: ["Mage", "Assassin"] },
  Akali: { id: "Akali", name: "アカリ", title: "背反の刃", blurb: "組織を抜けた暗殺者。", tags: ["Assassin"] },
};

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
});

describe("純関数: buildChampionPageUrl / buildChampionItem", () => {
  it("チャンピオンIDごとに一意・安定な公式ページURLを構築する", () => {
    expect(buildChampionPageUrl("Aatrox")).toBe("https://www.leagueoflegends.com/ja-jp/champions/aatrox/");
  });

  it("チャンピオン事実紹介アイテムはキーワード「チャンピオン」を含み公式blurbベースのcontent", () => {
    const now = new Date("2026-07-25T00:00:00+09:00");
    const item = buildChampionItem(CHAMPION_DATA.Ahri, now);
    expect(item.title).toContain("チャンピオン");
    expect(item.title).toContain("アーリ");
    expect(item.content).toContain("九つの尾を持つ半人半狐の存在。");
    expect(item.sourceUrl).toBe(buildChampionPageUrl("Ahri"));
  });
});

describe("純関数: selectRotatedChampionIds", () => {
  const ids = ["Aatrox", "Ahri", "Akali", "Bard", "Braum"];

  it("窓の幅ぶんのIDを返す(全件以下なら重複なし)", () => {
    const result = selectRotatedChampionIds(ids, new Date("2026-01-01T00:00:00Z"), 3);
    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
  });

  it("実行日が異なれば選ばれるチャンピオンが変わる(初回以降0件で止まらない)", () => {
    const day1 = selectRotatedChampionIds(ids, new Date("2026-01-01T00:00:00Z"), 2);
    const day2 = selectRotatedChampionIds(ids, new Date("2026-01-02T00:00:00Z"), 2);
    const day3 = selectRotatedChampionIds(ids, new Date("2026-01-03T00:00:00Z"), 2);
    expect(day1).not.toEqual(day2);
    expect(day2).not.toEqual(day3);
  });

  it("空配列や0以下の窓幅では空を返す", () => {
    expect(selectRotatedChampionIds([], new Date(), 5)).toEqual([]);
    expect(selectRotatedChampionIds(ids, new Date(), 0)).toEqual([]);
  });
});

describe("RiotDataDragonAdapter.fetchItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("versions/championを取得し、新パッチ検知1件＋ローテーション窓ぶんのチャンピオン事実紹介を返す", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === VERSIONS_URL) return jsonResponse(["14.6.1", "14.5.1"]);
      if (url.includes("/champion.json")) return jsonResponse({ data: CHAMPION_DATA });
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RiotDataDragonAdapter({
      now: () => new Date("2026-07-25T00:00:00Z"),
      championWindowSize: 2,
    });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(3); // patch 1件 + champion 2件
    expect(items[0].title).toContain("パッチ");
    expect(items[0].sourceUrl).toBe("https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-14-6-notes/");
    expect(items[1].title).toContain("チャンピオン");
    expect(items[2].title).toContain("チャンピオン");

    // champion.json のURLに locale(既定 ja_JP) と最新versionが反映されている
    const championCall = fetchMock.mock.calls.find(([url]) => (url as string).includes("/champion.json"));
    expect(championCall?.[0]).toBe("https://ddragon.leagueoflegends.com/cdn/14.6.1/data/ja_JP/champion.json");
  });

  it("任意のlocaleを反映する", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === VERSIONS_URL) return jsonResponse(["14.6.1"]);
      if (url.includes("/champion.json")) return jsonResponse({ data: CHAMPION_DATA });
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RiotDataDragonAdapter({ locale: "en_US", now: () => new Date("2026-07-25T00:00:00Z") });
    await adapter.fetchItems();

    const championCall = fetchMock.mock.calls.find(([url]) => (url as string).includes("/champion.json"));
    expect(championCall?.[0]).toBe("https://ddragon.leagueoflegends.com/cdn/14.6.1/data/en_US/champion.json");
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

  it("championのみ取得失敗した場合は新パッチ検知アイテムだけを返す(他ソース/他アイテムを止めない)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === VERSIONS_URL) return jsonResponse(["14.6.1"]);
      return jsonResponse(null, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RiotDataDragonAdapter({ now: () => new Date("2026-07-25T00:00:00Z") });
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("パッチ");
  });
});
