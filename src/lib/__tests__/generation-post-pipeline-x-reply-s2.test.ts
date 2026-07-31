/**
 * X-reply-S2: extractPostXReplies（F-XR2-2、純関数の防御的検証）と、
 * generateArticlesFromHotPosts経由の遅延fetch＆Post.media保存＆candidate配線（F-XR2-2/F-XR2-3）の
 * 結合テスト（専用テストDB、実際にPrisma経由で書き込む。GetXAPI呼び出しは`fetch`をstubして検証、
 * 実HTTPは叩かない）。表示（composeXBody）はX-reply-S3でxRepliesを使う構成に刷新されたため、
 * xReplies有りの結合テストはS3仕様（反応まとめブロックを含む）に合わせて更新している。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { MockLLMClient } from "@/lib/generation/llm-client";

// generateArticleForCandidateへ渡されたcandidateを検証するため、実装はそのまま呼びつつ
// 呼び出し引数を記録できるようスパイでラップする（partial mock、このテストファイル内のみ有効）。
vi.mock("@/lib/generation/generate-article", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generation/generate-article")>();
  return {
    ...actual,
    generateArticleForCandidate: vi.fn(actual.generateArticleForCandidate),
  };
});

import { generateArticlesFromHotPosts, extractPostXReplies } from "@/lib/generation/post-pipeline";
import { generateArticleForCandidate } from "@/lib/generation/generate-article";

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
}

const llm = new MockLLMClient();
const T0 = new Date("2026-07-30T12:00:00.000Z");

let seq = 0;
async function createXPost(opts: { metrics: { score: number; commentCount: number; capturedAt: Date }[] }) {
  seq += 1;
  const post = await prisma.post.create({
    data: {
      sourceType: "x",
      externalId: `x-reply-s2-ext-${seq}`,
      title: `Xタイトル${seq}`,
      body: `今日のLJLの試合が本当に面白かった${seq}。序盤から目が離せなかった。`,
      url: `https://x.com/lol_jp_fan/status/x-reply-s2-ext-${seq}`,
      author: "lol_jp_fan",
      postedAt: new Date(T0.getTime() - 2 * 60 * 60 * 1000),
      category: "Xの反応",
    },
  });
  for (const m of opts.metrics) {
    await prisma.postMetricsHistory.create({
      data: { postId: post.id, score: m.score, commentCount: m.commentCount, capturedAt: m.capturedAt },
    });
  }
  return post;
}

function replyTweetJson(id: string) {
  return {
    tweets: [
      {
        id,
        text: "同意です、序盤の集団戦が全てでした。",
        url: `https://x.com/reply_user/status/${id}`,
        createdAt: "2026-07-30T11:00:00.000Z",
        likeCount: 5,
        replyCount: 1,
        quoteCount: 0,
        author: { userName: "reply_user" },
      },
    ],
  };
}

describe("extractPostXReplies（純関数、DB読み出し時の防御的検証）", () => {
  const validItem = {
    id: "1",
    text: "t",
    author: "a",
    likeCount: 1,
    replyCount: 0,
    quoteCount: 0,
    url: "https://x.com/a/status/1",
    isQuote: false,
  };

  it("正常JSON→XReplyItem[]", () => {
    expect(extractPostXReplies({ xReplies: [validItem] })).toEqual([validItem]);
  });

  it("null・未設定・他ソースmedia(xRepliesキー無し)は空配列", () => {
    expect(extractPostXReplies(null)).toEqual([]);
    expect(extractPostXReplies({})).toEqual([]);
    expect(extractPostXReplies({ imageUrl: "https://pbs.twimg.com/x.jpg" })).toEqual([]);
  });

  it("xRepliesが配列でない場合は空配列", () => {
    expect(extractPostXReplies({ xReplies: "not-an-array" })).toEqual([]);
    expect(extractPostXReplies({ xReplies: { id: "1" } })).toEqual([]);
  });

  it("要素欠落・型違いの要素は捨てて安全な要素だけ残す", () => {
    const result = extractPostXReplies({
      xReplies: [
        validItem,
        { id: "2" }, // 必須フィールド欠落
        { ...validItem, id: "3", likeCount: "not-a-number" }, // 型違い
        { ...validItem, id: "4", isQuote: "yes" }, // 型違い
        null,
        "not-an-object",
      ],
    });
    expect(result).toEqual([validItem]);
  });

  it("件数上限(X_REPLIES_MAX既定8)で切り詰める", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ ...validItem, id: `${i}` }));
    const result = extractPostXReplies({ xReplies: items });
    expect(result).toHaveLength(8);
  });
});

describe("generateArticlesFromHotPosts のX-reply-S2配線（F-XR2-2/F-XR2-3、opt-in・コスト安全）", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.X_REPLIES_MODE;
    delete process.env.X_QUOTES_MODE;
    delete process.env.X_API_KEY;
    vi.unstubAllGlobals();
  });

  it("X_REPLIES_MODE on + X_API_KEY ありのhot XポストはPost.media.xRepliesに保存され、candidateにも配線される", async () => {
    process.env.X_REPLIES_MODE = "on";
    process.env.X_QUOTES_MODE = "off"; // リプライのみでシンプルに検証(1コール)
    process.env.X_API_KEY = "test-key";

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => replyTweetJson("reply-1"),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const post = await createXPost({ metrics: [{ score: 320, commentCount: 48, capturedAt: T0 }] });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    expect(summary.succeededCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // quotesMode offなので1コールのみ

    const updatedPost = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    const media = updatedPost.media as { xReplies?: { id: string; author: string; isQuote: boolean }[] };
    expect(media.xReplies).toHaveLength(1);
    expect(media.xReplies![0]).toMatchObject({ id: "reply-1", author: "reply_user", isQuote: false });

    const mockedGenerate = vi.mocked(generateArticleForCandidate);
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
    const candidateArg = mockedGenerate.mock.calls[0][0];
    expect(candidateArg.xReplies).toHaveLength(1);
    expect(candidateArg.xReplies![0].id).toBe("reply-1");
  });

  it("X_REPLIES_MODE off ではfetchせずxReplies空(従来どおり・回帰ゼロ)", async () => {
    process.env.X_REPLIES_MODE = "off";
    process.env.X_API_KEY = "test-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const post = await createXPost({ metrics: [{ score: 320, commentCount: 48, capturedAt: T0 }] });
    await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    expect(fetchMock).not.toHaveBeenCalled();
    const updatedPost = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect((updatedPost.media as Record<string, unknown> | null)?.xReplies).toBeUndefined();

    const candidateArg = vi.mocked(generateArticleForCandidate).mock.calls[0][0];
    expect(candidateArg.xReplies).toEqual([]);
  });

  it("X_API_KEY未設定ではfetchせずxReplies空($0・回帰ゼロ)", async () => {
    process.env.X_REPLIES_MODE = "on";
    delete process.env.X_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const post = await createXPost({ metrics: [{ score: 320, commentCount: 48, capturedAt: T0 }] });
    await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    expect(fetchMock).not.toHaveBeenCalled();
    const updatedPost = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect((updatedPost.media as Record<string, unknown> | null)?.xReplies).toBeUndefined();
  });

  it("保存済み(Post.media.xRepliesあり)なら再fetchしない(重複課金防止)", async () => {
    process.env.X_REPLIES_MODE = "on";
    process.env.X_API_KEY = "test-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const post = await createXPost({ metrics: [{ score: 320, commentCount: 48, capturedAt: T0 }] });
    await prisma.post.update({
      where: { id: post.id },
      data: {
        media: {
          xReplies: [
            {
              id: "already",
              text: "t",
              author: "a",
              likeCount: 1,
              replyCount: 0,
              quoteCount: 0,
              url: "https://x.com/a/status/already",
              isQuote: false,
            },
          ],
        },
      },
    });

    await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    expect(fetchMock).not.toHaveBeenCalled();
    const updatedPost = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    const media = updatedPost.media as { xReplies?: { id: string }[] };
    expect(media.xReplies).toHaveLength(1);
    expect(media.xReplies![0].id).toBe("already");
  });

  it("他mediaキー(imageUrl等)を壊さずxRepliesをマージ保存する", async () => {
    process.env.X_REPLIES_MODE = "on";
    process.env.X_QUOTES_MODE = "off";
    process.env.X_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ tweets: [] }) })),
    );

    const post = await createXPost({ metrics: [{ score: 320, commentCount: 48, capturedAt: T0 }] });
    await prisma.post.update({
      where: { id: post.id },
      data: { media: { imageUrl: "https://pbs.twimg.com/x.jpg" } },
    });

    await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    const updatedPost = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    const media = updatedPost.media as { imageUrl?: string; xReplies?: unknown[] };
    expect(media.imageUrl).toBe("https://pbs.twimg.com/x.jpg");
    expect(media.xReplies).toEqual([]);
  });

  it("表示連携: candidateに配線されたxRepliesがcomposeXBody(X-reply-S3)の反応まとめに使われる", async () => {
    process.env.X_REPLIES_MODE = "on";
    process.env.X_QUOTES_MODE = "off";
    process.env.X_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => replyTweetJson("reply-body-check") })),
    );

    const post = await createXPost({ metrics: [{ score: 320, commentCount: 48, capturedAt: T0 }] });
    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    expect(summary.succeededCount).toBe(1);

    const article = await prisma.article.findUniqueOrThrow({ where: { postId: post.id } });
    const body = article.body as { type: string }[];
    // X-reply-S3: xRepliesが載っているので、composeXBodyがreactionブロック(反応まとめ)を含む構成になる。
    expect(body.some((b) => b.type === "reaction")).toBe(true);
    const knownTypes = new Set(["heading", "paragraph", "quote", "embed", "reaction"]);
    for (const block of body) {
      expect(knownTypes.has(block.type)).toBe(true);
    }
  });
});
