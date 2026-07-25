import { describe, expect, it } from "vitest";
import { getAdapter, getAllAdapters } from "@/lib/collection/adapters";
import { RiotDataDragonAdapter } from "@/lib/collection/adapters/riot-datadragon";
import { MockSourceAdapter } from "@/lib/collection/adapters/mock";

describe("getAdapter (live)", () => {
  it("riotは実装済みのlive(RiotDataDragonAdapter)を返す", () => {
    const adapter = getAdapter("riot", "live");
    expect(adapter).toBeInstanceOf(RiotDataDragonAdapter);
    expect(adapter.sourceType).toBe("riot");
  });

  it("reddit/5chは未実装のため分かりやすいエラーを投げる", () => {
    expect(() => getAdapter("reddit", "live")).toThrow(/未実装/);
    expect(() => getAdapter("5ch", "live")).toThrow(/未実装/);
  });
});

describe("getAllAdapters (live)", () => {
  it("live実装があるriotのみを含み、未実装(reddit/5ch)はスキップする(全体を止めない)", () => {
    const adapters = getAllAdapters("live");
    expect(adapters).toHaveLength(1);
    expect(adapters[0].sourceType).toBe("riot");
  });
});

describe("mockモードの挙動(回帰)", () => {
  it("mockモードは従来どおり全ソースのMockSourceAdapterを返す", () => {
    const adapters = getAllAdapters("mock");
    expect(adapters).toHaveLength(3);
    expect(adapters.every((a) => a instanceof MockSourceAdapter)).toBe(true);
    expect(adapters.map((a) => a.sourceType)).toEqual(["reddit", "5ch", "riot"]);
  });
});
