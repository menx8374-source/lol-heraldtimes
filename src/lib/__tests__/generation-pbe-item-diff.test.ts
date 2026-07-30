import { describe, expect, it } from "vitest";
import { diffItems, toArticleBodyPatchChangeBlock, type PbeItemChange } from "@/lib/generation/pbe-item-diff";
import type { CDragonItem } from "@/lib/collection/adapters/cdragon-pbe";

/** 実在の店売りアイテムの既定値（`inStore: true` かつ `displayInItemSets: true`）。 */
function item(overrides: Partial<CDragonItem> & Pick<CDragonItem, "id" | "name">): CDragonItem {
  return {
    description: "",
    priceTotal: 0,
    from: [],
    to: [],
    inStore: true,
    displayInItemSets: true,
    ...overrides,
  };
}

describe("diffItems（PBE-S6 F-PBE6-1: 実在アイテムのみ・日本語ラベル・ノイズ無し）", () => {
  it("価格(priceTotal)の変更を「価格」stat・ゴールド単位の逐語で返す（テスト1）", () => {
    const latest: CDragonItem[] = [item({ id: 1001, name: "Boots", priceTotal: 300 })];
    const pbe: CDragonItem[] = [item({ id: 1001, name: "Boots", priceTotal: 350 })];

    const result = diffItems(pbe, latest);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1001);
    expect(result[0].changes).toEqual([{ stat: "価格", before: "300ゴールド", after: "350ゴールド" }]);
  });

  it("対訳glossaryにあるステータス数値の変更を日本語ラベルで返す（魔力/攻撃速度、テスト2）", () => {
    const latest: CDragonItem[] = [
      item({
        id: 3089,
        name: "Rabadon's Deathcap",
        description: "<mainText><stats> 100% Ability Power</stats><br><br></mainText>",
      }),
    ];
    const pbe: CDragonItem[] = [
      item({
        id: 3089,
        name: "Rabadon's Deathcap",
        description: "<mainText><stats> 120% Ability Power</stats><br><br></mainText>",
      }),
    ];

    const result = diffItems(pbe, latest);
    expect(result).toHaveLength(1);
    expect(result[0].changes).toEqual([{ stat: "魔力", before: "100%", after: "120%" }]);
  });

  it("複数ステータス（攻撃速度・クールダウン短縮）の変更をそれぞれ日本語ラベルで返す", () => {
    const latest: CDragonItem[] = [
      item({
        id: 3115,
        name: "Nashor's Tooth",
        description:
          "<mainText><stats> 65 Ability Power<br> 50% Attack Speed</stats><br><br> 20% Cooldown Reduction</mainText>",
      }),
    ];
    const pbe: CDragonItem[] = [
      item({
        id: 3115,
        name: "Nashor's Tooth",
        description:
          "<mainText><stats> 65 Ability Power<br> 55% Attack Speed<br> 25% Cooldown Reduction</stats><br><br></mainText>",
      }),
    ];

    const result = diffItems(pbe, latest);
    expect(result).toHaveLength(1);
    const byStat = Object.fromEntries(result[0].changes.map((c) => [c.stat, c]));
    expect(byStat["攻撃速度"]).toEqual({ stat: "攻撃速度", before: "50%", after: "55%" });
    // latest側は<stats>外(プレーンテキスト)にあり読み取れないため「なし」→pbeで新規追加扱い(捏造しない)
    expect(byStat["クールダウン短縮"]).toEqual({ stat: "クールダウン短縮", before: "なし", after: "25%" });
    expect(byStat["魔力"]).toBeUndefined(); // 変化なしは含まれない
  });

  it("英語の自由記述(prose)の差分・大文字小文字だけの違いは一切出さない（実データ報告①②の解消、テスト2）", () => {
    const latest: CDragonItem[] = [
      item({
        id: 6035,
        name: "Last Whisper",
        description:
          '<mainText><stats> 40 Attack Damage</stats><br><br><jadeUnique>Piercing Volley:</jadeUnique> You ignore <armorPen>35%</armorPen> of your opponent\'s armor.</mainText>',
      }),
    ];
    const pbe: CDragonItem[] = [
      item({
        id: 6035,
        name: "Last Whisper",
        description:
          '<mainText><stats> 40 Attack Damage</stats><br><br><jadeUnique>Piercing Volley:</jadeUnique> You ignore <armorPen>35%</armorPen> of your opponent\'s <scaleArmor>Armor</scaleArmor>.</mainText>',
      }),
    ];

    // <stats>ブロック(数値+既知ラベル)は同一、prose側だけの大文字小文字違いは差分として出ない
    expect(diffItems(pbe, latest)).toEqual([]);
  });

  it("対訳の無いステータス名は捏造せず出力しない(既知ラベルのみ日本語化)", () => {
    const latest: CDragonItem[] = [
      item({
        id: 9999,
        name: "Mystery Item",
        description: "<mainText><stats> 10 Unknown Stat Name</stats><br><br></mainText>",
      }),
    ];
    const pbe: CDragonItem[] = [
      item({
        id: 9999,
        name: "Mystery Item",
        description: "<mainText><stats> 20 Unknown Stat Name</stats><br><br></mainText>",
      }),
    ];
    expect(diffItems(pbe, latest)).toEqual([]);
  });

  it("inStore=falseの非店売りアイテムは対象外にする", () => {
    const latest: CDragonItem[] = [item({ id: 2001, name: "Recall", inStore: false, priceTotal: 0 })];
    const pbe: CDragonItem[] = [item({ id: 2001, name: "Recall", inStore: false, priceTotal: 60 })];
    expect(diffItems(pbe, latest)).toEqual([]);
  });

  it("displayInItemSets=falseの削除済み/専用モードアイテムは除外する（実データ報告③=エリーサの奇跡/デスファイア グラスプ相当、テスト1）", () => {
    const latest: CDragonItem[] = [
      item({
        id: 3128,
        name: "Deathfire Grasp",
        inStore: true,
        displayInItemSets: false,
        priceTotal: 2900,
      }),
      item({
        id: 3063,
        name: "Eleisa's Miracle",
        inStore: true,
        displayInItemSets: false,
        priceTotal: 2750,
      }),
    ];
    const pbe: CDragonItem[] = [
      item({
        id: 3128,
        name: "Deathfire Grasp",
        inStore: true,
        displayInItemSets: false,
        priceTotal: 3000, // 価格変更があっても除外対象
      }),
      item({
        id: 3063,
        name: "Eleisa's Miracle",
        inStore: true,
        displayInItemSets: false,
        priceTotal: 2800,
      }),
    ];
    expect(diffItems(pbe, latest)).toEqual([]);
  });

  it("displayInItemSetsが未設定(旧フィクスチャ相当)のアイテムも対象外にする(実在アイテムのみが安全側の既定)", () => {
    const latest: CDragonItem[] = [
      { id: 1, name: "Legacy Item", description: "", priceTotal: 100, from: [], to: [], inStore: true },
    ];
    const pbe: CDragonItem[] = [
      { id: 1, name: "Legacy Item", description: "", priceTotal: 200, from: [], to: [], inStore: true },
    ];
    expect(diffItems(pbe, latest)).toEqual([]);
  });

  it("変化なしのアイテムのみの場合は空配列を返す（意味のある差分が無ければ0件、テスト3）", () => {
    const items: CDragonItem[] = [item({ id: 1, name: "Same", description: "same", priceTotal: 100 })];
    expect(diffItems(items, items)).toEqual([]);
  });

  it("PBEのみに存在する完全新規アイテム(latest側に対応が無い)は対象外にする（捏造しない）", () => {
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
      changes: [{ stat: "価格", before: "300ゴールド", after: "350ゴールド" }],
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
    expect(block.groups[0].changes).toEqual([{ stat: "価格", before: "300ゴールド", after: "350ゴールド" }]);
  });

  it("iconPathが無ければtargetIconUrlはundefined", () => {
    const change: PbeItemChange = { id: 1, name: "x", changes: [{ stat: "s", before: "a", after: "b" }] };
    const block = toArticleBodyPatchChangeBlock(change);
    expect(block.targetIconUrl).toBeUndefined();
  });
});
