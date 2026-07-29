import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCDragonItemIconUrl,
  buildJaNameMap,
  fetchCDragonVersions,
  fetchLatestItems,
  fetchPbeItems,
} from "@/lib/collection/adapters/cdragon-pbe";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchCDragonVersions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pbe/latest の content-metadata.json からバージョン文字列を抽出する（テスト1）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/pbe/content-metadata.json")) {
          return jsonResponse({ version: "16.16.8000032+branch.main.content.beta" });
        }
        if (url.includes("/latest/content-metadata.json")) {
          return jsonResponse({ version: "16.15.7996036+branch.releases-16-15.content.release" });
        }
        throw new Error(`unexpected url: ${url}`);
      }),
    );

    const versions = await fetchCDragonVersions();
    expect(versions.pbe).toBe("16.16.8000032+branch.main.content.beta");
    expect(versions.latest).toBe("16.15.7996036+branch.releases-16-15.content.release");
  });

  it("HTTPエラー時は該当チャンネルをnullにする（例外を投げない）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/pbe/")) return jsonResponse({}, 500);
        return jsonResponse({ version: "16.15.0" });
      }),
    );

    const versions = await fetchCDragonVersions();
    expect(versions.pbe).toBeNull();
    expect(versions.latest).toBe("16.15.0");
  });

  it("ネットワーク断・不正JSONは両方nullを返す（例外を投げない）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const versions = await fetchCDragonVersions();
    expect(versions.pbe).toBeNull();
    expect(versions.latest).toBeNull();
  });

  it("versionフィールドが無い/不正な形の場合はnullを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ notVersion: "x" })),
    );
    const versions = await fetchCDragonVersions();
    expect(versions.pbe).toBeNull();
    expect(versions.latest).toBeNull();
  });
});

describe("fetchPbeItems / fetchLatestItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sampleItem = {
    id: 1001,
    name: "Boots",
    description: "<mainText><stats><attention> 25</attention> Move Speed</stats><br><br></mainText>",
    active: false,
    inStore: true,
    from: [],
    to: [3006],
    priceTotal: 300,
    iconPath: "/lol-game-data/assets/ASSETS/Items/Icons2D/1001_Class_T1_BootsofSpeed.png",
  };

  it("items.jsonを取得しCDragonItem配列を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/pbe/plugins/rcp-be-lol-game-data/global/default/v1/items.json");
        return jsonResponse([sampleItem]);
      }),
    );
    const items = await fetchPbeItems("default");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(1001);
    expect(items[0].priceTotal).toBe(300);
  });

  it("ja_jpロケールのURLを構築する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/latest/plugins/rcp-be-lol-game-data/global/ja_jp/v1/items.json");
        return jsonResponse([{ ...sampleItem, name: "ブーツ" }]);
      }),
    );
    const items = await fetchLatestItems("ja_jp");
    expect(items[0].name).toBe("ブーツ");
  });

  it("必須フィールドが欠けている要素は除外する（不正データで壊れない）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([sampleItem, { id: 999, name: "Broken" }])),
    );
    const items = await fetchPbeItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(1001);
  });

  it("非2xx・不正JSON・ネットワーク断は空配列を返す（例外を投げない、テスト4）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 404)),
    );
    await expect(fetchPbeItems()).resolves.toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ not: "an array" }) }) as unknown as Response),
    );
    await expect(fetchLatestItems()).resolves.toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchPbeItems()).resolves.toEqual([]);
  });
});

describe("buildJaNameMap / buildCDragonItemIconUrl", () => {
  it("id→日本語名のマップを組み立てる", () => {
    const map = buildJaNameMap([
      { id: 1001, name: "ブーツ", description: "", priceTotal: 300, from: [], to: [], inStore: true },
    ]);
    expect(map[1001]).toBe("ブーツ");
  });

  it("iconPathを小文字化してCDragon配信URLを組み立てる", () => {
    expect(buildCDragonItemIconUrl("/lol-game-data/assets/ASSETS/Items/Icons2D/1001_Boots.png")).toBe(
      "https://raw.communitydragon.org/pbe/game/lol-game-data/assets/assets/items/icons2d/1001_boots.png",
    );
  });

  it("iconPathが無ければundefinedを返す", () => {
    expect(buildCDragonItemIconUrl(undefined)).toBeUndefined();
  });
});
