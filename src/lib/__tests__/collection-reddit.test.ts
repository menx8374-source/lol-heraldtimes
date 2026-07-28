import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RedditAdapter,
  buildCommentsSearchUrl,
  buildPostUrl,
  buildPostsByIdsUrl,
  buildRedditItem,
  buildRedditThreadDump,
  computeFetchWindow,
  extractRedditImageUrl,
  matchKeywordPosts,
  selectPostsForCollection,
  selectRelevantPosts,
  selectTopComments,
  type RedditCommentData,
  type RedditPostData,
} from "@/lib/collection/adapters/reddit";
import { parseThreadReses } from "@/lib/generation/thread-format";

function post(overrides: Partial<RedditPostData> = {}): RedditPostData {
  return {
    id: "abc123",
    permalink: "/r/leagueoflegends/comments/abc123/some_post/",
    title: "Patch discussion thread",
    selftext: "Post body text",
    created_utc: 1753401600, // 値自体の意味は問わない
    score: 100,
    stickied: false,
    over_18: false,
    ...overrides,
  };
}

function comment(overrides: Partial<RedditCommentData> = {}): RedditCommentData {
  return {
    id: "c1",
    body: "This is a top comment",
    score: 10,
    author: "someuser",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const KEYWORDS = ["patch", "jungle", "lol"];

describe("純関数: computeFetchWindow（取得窓、拡張E46 テスト5・成長G8 F-G8-1で時間粒度化）", () => {
  it("nowから指定時間前相当のISO日時を算出する（境界の計算が正しい・時間粒度）", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const window = computeFetchWindow(now, 12, 72);
    expect(window.afterIso).toBe("2026-07-24T00:00:00.000Z"); // 72時間(3日)前
    expect(window.beforeIso).toBe("2026-07-26T12:00:00.000Z"); // 12時間前
  });

  it("既定値相当(min12h/max72h)で前寄せされた窓になる(旧既定min2日/max4日より広く新しい側に寄る)", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const window = computeFetchWindow(now, 12, 72);
    // 旧既定(2日=48h前〜4日=96h前)より新しい投稿まで対象に入ることを確認。
    expect(new Date(window.beforeIso).getTime()).toBeGreaterThan(now.getTime() - 48 * 3600000);
  });
});

describe("純関数: 投稿選抜（拡張E46 テスト1）", () => {
  it("stickied除外・over_18除外・キーワード一致・score下限・score降順・件数上限が効く", () => {
    const posts = [
      post({ id: "1", title: "Patch 14.1 notes", score: 200 }),
      post({ id: "2", title: "Sticky patch thread", score: 500, stickied: true }),
      post({ id: "3", title: "NSFW patch fanart", score: 300, over_18: true }),
      post({ id: "4", title: "Unrelated cooking recipe", score: 400 }),
      post({ id: "5", title: "Jungle tier list", score: 40 }), // score未満
      post({ id: "6", title: "Best jungle picks", score: 150 }),
    ];
    const selected = selectRelevantPosts(posts, KEYWORDS, 50, 5);
    expect(selected.map((p) => p.id)).toEqual(["1", "6"]); // score降順: 200, 150
  });

  it("件数上限(limit)が効く", () => {
    const posts = [
      post({ id: "a", title: "patch a", score: 300 }),
      post({ id: "b", title: "patch b", score: 200 }),
      post({ id: "c", title: "patch c", score: 100 }),
    ];
    const selected = selectRelevantPosts(posts, KEYWORDS, 0, 2);
    expect(selected.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("matchKeywordPostsはキーワード一致しない投稿を除外する", () => {
    const posts = [post({ title: "patch notes" }), post({ title: "totally unrelated" })];
    expect(matchKeywordPosts(posts, KEYWORDS)).toHaveLength(1);
  });
});

describe("純関数: selectPostsForCollection（成長G8 F-G8-2、収集の足切りと記事化の判定の分離）", () => {
  const NOW = new Date("2026-07-27T00:00:00.000Z");
  /** NOWから`hoursAgo`時間前のUNIX秒（created_utc）を作る。 */
  function createdUtcHoursAgo(hoursAgo: number): number {
    return Math.floor((NOW.getTime() - hoursAgo * 3600000) / 1000);
  }
  const baseOptions = {
    keywords: KEYWORDS,
    minScore: 50,
    maxThreads: 5,
    now: NOW,
    monitorMaxAgeHours: 24,
    monitorMinComments: 1,
    maxMonitorCandidates: 5,
  };

  it("新しい投稿(監視ウィンドウ内)はscore<minScoreでも足切りされず選抜される(num_comments>=1は満たす)", () => {
    const newLowScorePost = post({
      id: "new-1",
      title: "patch discussion fresh",
      created_utc: createdUtcHoursAgo(2), // 監視ウィンドウ内(24h以内)
      score: 1, // Arctic Shiftのバックフィル遅延実測どおりscore=1
      num_comments: 3,
    });
    const selected = selectPostsForCollection([newLowScorePost], baseOptions);
    expect(selected.map((p) => p.id)).toEqual(["new-1"]);
  });

  it("古い投稿(監視ウィンドウ外)は従来どおりscore足切りされる", () => {
    const oldLowScorePost = post({
      id: "old-1",
      title: "patch discussion old",
      created_utc: createdUtcHoursAgo(48), // 監視ウィンドウ外(24h超)
      score: 10, // minScore=50未満
      num_comments: 20,
    });
    const oldHighScorePost = post({
      id: "old-2",
      title: "patch discussion old hot",
      created_utc: createdUtcHoursAgo(48),
      score: 100,
      num_comments: 20,
    });
    const selected = selectPostsForCollection([oldLowScorePost, oldHighScorePost], baseOptions);
    expect(selected.map((p) => p.id)).toEqual(["old-2"]); // score不足のold-1は除外
  });

  it("新しい投稿でもnum_comments下限未満(無反応/bot投稿)は除外される", () => {
    const noReactionPost = post({
      id: "new-noreaction",
      title: "patch discussion silent",
      created_utc: createdUtcHoursAgo(1),
      score: 1,
      num_comments: 0,
    });
    const selected = selectPostsForCollection([noReactionPost], baseOptions);
    expect(selected).toEqual([]);
  });

  it("新しい投稿の選抜件数はmaxMonitorCandidatesで頭打ちになる(監視対象の暴走防止)", () => {
    const manyNewPosts = Array.from({ length: 10 }, (_, i) =>
      post({
        id: `new-${i}`,
        title: `patch discussion ${i}`,
        created_utc: createdUtcHoursAgo(1),
        score: i, // score降順で選抜されることも兼ねて確認
        num_comments: 5,
      }),
    );
    const selected = selectPostsForCollection(manyNewPosts, { ...baseOptions, maxMonitorCandidates: 3 });
    expect(selected).toHaveLength(3);
    // score降順: 9,8,7 のid
    expect(selected.map((p) => p.id)).toEqual(["new-9", "new-8", "new-7"]);
  });

  it("古い投稿・新しい投稿の両方が混在しても、それぞれの規則で選抜され結果が結合される", () => {
    const oldHot = post({ id: "old-hot", created_utc: createdUtcHoursAgo(48), score: 200, num_comments: 50 });
    const newFresh = post({ id: "new-fresh", created_utc: createdUtcHoursAgo(1), score: 1, num_comments: 2 });
    const selected = selectPostsForCollection([oldHot, newFresh], baseOptions);
    expect(selected.map((p) => p.id).sort()).toEqual(["new-fresh", "old-hot"]);
  });

  it("stickied/over_18/キーワード不一致は新しい投稿でも除外される(ノイズ抑制は不変)", () => {
    const sticky = post({ id: "s1", created_utc: createdUtcHoursAgo(1), score: 1, num_comments: 5, stickied: true });
    const nsfw = post({ id: "n1", created_utc: createdUtcHoursAgo(1), score: 1, num_comments: 5, over_18: true });
    const unrelated = post({
      id: "u1",
      title: "totally unrelated cooking",
      created_utc: createdUtcHoursAgo(1),
      score: 1,
      num_comments: 5,
    });
    const selected = selectPostsForCollection([sticky, nsfw, unrelated], baseOptions);
    expect(selected).toEqual([]);
  });
});

describe("純関数: コメント整形（拡張E46 テスト2）", () => {
  it("[deleted]/[removed]/空/AutoModerator除外・score降順・件数上限が効く", () => {
    const comments = [
      comment({ id: "1", body: "great point", score: 50 }),
      comment({ id: "2", body: "[deleted]", score: 999 }),
      comment({ id: "3", body: "[removed]", score: 999 }),
      comment({ id: "4", body: "   ", score: 999 }),
      comment({ id: "5", body: "bot reply", score: 999, author: "AutoModerator" }),
      comment({ id: "6", body: "another good comment", score: 80 }),
    ];
    const selected = selectTopComments(comments, 5);
    expect(selected.map((c) => c.id)).toEqual(["6", "1"]); // score降順: 80, 50
  });

  it("件数上限(limit)が効く", () => {
    const comments = [
      comment({ id: "1", score: 10 }),
      comment({ id: "2", score: 30 }),
      comment({ id: "3", score: 20 }),
    ];
    expect(selectTopComments(comments, 2).map((c) => c.id)).toEqual(["2", "3"]);
  });
});

describe("純関数: 議論コメント選抜（成長G8 F-G8-3）", () => {
  it("num_repliesを持つコメントがあれば、score上位に加えて返信数上位の議論コメントも確保する", () => {
    const comments = [
      comment({ id: "top1", score: 100, num_replies: 0 }),
      comment({ id: "top2", score: 90, num_replies: 1 }),
      comment({ id: "controversial", score: 5, num_replies: 40 }), // scoreは低いが議論が活発
      comment({ id: "low", score: 1, num_replies: 2 }),
    ];
    const selected = selectTopComments(comments, 3, { discussionSlots: 1 });
    // score上位2件(top1,top2)＋議論コメント枠1件(controversial、score上位に含まれない中で返信数最多)
    expect(selected.map((c) => c.id)).toEqual(["top1", "top2", "controversial"]);
  });

  it("num_repliesを誰も持たない場合は現状どおりscore降順のみになる(回帰なし)", () => {
    const comments = [
      comment({ id: "a", score: 10 }),
      comment({ id: "b", score: 30 }),
      comment({ id: "c", score: 20 }),
    ];
    const selected = selectTopComments(comments, 3, { discussionSlots: 1 });
    expect(selected.map((c) => c.id)).toEqual(["b", "c", "a"]); // score降順のみ
  });

  it("discussionSlots未指定(既定0)ならnum_repliesがあってもscore降順のみになる(明示的opt-inのみ有効)", () => {
    const comments = [
      comment({ id: "top1", score: 100, num_replies: 0 }),
      comment({ id: "controversial", score: 1, num_replies: 40 }),
    ];
    const selected = selectTopComments(comments, 2);
    expect(selected.map((c) => c.id)).toEqual(["top1", "controversial"]); // score降順(100,1)のまま
  });
});

describe("純関数: スレッドダンプ構築（拡張E46 テスト3）", () => {
  it("OP(res1)＋コメント(res2..)がN: 本文形式でparseThreadResesにより正しくレス配列に戻る（逐語維持）", () => {
    const p = post({ title: "Patch 14.1 notes", selftext: "Some champions were nerfed." });
    const comments = [
      comment({ body: "This nerf is deserved" }),
      comment({ body: "Line one\nLine two verbatim" }),
    ];
    const dump = buildRedditThreadDump(p, comments);
    const reses = parseThreadReses(dump);
    expect(reses).toHaveLength(3);
    expect(reses[0].number).toBe(1);
    expect(reses[0].lines).toEqual(["Patch 14.1 notes", "Some champions were nerfed."]);
    expect(reses[1].number).toBe(2);
    expect(reses[1].lines).toEqual(["This nerf is deserved"]);
    expect(reses[2].number).toBe(3);
    expect(reses[2].lines).toEqual(["Line one", "Line two verbatim"]);
  });

  it("selftextが無ければOP本文はtitleのみになる", () => {
    const p = post({ title: "Just a title", selftext: "" });
    const dump = buildRedditThreadDump(p, []);
    expect(parseThreadReses(dump)).toEqual([{ number: 1, lines: ["Just a title"] }]);
  });
});

describe("純関数: RawCollectionItem生成（拡張E46 テスト4）", () => {
  it("sourceUrl(絶対URL)/title/content(ダンプ)/fetchedAtを正しく生成する", () => {
    const p = post({ created_utc: 1000 });
    const item = buildRedditItem(p, [comment({ body: "nice" })]);
    expect(item.sourceUrl).toBe("https://www.reddit.com/r/leagueoflegends/comments/abc123/some_post/");
    expect(item.title).toBe("Patch discussion thread");
    expect(item.fetchedAt).toEqual(new Date(1000 * 1000));
    expect(parseThreadReses(item.content)).toHaveLength(2);
  });

  it("permalink無ければ.../comments/<id>にフォールバックする", () => {
    const p = post({ permalink: undefined });
    expect(buildPostUrl(p)).toBe("https://www.reddit.com/comments/abc123");
  });

  it("imageUrlはpreview優先→thumbnail→nullの順で解決する", () => {
    const withPreview = post({
      preview: { images: [{ source: { url: "https://preview.redd.it/x.jpg?a=1&amp;b=2" } }] },
      thumbnail: "https://b.thumbs.redditmedia.com/should-not-be-used.jpg",
    });
    expect(buildRedditItem(withPreview, []).imageUrl).toBe("https://preview.redd.it/x.jpg?a=1&b=2");

    const withThumbOnly = post({ thumbnail: "https://b.thumbs.redditmedia.com/real.jpg" });
    expect(buildRedditItem(withThumbOnly, []).imageUrl).toBe("https://b.thumbs.redditmedia.com/real.jpg");

    const withNeither = post({ thumbnail: "self" });
    expect(buildRedditItem(withNeither, []).imageUrl).toBeNull();
  });

  it("extractRedditImageUrlはpreviewもthumbnailも無ければnullを返す", () => {
    expect(extractRedditImageUrl(post({ thumbnail: undefined }))).toBeNull();
  });
});

describe("純関数: Post永続化用メタの付与（リファクタリングS2 F-S2-1・テスト1）", () => {
  it("externalId=投稿id・score・commentCount・author・flairがRawCollectionItemに載る", () => {
    const p = post({
      id: "meta1",
      score: 321,
      num_comments: 42,
      author: "some_redditor",
      link_flair_text: "Discussion",
    });
    const item = buildRedditItem(p, [comment({ body: "nice" })]);
    expect(item.externalId).toBe("meta1");
    expect(item.score).toBe(321);
    expect(item.commentCount).toBe(42);
    expect(item.author).toBe("some_redditor");
    expect(item.flair).toBe("Discussion");
    // 既存の共通フィールドは不変
    expect(item.sourceUrl).toBe(buildPostUrl(p));
    expect(item.title).toBe(p.title);
  });

  it("scoreやnum_commentsが未指定の場合は0になる、author/flairは未指定ならnull", () => {
    const p = post({ id: "meta2", score: undefined, num_comments: undefined, author: undefined, link_flair_text: undefined });
    const item = buildRedditItem(p, []);
    expect(item.score).toBe(0);
    expect(item.commentCount).toBe(0);
    expect(item.author).toBeNull();
    expect(item.flair).toBeNull();
  });

  it("upvote_ratioがRawCollectionItem.upvoteRatioにそのまま転記される（成長G1 F-G1-3）", () => {
    const p = post({ id: "meta5", upvote_ratio: 0.62 });
    const item = buildRedditItem(p, []);
    expect(item.upvoteRatio).toBe(0.62);
  });

  it("upvote_ratioが未指定の場合はupvoteRatioもundefinedのまま", () => {
    const p = post({ id: "meta6", upvote_ratio: undefined });
    const item = buildRedditItem(p, []);
    expect(item.upvoteRatio).toBeUndefined();
  });

  it("mediaにimageUrl/urlが設定される（どちらも無ければundefined）", () => {
    const p = post({
      id: "meta3",
      url: "https://external.example.com/article",
      preview: { images: [{ source: { url: "https://preview.redd.it/x.jpg" } }] },
    });
    const item = buildRedditItem(p, []);
    expect(item.media).toEqual({ imageUrl: "https://preview.redd.it/x.jpg", url: "https://external.example.com/article" });

    const withNeither = post({ id: "meta4", thumbnail: undefined, preview: undefined, url: undefined });
    expect(buildRedditItem(withNeither, []).media).toBeUndefined();
  });
});

describe("RedditAdapter.fetchItems（拡張E46 テスト6・7）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("投稿検索→各投稿のコメント検索の順に直列で呼び出し、RawCollectionItem[]を生成する(fetch注入/fixture)", async () => {
    const now = () => new Date("2026-07-27T00:00:00.000Z");
    const calledUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calledUrls.push(url);
      const headers = init?.headers as Record<string, string>;
      expect(headers["User-Agent"]).toBeTruthy();
      if (url.includes("/posts/search")) {
        expect(url).toContain("subreddit=leagueoflegends");
        return jsonResponse({ data: [post({ id: "p1", title: "patch notes", score: 100 })] });
      }
      if (url.includes("/comments/search")) {
        expect(url).toContain("link_id=p1");
        return jsonResponse({ data: [comment({ body: "great patch" })] });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RedditAdapter({
      subreddits: ["leagueoflegends"],
      keywords: KEYWORDS,
      now,
      minScore: 50,
      delayMs: 0,
      sleep: async () => {},
    });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toContain("reddit.com");
    expect(parseThreadReses(items[0].content)).toHaveLength(2);
    expect(calledUrls[0]).toContain("/posts/search");
    expect(calledUrls[1]).toContain("/comments/search");
  });

  it("ディレイ(sleep)が連続fetch間で呼ばれる(delayMs:0+noopで実待機なし)（拡張E46 テスト6）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/posts/search")) {
          return jsonResponse({ data: [post({ id: "p1", score: 100 })] });
        }
        return jsonResponse({ data: [] });
      }),
    );
    const sleepMock = vi.fn(async () => {});
    const adapter = new RedditAdapter({
      subreddits: ["leagueoflegends"],
      keywords: KEYWORDS,
      minScore: 50,
      delayMs: 0,
      sleep: sleepMock,
    });
    await adapter.fetchItems();
    // 最初のfetch(posts)前はディレイ無し、posts→comments間で1回呼ばれる。
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(0);
  });

  it("投稿検索がHTTPエラーの場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(null, 500)));
    const adapter = new RedditAdapter({ subreddits: ["leagueoflegends"], delayMs: 0, sleep: async () => {} });
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
    const adapter = new RedditAdapter({ subreddits: ["leagueoflegends"], delayMs: 0, sleep: async () => {} });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("ネットワーク断(fetchがreject)の場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const adapter = new RedditAdapter({ subreddits: ["leagueoflegends"], delayMs: 0, sleep: async () => {} });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("コメント検索が失敗しても、そのスレはコメント無し(OPのみ)のRawCollectionItemになる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/posts/search")) return jsonResponse({ data: [post({ id: "p1", score: 100 })] });
        return jsonResponse(null, 500);
      }),
    );
    const adapter = new RedditAdapter({ subreddits: ["leagueoflegends"], keywords: KEYWORDS, minScore: 50, delayMs: 0, sleep: async () => {} });
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(1);
    expect(parseThreadReses(items[0].content)).toHaveLength(1); // OPのみ
  });

  it("同一sourceUrlの投稿が複数サブレディットで重複しても重複排除して1件になる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/posts/search")) return jsonResponse({ data: [post({ id: "p1", score: 100 })] });
        return jsonResponse({ data: [] });
      }),
    );
    const adapter = new RedditAdapter({
      subreddits: ["leagueoflegends", "leagueoflegends"],
      keywords: KEYWORDS,
      minScore: 50,
      delayMs: 0,
      sleep: async () => {},
    });
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(1);
  });

  it("成長G8 F-G8-2: 新しい低スコア投稿でも監視ウィンドウ内ならfetchItemsの結果に含まれる(記事化ゲートではなく収集段階では捨てない)", async () => {
    const now = () => new Date("2026-07-27T00:00:00.000Z");
    const freshLowScoreCreatedUtc = Math.floor(
      (now().getTime() - 2 * 3600000) / 1000, // 2時間前(監視ウィンドウ24h以内)
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/posts/search")) {
          return jsonResponse({
            data: [
              post({
                id: "fresh-1",
                title: "patch notes fresh discussion",
                created_utc: freshLowScoreCreatedUtc,
                score: 1, // 実測どおりバックフィル遅延でscore=1
                num_comments: 3,
              }),
            ],
          });
        }
        return jsonResponse({ data: [] });
      }),
    );
    const adapter = new RedditAdapter({
      subreddits: ["leagueoflegends"],
      keywords: KEYWORDS,
      now,
      minScore: 50, // 通常ならこのscore=1は足切りされるはずだが、監視ウィンドウ内なのでバイパスされる
      monitorMaxAgeHours: 24,
      monitorMinComments: 1,
      maxMonitorCandidates: 5,
      delayMs: 0,
      sleep: async () => {},
    });
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(1);
    expect(items[0].score).toBe(1);
  });

  it("対象サブレディットが無い場合は空配列を返し、fetchを一切呼ばずスキップログを1度残す", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const adapter = new RedditAdapter({ subreddits: [] });
    const items = await adapter.fetchItems();

    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("スキップ"));
  });
});

describe("純関数: buildCommentsSearchUrl", () => {
  it("link_idを付与したURLを組み立てる", () => {
    expect(buildCommentsSearchUrl("p1")).toContain("link_id=p1");
  });
});

describe("純関数: buildPostsByIdsUrl（S4 F-S4-1）", () => {
  it("idsを付与したURLを組み立てる", () => {
    expect(buildPostsByIdsUrl("abc123")).toBe(
      "https://arctic-shift.photon-reddit.com/api/posts/ids?ids=abc123",
    );
  });
});

describe("RedditAdapter.fetchMetrics（リファクタリングS4 F-S4-1・テスト2）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("score/num_commentsを取得できる(確認済みエンドポイント/posts/ids)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(buildPostsByIdsUrl("abc123"));
      return jsonResponse({ data: [{ id: "abc123", score: 321, num_comments: 42 }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RedditAdapter({});
    await expect(adapter.fetchMetrics("abc123")).resolves.toEqual({ score: 321, commentCount: 42 });
  });

  it("score/num_comments未設定なら0を返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ id: "abc123" }] })));
    const adapter = new RedditAdapter({});
    await expect(adapter.fetchMetrics("abc123")).resolves.toEqual({ score: 0, commentCount: 0 });
  });

  it("dataが空配列の場合はnullを返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [] })));
    const adapter = new RedditAdapter({});
    await expect(adapter.fetchMetrics("abc123")).resolves.toBeNull();
  });

  it("HTTPエラーの場合はnullを返す(例外を投げない)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(null, 500)));
    const adapter = new RedditAdapter({});
    await expect(adapter.fetchMetrics("abc123")).resolves.toBeNull();
  });

  it("ネットワーク断の場合はnullを返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const adapter = new RedditAdapter({});
    await expect(adapter.fetchMetrics("abc123")).resolves.toBeNull();
  });
});

describe("RedditAdapter.fetchContent（リファクタリングS6 F-S6-2・テスト3）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("投稿id→投稿本体+上位コメントの順に再取得し、現在の内容でスレッドダンプを作り直す(既存ロジック再利用)", async () => {
    const calledUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calledUrls.push(url);
      if (url.includes("/posts/ids")) {
        return jsonResponse({
          data: [post({ id: "abc123", title: "Updated title after surge", selftext: "New details" })],
        });
      }
      if (url.includes("/comments/search")) {
        return jsonResponse({ data: [comment({ body: "Fresh top comment" })] });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RedditAdapter({ maxComments: 20, delayMs: 0, sleep: async () => {} });
    const result = await adapter.fetchContent("abc123");

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Updated title after surge");
    expect(parseThreadReses(result!.content)).toHaveLength(2); // OP + 1コメント
    expect(calledUrls[0]).toContain("/posts/ids");
    expect(calledUrls[1]).toContain("/comments/search");
  });

  it("投稿が見つからない(data空)場合はnullを返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [] })));
    const adapter = new RedditAdapter({});
    await expect(adapter.fetchContent("abc123")).resolves.toBeNull();
  });

  it("HTTPエラーの場合はnullを返す(例外を投げない)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(null, 500)));
    const adapter = new RedditAdapter({});
    await expect(adapter.fetchContent("abc123")).resolves.toBeNull();
  });

  it("ネットワーク断の場合はnullを返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const adapter = new RedditAdapter({});
    await expect(adapter.fetchContent("abc123")).resolves.toBeNull();
  });
});
