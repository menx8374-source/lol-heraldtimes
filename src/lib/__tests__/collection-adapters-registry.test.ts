import { describe, expect, it } from "vitest";
import { getAdapter, getAllAdapters } from "@/lib/collection/adapters";
import { RiotDataDragonAdapter } from "@/lib/collection/adapters/riot-datadragon";
import { RedditAdapter } from "@/lib/collection/adapters/reddit";
import { ClipAdapter } from "@/lib/collection/adapters/clip";
import { FiveChAdapter } from "@/lib/collection/adapters/fivech";
import { MockSourceAdapter } from "@/lib/collection/adapters/mock";

describe("getAdapter (live)", () => {
  it("riotは実装済みのlive(RiotDataDragonAdapter)を返す", () => {
    const adapter = getAdapter("riot", "live");
    expect(adapter).toBeInstanceOf(RiotDataDragonAdapter);
    expect(adapter.sourceType).toBe("riot");
  });

  it("redditは実装済みのlive(RedditAdapter)を返す", () => {
    const adapter = getAdapter("reddit", "live");
    expect(adapter).toBeInstanceOf(RedditAdapter);
    expect(adapter.sourceType).toBe("reddit");
  });

  it("clipは実装済みのlive(ClipAdapter)を返す", () => {
    const adapter = getAdapter("clip", "live");
    expect(adapter).toBeInstanceOf(ClipAdapter);
    expect(adapter.sourceType).toBe("clip");
  });

  it("5chは実装済みのlive(FiveChAdapter)を返す(拡張E18)", () => {
    const adapter = getAdapter("5ch", "live");
    expect(adapter).toBeInstanceOf(FiveChAdapter);
    expect(adapter.sourceType).toBe("5ch");
  });
});

describe("getAllAdapters (live)", () => {
  it("live実装が揃った全4ソース(riot・reddit・clip・5ch)を含む(拡張E18でフェーズ2完了)", () => {
    const adapters = getAllAdapters("live");
    expect(adapters).toHaveLength(4);
    expect(adapters.map((a) => a.sourceType).sort()).toEqual(["5ch", "clip", "reddit", "riot"]);
  });
});

describe("mockモードの挙動(回帰)", () => {
  it("mockモードは従来どおり全ソースのMockSourceAdapterを返す", () => {
    const adapters = getAllAdapters("mock");
    expect(adapters).toHaveLength(4);
    expect(adapters.every((a) => a instanceof MockSourceAdapter)).toBe(true);
    expect(adapters.map((a) => a.sourceType)).toEqual(["reddit", "5ch", "riot", "clip"]);
  });
});
