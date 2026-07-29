import { describe, expect, it } from "vitest";
import { diffItems, toArticleBodyPatchChangeBlock, type PbeItemChange } from "@/lib/generation/pbe-item-diff";
import type { CDragonItem } from "@/lib/collection/adapters/cdragon-pbe";

function item(overrides: Partial<CDragonItem> & Pick<CDragonItem, "id" | "name">): CDragonItem {
  return {
    description: "",
    priceTotal: 0,
    from: [],
    to: [],
    inStore: true,
    ...overrides,
  };
}

describe("diffItems", () => {
  it("priceTotal/ステータス/説明/素材/合成先/店舗掲載の変更分だけをbefore→after逐語で返す（テスト2）", () => {
    const latest: CDragonItem[] = [
      item({
        id: 1001,
        name: "Boots",
        description: "<mainText><stats><attention> 25</attention> Move Speed</stats><br><br></mainText>",
        priceTotal: 300,
        from: [],
        to: [3006],
        inStore: true,
        iconPath: "/lol-game-data/assets/ASSETS/Items/Icons2D/1001_Boots.png",
      }),
      item({ id: 2003, name: "Health Potion", description: "Restores health.", priceTotal: 50 }),
    ];
    const pbe: CDragonItem[] = [
      item({
        id: 1001,
        name: "Boots",
        description: "<mainText><stats><attention> 30</attention> Move Speed</stats><br><br></mainText>",
        priceTotal: 350,
        from: [],
        to: [3006, 3117],
        inStore: false,
        iconPath: "/lol-game-data/assets/ASSETS/Items/Icons2D/1001_Boots.png",
      }),
      item({ id: 2003, name: "Health Potion", description: "Restores health.", priceTotal: 50 }), // 変化なし
    ];

    const result = diffItems(pbe, latest);

    // 変化なしアイテム(2003)は含まれない
    expect(result).toHaveLength(1);
    const change = result[0];
    expect(change.id).toBe(1001);
    expect(change.name).toBe("Boots");

    const byStat = Object.fromEntries(change.changes.map((c) => [c.stat, c]));
    expect(byStat["合計コスト"]).toEqual({ stat: "合計コスト", before: "300", after: "350" });
    expect(byStat["ステータス"].before).toBe("25 Move Speed");
    expect(byStat["ステータス"].after).toBe("30 Move Speed");
    expect(byStat["合成先"].before).toContain("#3006");
    expect(byStat["合成先"].after).toContain("#3006");
    expect(byStat["合成先"].after).toContain("#3117");
    expect(byStat["店舗掲載"]).toEqual({ stat: "店舗掲載", before: "あり", after: "なし" });
    // 素材(from)は変化なしなので含まれない
    expect(byStat["素材"]).toBeUndefined();
  });

  it("変化なしのアイテムのみの場合は空配列を返す", () => {
    const items: CDragonItem[] = [item({ id: 1, name: "Same", description: "same", priceTotal: 100 })];
    expect(diffItems(items, items)).toEqual([]);
  });

  it("素材(from)の変更を逐語（アイテム名解決）で返す", () => {
    const componentA = item({ id: 1004, name: "Faerie Charm" });
    const latest: CDragonItem[] = [
      componentA,
      item({ id: 3010, name: "Symbol of War", from: [1004] }),
    ];
    const pbe: CDragonItem[] = [
      componentA,
      item({ id: 3010, name: "Symbol of War", from: [1004, 1006] }),
      item({ id: 1006, name: "Rejuvenation Bead" }),
    ];
    const result = diffItems(pbe, latest);
    const target = result.find((c) => c.id === 3010) as PbeItemChange;
    expect(target).toBeDefined();
    const fromChange = target.changes.find((c) => c.stat === "素材");
    expect(fromChange?.before).toBe("Faerie Charm");
    expect(fromChange?.after).toBe("Faerie Charm、Rejuvenation Bead");
  });

  it("PBEのみに存在する完全新規アイテム(latest側に対応が無い)は対象外にする（捏造しない、テスト2の新規/削除扱い）", () => {
    const latest: CDragonItem[] = [item({ id: 1001, name: "Boots", priceTotal: 300 })];
    const pbe: CDragonItem[] = [
      item({ id: 1001, name: "Boots", priceTotal: 300 }), // 変化なし
      item({ id: 9999, name: "Brand New Item", priceTotal: 1000 }), // latestに存在しない
    ];
    const result = diffItems(pbe, latest);
    expect(result).toEqual([]);
  });

  it("日本語名(jaNames)があれば日本語名、無ければ英名にフォールバックする（テスト3）", () => {
    const latest: CDragonItem[] = [item({ id: 1001, name: "Boots", priceTotal: 300 })];
    const pbe: CDragonItem[] = [item({ id: 1001, name: "Boots", priceTotal: 350 })];

    const withJa = diffItems(pbe, latest, { 1001: "ブーツ" });
    expect(withJa[0].name).toBe("ブーツ");

    const withoutJa = diffItems(pbe, latest);
    expect(withoutJa[0].name).toBe("Boots");

    // jaNamesにこのidが無い場合も英名にフォールバック
    const partialJa = diffItems(pbe, latest, { 2222: "他のアイテム" });
    expect(partialJa[0].name).toBe("Boots");
  });

  it("空配列同士・不正な入力でも例外を投げず空配列を返す（テスト4）", () => {
    expect(diffItems([], [])).toEqual([]);
    expect(diffItems([], [item({ id: 1, name: "x" })])).toEqual([]);
  });

  it("スキル効果量に相当するフィールド(effectAmounts等)は入力に含まれず、出力にも一切現れない", () => {
    const latest: CDragonItem[] = [item({ id: 1001, name: "Boots", priceTotal: 300 })];
    const pbe: CDragonItem[] = [item({ id: 1001, name: "Boots", priceTotal: 350 })];
    const result = diffItems(pbe, latest);
    const stats = result[0].changes.map((c) => c.stat);
    expect(stats).not.toContain("effectAmounts");
    expect(stats).not.toContain("coefficients");
  });
});

describe("toArticleBodyPatchChangeBlock", () => {
  it("PbeItemChangeをArticleBodyPatchChangeBlock(kind:item)へ変換する", () => {
    const change: PbeItemChange = {
      id: 1001,
      name: "ブーツ",
      iconPath: "/lol-game-data/assets/ASSETS/Items/Icons2D/1001_Boots.png",
      changes: [{ stat: "合計コスト", before: "300", after: "350" }],
    };
    const block = toArticleBodyPatchChangeBlock(change);
    expect(block.type).toBe("patchChange");
    expect(block.targetKind).toBe("item");
    expect(block.targetName).toBe("ブーツ");
    expect(block.direction).toBe("adjust");
    expect(block.targetIconUrl).toBe(
      "https://raw.communitydragon.org/pbe/game/lol-game-data/assets/assets/items/icons2d/1001_boots.png",
    );
    expect(block.groups).toHaveLength(1);
    expect(block.groups[0].changes).toEqual([{ stat: "合計コスト", before: "300", after: "350" }]);
  });

  it("iconPathが無ければtargetIconUrlはundefined", () => {
    const change: PbeItemChange = { id: 1, name: "x", changes: [{ stat: "s", before: "a", after: "b" }] };
    const block = toArticleBodyPatchChangeBlock(change);
    expect(block.targetIconUrl).toBeUndefined();
  });
});
