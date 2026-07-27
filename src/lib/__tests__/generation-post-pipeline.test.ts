/**
 * generateArticlesFromHotPosts（リファクタリングS5a F-S5a-1）の結合テスト（ブリーフ テスト1〜3）。
 * 専用テストDB（vitest.global-setup.ts でDATABASE_URLを差し替え済み）に対して実際にPrisma経由で
 * 書き込み、「hot判定による母数絞り・既記事化スキップ(1投稿1回)」「カテゴリ別上限・hotness降順選択」
 * 「postId紐付け・moderation held・1件失敗でも他継続」を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateArticlesFromHotPosts } from "@/lib/generation/post-pipeline";
import { MockLLMClient } from "@/lib/generation/llm-client";
import type { SourceType } from "@/lib/collection/types";

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.article.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
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
