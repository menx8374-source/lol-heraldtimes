import { describe, expect, it } from "vitest";
import {
  isAllowedEmbedUrl,
  isValidTweetStatusUrl,
  EMBED_PROVIDER_LABELS,
  extractYoutubeVideoId,
  extractTwitchClipSlug,
  extractTweetStatusId,
  embedIframeSrc,
} from "@/lib/embed";

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

describe("isValidTweetStatusUrl（tweetステータスURL検証、成長G7 F-G7-4）", () => {
  it("x.com/twitter.comのstatus URLはtrue", () => {
    expect(isValidTweetStatusUrl("https://x.com/example_user/status/1234567890")).toBe(true);
    expect(isValidTweetStatusUrl("https://twitter.com/example_user/status/1234567890")).toBe(true);
  });

  it("status URLでない同ホストのページ(プロフィール・設定等)はfalse", () => {
    expect(isValidTweetStatusUrl("https://x.com/example_user")).toBe(false);
    expect(isValidTweetStatusUrl("https://x.com/settings/profile")).toBe(false);
  });

  it("無関係なドメイン・URL不正・httpはfalse", () => {
    expect(isValidTweetStatusUrl("https://youtube.com/example_user/status/123")).toBe(false);
    expect(isValidTweetStatusUrl("not a url")).toBe(false);
    expect(isValidTweetStatusUrl("http://x.com/example_user/status/123")).toBe(false);
  });
});

describe("extractYoutubeVideoId（動画ID抽出, 拡張E22）", () => {
  it("watch?v=・youtu.be・shorts の正規URLから11文字の動画IDを抽出する", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYoutubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("IDが11文字ちょうどでない場合はnull（形式検証、v未指定・短すぎる場合も含む）", () => {
    expect(extractYoutubeVideoId("https://youtu.be/short")).toBeNull();
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=abc_123")).toBeNull();
    expect(extractYoutubeVideoId("https://www.youtube.com/watch")).toBeNull();
  });

  it("許可外ホスト・URL不正はnull", () => {
    expect(extractYoutubeVideoId("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractYoutubeVideoId("not a url")).toBeNull();
  });
});

describe("extractTweetStatusId（ツイートID抽出, X-embed F-XE-1）", () => {
  it("x.com/twitter.comの正規status URLから数値のツイートIDを抽出する", () => {
    expect(extractTweetStatusId("https://x.com/example_user/status/1234567890")).toBe("1234567890");
    expect(extractTweetStatusId("https://twitter.com/example_user/status/9876543210")).toBe("9876543210");
  });

  it("status URLでない同ホストのページ(プロフィール等)・許可外ホスト・URL不正はnull", () => {
    expect(extractTweetStatusId("https://x.com/example_user")).toBeNull();
    expect(extractTweetStatusId("https://evil.example/example_user/status/123")).toBeNull();
    expect(extractTweetStatusId("not a url")).toBeNull();
  });
});

describe("extractTwitchClipSlug（クリップslug抽出, 拡張E22）", () => {
  it("clips.twitch.tv・twitch.tv/*/clip/ の正規URLからslugを抽出する", () => {
    expect(extractTwitchClipSlug("https://clips.twitch.tv/SampleClip-123")).toBe("SampleClip-123");
    expect(extractTwitchClipSlug("https://www.twitch.tv/somestreamer/clip/SampleClip-123")).toBe(
      "SampleClip-123",
    );
  });

  it("slugが空、または許可外ホストの場合はnull", () => {
    expect(extractTwitchClipSlug("https://clips.twitch.tv/")).toBeNull();
    expect(extractTwitchClipSlug("https://eviltwitch.tv/SampleClip")).toBeNull();
    expect(extractTwitchClipSlug("not a url")).toBeNull();
  });
});

describe("embedIframeSrc（iframe用src組み立て, 拡張E22）", () => {
  it("youtubeは youtube-nocookie.com/embed/{ID} を返す", () => {
    expect(embedIframeSrc("youtube", "https://youtu.be/dQw4w9WgXcQ", "localhost")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  it("clipは clips.twitch.tv/embed?clip={SLUG}&parent={siteHost} を返す", () => {
    expect(embedIframeSrc("clip", "https://clips.twitch.tv/SampleClip", "lolheraldtimes.com")).toBe(
      "https://clips.twitch.tv/embed?clip=SampleClip&parent=lolheraldtimes.com",
    );
  });

  it("ID/slug抽出に失敗した場合はnull", () => {
    expect(embedIframeSrc("youtube", "https://youtu.be/bad", "localhost")).toBeNull();
    expect(embedIframeSrc("clip", "https://clips.twitch.tv/", "localhost")).toBeNull();
  });

  it("twitterは検証済みstatus URLからplatform.twitter.com/embed/Tweet.htmlのsrcを返す(X-embed F-XE-1)", () => {
    expect(embedIframeSrc("twitter", "https://x.com/example/status/1234567890", "localhost")).toBe(
      "https://platform.twitter.com/embed/Tweet.html?id=1234567890",
    );
    expect(embedIframeSrc("twitter", "https://twitter.com/example/status/9876543210", "localhost")).toBe(
      "https://platform.twitter.com/embed/Tweet.html?id=9876543210",
    );
  });

  it("twitterで不正なURL(プロフィール等・別ドメイン)はnull(X-embed F-XE-1)", () => {
    expect(embedIframeSrc("twitter", "https://x.com/example", "localhost")).toBeNull();
    expect(embedIframeSrc("twitter", "https://youtube.com/example/status/123", "localhost")).toBeNull();
  });
});
