/**
 * X-reply-S2 F-XR2-1: fetchTopReplies（親Xポストのリプライ/引用取得）の単体テスト
 * （ブリーフ テスト1）。実ネットワーク非依存（`vi.stubGlobal("fetch", ...)`）。実APIは叩かない。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildQuotesQuery,
  buildRepliesQuery,
  fetchTopReplies,
  isXQuotesModeOn,
  isXRepliesModeOn,
  toXReplyItem,
  type GetXApiSearchResponse,
  type GetXApiTweet,
} from "@/lib/collection/adapters/x";

function tweet(overrides: Partial<GetXApiTweet> = {}): GetXApiTweet {
  return {
    id: "9990000000000000001",
    text: "それはちょっと違うと思う、序盤のダイブが無理筋だった。",
    url: "https://x.com/reply_user/status/9990000000000000001",
    createdAt: "2026-07-27T11:00:00.000Z",
    likeCount: 10,
    replyCount: 2,
    quoteCount: 0,
    author: { userName: "reply_user" },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe("純関数: buildRepliesQuery / buildQuotesQuery", () => {
  it("conversation_id:<id> -filter:retweets を組み立てる", () => {
    expect(buildRepliesQuery("123")).toBe("conversation_id:123 -filter:retweets");
  });

  it("quoted_tweet_id:<id> を組み立てる", () => {
    expect(buildQuotesQuery("123")).toBe("quoted_tweet_id:123");
  });
});

describe("純関数: toXReplyItem", () => {
  it("正常なtweetをXReplyItemに変換する（conversation由来はisQuote=false）", () => {
    const item = toXReplyItem(tweet(), "parent-1", false);
    expect(item).toMatchObject({
      id: "9990000000000000001",
      text: "それはちょっと違うと思う、序盤のダイブが無理筋だった。",
      author: "reply_user",
      likeCount: 10,
      replyCount: 2,
      quoteCount: 0,
      url: "https://x.com/reply_user/status/9990000000000000001",
      isQuote: false,
    });
  });

  it("quoted_tweet_id由来はisQuote=true", () => {
    const item = toXReplyItem(tweet(), "parent-1", true);
    expect(item!.isQuote).toBe(true);
  });

  it("親ツイート自身(id===parentTweetId)はnull(除外)", () => {
    expect(toXReplyItem(tweet({ id: "parent-1" }), "parent-1", false)).toBeNull();
  });

  it("id/text/url/authorのいずれかが欠落したtweetはnull", () => {
    expect(toXReplyItem(tweet({ id: "" }), "parent-1", false)).toBeNull();
    expect(toXReplyItem(tweet({ text: "" }), "parent-1", false)).toBeNull();
    expect(toXReplyItem(tweet({ url: "" }), "parent-1", false)).toBeNull();
    expect(toXReplyItem(tweet({ author: undefined }), "parent-1", false)).toBeNull();
  });
});

describe("isXRepliesModeOn / isXQuotesModeOn（既定on）", () => {
  const ORIGINAL_REPLIES = process.env.X_REPLIES_MODE;
  const ORIGINAL_QUOTES = process.env.X_QUOTES_MODE;
  afterEach(() => {
    if (ORIGINAL_REPLIES === undefined) delete process.env.X_REPLIES_MODE;
    else process.env.X_REPLIES_MODE = ORIGINAL_REPLIES;
    if (ORIGINAL_QUOTES === undefined) delete process.env.X_QUOTES_MODE;
    else process.env.X_QUOTES_MODE = ORIGINAL_QUOTES;
  });

  it("未設定時は既定on", () => {
    delete process.env.X_REPLIES_MODE;
    delete process.env.X_QUOTES_MODE;
    expect(isXRepliesModeOn()).toBe(true);
    expect(isXQuotesModeOn()).toBe(true);
  });

  it("offを明示指定するとfalse", () => {
    process.env.X_REPLIES_MODE = "off";
    process.env.X_QUOTES_MODE = "off";
    expect(isXRepliesModeOn()).toBe(false);
    expect(isXQuotesModeOn()).toBe(false);
  });
});

describe("fetchTopReplies（ブリーフ テスト1、実HTTPは叩かない）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("apiKey未設定なら空配列(fetchを呼ばない・無課金)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTopReplies("parent-1", undefined)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("conversation_id:<id>のURLが正しく組まれる（quotesMode off時は1コールのみ）", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        const response: GetXApiSearchResponse = { tweets: [tweet()] };
        return jsonResponse(response);
      }),
    );
    await fetchTopReplies("parent-1", "test-key", { quotesMode: false });
    expect(calls).toHaveLength(1);
    const q = new URL(calls[0]).searchParams.get("q");
    expect(q).toBe("conversation_id:parent-1 -filter:retweets");
  });

  it("quotesMode onならquoted_tweet_id:<id>も呼び、結果をマージする(+1コール)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        const isQuoteCall = new URL(url).searchParams.get("q")?.startsWith("quoted_tweet_id:");
        const response: GetXApiSearchResponse = {
          tweets: [tweet({ id: isQuoteCall ? "quote-1" : "reply-1", url: `https://x.com/u/status/${isQuoteCall ? "quote-1" : "reply-1"}` })],
        };
        return jsonResponse(response);
      }),
    );
    const items = await fetchTopReplies("parent-1", "test-key", { quotesMode: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("quoted_tweet_id%3Aparent-1");
    expect(items.map((i) => i.id).sort()).toEqual(["quote-1", "reply-1"]);
    const quoteItem = items.find((i) => i.id === "quote-1");
    expect(quoteItem!.isQuote).toBe(true);
    const replyItem = items.find((i) => i.id === "reply-1");
    expect(replyItem!.isQuote).toBe(false);
  });

  it("親ツイート自身を除外する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response: GetXApiSearchResponse = {
          tweets: [tweet({ id: "parent-1" }), tweet({ id: "child-1", url: "https://x.com/u/status/child-1" })],
        };
        return jsonResponse(response);
      }),
    );
    const items = await fetchTopReplies("parent-1", "test-key", { quotesMode: false });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("child-1");
  });

  it("likeCount降順でX_REPLIES_MAX(既定8)件に打ち切る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const tweets: GetXApiTweet[] = Array.from({ length: 12 }, (_, i) =>
          tweet({ id: `t-${i}`, url: `https://x.com/u/status/t-${i}`, likeCount: i }),
        );
        const response: GetXApiSearchResponse = { tweets };
        return jsonResponse(response);
      }),
    );
    const items = await fetchTopReplies("parent-1", "test-key", { quotesMode: false });
    expect(items).toHaveLength(8);
    expect(items[0].likeCount).toBe(11);
    expect(items[7].likeCount).toBe(4);
    for (let i = 0; i < items.length - 1; i++) {
      expect(items[i].likeCount).toBeGreaterThanOrEqual(items[i + 1].likeCount);
    }
  });

  it("同点likeCountはreplyCount降順で並ぶ", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response: GetXApiSearchResponse = {
          tweets: [
            tweet({ id: "a", url: "https://x.com/u/status/a", likeCount: 5, replyCount: 1 }),
            tweet({ id: "b", url: "https://x.com/u/status/b", likeCount: 5, replyCount: 9 }),
          ],
        };
        return jsonResponse(response);
      }),
    );
    const items = await fetchTopReplies("parent-1", "test-key", { quotesMode: false });
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("カスタムmax指定でその件数に打ち切る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const tweets: GetXApiTweet[] = Array.from({ length: 5 }, (_, i) =>
          tweet({ id: `t-${i}`, url: `https://x.com/u/status/t-${i}`, likeCount: i }),
        );
        return jsonResponse({ tweets } as GetXApiSearchResponse);
      }),
    );
    const items = await fetchTopReplies("parent-1", "test-key", { quotesMode: false, max: 3 });
    expect(items).toHaveLength(3);
  });

  it("非2xx応答・ネットワーク断・タイムアウトは例外を投げず空配列", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    await expect(fetchTopReplies("parent-1", "test-key", { quotesMode: false })).resolves.toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchTopReplies("parent-1", "test-key", { quotesMode: false })).resolves.toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      }),
    );
    await expect(fetchTopReplies("parent-1", "test-key", { quotesMode: false })).resolves.toEqual([]);
  });

  it("0件応答は空配列", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ tweets: [] } as GetXApiSearchResponse)));
    await expect(fetchTopReplies("parent-1", "test-key", { quotesMode: false })).resolves.toEqual([]);
  });
});
