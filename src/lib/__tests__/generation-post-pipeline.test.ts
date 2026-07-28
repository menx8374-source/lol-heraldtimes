/**
 * generateArticlesFromHotPosts（リファクタリングS5a F-S5a-1）の結合テスト（ブリーフ テスト1〜3）。
 * 専用テストDB（vitest.global-setup.ts でDATABASE_URLを差し替え済み）に対して実際にPrisma経由で
 * 書き込み、「hot判定による母数絞り・既記事化スキップ(1投稿1回)」「カテゴリ別上限・hotness降順選択」
 * 「postId紐付け・moderation held・1件失敗でも他継続」を検証する。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateArticlesFromHotPosts } from "@/lib/generation/post-pipeline";
import { MockLLMClient, type LLMClient, type LLMMessage } from "@/lib/generation/llm-client";
import { SEO_SYSTEM_PROMPT } from "@/lib/generation/seo";
import type { SourceType } from "@/lib/collection/types";

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
}

/** SEO_SYSTEM_PROMPT向けの呼び出しだけ有効なSEO JSONを返し、それ以外はMockLLMClientに委譲するスタブ（S5b）。 */
class SeoStubLLMClient implements LLMClient {
  private readonly mock = new MockLLMClient();
  async generate(messages: LLMMessage[]): Promise<string> {
    if (messages.some((m) => m.role === "system" && m.content === SEO_SYSTEM_PROMPT)) {
      return JSON.stringify({
        seoTitle: "新経路SEO保存確認用のSEOタイトル",
        metaDescription: "新経路(Post)でSEO列とタグが保存されることを確認する説明文。",
        ogTitle: "新経路SEO確認用OGPタイトル",
        ogDescription: "新経路SEO確認用OGPディスクリプション。",
        tags: ["ヤスオ", "パッチ"],
      });
    }
    return this.mock.generate(messages);
  }
}

beforeEach(async () => {
  await resetDb();
});

const llm = new MockLLMClient();
const T0 = new Date("2026-07-27T12:00:00.000Z");
const hours = (n: number) => n * 60 * 60 * 1000;

let seq = 0;
type CreatePostOptions = {
  sourceType: SourceType;
  title?: string;
  body?: string;
  sourceUrl?: string;
  postedAt?: Date;
  media?: { imageUrl: string };
  category?: string;
  /** 成長G1（F-G1-4）: upvote比率（0〜1）。未指定はnull（Post.upvoteRatio既定と同じ）。 */
  upvoteRatio?: number;
  metrics: { score: number; commentCount: number; capturedAt: Date }[];
};

/** 反応形式(5ch/reddit)ならreactionブロックが1件以上組み立てられる既定本文にする。 */
async function createPost(opts: CreatePostOptions) {
  seq += 1;
  const externalId = `ext-${seq}`;
  const post = await prisma.post.create({
    data: {
      sourceType: opts.sourceType,
      externalId,
      title: opts.title ?? `タイトル${seq}`,
      body: opts.body ?? `1: 本文${seq}その1\n2: 本文${seq}その2`,
      url: opts.sourceUrl ?? `https://example.com/${opts.sourceType}/${externalId}`,
      postedAt: opts.postedAt ?? new Date(T0.getTime() - hours(2)),
      ...(opts.media ? { media: opts.media } : {}),
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.upvoteRatio !== undefined ? { upvoteRatio: opts.upvoteRatio } : {}),
    },
  });
  for (const m of opts.metrics) {
    await prisma.postMetricsHistory.create({
      data: { postId: post.id, score: m.score, commentCount: m.commentCount, capturedAt: m.capturedAt },
    });
  }
  return post;
}

describe("generateArticlesFromHotPosts（リファクタリングS5a F-S5a-1）", () => {
  it("isHotな未記事化Postのみ記事化され、非hot・既記事化Postはスキップされる(1投稿1回・重複防止)", async () => {
    // 5chはminScore=0・minComments=30が既定閾値のため、comments>=30なら現在値ルールでhot。
    const hotPost = await createPost({
      sourceType: "5ch",
      metrics: [{ score: 0, commentCount: 50, capturedAt: T0 }],
    });
    const nonHotPost = await createPost({
      sourceType: "5ch",
      metrics: [{ score: 0, commentCount: 5, capturedAt: T0 }],
    });
    const articledPost = await createPost({
      sourceType: "5ch",
      metrics: [{ score: 0, commentCount: 100, capturedAt: T0 }],
    });
    // articledPostは既にArticleが紐付いている(1投稿1回の既存状態) → 対象Postの抽出クエリで除外される想定。
    await prisma.article.create({
      data: {
        slug: "already-articled-post",
        title: "既存記事タイトル",
        category: "5chの反応",
        body: [],
        publishedAt: T0,
        postId: articledPost.id,
      },
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    // 記事化対象になったのはhotPostのみ(非hot・既記事化はどちらもスキップ)。
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]).toMatchObject({ postId: hotPost.id, status: "success" });

    const hotArticle = await prisma.article.findUnique({ where: { postId: hotPost.id } });
    expect(hotArticle).not.toBeNull();

    const nonHotArticle = await prisma.article.findUnique({ where: { postId: nonHotPost.id } });
    expect(nonHotArticle).toBeNull();
  });

  it("カテゴリ(=ソース種別)別に独立して最大maxPerCategory件、hotnessの強さ降順で選ばれる(拡張E48踏襲)", async () => {
    // 5ch: score恒常0のためcomments降順で強さを決める。
    const fivechCommentCounts = [100, 90, 80, 70];
    const fivechPosts = [];
    for (const c of fivechCommentCounts) {
      fivechPosts.push(
        await createPost({ sourceType: "5ch", metrics: [{ score: 0, commentCount: c, capturedAt: T0 }] }),
      );
    }
    // reddit: score降順で強さを決める(comments一定・全件hot閾値超)。
    const redditScores = [300, 250, 200];
    const redditPosts = [];
    for (const s of redditScores) {
      redditPosts.push(
        await createPost({ sourceType: "reddit", metrics: [{ score: s, commentCount: 50, capturedAt: T0 }] }),
      );
    }

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, maxPerCategory: 2, championMap: null });

    const processedIds = new Set(summary.results.map((r) => r.postId));
    expect(processedIds.size).toBe(4); // 5ch上位2 + reddit上位2

    expect(processedIds.has(fivechPosts[0].id)).toBe(true); // comments=100
    expect(processedIds.has(fivechPosts[1].id)).toBe(true); // comments=90
    expect(processedIds.has(fivechPosts[2].id)).toBe(false); // comments=80(上限外)
    expect(processedIds.has(fivechPosts[3].id)).toBe(false); // comments=70(上限外)

    expect(processedIds.has(redditPosts[0].id)).toBe(true); // score=300
    expect(processedIds.has(redditPosts[1].id)).toBe(true); // score=250
    expect(processedIds.has(redditPosts[2].id)).toBe(false); // score=200(上限外、他ソースの取得数に影響しない)
  });

  it("postId紐付け(@unique)・moderation不通過はheld・1件の生成失敗があっても他は継続し例外を投げない", async () => {
    const riotTitle = "パッチ26.14ノート公開";
    const riotContent = "本パッチではジャングルモンスターの経験値量が引き下げられ、序盤のペースに変化が生まれた。";
    const riotSourceUrl = "https://www.leagueoflegends.com/ja-jp/news/patch-26-14-notes/";

    // riotは事実速報(fact)モードでcandidate.titleがそのままタイトルになるため、同一タイトル+同一本文の
    // 2件を用意すると2件目が既存公開記事(1件目)と重複判定され held(duplicate) になる。
    const riotA = await createPost({
      sourceType: "riot",
      title: riotTitle,
      body: riotContent,
      sourceUrl: riotSourceUrl,
      metrics: [{ score: 200, commentCount: 50, capturedAt: T0 }],
    });
    const riotB = await createPost({
      sourceType: "riot",
      title: riotTitle,
      body: riotContent,
      sourceUrl: riotSourceUrl,
      metrics: [{ score: 200, commentCount: 50, capturedAt: T0 }],
    });

    // 5ch: 本文が空でreactionブロックが1件も組み立てられず生成失敗する(既存方針、拡張E48テストと同型)。
    const failPost = await createPost({
      sourceType: "5ch",
      title: "【LoL】空スレ",
      body: "",
      metrics: [{ score: 0, commentCount: 40, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    expect(summary.results).toHaveLength(3);
    expect(summary.succeededCount).toBe(2);
    expect(summary.failedCount).toBe(1);

    const failResult = summary.results.find((r) => r.postId === failPost.id);
    expect(failResult?.status).toBe("failure");
    const failArticle = await prisma.article.findUnique({ where: { postId: failPost.id } });
    expect(failArticle).toBeNull(); // 失敗した候補はArticleを作らない

    const resultA = summary.results.find((r) => r.postId === riotA.id);
    const resultB = summary.results.find((r) => r.postId === riotB.id);
    expect(resultA?.status).toBe("success");
    expect(resultB?.status).toBe("success");

    const articleA = await prisma.article.findUnique({ where: { postId: riotA.id } });
    const articleB = await prisma.article.findUnique({ where: { postId: riotB.id } });
    // moderation不通過でもArticle自体は作成しpostIdで紐付ける(既存方針)。
    expect(articleA).not.toBeNull();
    expect(articleB).not.toBeNull();

    const statuses = [articleA?.status, articleB?.status].sort();
    expect(statuses).toEqual(["held", "published"]); // 片方は重複でheld、片方はpublished

    const heldArticle = [articleA, articleB].find((a) => a?.status === "held");
    expect(heldArticle?.heldReason).toBe("duplicate");
  });

  it("hot判定されたPostが1件も無い場合は0件記事化で正常終了する(例外なし)", async () => {
    await createPost({ sourceType: "5ch", metrics: [{ score: 0, commentCount: 1, capturedAt: T0 }] });
    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    expect(summary).toEqual({ succeededCount: 0, failedCount: 0, results: [] });
  });

  it("Postが1件も無い場合は0件記事化で正常終了する(例外なし)", async () => {
    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    expect(summary).toEqual({ succeededCount: 0, failedCount: 0, results: [] });
  });
});

describe("generateArticlesFromHotPosts（SEO列・タグの保存、リファクタリングS5b F-S5b-2 ブリーフテスト3）", () => {
  it("SEOをスタブで返すLLMを渡すと Article の SEO列に保存され、tags が ArticleTag に紐付く", async () => {
    const post = await createPost({
      sourceType: "riot",
      metrics: [{ score: 200, commentCount: 50, capturedAt: T0 }],
    });
    const summary = await generateArticlesFromHotPosts(new SeoStubLLMClient(), { now: T0, championMap: null });

    const result = summary.results.find((r) => r.postId === post.id);
    expect(result?.status).toBe("success");
    const article = await prisma.article.findUnique({
      where: { postId: post.id },
      include: { tags: { include: { tag: true } } },
    });
    expect(article?.seoTitle).toBe("新経路SEO保存確認用のSEOタイトル");
    expect(article?.metaDescription).toBe("新経路(Post)でSEO列とタグが保存されることを確認する説明文。");
    expect(article?.ogTitle).toBe("新経路SEO確認用OGPタイトル");
    expect(article?.ogDescription).toBe("新経路SEO確認用OGPディスクリプション。");
    expect(article?.tags.map((t) => t.tag.name).sort()).toEqual(["パッチ", "ヤスオ"]);
  });

  it("mock(MockLLMClient)ではSEOがnullのため、SEO列・タグとも未設定のまま保存される(回帰なし)", async () => {
    const post = await createPost({
      sourceType: "riot",
      metrics: [{ score: 200, commentCount: 50, capturedAt: T0 }],
    });
    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    const result = summary.results.find((r) => r.postId === post.id);
    expect(result?.status).toBe("success");
    const article = await prisma.article.findUnique({
      where: { postId: post.id },
      include: { tags: true },
    });
    expect(article?.seoTitle).toBeNull();
    expect(article?.metaDescription).toBeNull();
    expect(article?.ogTitle).toBeNull();
    expect(article?.ogDescription).toBeNull();
    expect(article?.tags).toHaveLength(0);
  });
});

describe("generateArticlesFromHotPosts（hotness免除ソース、リファクタリング S5c F-S5c-1／ブリーフ テスト1）", () => {
  afterEach(() => {
    delete process.env.HOTNESS_EXEMPT_SOURCE_TYPES;
  });

  const riotTitle = "パッチ26.14ノート公開";
  const riotContent = "本パッチではジャングルモンスターの経験値量が引き下げられ、序盤のペースに変化が生まれた。";
  const riotSourceUrl = "https://www.leagueoflegends.com/ja-jp/news/patch-26-14-notes/";

  it("riot(score0/comment0)は既定でhotness免除され、hotness判定を経ずに記事化される。同条件の5chはhotでないためスキップされる", async () => {
    const riotPost = await createPost({
      sourceType: "riot",
      title: riotTitle,
      body: riotContent,
      sourceUrl: riotSourceUrl,
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });
    const nonHotFivech = await createPost({
      sourceType: "5ch",
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]).toMatchObject({ postId: riotPost.id, status: "success" });

    const riotArticle = await prisma.article.findUnique({ where: { postId: riotPost.id } });
    expect(riotArticle).not.toBeNull();
    const fivechArticle = await prisma.article.findUnique({ where: { postId: nonHotFivech.id } });
    expect(fivechArticle).toBeNull();
  });

  it("免除ソース(riot)でも既記事化済みPost(article有り)は対象から除外される(1投稿1回)", async () => {
    const alreadyArticledRiot = await createPost({
      sourceType: "riot",
      title: riotTitle,
      body: riotContent,
      sourceUrl: riotSourceUrl,
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });
    await prisma.article.create({
      data: {
        slug: "already-articled-riot",
        title: "既存パッチ記事タイトル",
        category: "パッチ/メタ",
        body: [],
        publishedAt: T0,
        postId: alreadyArticledRiot.id,
      },
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    expect(summary).toEqual({ succeededCount: 0, failedCount: 0, results: [] });
  });

  it("免除ソース(riot)にもカテゴリ別上限(maxPerCategory)が適用され、同点時はpostedAt降順(新しい投稿優先)で選ばれる", async () => {
    const older = await createPost({
      sourceType: "riot",
      title: "パッチ26.13ノート公開",
      body: riotContent,
      sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/patch-26-13-notes/",
      postedAt: new Date(T0.getTime() - hours(48)),
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });
    const newer = await createPost({
      sourceType: "riot",
      title: riotTitle,
      body: riotContent,
      sourceUrl: riotSourceUrl,
      postedAt: new Date(T0.getTime() - hours(1)),
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });
    const oldest = await createPost({
      sourceType: "riot",
      title: "パッチ26.12ノート公開",
      body: riotContent,
      sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/patch-26-12-notes/",
      postedAt: new Date(T0.getTime() - hours(72)),
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, maxPerCategory: 2, championMap: null });

    const processedIds = new Set(summary.results.map((r) => r.postId));
    expect(processedIds.size).toBe(2);
    expect(processedIds.has(newer.id)).toBe(true);
    expect(processedIds.has(older.id)).toBe(true);
    expect(processedIds.has(oldest.id)).toBe(false); // 上限外(最も古い)
  });

  it("env HOTNESS_EXEMPT_SOURCE_TYPESで免除ソースを上書きできる(riotを免除から外すとscore0/comment0では記事化されない)", async () => {
    process.env.HOTNESS_EXEMPT_SOURCE_TYPES = "5ch"; // riotを免除リストから除外
    const riotPost = await createPost({
      sourceType: "riot",
      title: riotTitle,
      body: riotContent,
      sourceUrl: riotSourceUrl,
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    expect(summary).toEqual({ succeededCount: 0, failedCount: 0, results: [] });

    const article = await prisma.article.findUnique({ where: { postId: riotPost.id } });
    expect(article).toBeNull();
  });
});

describe("generateArticlesFromHotPosts（取得元ルールによるカテゴリ付与、リファクタリングS7a F-S7a-3）", () => {
  it("Post.categoryが設定されていればArticle.categoryにそのまま反映される（ソース既定より優先）", async () => {
    const post = await createPost({
      sourceType: "riot",
      category: "Riot公式",
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    const result = summary.results.find((r) => r.postId === post.id);
    expect(result?.status).toBe("success");

    const article = await prisma.article.findUnique({ where: { postId: post.id } });
    expect(article?.category).toBe("Riot公式");
  });

  it("Post.category未設定ならソース既定カテゴリ(CATEGORY_BY_SOURCE)にフォールバックする(回帰なし)", async () => {
    const post = await createPost({
      sourceType: "riot",
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    const result = summary.results.find((r) => r.postId === post.id);
    expect(result?.status).toBe("success");

    const article = await prisma.article.findUnique({ where: { postId: post.id } });
    expect(article?.category).toBe("パッチ/メタ");
  });
});

describe("generateArticlesFromHotPosts（riot-news: hotness免除＋カテゴリ付与、リファクタリングS7b）", () => {
  it("riot-newsは既定でhotness免除され、score0/comment0でも記事化される。カテゴリはPost.category(取得元ルール)がそのまま反映される", async () => {
    const post = await createPost({
      sourceType: "riot-news",
      title: "World Championship 2026 グループステージ組み合わせ発表",
      body: "今年のWorld Championshipのグループステージ組み合わせが発表された。",
      sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/esports/worlds-2026-groups-announced",
      category: "eスポーツ",
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    const result = summary.results.find((r) => r.postId === post.id);
    expect(result).toMatchObject({ status: "success", publicationStatus: "published" });

    const article = await prisma.article.findUnique({ where: { postId: post.id } });
    expect(article).not.toBeNull();
    expect(article?.category).toBe("eスポーツ");
    expect(article?.title).toBe("World Championship 2026 グループステージ組み合わせ発表"); // og:title事実そのまま
  });

  it("既記事化済みのriot-news Postは対象から除外される(1投稿1回)", async () => {
    const post = await createPost({
      sourceType: "riot-news",
      category: "Riot公式",
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });
    await prisma.article.create({
      data: {
        slug: "already-articled-riot-news",
        title: "既存ニュース記事タイトル",
        category: "Riot公式",
        body: [],
        publishedAt: T0,
        postId: post.id,
      },
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    expect(summary.results.find((r) => r.postId === post.id)).toBeUndefined();
  });
});

describe("generateArticlesFromHotPosts（論争度シグナル、成長G1 F-G1-4 ブリーフ テスト4）", () => {
  it("Post.upvoteRatioがevaluateHotnessに伝播し、isControversialなPostのタイトルが議論寄り(【議論】)になる", async () => {
    // score=500/comments=40は現在値ルールでhot(reddit既定minScore=100/minComments=30)。
    // comments/score比=40/500=0.08<0.15(非controversy比)だが、upvoteRatio=0.5<=0.80のため論争判定される。
    const post = await createPost({
      sourceType: "reddit",
      upvoteRatio: 0.5,
      metrics: [{ score: 500, commentCount: 40, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    const result = summary.results.find((r) => r.postId === post.id);
    expect(result?.status).toBe("success");

    const article = await prisma.article.findUnique({ where: { postId: post.id } });
    // MockLLMClientはJSON以外の入力を空文字にするため、必ずルールベース(generateHookTitle)へ
    // フォールバックする。isControversial=trueならラベルは【議論】固定になる。
    expect(article?.title.startsWith("【議論】")).toBe(true);
  });

  it("Post.upvoteRatioが高い(賛否割れなし)場合はisControversial=falseとなり、通常のhotnessランキングで選ばれる(回帰なし)", async () => {
    const post = await createPost({
      sourceType: "reddit",
      upvoteRatio: 0.95,
      metrics: [{ score: 500, commentCount: 40, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    const result = summary.results.find((r) => r.postId === post.id);
    expect(result?.status).toBe("success"); // 記事化自体は成功する(isControversialはisHotを置き換えない)
  });

  it("同一hotnessStrength(score/comments同値)の2Postがある場合、isControversialなPostがカテゴリ別上限内で優先選出される", async () => {
    // 両者ともscore=500/comments=40で同じhotnessStrengthになるようにする。
    const controversial = await createPost({
      sourceType: "reddit",
      upvoteRatio: 0.5, // <=0.80 → isControversial=true
      postedAt: new Date(T0.getTime() - hours(2)), // 新しい投稿(postedAt降順なら本来こちらが有利)
      metrics: [{ score: 500, commentCount: 40, capturedAt: T0 }],
    });
    const nonControversialButNewer = await createPost({
      sourceType: "reddit",
      upvoteRatio: 0.95, // isControversial=false
      postedAt: new Date(T0.getTime() - hours(1)), // controversialより新しい(postedAt降順なら有利)
      metrics: [{ score: 500, commentCount: 40, capturedAt: T0 }],
    });

    // maxPerCategory=1で1件だけ選出させ、isControversial優先(postedAt降順より優先)を確認する。
    const summary = await generateArticlesFromHotPosts(llm, { now: T0, maxPerCategory: 1, championMap: null });

    const processedIds = summary.results.map((r) => r.postId);
    expect(processedIds).toEqual([controversial.id]);
    expect(processedIds.includes(nonControversialButNewer.id)).toBe(false);
  });
});

describe("generateArticlesFromHotPosts（Post経路の画像取りこぼし修正、リファクタリング S5c F-S5c-2／ブリーフ テスト4）", () => {
  it("Post.media.imageUrlを持つriot Postから生成したArticleのthumbnailUrlに画像URLが反映される", async () => {
    const imageUrl = "https://www.leagueoflegends.com/og-image-patch-26-14.png";
    const post = await createPost({
      sourceType: "riot",
      title: "パッチ26.14ノート公開",
      body: "本パッチではジャングルモンスターの経験値量が引き下げられ、序盤のペースに変化が生まれた。",
      sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/patch-26-14-notes/",
      media: { imageUrl },
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    const result = summary.results.find((r) => r.postId === post.id);
    expect(result?.status).toBe("success");

    const article = await prisma.article.findUnique({ where: { postId: post.id } });
    expect(article?.thumbnailUrl).toBe(imageUrl);
  });
});
