import { describe, expect, it } from "vitest";
import { isAllowedEmbedUrl, EMBED_PROVIDER_LABELS } from "@/lib/embed";

describe("isAllowedEmbedUrl（埋め込みURLのホワイトリスト検証, 拡張E3）", () => {
  it("twitter/x.comの正規ドメインはhttpsなら許可", () => {
    expect(isAllowedEmbedUrl("twitter", "https://twitter.com/example/status/123")).toBe(true);
    expect(isAllowedEmbedUrl("twitter", "https://x.com/example/status/123")).toBe(true);
  });

  it("youtubeの正規ドメイン(youtube.com/youtu.be)はhttpsなら許可", () => {
    expect(isAllowedEmbedUrl("youtube", "https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isAllowedEmbedUrl("youtube", "https://youtu.be/abc")).toBe(true);
  });

  it("clipのtwitch正規ドメインはhttpsなら許可", () => {
    expect(isAllowedEmbedUrl("clip", "https://clips.twitch.tv/SampleClip")).toBe(true);
  });

  it("providerと無関係なドメインは拒否", () => {
    expect(isAllowedEmbedUrl("twitter", "https://youtube.com/watch?v=abc")).toBe(false);
    expect(isAllowedEmbedUrl("youtube", "https://twitter.com/example")).toBe(false);
  });

  it("偽装ドメイン(正規ドメインを含むが別ホスト)は拒否", () => {
    expect(isAllowedEmbedUrl("youtube", "https://youtube.com.evil.example/watch")).toBe(false);
    expect(isAllowedEmbedUrl("clip", "https://eviltwitch.tv/clip")).toBe(false);
  });

  it("httpは拒否(httpsのみ許可)", () => {
    expect(isAllowedEmbedUrl("twitter", "http://twitter.com/example/status/123")).toBe(false);
  });

  it("javascript:等の危険スキームは拒否", () => {
    expect(isAllowedEmbedUrl("twitter", "javascript:alert(1)")).toBe(false);
  });

  it("URLとして解釈できない値は拒否", () => {
    expect(isAllowedEmbedUrl("twitter", "not a url")).toBe(false);
    expect(isAllowedEmbedUrl("twitter", "")).toBe(false);
  });

  it("EMBED_PROVIDER_LABELSは3providerすべてに日本語ラベルを持つ", () => {
    expect(EMBED_PROVIDER_LABELS.twitter).toBeTruthy();
    expect(EMBED_PROVIDER_LABELS.youtube).toBeTruthy();
    expect(EMBED_PROVIDER_LABELS.clip).toBeTruthy();
  });
});
