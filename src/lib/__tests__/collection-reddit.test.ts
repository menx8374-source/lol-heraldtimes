import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RedditAdapter,
  buildPostUrl,
  buildRedditItem,
  extractPosts,
  extractRedditImageUrl,
  type RedditListingResponse,
  type RedditPostData,
} from "@/lib/collection/adapters/reddit";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const CREDS = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  userAgent: "lol-matome/1.0 by test-owner",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function post(overrides: Partial<RedditPostData> = {}): RedditPostData {
  return {
    permalink: "/r/leagueoflegends/comments/abc123/some_post/",
    title: "Some post title",
    selftext: "Post body text",
    created_utc: 1753401600, // 2025-07-25T00:00:00Z 付近(値自体の意味は問わない)
    ...overrides,
  };
}

function listingOf(posts: RedditPostData[]): RedditListingResponse {
  return { data: { children: posts.map((data) => ({ data })) } };
}

describe("純関数: buildPostUrl / buildRedditItem / extractPosts", () => {
  it("permalinkから一意・安定な絶対URLを構築する", () => {
    expect(buildPostUrl("/r/leagueoflegends/comments/abc123/foo/")).toBe(
      "https://www.reddit.com/r/leagueoflegends/comments/abc123/foo/",
    );
  });

  it("selftextがあればcontentに優先採用し、created_utc(UNIX秒)をDateへ変換する", () => {
    const item = buildRedditItem(post({ selftext: "本文だよ", created_utc: 1000 }));
    expect(item.content).toBe("本文だよ");
    expect(item.title).toBe("Some post title");
    expect(item.sourceUrl).toBe("https://www.reddit.com/r/leagueoflegends/comments/abc123/some_post/");
    expect(item.fetchedAt).toEqual(new Date(1000 * 1000));
  });

  it("selftextが空ならタイトルをcontentの代わりに使う", () => {
    const item = buildRedditItem(post({ selftext: "" }));
    expect(item.content).toBe("Some post title");
  });

  it("selftextが未定義でもタイトルにフォールバックする", () => {
    const item = buildRedditItem(post({ selftext: undefined }));
    expect(item.content).toBe("Some post title");
  });

  it("リスティングJSONから投稿データ配列を取り出す(不正な子要素は無視)", () => {
    const listing: RedditListingResponse = {
      data: { children: [{ data: post() }, {}, { data: undefined }] },
    };
    const posts = extractPosts(listing);
    expect(posts).toHaveLength(1);
  });

  it("children未定義でも空配列を返す", () => {
    expect(extractPosts({})).toEqual([]);
  });
});

describe("extractRedditImageUrl（拡張E19 F-E19-3）", () => {
  it("preview.images[0].source.urlがあれば最優先で使い、HTMLエンティティ&amp;をデコードする", () => {
    const p = post({
      preview: {
        images: [{ source: { url: "https://preview.redd.it/abc.jpg?width=640&amp;auto=webp&amp;s=xyz" } }],
      },
      thumbnail: "https://b.thumbs.redditmedia.com/should-not-be-used.jpg",
    });
    expect(extractRedditImageUrl(p)).toBe("https://preview.redd.it/abc.jpg?width=640&auto=webp&s=xyz");
  });

  it("previewが無くthumbnailがhttp(s)の実画像URLならそれを使う", () => {
    const p = post({ thumbnail: "https://b.thumbs.redditmedia.com/real-thumb.jpg" });
    expect(extractRedditImageUrl(p)).toBe("https://b.thumbs.redditmedia.com/real-thumb.jpg");
  });

  it("thumbnailが'self'/'default'等の非画像プレースホルダーの場合はnullを返す", () => {
    expect(extractRedditImageUrl(post({ thumbnail: "self" }))).toBeNull();
    expect(extractRedditImageUrl(post({ thumbnail: "default" }))).toBeNull();
  });

  it("previewもthumbnailも無ければnullを返す", () => {
    expect(extractRedditImageUrl(post({ thumbnail: undefined }))).toBeNull();
  });

  it("buildRedditItemはimageUrlをRawCollectionItemに反映する", () => {
    const p = post({ thumbnail: "https://b.thumbs.redditmedia.com/real-thumb.jpg" });
    expect(buildRedditItem(p).imageUrl).toBe("https://b.thumbs.redditmedia.com/real-thumb.jpg");
  });
});

describe("RedditAdapter.fetchItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("トークン取得→リスティング取得の2段呼び出しに成功しRawCollectionItem[]を返す(Basic認証/grant_type/Bearer/User-Agentを検証)", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) {
        expect(init?.method).toBe("POST");
        const headers = init?.headers as Record<string, string>;
        const expectedBasic = Buffer.from(`${CREDS.clientId}:${CREDS.clientSecret}`).toString("base64");
        expect(headers.Authorization).toBe(`Basic ${expectedBasic}`);
        expect(headers["User-Agent"]).toBe(CREDS.userAgent);
        expect(init?.body).toBe("grant_type=client_credentials");
        return jsonResponse({ access_token: "test-token-123" });
      }
      if (url.startsWith("https://oauth.reddit.com/r/leagueoflegends/hot")) {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer test-token-123");
        expect(headers["User-Agent"]).toBe(CREDS.userAgent);
        return jsonResponse(listingOf([post()]));
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RedditAdapter(CREDS);
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe("https://www.reddit.com/r/leagueoflegends/comments/abc123/some_post/");
    expect(items[0].content).toBe("Post body text");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("同一permalinkの投稿が複数回現れても重複排除して1件になる(sourceUrl一意)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === TOKEN_URL) return jsonResponse({ access_token: "tok" });
        return jsonResponse(listingOf([post(), post()]));
      }),
    );
    const adapter = new RedditAdapter(CREDS);
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(1);
  });

  it("トークン取得がHTTPエラーの場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === TOKEN_URL ? jsonResponse(null, 401) : jsonResponse(listingOf([])))),
    );
    const adapter = new RedditAdapter(CREDS);
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("リスティング取得がHTTPエラーの場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === TOKEN_URL ? jsonResponse({ access_token: "tok" }) : jsonResponse(null, 500),
      ),
    );
    const adapter = new RedditAdapter(CREDS);
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("不正JSON(パース失敗)の場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("invalid json");
        },
      })),
    );
    const adapter = new RedditAdapter(CREDS);
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("ネットワーク断(fetchがreject)の場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const adapter = new RedditAdapter(CREDS);
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("クレデンシャル未設定の場合は空配列を返し、fetchを一切呼ばずスキップログを1度残す", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const adapter = new RedditAdapter({});
    const items = await adapter.fetchItems();

    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = logSpy.mock.calls[0]?.[0] as string;
    expect(loggedMessage).not.toContain(CREDS.clientSecret);
  });
});
