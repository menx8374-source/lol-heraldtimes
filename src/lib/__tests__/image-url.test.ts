import { describe, expect, it } from "vitest";
import { isSafeImageUrl } from "@/lib/image-url";

describe("isSafeImageUrl", () => {
  it("httpsの絶対URLは許可する", () => {
    expect(isSafeImageUrl("https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Lillia_0.jpg")).toBe(true);
  });

  it("自サイトのルート相対パス(/から始まる)は許可する(ローカル既定/モック画像用)", () => {
    expect(isSafeImageUrl("/default-thumb.svg")).toBe(true);
    expect(isSafeImageUrl("/mock-images/thumb-jungle-nerf.svg")).toBe(true);
  });

  it("httpの平文URLは拒否する", () => {
    expect(isSafeImageUrl("http://example.com/image.jpg")).toBe(false);
  });

  it("プロトコル相対URL(//)は拒否する(任意ホストへの誘導を防ぐ)", () => {
    expect(isSafeImageUrl("//evil.example.com/image.jpg")).toBe(false);
  });

  it("javascript:/data: 等の不正スキームは拒否する", () => {
    expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeImageUrl("data:image/png;base64,abc")).toBe(false);
  });

  it("未設定(null/undefined/空文字)は拒否する", () => {
    expect(isSafeImageUrl(null)).toBe(false);
    expect(isSafeImageUrl(undefined)).toBe(false);
    expect(isSafeImageUrl("")).toBe(false);
    expect(isSafeImageUrl("   ")).toBe(false);
  });

  it("URLとして解釈できない不正な文字列は拒否する", () => {
    expect(isSafeImageUrl("not a url")).toBe(false);
  });
});
