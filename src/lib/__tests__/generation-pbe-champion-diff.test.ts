import { describe, expect, it } from "vitest";
import {
  diffChampions,
  toArticleBodyPatchChangeBlock,
  type PbeChampionChange,
} from "@/lib/generation/pbe-champion-diff";
import type { CDragonChampion, JaChampionName } from "@/lib/collection/adapters/cdragon-pbe";

function champion(overrides: Partial<CDragonChampion> & Pick<CDragonChampion, "id" | "name" | "alias">): CDragonChampion {
  return {
    stats: {
      baseHP: 575,
      hpPerLevel: 108,
      baseDamage: 56,
      damagePerLevel: 3.5,
      baseArmor: 25,
      armorPerLevel: 5,
      baseMR: 30,
      baseMoveSpeed: 330,
      attackRange: 525,
      attackSpeed: 0.625,
      attackSpeedPerLevel: 5,
    },
    passive: { name: "Shurima's Legacy" },
    spells: [
      { name: "Conquering Sands", costCoefficients: [40, 40, 40, 40, 40], cooldownCoefficients: [8, 7.5, 7, 6.5, 6] },
      { name: "Arise!", costCoefficients: [0], cooldownCoefficients: [1] },
      { name: "Shifting Sands", costCoefficients: [0], cooldownCoefficients: [1] },
      { name: "Emperor's Divide", costCoefficients: [0], cooldownCoefficients: [1] },
    ],
    ...overrides,
  };
}

describe("diffChampions", () => {
  it("基本ステータス/cost/cooldownの変更分だけをbefore→after逐語で返す（変更なしチャンピオンは除外、テスト1）", () => {
    const latest: CDragonChampion[] = [
      champion({ id: 268, name: "Azir", alias: "Azir" }),
      champion({ id: 1, name: "Annie", alias: "Annie" }), // 変化なし
    ];
    const pbe: CDragonChampion[] = [
      champion({
        id: 268,
        name: "Azir",
        alias: "Azir",
        stats: { ...latest[0].stats, baseHP: 620, baseArmor: 25 },
        spells: [
          { name: "Conquering Sands", costCoefficients: [50, 50, 50, 50, 50], cooldownCoefficients: [6, 5.5, 5, 4.5, 4] },
          latest[0].spells![1],
          latest[0].spells![2],
          latest[0].spells![3],
        ],
      }),
      champion({ id: 1, name: "Annie", alias: "Annie" }), // latestと同一
    ];

    const result = diffChampions(pbe, latest);
    expect(result).toHaveLength(1);
    const change = result[0];
    expect(change.key).toBe(268);
    expect(change.id).toBe("Azir");

    const baseGroup = change.groups.find((g) => g.abilityKey === "base");
    expect(baseGroup).toBeDefined();
    const baseByStat = Object.fromEntries(baseGroup!.changes.map((c) => [c.stat, c]));
    expect(baseByStat["HP"]).toEqual({ stat: "HP", before: "575", after: "620" });
    expect(baseByStat["物理防御"]).toBeUndefined(); // 変化なしは含まれない

    const qGroup = change.groups.find((g) => g.abilityKey === "Q");
    expect(qGroup).toBeDefined();
    const qByStat = Object.fromEntries(qGroup!.changes.map((c) => [c.stat, c]));
    expect(qByStat["コスト"]).toEqual({ stat: "コスト", before: "40/40/40/40/40", after: "50/50/50/50/50" });
    expect(qByStat["クールダウン"]).toEqual({ stat: "クールダウン", before: "8/7.5/7/6.5/6", after: "6/5.5/5/4.5/4" });
  });

  it("変化なしのチャンピオンのみの場合は空配列を返す", () => {
    const champs = [champion({ id: 268, name: "Azir", alias: "Azir" })];
    expect(diffChampions(champs, champs)).toEqual([]);
  });

  it("弾数(ammo)の変更を逐語で返す", () => {
    const latest: CDragonChampion[] = [
      champion({
        id: 429,
        name: "Kalista",
        alias: "Kalista",
        spells: [
          { name: "Pierce", costCoefficients: [60], cooldownCoefficients: [9] },
          { name: "Sentinel", costCoefficients: [0], cooldownCoefficients: [30], ammo: { maxAmmo: [2, 2], ammoRechargeTime: [90, 80] } },
          { name: "Rend", costCoefficients: [30], cooldownCoefficients: [0] },
          { name: "Fate's Call", costCoefficients: [100], cooldownCoefficients: [160] },
        ],
      }),
    ];
    const pbe: CDragonChampion[] = [
      champion({
        id: 429,
        name: "Kalista",
        alias: "Kalista",
        spells: [
          latest[0].spells![0],
          { name: "Sentinel", costCoefficients: [0], cooldownCoefficients: [30], ammo: { maxAmmo: [3, 3], ammoRechargeTime: [90, 80] } },
          latest[0].spells![2],
          latest[0].spells![3],
        ],
      }),
    ];
    const result = diffChampions(pbe, latest);
    const wGroup = result[0].groups.find((g) => g.abilityKey === "W");
    const change = wGroup!.changes.find((c) => c.stat === "弾数");
    expect(change).toEqual({ stat: "弾数", before: "2/2", after: "3/3" });
  });

  it("PBEのみに存在する完全新規チャンピオン(latest側に対応が無い)は対象外にする（捏造しない）", () => {
    const latest: CDragonChampion[] = [champion({ id: 268, name: "Azir", alias: "Azir" })];
    const pbe: CDragonChampion[] = [
      champion({ id: 268, name: "Azir", alias: "Azir" }), // 変化なし
      champion({ id: 99999, name: "Brand New Champ", alias: "BrandNewChamp" }), // latestに存在しない
    ];
    expect(diffChampions(pbe, latest)).toEqual([]);
  });

  it("スキル効果量(effectAmounts/coefficients)に相当するフィールドは型に無く、diffに一切現れない", () => {
    const latest: CDragonChampion[] = [champion({ id: 268, name: "Azir", alias: "Azir" })];
    const pbeSpellWithExtra = {
      name: "Conquering Sands",
      costCoefficients: [50, 50, 50, 50, 50],
      cooldownCoefficients: [6, 5.5, 5, 4.5, 4],
      // 実際の型には存在しないフィールドを紛れ込ませても無視されることを確認する
      effectAmounts: { Effect1Amount: [999, 999, 999, 999, 999] },
      coefficients: [9.9, 9.9, 9.9, 9.9, 9.9],
    };
    const pbe: CDragonChampion[] = [
      champion({
        id: 268,
        name: "Azir",
        alias: "Azir",
        spells: [pbeSpellWithExtra as never, latest[0].spells![1], latest[0].spells![2], latest[0].spells![3]],
      }),
    ];
    const result = diffChampions(pbe, latest);
    const allStats = result[0].groups.flatMap((g) => g.changes.map((c) => c.stat));
    expect(allStats).not.toContain("effectAmounts");
    expect(allStats).not.toContain("coefficients");
    expect(allStats).toEqual(["コスト", "クールダウン"]); // costCoefficients/cooldownCoefficientsの変更のみ
  });

  it("日本語名(jaNames)があれば日本語のチャンピオン名/スキル名、無ければ英名にフォールバックする（テスト4）", () => {
    const latest: CDragonChampion[] = [champion({ id: 268, name: "Azir", alias: "Azir" })];
    const pbe: CDragonChampion[] = [
      champion({
        id: 268,
        name: "Azir",
        alias: "Azir",
        stats: { ...latest[0].stats, baseHP: 600 },
      }),
    ];
    const jaNames: Record<number, JaChampionName> = {
      268: { name: "アジール", abilityNames: { passive: "シュリーマの遺産", Q: "征服の勅命" } },
    };

    const withJa = diffChampions(pbe, latest, jaNames);
    expect(withJa[0].name).toBe("アジール");
    expect(withJa[0].id).toBe("Azir"); // 対象IDは常にalias（英名）で誤帰属ゼロ

    const withoutJa = diffChampions(pbe, latest);
    expect(withoutJa[0].name).toBe("Azir");
  });

  it("空配列同士・不正な入力でも例外を投げず空配列を返す（異常系）", () => {
    expect(diffChampions([], [])).toEqual([]);
    expect(diffChampions([], [champion({ id: 1, name: "x", alias: "X" })])).toEqual([]);
  });
});

describe("toArticleBodyPatchChangeBlock", () => {
  it("cost/cooldownの減少は強化(buff)判定になる（反転、テスト2）", () => {
    const change: PbeChampionChange = {
      key: 268,
      id: "Azir",
      name: "アジール",
      groups: [{ abilityKey: "Q", abilityName: "征服の勅命", changes: [{ stat: "コスト", before: "80", after: "60" }] }],
    };
    const block = toArticleBodyPatchChangeBlock(change);
    expect(block.type).toBe("patchChange");
    expect(block.targetKind).toBe("champion");
    expect(block.targetName).toBe("アジール");
    expect(block.direction).toBe("buff");
  });

  it("cost/cooldownの増加は弱体化(nerf)判定になる（反転）", () => {
    const change: PbeChampionChange = {
      key: 268,
      id: "Azir",
      name: "アジール",
      groups: [{ abilityKey: "Q", changes: [{ stat: "クールダウン", before: "8", after: "10" }] }],
    };
    expect(toArticleBodyPatchChangeBlock(change).direction).toBe("nerf");
  });

  it("基本ステータス(HP等)の増加は強化(buff)判定になる（反転しない）", () => {
    const change: PbeChampionChange = {
      key: 268,
      id: "Azir",
      name: "アジール",
      groups: [{ abilityKey: "base", changes: [{ stat: "HP", before: "575", after: "620" }] }],
    };
    expect(toArticleBodyPatchChangeBlock(change).direction).toBe("buff");
  });

  it("buff/nerf混在は曖昧なのでadjust判定になる", () => {
    const change: PbeChampionChange = {
      key: 268,
      id: "Azir",
      name: "アジール",
      groups: [
        { abilityKey: "base", changes: [{ stat: "HP", before: "575", after: "620" }] }, // buff
        { abilityKey: "Q", changes: [{ stat: "コスト", before: "40", after: "60" }] }, // nerf(コスト増加)
      ],
    };
    expect(toArticleBodyPatchChangeBlock(change).direction).toBe("adjust");
  });

  it("iconUrlが無ければtargetIconUrlはundefined、groupsはそのまま変換される", () => {
    const change: PbeChampionChange = {
      key: 268,
      id: "Azir",
      name: "アジール",
      groups: [{ abilityKey: "base", changes: [{ stat: "HP", before: "575", after: "620" }] }],
    };
    const block = toArticleBodyPatchChangeBlock(change);
    expect(block.targetIconUrl).toBeUndefined();
    expect(block.groups).toEqual([{ abilityKey: "base", changes: [{ stat: "HP", before: "575", after: "620" }] }]);
  });

  it("iconUrlがあればtargetIconUrlに引き継がれる", () => {
    const change: PbeChampionChange = {
      key: 268,
      id: "Azir",
      name: "アジール",
      iconUrl: "https://raw.communitydragon.org/pbe/game/lol-game-data/assets/v1/champion-icons/268.png",
      groups: [{ abilityKey: "base", changes: [{ stat: "HP", before: "575", after: "620" }] }],
    };
    expect(toArticleBodyPatchChangeBlock(change).targetIconUrl).toBe(
      "https://raw.communitydragon.org/pbe/game/lol-game-data/assets/v1/champion-icons/268.png",
    );
  });
});
