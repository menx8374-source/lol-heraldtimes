import { describe, expect, it } from "vitest";
import { PATCHES, getPatchBySlug, listPatches } from "@/lib/lol-data/patches";

describe("PATCHES データ整合性", () => {
  it("バージョン・スラッグがそれぞれ一意である", () => {
    const versions = PATCHES.map((p) => p.version);
    const slugs = PATCHES.map((p) => p.slug);
    expect(new Set(versions).size).toBe(versions.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("すべてASCII安全なスラッグを持つ", () => {
    for (const p of PATCHES) {
      expect(p.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("各パッチが1件以上の変更点(highlights)を持つ", () => {
    for (const p of PATCHES) {
      expect(p.highlights.length).toBeGreaterThan(0);
    }
  });
});

describe("listPatches", () => {
  it("公開日の新しい順に並ぶ", () => {
    const list = listPatches();
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].releaseDate >= list[i].releaseDate).toBe(true);
    }
  });
});

describe("getPatchBySlug", () => {
  it("URLスラッグで引ける", () => {
    expect(getPatchBySlug("14-13")?.version).toBe("14.13");
  });

  it("バージョン表記(ドット区切り)はスラッグではないので引けない（重複URL防止）", () => {
    expect(getPatchBySlug("14.13")).toBeUndefined();
  });

  it("存在しない場合は undefined を返す", () => {
    expect(getPatchBySlug("no-such-slug")).toBeUndefined();
  });
});
