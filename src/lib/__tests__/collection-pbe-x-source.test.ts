/**
 * pbe-x-source.ts（PBE-S3 F-PBE3-1〜F-PBE3-3）の単体テスト。実ネットワーク非依存
 * （`vi.stubGlobal("fetch", ...)`でJSON/HTTPエラー/タイムアウト/不正JSONを注入）。実APIは叩かない。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPbeSourceTweet,
  detectPbeDirection,
  fetchPbeSourceTweets,
  parsePbeQueries,
} from "@/lib/collection/adapters/pbe-x-source";
import type { GetXApiTweet, GetXApiSearchResponse } from "@/lib/collection/adapters/x";

function tweet(overrides: Partial<GetXApiTweet> = {}): GetXApiTweet {
  return {
    id: "1820000000000000099",
    text: "PBE preview: buffing junglers, nerfing top lane bruisers. Numbers on the infographic.",
    url: "https://x.com/RiotPhroxzon/status/1820000000000000099",
    createdAt: "2026-07-28T10:00:00.000Z",
    likeCount: 500,
    replyCount: 40,
    isReply: false,
    author: { userName: "RiotPhroxzon", name: "Matt Leung-Harrison" },
    media: [{ type: "photo", url: "https://pbs.twimg.com/media/mock-preview.jpg" }],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe("純関数: buildPbeSourceTweet（GetXAPIレスポンス→PbeSourceTweet変換、逐語text＋画像URL保持）", () => {
  it("author/authorHandle/text逐語/url/createdAt/mediaUrlsを転記する", () => {
    const item = buildPbeSourceTweet(tweet());
    expect(item).toMatchObject({
      author: "Matt Leung-Harrison",
      authorHandle: "RiotPhroxzon",
      text: "PBE preview: buffing junglers, nerfing top lane bruisers. Numbers on the infographic.",
      url: "https://x.com/RiotPhroxzon/status/1820000000000000099",
      mediaUrls: ["https://pbs.twimg.com/media/mock-preview.jpg"],
    });
    expect(item!.createdAt).toEqual(new Date("2026-07-28T10:00:00.000Z"));
  });

  it("textは逐語のまま保持し、要約・改変・数値抽出はしない（原文と完全一致）", () => {
    const original =
      "Q AP ratio 0.5 -> 0.45, W cooldown 14/13/12/11/10 -> 16/15/14/13/12. See image for full numbers.";
    const item = buildPbeSourceTweet(tweet({ text: original }));
    expect(item!.text).toBe(original);
  });

  it("authorのnameが無ければauthorHandle(userName)をauthorとして使う", () => {
    const item = buildPbeSourceTweet(tweet({ author: { userName: "Spideraxe30" } }));
    expect(item!.author).toBe("Spideraxe30");
    expect(item!.authorHandle).toBe("Spideraxe30");
  });

  it("mediaが無ければmediaUrlsは空配列（undefinedにはしない）", () => {
    const item = buildPbeSourceTweet(tweet({ media: undefined }));
    expect(item!.mediaUrls).toEqual([]);
  });

  it("media要素にurlが無い/不正な形式は無視し、正しい要素だけ拾う", () => {
    const item = buildPbeSourceTweet(
      tweet({ media: [{ type: "photo" }, { url: "https://pbs.twimg.com/media/ok.jpg" }, null, "not-an-object"] }),
    );
    expect(item!.mediaUrls).toEqual(["https://pbs.twimg.com/media/ok.jpg"]);
  });

  it("isReply=trueのtweetは除外(null)する", () => {
    expect(buildPbeSourceTweet(tweet({ isReply: true }))).toBeNull();
  });

  it("id/url/text/authorのいずれかが欠落したtweetは除外(null)する", () => {
    expect(buildPbeSourceTweet(tweet({ id: "" }))).toBeNull();
    expect(buildPbeSourceTweet(tweet({ url: "" }))).toBeNull();
    expect(buildPbeSourceTweet(tweet({ text: "" }))).toBeNull();
    expect(buildPbeSourceTweet(tweet({ author: undefined }))).toBeNull();
  });

  it("createdAtが不正な日付文字列でも例外を投げず、fetchedAtは現在時刻にフォールバックする", () => {
    const item = buildPbeSourceTweet(tweet({ createdAt: "not-a-date" }));
    expect(item).not.toBeNull();
    expect(item!.createdAt instanceof Date).toBe(true);
    expect(Number.isNaN(item!.createdAt.getTime())).toBe(false);
  });
});

describe("純関数: detectPbeDirection（軽い方向性タグ・純ルール・数値は一切見ない）", () => {
  it("弱体/ナーフ/nerfキーワードのみ含む場合はnerf", () => {
    expect(detectPbeDirection("This champion is getting a nerf next patch.")).toBe("nerf");
    expect(detectPbeDirection("弱体化される予定です")).toBe("nerf");
    expect(detectPbeDirection("ナーフされそう")).toBe("nerf");
    expect(detectPbeDirection("NERF INCOMING")).toBe("nerf");
  });

  it("強化/バフ/buffキーワードのみ含む場合はbuff", () => {
    expect(detectPbeDirection("Getting a nice buff this cycle.")).toBe("buff");
    expect(detectPbeDirection("強化されるらしい")).toBe("buff");
    expect(detectPbeDirection("バフくる")).toBe("buff");
  });

  it("両方含む、またはどちらも含まない場合は未設定（曖昧を確定させない）", () => {
    expect(detectPbeDirection("Buffing junglers, nerfing bruisers.")).toBeUndefined();
    expect(detectPbeDirection("New PBE item icon spotted, no numbers revealed yet.")).toBeUndefined();
  });

  it("数値には一切触れない（キーワード判定のみで数値抽出をしないことの確認）", () => {
    // 数値を含むテキストでもキーワードが無ければ undefined のまま（数値からdirectionを推測しない）
    expect(detectPbeDirection("Q AP ratio 0.5 -> 0.45")).toBeUndefined();
  });
});

describe("純関数: parsePbeQueries", () => {
  it("未設定・空文字列は既定のPBEクエリ1件を返す", () => {
    expect(parsePbeQueries(undefined)).toEqual([
      '(from:Spideraxe30 OR from:RiotPhroxzon) (PBE OR patch OR パッチ) -filter:retweets',
    ]);
    expect(parsePbeQueries("")).toHaveLength(1);
    expect(parsePbeQueries("   ")).toHaveLength(1);
  });

  it("|||区切りでカスタムクエリをパースできる（env PBE_X_QUERIESでの上書き）", () => {
    const parsed = parsePbeQueries("from:Spideraxe30 PBE|||from:RiotPhroxzon patch");
    expect(parsed).toEqual(["from:Spideraxe30 PBE", "from:RiotPhroxzon patch"]);
  });
});

describe("fetchPbeSourceTweets（mock/live切替、実APIは叩かない）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("X_API_KEY未設定ならmock(fixture)を返す（fetchを呼ばない、無課金）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tweets = await fetchPbeSourceTweets({ apiKey: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tweets.length).toBeGreaterThan(0);
    for (const t of tweets) {
      expect(typeof t.author).toBe("string");
      expect(typeof t.authorHandle).toBe("string");
      expect(typeof t.text).toBe("string");
      expect(typeof t.url).toBe("string");
      expect(t.createdAt instanceof Date).toBe(true);
      expect(Array.isArray(t.mediaUrls)).toBe(true);
    }
  });

  it("X_API_KEY設定時はGetXAPIへlive接続し、Authorization: Bearerヘッダを付与、逐語text＋画像URLを保持する", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        const response: GetXApiSearchResponse = { tweets: [tweet()] };
        return jsonResponse(response);
      }),
    );
    const tweets = await fetchPbeSourceTweets({ apiKey: "test-key", sleep: vi.fn(async () => {}) });

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe("Bearer test-key");
    const q = new URL(calls[0].url).searchParams.get("q");
    expect(q).toContain("Spideraxe30");
    expect(q).toContain("RiotPhroxzon");
    expect(tweets).toHaveLength(1);
    expect(tweets[0].text).toBe(
      "PBE preview: buffing junglers, nerfing top lane bruisers. Numbers on the infographic.",
    );
    expect(tweets[0].mediaUrls).toEqual(["https://pbs.twimg.com/media/mock-preview.jpg"]);
  });

  it("複数クエリ指定時は直列で呼び、結果をマージ・重複排除する", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        const response: GetXApiSearchResponse = {
          tweets: [tweet({ id: `id-${call}`, url: `https://x.com/user/status/${call}` })],
        };
        return jsonResponse(response);
      }),
    );
    const tweets = await fetchPbeSourceTweets({
      apiKey: "test-key",
      queries: ["from:Spideraxe30 PBE", "from:RiotPhroxzon patch"],
      sleep: vi.fn(async () => {}),
    });
    expect(call).toBe(2);
    expect(tweets).toHaveLength(2);
  });

  it("非2xx応答は例外を投げず空配列を返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    const tweets = await fetchPbeSourceTweets({ apiKey: "test-key", sleep: vi.fn(async () => {}) });
    expect(tweets).toEqual([]);
  });

  it("ネットワーク断（fetchが例外を投げる）でも空配列を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const tweets = await fetchPbeSourceTweets({ apiKey: "test-key", sleep: vi.fn(async () => {}) });
    expect(tweets).toEqual([]);
  });

  it("タイムアウト（AbortError）でも空配列を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      }),
    );
    const tweets = await fetchPbeSourceTweets({ apiKey: "test-key", sleep: vi.fn(async () => {}) });
    expect(tweets).toEqual([]);
  });

  it("不正JSON（json()がパースエラーを投げる）でも空配列を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("invalid json");
        },
      })),
    );
    const tweets = await fetchPbeSourceTweets({ apiKey: "test-key", sleep: vi.fn(async () => {}) });
    expect(tweets).toEqual([]);
  });

  it("isReplyのtweetは変換結果から除外される", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response: GetXApiSearchResponse = {
          tweets: [tweet({ id: "keep-1" }), tweet({ id: "reply-1", isReply: true })],
        };
        return jsonResponse(response);
      }),
    );
    const tweets = await fetchPbeSourceTweets({ apiKey: "test-key", sleep: vi.fn(async () => {}) });
    expect(tweets).toHaveLength(1);
  });
});
