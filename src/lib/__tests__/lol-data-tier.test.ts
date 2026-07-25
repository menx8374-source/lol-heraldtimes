import { describe, expect, it } from "vitest";
import { CHAMPIONS, listChampions } from "@/lib/lol-data/champions";
import { buildAllTierTables, buildTierTable } from "@/lib/lol-data/tier";
import { ROLES, TIERS } from "@/lib/lol-data/types";

describe("buildTierTable", () => {
  it("指定ロールのチャンピオンのみを含み、そのロールのチャンピオン総数と一致する", () => {
    for (const role of ROLES) {
      const rows = buildTierTable(role);
      const total = rows.reduce((sum, row) => sum + row.champions.length, 0);
      expect(total).toBe(listChampions(role).length);
      for (const row of rows) {
        for (const champion of row.champions) {
          expect(champion.role).toBe(role);
          expect(champion.tier).toBe(row.tier);
        }
      }
    }
  });

  it("S/A/B/Cの4行を必ず持つ（0件の行があってもよい）", () => {
    const rows = buildTierTable("TOP");
    expect(rows.map((r) => r.tier)).toEqual([...TIERS]);
  });
});

describe("buildAllTierTables", () => {
  it("全ロールぶんのTier表を返し、合計チャンピオン数がCHAMPIONS全体と一致する", () => {
    const tables = buildAllTierTables();
    expect(tables.map((t) => t.role)).toEqual([...ROLES]);
    const total = tables.reduce(
      (sum, table) => sum + table.rows.reduce((s, row) => s + row.champions.length, 0),
      0,
    );
    expect(total).toBe(CHAMPIONS.length);
  });
});
