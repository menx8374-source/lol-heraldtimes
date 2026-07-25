import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClipAdapter,
  buildYouTubeSearchUrl,
  buildYouTubeVideoUrl,
  buildYouTubeItem,
  extractYouTubeItems,
  buildTwitchClipsUrl,
  buildTwitchItem,
  extractTwitchItems,
  type YouTubeSearchResponse,
  type TwitchClipsResponse,
} from "@/lib/collection/adapters/clip";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("純関数: YouTube", () => {
  it("videoIdから一意・安定なYouTube動画URLを構築する", () => {
    expect(buildYouTubeVideoUrl("abc123")).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("APIキーを含む検索URLを構築する(キー自体はログに出さない前提のURL文字列)", () => {
    const url = buildYouTubeSearchUrl("test-key");
    expect(url).toContain("key=test-key");
    expect(url).toContain("googleapis.com/youtube/v3/search");
  });

  it("検索結果1件をRawCollectionItemへ整形する(publishedAt->Date変換)", () => {
    const item = buildYouTubeItem({
      id: { videoId: "vid1" },
      snippet: {
        title: "LoLハイライト動画",
        description: "今週のLoL神プレイをまとめました。".repeat(5),
        channelTitle: "テストch",
        publishedAt: "2026-07-24T09:00:00.000Z",
      },
    });
    expect(item?.sourceUrl).toBe("https://www.youtube.com/watch?v=vid1");
    expect(item?.title).toBe("LoLハイライト動画");
    expect(item?.content).toContain("テストch");
    expect(item?.fetchedAt).toEqual(new Date("2026-07-24T09:00:00.000Z"));
  });

  it("snippet.thumbnails.high.urlをimageUrlに設定する(拡張E19 F-E19-3)", () => {
    const item = buildYouTubeItem({
      id: { videoId: "vid1" },
      snippet: { title: "t", thumbnails: { high: { url: "https://i.ytimg.com/vi/vid1/hqdefault.jpg" } } },
    });
    expect(item?.imageUrl).toBe("https://i.ytimg.com/vi/vid1/hqdefault.jpg");
  });

  it("thumbnailsが無ければimageUrlはnullになる", () => {
    const item = buildYouTubeItem({ id: { videoId: "vid1" }, snippet: { title: "t" } });
    expect(item?.imageUrl).toBeNull();
  });

  it("videoId/titleが欠けている要素はnullを返す", () => {
    expect(buildYouTubeItem({ id: {}, snippet: { title: "t" } })).toBeNull();
    expect(buildYouTubeItem({ id: { videoId: "v" }, snippet: {} })).toBeNull();
  });

  it("不正な子要素を無視して抽出する", () => {
    const res: YouTubeSearchResponse = {
      items: [
        { id: { videoId: "v1" }, snippet: { title: "t1" } },
        { id: {}, snippet: { title: "no video id" } },
      ],
    };
    expect(extractYouTubeItems(res)).toHaveLength(1);
  });
});

describe("純関数: Twitch", () => {
  it("game_id/firstを含むクリップ取得URLを構築する", () => {
    const url = buildTwitchClipsUrl();
    expect(url).toContain("game_id=21779");
    expect(url).toContain("api.twitch.tv/helix/clips");
  });

  it("クリップ1件をRawCollectionItemへ整形する(created_at->Date変換)", () => {
    const item = buildTwitchItem({
      id: "c1",
      url: "https://clips.twitch.tv/SampleClip",
      title: "ヤスオの神プレイ",
      broadcaster_name: "テスト配信者",
      created_at: "2026-07-24T10:00:00Z",
      thumbnail_url: "https://clips-media-assets2.twitch.tv/SampleClip-preview.jpg",
    });
    expect(item?.sourceUrl).toBe("https://clips.twitch.tv/SampleClip");
    expect(item?.content).toContain("テスト配信者");
    expect(item?.fetchedAt).toEqual(new Date("2026-07-24T10:00:00Z"));
    expect(item?.imageUrl).toBe("https://clips-media-assets2.twitch.tv/SampleClip-preview.jpg");
  });

  it("thumbnail_urlが無ければimageUrlはnullになる", () => {
    const item = buildTwitchItem({ id: "c1", url: "https://clips.twitch.tv/SampleClip", title: "t" });
    expect(item?.imageUrl).toBeNull();
  });

  it("url/titleが欠けているクリップはnullを返す", () => {
    expect(buildTwitchItem({ id: "c1", title: "t" })).toBeNull();
    expect(buildTwitchItem({ id: "c1", url: "https://clips.twitch.tv/x" })).toBeNull();
  });

  it("不正な子要素を無視して抽出する", () => {
    const res: TwitchClipsResponse = {
      data: [
        { url: "https://clips.twitch.tv/a", title: "a" },
        { url: "https://clips.twitch.tv/b" },
      ],
    };
    expect(extractTwitchItems(res)).toHaveLength(1);
  });
});

describe("ClipAdapter.fetchItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("YouTube/Twitch両方のキーがある場合、両方から取得しRawCollectionItem[]を返す(sourceUrl一意)", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("googleapis.com")) {
        expect(url).toContain("key=yt-key");
        return jsonResponse({
          items: [{ id: { videoId: "v1" }, snippet: { title: "LoL動画", description: "説明", publishedAt: "2026-07-24T09:00:00Z" } }],
        });
      }
      if (url === TWITCH_TOKEN_URL || url.startsWith(`${TWITCH_TOKEN_URL}?`)) {
        expect(init?.method).toBe("POST");
        expect(url).toContain("client_id=tw-id");
        expect(url).toContain("client_secret=tw-secret");
        return jsonResponse({ access_token: "tw-token" });
      }
      if (url.includes("api.twitch.tv/helix/clips")) {
        const headers = init?.headers as Record<string, string>;
        expect(headers["Client-Id"]).toBe("tw-id");
        expect(headers.Authorization).toBe("Bearer tw-token");
        return jsonResponse({
          data: [{ url: "https://clips.twitch.tv/c1", title: "クリップ", broadcaster_name: "配信者", created_at: "2026-07-24T10:00:00Z" }],
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new ClipAdapter({ youtubeApiKey: "yt-key", twitchClientId: "tw-id", twitchClientSecret: "tw-secret" });
    const items = await adapter.fetchItems();

    expect(items.map((i) => i.sourceUrl).sort()).toEqual(
      ["https://clips.twitch.tv/c1", "https://www.youtube.com/watch?v=v1"].sort(),
    );
  });

  it("YouTubeキーのみ設定時はYouTubeのみ取得し、Twitchはfetchを呼ばずスキップログを残す", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("googleapis.com")) {
        return jsonResponse({ items: [{ id: { videoId: "v1" }, snippet: { title: "LoL動画" } }] });
      }
      throw new Error(`unexpected url (Twitchは呼ばれないはず): ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const adapter = new ClipAdapter({ youtubeApiKey: "yt-key" });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe("https://www.youtube.com/watch?v=v1");
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("Twitch"))).toBe(true);
  });

  it("Twitchキーのみ設定時はTwitchのみ取得し、YouTubeはfetchを呼ばずスキップログを残す", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith(TWITCH_TOKEN_URL)) return jsonResponse({ access_token: "tok" });
      if (url.includes("helix/clips")) {
        return jsonResponse({ data: [{ url: "https://clips.twitch.tv/only", title: "クリップ" }] });
      }
      throw new Error(`unexpected url (YouTubeは呼ばれないはず): ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const adapter = new ClipAdapter({ twitchClientId: "id", twitchClientSecret: "secret" });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe("https://clips.twitch.tv/only");
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("YouTube"))).toBe(true);
  });

  it("両方未設定の場合は空配列＋fetchを一切呼ばずスキップログを2件残す。シークレットはログに出ない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const adapter = new ClipAdapter({});
    const items = await adapter.fetchItems();

    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it("YouTube検索がHTTPエラーの場合はYouTube分だけ空になる(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("googleapis.com") ? jsonResponse(null, 500) : jsonResponse({}))),
    );
    const adapter = new ClipAdapter({ youtubeApiKey: "yt-key" });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("Twitchトークン取得がHTTPエラーの場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.startsWith(TWITCH_TOKEN_URL) ? jsonResponse(null, 401) : jsonResponse({}))),
    );
    const adapter = new ClipAdapter({ twitchClientId: "id", twitchClientSecret: "secret" });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("ネットワーク断(fetchがreject)の場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const adapter = new ClipAdapter({ youtubeApiKey: "yt-key", twitchClientId: "id", twitchClientSecret: "secret" });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("同一URLが両社で重複した場合(理論上)は重複排除して1件になる", async () => {
    const duplicatedUrl = "https://www.youtube.com/watch?v=dup1";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("googleapis.com")) {
          return jsonResponse({ items: [{ id: { videoId: "dup1" }, snippet: { title: "重複テスト" } }] });
        }
        if (url.startsWith(TWITCH_TOKEN_URL)) return jsonResponse({ access_token: "tok" });
        if (url.includes("helix/clips")) {
          return jsonResponse({ data: [{ url: duplicatedUrl, title: "重複テスト(twitch側)" }] });
        }
        throw new Error(`unexpected url: ${url}`);
      }),
    );
    const adapter = new ClipAdapter({ youtubeApiKey: "yt-key", twitchClientId: "id", twitchClientSecret: "secret" });
    const items = await adapter.fetchItems();
    expect(items.filter((i) => i.sourceUrl === duplicatedUrl)).toHaveLength(1);
  });
});
