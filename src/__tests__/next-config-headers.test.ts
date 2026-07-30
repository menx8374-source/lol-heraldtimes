import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("next.config headers() — frame-src/img-src CSP（拡張E22 F-E22-3・X-embed F-XE-3）", () => {
  it("Content-Security-Policyヘッダにframe-src（youtube-nocookie/player.twitch.tv/clips.twitch.tv/platform.twitter.com許可）を含む", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const entries = await nextConfig.headers!();
    const cspHeader = entries
      .flatMap((entry) => entry.headers)
      .find((h) => h.key === "Content-Security-Policy");

    expect(cspHeader).toBeDefined();
    expect(cspHeader?.value).toContain("frame-src 'self'");
    expect(cspHeader?.value).toContain("https://www.youtube-nocookie.com");
    expect(cspHeader?.value).toContain("https://player.twitch.tv");
    expect(cspHeader?.value).toContain("https://clips.twitch.tv");
    // X-embed F-XE-3: Twitter公式のサンドボックス化ツイート埋め込み用ドメインを追加
    expect(cspHeader?.value).toContain("https://platform.twitter.com");
    // frame-src/img-src以外のディレクティブ(default-src等)は含まない
    expect(cspHeader?.value).not.toContain("default-src");
  });

  it("Content-Security-Policyヘッダにimg-src（pbs.twimg.com/abs.twimg.com許可）を含み、script-srcは広げない(X-embed F-XE-3)", async () => {
    const entries = await nextConfig.headers!();
    const cspHeader = entries
      .flatMap((entry) => entry.headers)
      .find((h) => h.key === "Content-Security-Policy");

    expect(cspHeader?.value).toContain("img-src");
    expect(cspHeader?.value).toContain("https://pbs.twimg.com");
    expect(cspHeader?.value).toContain("https://abs.twimg.com");
    // widgets.js等を読み込まないため script-src は一切追加しない
    expect(cspHeader?.value).not.toContain("script-src");
  });
});
