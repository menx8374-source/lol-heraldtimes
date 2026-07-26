import { describe, expect, it } from "vitest";
import {
  buildChampionSplashUrl,
  CURATED_SPLASH_CHAMPION_IDS,
  pickDeterministicChampionSplashUrl,
} from "@/lib/generation/champion-splash";
import {
  buildChampionSplashUrl as reexportedBuildChampionSplashUrl,
  pickDeterministicChampionSplashUrl as reexportedPickDeterministicChampionSplashUrl,
} from "@/lib/generation/champion-thumbnail";

describe("pickDeterministicChampionSplashUrl（拡張E38 テスト1: 決定論・分散・_0形式）", () => {
  it("同じkeyなら常に同じURLを返す（決定論）", () => {
    const key = "sample-article-slug-1";
    const first = pickDeterministicChampionSplashUrl(key);
    const second = pickDeterministicChampionSplashUrl(key);
    expect(first).toBe(second);
  });

  it("異なるkeyでは複数チャンピオンに分散する", () => {
    const keys = CURATED_SPLASH_CHAMPION_IDS.map((_, i) => `slug-${i}`);
    const urls = new Set(keys.map((k) => pickDeterministicChampionSplashUrl(k)));
    expect(urls.size).toBeGreaterThan(1);
  });

  it("`_0.jpg` 形式（公式スプラッシュ1枚目）のURLを返す", () => {
    const url = pickDeterministicChampionSplashUrl("some-key");
    expect(url).toMatch(/^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/img\/champion\/splash\/[A-Za-z]+_0\.jpg$/);
  });

  it("champion-thumbnail.tsからの再exportも同じ関数を指す（既存importが壊れない）", () => {
    expect(reexportedBuildChampionSplashUrl).toBe(buildChampionSplashUrl);
    expect(reexportedPickDeterministicChampionSplashUrl).toBe(pickDeterministicChampionSplashUrl);
    expect(reexportedPickDeterministicChampionSplashUrl("same-key")).toBe(
      pickDeterministicChampionSplashUrl("same-key"),
    );
  });
});
