import { afterEach, describe, expect, it } from "vitest";
import { getAdapter, getAllAdapters } from "@/lib/collection/adapters";
import { RiotDataDragonAdapter } from "@/lib/collection/adapters/riot-datadragon";
import { RiotNewsAdapter } from "@/lib/collection/adapters/riot-news";
import { RedditAdapter } from "@/lib/collection/adapters/reddit";
import { FiveChAdapter } from "@/lib/collection/adapters/fivech";
import { XAdapter } from "@/lib/collection/adapters/x";
import { MockSourceAdapter } from "@/lib/collection/adapters/mock";

const originalXApiKey = process.env.X_API_KEY;
afterEach(() => {
  if (originalXApiKey === undefined) delete process.env.X_API_KEY;
  else process.env.X_API_KEY = originalXApiKey;
});

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

  it("5chは実装済みのlive(FiveChAdapter)を返す(拡張E18)", () => {
    const adapter = getAdapter("5ch", "live");
    expect(adapter).toBeInstanceOf(FiveChAdapter);
    expect(adapter.sourceType).toBe("5ch");
  });

  it("riot-newsは実装済みのlive(RiotNewsAdapter)を返す(リファクタリングS7b)", () => {
    const adapter = getAdapter("riot-news", "live");
    expect(adapter).toBeInstanceOf(RiotNewsAdapter);
    expect(adapter.sourceType).toBe("riot-news");
  });

  it("xはX_API_KEY設定時のみ実装済みのlive(XAdapter)を返す(成長G7 F-G7-3)", () => {
    process.env.X_API_KEY = "test-dummy-key";
    const adapter = getAdapter("x", "live");
    expect(adapter).toBeInstanceOf(XAdapter);
    expect(adapter.sourceType).toBe("x");
  });

  it("xはX_API_KEY未設定時はmock(MockSourceAdapter)にフォールバックする(成長G7 F-G7-3、無課金・本体を止めない)", () => {
    delete process.env.X_API_KEY;
    const adapter = getAdapter("x", "live");
    expect(adapter).toBeInstanceOf(MockSourceAdapter);
    expect(adapter.sourceType).toBe("x");
  });
});

describe("getAllAdapters (live)", () => {
  it("live実装が揃った全5ソース(riot・reddit・5ch・riot-news・x)を含む(X_API_KEY設定時、成長G7)", () => {
    process.env.X_API_KEY = "test-dummy-key";
    const adapters = getAllAdapters("live");
    expect(adapters).toHaveLength(5);
    expect(adapters.map((a) => a.sourceType).sort()).toEqual(["5ch", "reddit", "riot", "riot-news", "x"]);
    expect(adapters.find((a) => a.sourceType === "x")).toBeInstanceOf(XAdapter);
  });

  it("X_API_KEY未設定時はxのみMockSourceAdapterになる(他4ソースはlive実装のまま、成長G7)", () => {
    delete process.env.X_API_KEY;
    const adapters = getAllAdapters("live");
    expect(adapters).toHaveLength(5);
    const xAdapter = adapters.find((a) => a.sourceType === "x");
    expect(xAdapter).toBeInstanceOf(MockSourceAdapter);
  });
});

describe("mockモードの挙動(回帰)", () => {
  it("mockモードは従来どおり全ソースのMockSourceAdapterを返す(成長G7でxを追加、全5ソース)", () => {
    const adapters = getAllAdapters("mock");
    expect(adapters).toHaveLength(5);
    expect(adapters.every((a) => a instanceof MockSourceAdapter)).toBe(true);
    expect(adapters.map((a) => a.sourceType)).toEqual(["reddit", "5ch", "riot", "riot-news", "x"]);
  });
});
