import { describe, expect, it } from "vitest";
import { CHAMPIONS, getChampionBySlug, listChampions } from "@/lib/lol-data/champions";
import { ROLES } from "@/lib/lol-data/types";

describe("CHAMPIONS データ整合性", () => {
  it("スラッグが一意である", () => {
    const slugs = CHAMPIONS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("すべてASCII安全なスラッグを持つ", () => {
    for (const c of CHAMPIONS) {
      expect(c.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("名前が一意である", () => {
    const names = CHAMPIONS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("全チャンピオンが定義済みロールに属する", () => {
    for (const c of CHAMPIONS) {
      expect(ROLES).toContain(c.role);
    }
  });

  it("50体程度のデータを持つ", () => {
    expect(CHAMPIONS.length).toBeGreaterThanOrEqual(40);
    expect(CHAMPIONS.length).toBeLessThanOrEqual(60);
  });
});

describe("listChampions", () => {
  it("role未指定は全件を返す", () => {
    expect(listChampions()).toHaveLength(CHAMPIONS.length);
  });

  it("roleを指定するとそのロールのみに絞り込む", () => {
    const tops = listChampions("TOP");
    expect(tops.length).toBeGreaterThan(0);
    for (const c of tops) {
      expect(c.role).toBe("TOP");
    }
  });

  it("名前の五十音順にソートされる", () => {
    const all = listChampions();
    const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name, "ja"));
    expect(all.map((c) => c.slug)).toEqual(sorted.map((c) => c.slug));
  });
});

describe("getChampionBySlug", () => {
  it("存在するスラッグはチャンピオンを返す", () => {
    const champion = getChampionBySlug("garen");
    expect(champion?.name).toBe("ガレン");
  });

  it("存在しないスラッグは undefined を返す", () => {
    expect(getChampionBySlug("no-such-champion")).toBeUndefined();
  });
});
