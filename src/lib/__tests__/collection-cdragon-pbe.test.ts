import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCDragonChampionIconUrl,
  buildCDragonItemIconUrl,
  buildJaChampionNameMap,
  buildJaNameMap,
  fetchCDragonVersions,
  fetchLatestChampion,
  fetchLatestChampionSummary,
  fetchLatestChampions,
  fetchLatestItems,
  fetchPbeChampion,
  fetchPbeChampionSummary,
  fetchPbeChampions,
  fetchPbeItems,
  resolveCandidateChampionKeys,
  MAX_CHAMPIONS_PER_FETCH,
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

const azirSummaryEntry = {
  id: 268,
  name: "Azir",
  alias: "Azir",
  squarePortraitPath: "/lol-game-data/assets/v1/champion-icons/268.png",
};

function azirChampionJson(locale: "default" | "ja_jp" = "default") {
  const isJa = locale === "ja_jp";
  return {
    id: 268,
    name: isJa ? "アジール" : "Azir",
    alias: "Azir",
    passive: {
      name: isJa ? "シュリーマの遺産" : "Shurima's Legacy",
      abilityIconPath: "/lol-game-data/assets/ASSETS/Characters/Azir/HUD/Icons2D/Azir_Passive.png",
    },
    spells: [
      {
        spellKey: "q",
        name: isJa ? "征服の勅命" : "Conquering Sands",
        abilityIconPath: "/lol-game-data/assets/ASSETS/Characters/Azir/HUD/Icons2D/Azir_Q.png",
        costCoefficients: [40, 40, 40, 40, 40],
        cooldownCoefficients: [8, 7.5, 7, 6.5, 6],
        coefficients: [0.3, 0.35, 0.4, 0.45, 0.5],
        effectAmounts: { Effect1Amount: [40, 60, 80, 100, 120] },
        ammo: { ammoRechargeTime: [0, 0, 0, 0, 0], maxAmmo: [0, 0, 0, 0, 0] },
      },
      { spellKey: "w", name: isJa ? "目覚めよ！" : "Arise!", costCoefficients: [0], cooldownCoefficients: [1] },
      { spellKey: "e", name: isJa ? "流砂の衝撃" : "Shifting Sands", costCoefficients: [0], cooldownCoefficients: [1] },
      { spellKey: "r", name: isJa ? "皇帝の分砂嶺" : "Emperor's Divide", costCoefficients: [0], cooldownCoefficients: [1] },
    ],
  };
}

function azirBinJson() {
  return {
    "Characters/Azir/CharacterRecords/Root": {
      baseHPModifiable: { baseValue: 575 },
      hpPerLevelModifiable: { baseValue: 108 },
      baseDamageModifiable: { baseValue: 56 },
      damagePerLevelModifiable: { baseValue: 3.5 },
      baseArmorModifiable: { baseValue: 25 },
      armorPerLevelModifiable: { baseValue: 5 },
      baseMR: { baseValue: 30 },
      baseMoveSpeedModifiable: { baseValue: 330 },
      attackRangeModifiable: { baseValue: 525 },
      attackSpeedModifiable: { baseValue: 0.625 },
      attackSpeedPerLevelModifiable: { baseValue: 5 },
      "{01262a25}": { baseValue: 1.3 }, // ハッシュ化未知キー(参照しないことを確認する材料)
    },
  };
}

describe("fetchPbeChampionSummary / fetchLatestChampionSummary / resolveCandidateChampionKeys", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("champion-summary.jsonを取得し、id<=0の無効エントリを除外する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/pbe/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json");
        return jsonResponse([{ id: -1, name: "None", alias: "None" }, azirSummaryEntry]);
      }),
    );
    const summary = await fetchPbeChampionSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0].id).toBe(268);
  });

  it("非2xx・不正JSON・ネットワーク断は空配列を返す（例外を投げない）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    await expect(fetchLatestChampionSummary()).resolves.toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchPbeChampionSummary()).resolves.toEqual([]);
  });

  it("pbe/latest両方のchampion-summaryに存在するidだけを昇順で返す（新規/削除は除外、誤帰属ゼロ）", () => {
    const pbeSummary = [
      { id: 268, name: "Azir", alias: "Azir" },
      { id: 9999, name: "NewChamp", alias: "NewChamp" }, // PBEのみの新規（対応が無いので候補外）
      { id: 1, name: "Annie", alias: "Annie" },
    ];
    const latestSummary = [
      { id: 1, name: "Annie", alias: "Annie" },
      { id: 268, name: "Azir", alias: "Azir" },
    ];
    expect(resolveCandidateChampionKeys(pbeSummary, latestSummary)).toEqual([1, 268]);
  });
});

describe("fetchPbeChampion / fetchLatestChampion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("champions/<key>.jsonと基本ステータス(bin.json)を合成して取得する（default locale、テスト1）", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/v1/champions/268.json")) return jsonResponse(azirChampionJson());
      if (url.includes("/game/data/characters/azir/azir.bin.json")) return jsonResponse(azirBinJson());
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const champ = await fetchPbeChampion(268);
    expect(champ).not.toBeNull();
    expect(champ?.id).toBe(268);
    expect(champ?.alias).toBe("Azir");
    expect(champ?.stats?.baseHP).toBe(575);
    expect(champ?.stats?.armorPerLevel).toBe(5);
    expect(champ?.spells).toHaveLength(4);
    expect(champ?.spells?.[0].costCoefficients).toEqual([40, 40, 40, 40, 40]);
    expect(champ?.spells?.[0].cooldownCoefficients).toEqual([8, 7.5, 7, 6.5, 6]);
    // スキル効果量(effectAmounts/coefficients)は一切拾わない（誤情報リスク回避）
    expect(champ?.spells?.[0]).not.toHaveProperty("effectAmounts");
    expect(champ?.spells?.[0]).not.toHaveProperty("coefficients");
    // fetch呼び出しは2回（champions json + bin.json）
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ja_jpロケールでは基本ステータス(bin.json)を取得しない（名前解決専用、fetchは1回のみ）", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/global/ja_jp/v1/champions/268.json");
      return jsonResponse(azirChampionJson("ja_jp"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const champ = await fetchLatestChampion(268, "ja_jp");
    expect(champ?.name).toBe("アジール");
    expect(champ?.passive?.name).toBe("シュリーマの遺産");
    expect(champ?.spells?.[0].name).toBe("征服の勅命");
    expect(champ?.stats).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("champions/<key>.json取得失敗・不正形はnullを返す（例外を投げない、テスト5）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 404)));
    await expect(fetchPbeChampion(268)).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchLatestChampion(268)).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ notAChampion: true })));
    await expect(fetchPbeChampion(268)).resolves.toBeNull();
  });

  it("bin.json取得失敗時はstatsがundefinedになるが、チャンピオン自体は取得できる（本体を止めない）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/v1/champions/268.json")) return jsonResponse(azirChampionJson());
        return jsonResponse({}, 404);
      }),
    );
    const champ = await fetchPbeChampion(268);
    expect(champ).not.toBeNull();
    expect(champ?.stats).toBeUndefined();
  });
});

describe("fetchPbeChampions / fetchLatestChampions（効率/レート配慮、テスト5）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("MAX_CHAMPIONS_PER_FETCHを超える候補キーは切り捨てる", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/game/data/characters/")) return jsonResponse(azirBinJson());
      return jsonResponse(azirChampionJson());
    });
    vi.stubGlobal("fetch", fetchMock);

    const manyKeys = Array.from({ length: MAX_CHAMPIONS_PER_FETCH + 10 }, (_, i) => i + 1);
    const champs = await fetchPbeChampions(manyKeys, "default", 0);
    expect(champs).toHaveLength(MAX_CHAMPIONS_PER_FETCH);
    // 1チャンピオンあたり champions.json + bin.json の2回
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CHAMPIONS_PER_FETCH * 2);
  });

  it("一部取得失敗があっても本体を止めず、成功分のみ返す", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/v1/champions/999.json")) return jsonResponse({}, 500);
      if (url.includes("/game/data/characters/")) return jsonResponse(azirBinJson());
      return jsonResponse(azirChampionJson());
    });
    vi.stubGlobal("fetch", fetchMock);

    const champs = await fetchLatestChampions([268, 999], "default", 0);
    expect(champs).toHaveLength(1);
    expect(champs[0].id).toBe(268);
  });
});

describe("buildJaChampionNameMap / buildCDragonChampionIconUrl", () => {
  it("id→日本語のチャンピオン名/パッシブ名/スキル名のマップを組み立てる（テスト4）", () => {
    const map = buildJaChampionNameMap([azirChampionJson("ja_jp")] as unknown as Parameters<typeof buildJaChampionNameMap>[0]);
    expect(map[268].name).toBe("アジール");
    expect(map[268].abilityNames.passive).toBe("シュリーマの遺産");
    expect(map[268].abilityNames.Q).toBe("征服の勅命");
    expect(map[268].abilityNames.R).toBe("皇帝の分砂嶺");
  });

  it("squarePortraitPathを小文字化してCDragon配信URLを組み立てる", () => {
    expect(buildCDragonChampionIconUrl(azirSummaryEntry.squarePortraitPath)).toBe(
      "https://raw.communitydragon.org/pbe/game/lol-game-data/assets/v1/champion-icons/268.png",
    );
  });

  it("squarePortraitPathが無ければundefinedを返す", () => {
    expect(buildCDragonChampionIconUrl(undefined)).toBeUndefined();
  });
});
