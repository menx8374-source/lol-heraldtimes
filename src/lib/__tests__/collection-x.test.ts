/**
 * XAdapter（成長G7 F-G7-2）の単体テスト（ブリーフ テスト1〜3）。実ネットワーク非依存
 * （`vi.stubGlobal("fetch", ...)` でJSON/HTTPエラー/タイムアウト/不正JSONを注入）。実APIは叩かない。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  XAdapter,
  appendSinceIfMissing,
  buildAdvancedSearchUrl,
  buildDefaultSearchQueries,
  buildTweetTitle,
  buildXItem,
  parseSearchQueries,
  type GetXApiSearchResponse,
  type GetXApiTweet,
} from "@/lib/collection/adapters/x";
import { getHotnessConfig } from "@/lib/hotness/config";

function tweet(overrides: Partial<GetXApiTweet> = {}): GetXApiTweet {
  return {
    id: "1810000000000000099",
    text: "今日のLJL、レッドブルの動きが本当にヤバい。序盤から圧倒的だった。",
    url: "https://x.com/lol_jp_fan/status/1810000000000000099",
    createdAt: "2026-07-27T10:00:00.000Z",
    likeCount: 320,
    replyCount: 48,
    isReply: false,
    author: { userName: "lol_jp_fan" },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe("純関数: buildXItem（GetXAPIレスポンス→RawCollectionItemマッピング、ブリーフ テスト1）", () => {
  it("id/url/text/likeCount→score/replyCount(+quoteCount)→commentCount/author/createdAt/category を正しく転記する", () => {
    const item = buildXItem(tweet());
    expect(item).toMatchObject({
      sourceUrl: "https://x.com/lol_jp_fan/status/1810000000000000099",
      content: "今日のLJL、レッドブルの動きが本当にヤバい。序盤から圧倒的だった。",
      externalId: "1810000000000000099",
      score: 320,
      commentCount: 48, // replyCount=48, quoteCount未指定(0)
      author: "lol_jp_fan",
      category: "Xの反応",
    });
    expect(item!.fetchedAt).toEqual(new Date("2026-07-27T10:00:00.000Z"));
    expect(item!.title.length).toBeGreaterThan(0);
  });

  it("X-reply-S1 F-XR1-2: commentCountはreplyCountとquoteCountの合算(議論量シグナル)", () => {
    const item = buildXItem(tweet({ replyCount: 48, quoteCount: 12 }));
    expect(item!.commentCount).toBe(60);
    expect(item!.score).toBe(320); // score=likeCountの既存マッピングは不変
  });

  it("media（画像/動画）があれば転記し、無ければundefinedのまま", () => {
    const withMedia = buildXItem(tweet({ media: [{ type: "photo", url: "https://pbs.twimg.com/mock.jpg" }] }));
    expect(withMedia!.media).toEqual([{ type: "photo", url: "https://pbs.twimg.com/mock.jpg" }]);

    const withoutMedia = buildXItem(tweet({ media: undefined }));
    expect(withoutMedia!.media).toBeUndefined();
  });

  it("isReply=trueのtweet（リプライ由来の薄い投稿）は除外(null)する", () => {
    expect(buildXItem(tweet({ isReply: true }))).toBeNull();
  });

  it("id/url/text/authorのいずれかが欠落したtweetは除外(null)する", () => {
    expect(buildXItem(tweet({ id: "" }))).toBeNull();
    expect(buildXItem(tweet({ url: "" }))).toBeNull();
    expect(buildXItem(tweet({ text: "" }))).toBeNull();
    expect(buildXItem(tweet({ author: undefined }))).toBeNull();
  });

  it("createdAtが不正な日付文字列でも例外を投げず、fetchedAtは現在時刻にフォールバックする", () => {
    const item = buildXItem(tweet({ createdAt: "not-a-date" }));
    expect(item).not.toBeNull();
    expect(item!.fetchedAt instanceof Date).toBe(true);
    expect(Number.isNaN(item!.fetchedAt.getTime())).toBe(false);
  });
});

describe("純関数: buildTweetTitle（tweet本文からの短いタイトル生成）", () => {
  it("先頭一文をそのまま使う（捏造しない）", () => {
    expect(buildTweetTitle("今日は最高の試合だった。みんなお疲れ様。")).toBe("今日は最高の試合だった。");
  });

  it("先頭一文が長い場合は上限文字数で切り詰め、末尾に…を付ける", () => {
    const longSentence = "あ".repeat(60);
    const title = buildTweetTitle(longSentence);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThan(longSentence.length);
  });
});

describe("純関数: parseSearchQueries / appendSinceIfMissing", () => {
  it("未設定・空文字列は既定クエリ3件(国内/海外/eスポーツ特化、fetchopt-S1 F-FO1-1)を返す", () => {
    expect(parseSearchQueries(undefined)).toHaveLength(3);
    expect(parseSearchQueries("")).toHaveLength(3);
    expect(parseSearchQueries("   ")).toHaveLength(3);
  });

  it("既定クエリ全件にmin_replies:(hot.minComments由来)が含まれる(fetchopt-S1 F-FO1-1)", () => {
    const queries = parseSearchQueries(undefined);
    expect(queries.every((q) => /min_replies:/.test(q))).toBe(true);
  });

  it("X_SEARCH_QUERIES(カスタムクエリ)指定時はそちらが優先される(既存挙動不変)", () => {
    const parsed = parseSearchQueries("custom query only min_faves:5");
    expect(parsed).toEqual(["custom query only min_faves:5"]);
    expect(parsed.some((q) => /min_replies:/.test(q))).toBe(false);
  });

  it("|||区切りでカスタムクエリをパースできる", () => {
    const parsed = parseSearchQueries("query one min_faves:10|||query two lang:ja");
    expect(parsed).toEqual(["query one min_faves:10", "query two lang:ja"]);
  });

  it("since:を含まないクエリには付与し、既に含むクエリはそのまま使う", () => {
    expect(appendSinceIfMissing("lol min_faves:100", "2026-07-26")).toBe("lol min_faves:100 since:2026-07-26");
    expect(appendSinceIfMissing("lol min_faves:100 since:2026-01-01", "2026-07-26")).toBe(
      "lol min_faves:100 since:2026-01-01",
    );
  });
});

describe("純関数: buildAdvancedSearchUrl（GetXAPI仕様: GET .../advanced_search、q/product/cursor）", () => {
  it("q・productをクエリパラメータに含む（既定product=Latest）", () => {
    const url = buildAdvancedSearchUrl("lol min_faves:100");
    expect(url).toContain("https://api.getxapi.com/twitter/tweet/advanced_search?");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("lol min_faves:100");
    expect(parsed.searchParams.get("product")).toBe("Latest");
    expect(parsed.searchParams.has("cursor")).toBe(false);
  });

  it("cursorを渡すとクエリパラメータに含まれる", () => {
    const url = buildAdvancedSearchUrl("lol min_faves:100", "Top", "cursor-abc");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("product")).toBe("Top");
    expect(parsed.searchParams.get("cursor")).toBe("cursor-abc");
  });
});

describe("純関数: buildDefaultSearchQueries（fetchopt-S1 F-FO1-1、既定クエリのhot整合）", () => {
  it("クエリ数は3のまま（クレジット不変）", () => {
    expect(buildDefaultSearchQueries()).toHaveLength(3);
  });

  it("全クエリが hot.minComments 由来の min_replies:30 を含む（既定 HOTNESS_X_MIN_COMMENTS=30）", () => {
    const hot = getHotnessConfig("x");
    expect(hot.minComments).toBe(30);
    const queries = buildDefaultSearchQueries();
    for (const q of queries) {
      expect(q).toContain(`min_replies:${hot.minComments}`);
    }
  });

  it("min_favesは max(floor, hot.minScore)（国内100/海外1000/eスポ100、既定 HOTNESS_X_MIN_SCORE=100）", () => {
    const hot = getHotnessConfig("x");
    expect(hot.minScore).toBe(100);
    const [domestic, overseas, esports] = buildDefaultSearchQueries();
    expect(domestic).toContain("min_faves:100");
    expect(overseas).toContain("min_faves:1000");
    expect(esports).toContain("min_faves:100");
  });

  it("hot設定を変えるとmin_faves/min_repliesがそれに追随する（config由来であることの確認）", () => {
    const queries = buildDefaultSearchQueries({ minScore: 500, minComments: 40 });
    for (const q of queries) {
      expect(q).toContain("min_replies:40");
    }
    expect(queries[0]).toContain("min_faves:500"); // 国内floor(100) < 500 → minScore採用
    expect(queries[1]).toContain("min_faves:1000"); // 海外floor(1000) >= 500 → floor維持
    expect(queries[2]).toContain("min_faves:500"); // eスポfloor(100) < 500 → minScore採用
  });

  it("eスポーツ特化クエリは国内クエリと同一文字列でない（重複回避）", () => {
    const [domestic, , esports] = buildDefaultSearchQueries();
    expect(esports).not.toBe(domestic);
  });

  it("全クエリに lang: と -filter:retweets が付く", () => {
    for (const q of buildDefaultSearchQueries()) {
      expect(q).toMatch(/lang:(ja|en)/);
      expect(q).toContain("-filter:retweets");
    }
  });

  it("reactqual-S1 F-RQ1-1: 国内/海外クエリに裸のLoL/lol（単語境界）を含まない（#LoL・\"League of Legends\"はOK）", () => {
    const [domestic, overseas] = buildDefaultSearchQueries();
    const bareLolPattern = /(?<![#\w])lol(?![a-z])/i;
    expect(bareLolPattern.test(domestic)).toBe(false);
    expect(bareLolPattern.test(overseas)).toBe(false);
    expect(domestic).toContain("#LoL");
    expect(overseas).toContain("#LoL");
    expect(overseas).toContain("League of Legends");
  });

  it("eスポーツ特化クエリも既定値と同様に裸LoLを含まない（現状維持のはず）", () => {
    const [, , esports] = buildDefaultSearchQueries();
    const bareLolPattern = /(?<![#\w])lol(?![a-z])/i;
    expect(bareLolPattern.test(esports)).toBe(false);
  });

  it("reactqual-S5: eスポーツ特化クエリはLoLリーグ名のみ（MSI/Worlds/世界大会を含まない）", () => {
    const [domestic, overseas, esports] = buildDefaultSearchQueries();
    expect(esports.startsWith("(LJL OR LCK OR LPL OR LEC)")).toBe(true);
    expect(esports).not.toContain("MSI");
    expect(esports).not.toContain("Worlds");
    expect(esports).not.toContain("世界大会");
    // domestic/overseasは従来どおり（#LoL/League of Legends/リーグ名を含む）
    expect(domestic).toContain("#LoL");
    expect(overseas).toContain("League of Legends");
  });
});

describe("XAdapter.fetchItems（ブリーフ テスト1〜3、実APIは叩かない）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("X_API_KEY未設定なら空配列を返す（fetchを呼ばない、無課金）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new XAdapter({ apiKey: undefined, queries: ["lol min_faves:100"] });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("複数クエリを直列で呼び、Authorization: Bearerヘッダを付与し、結果をマージ・重複排除する", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        const response: GetXApiSearchResponse = {
          tweets: [tweet({ id: `id-${calls.length}`, url: `https://x.com/user/status/${calls.length}` })],
        };
        return jsonResponse(response);
      }),
    );
    const adapter = new XAdapter({
      apiKey: "test-key",
      queries: ["query domestic min_faves:100", "query overseas min_faves:1000"],
      sleep: vi.fn(async () => {}),
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });
    const items = await adapter.fetchItems();

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.headers.Authorization === "Bearer test-key")).toBe(true);
    const firstQ = new URL(calls[0].url).searchParams.get("q");
    expect(firstQ).toContain("since:2026-07-24"); // 既定sinceHours=72（fetchopt-S1 F-FO1-2）
    expect(items).toHaveLength(2);
  });

  it("X_SINCE_HOURS env指定時はそちらのsinceHoursで上書きされる（fetchopt-S1 F-FO1-2、appendSinceIfMissing不変）", async () => {
    const original = process.env.X_SINCE_HOURS;
    process.env.X_SINCE_HOURS = "24";
    try {
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          calls.push(url);
          return jsonResponse({ tweets: [] } satisfies GetXApiSearchResponse);
        }),
      );
      const adapter = new XAdapter({
        apiKey: "test-key",
        queries: ["query min_faves:100"],
        sleep: vi.fn(async () => {}),
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      });
      await adapter.fetchItems();
      const q = new URL(calls[0]).searchParams.get("q");
      expect(q).toContain("since:2026-07-26"); // 24h前 = 07-27T12:00 - 24h = 07-26
    } finally {
      if (original === undefined) delete process.env.X_SINCE_HOURS;
      else process.env.X_SINCE_HOURS = original;
    }
  });

  it("既定クエリ(env未指定)使用時、クエリ数=3のままAPI呼び出し回数が3回（クレジット不変、fetchopt-S1）", async () => {
    const originalQueries = process.env.X_SEARCH_QUERIES;
    delete process.env.X_SEARCH_QUERIES;
    try {
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          calls.push(url);
          return jsonResponse({ tweets: [] } satisfies GetXApiSearchResponse);
        }),
      );
      const adapter = new XAdapter({ apiKey: "test-key", sleep: vi.fn(async () => {}) });
      await adapter.fetchItems();
      expect(calls).toHaveLength(3);
    } finally {
      if (originalQueries === undefined) delete process.env.X_SEARCH_QUERIES;
      else process.env.X_SEARCH_QUERIES = originalQueries;
    }
  });

  it("非2xx応答は例外を投げず空配列を返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    const adapter = new XAdapter({ apiKey: "test-key", queries: ["q1"], sleep: vi.fn(async () => {}) });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("ネットワーク断（fetchが例外を投げる）でも空配列を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const adapter = new XAdapter({ apiKey: "test-key", queries: ["q1"], sleep: vi.fn(async () => {}) });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("タイムアウト（AbortSignal.timeout由来のAbortError）でも空配列を返す（実タイマーは使わず即abortを再現）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      }),
    );
    const adapter = new XAdapter({ apiKey: "test-key", queries: ["q1"], sleep: vi.fn(async () => {}) });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
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
    const adapter = new XAdapter({ apiKey: "test-key", queries: ["q1"], sleep: vi.fn(async () => {}) });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("isReplyのtweetは変換結果から除外される（-filter:repliesはクエリ側にも設定するが変換側でも落とす）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response: GetXApiSearchResponse = {
          tweets: [tweet({ id: "keep-1" }), tweet({ id: "reply-1", isReply: true })],
        };
        return jsonResponse(response);
      }),
    );
    const adapter = new XAdapter({ apiKey: "test-key", queries: ["q1"], sleep: vi.fn(async () => {}) });
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe("keep-1");
  });
});
