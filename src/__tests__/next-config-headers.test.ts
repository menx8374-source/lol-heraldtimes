import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("next.config headers() — frame-src CSP（拡張E22 F-E22-3）", () => {
  it("Content-Security-Policyヘッダにframe-src（youtube-nocookie/player.twitch.tv/clips.twitch.tv許可）を含む", async () => {
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
    // frame-srcのみを指定し、他ディレクティブ(default-src等)は含まない
    expect(cspHeader?.value).not.toContain("default-src");
  });
});
