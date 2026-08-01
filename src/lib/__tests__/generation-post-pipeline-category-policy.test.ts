/**
 * generateArticlesFromHotPosts（既定の生成経路）における、カテゴリ別公開ポリシー
 * （admincms-S1 F3）の結合テスト。
 * テスト観点: ポリシー未設定(既定)ならstatus=review、autoPublish=trueならstatus=published、
 * 安全フィルタ不通過(held)はポリシーがautoPublish=trueでも優先されること。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateArticlesFromHotPosts } from "@/lib/generation/post-pipeline";
import { MockLLMClient } from "@/lib/generation/llm-client";
import type { SourceType } from "@/lib/collection/types";

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.categoryPublishPolicy.deleteMany();
}

beforeEach(async () => {
  await resetDb();
});

const llm = new MockLLMClient();
const T0 = new Date("2026-07-27T12:00:00.000Z");

let seq = 0;
async function createPost(opts: {
  sourceType: SourceType;
  title?: string;
  body?: string;
  sourceUrl?: string;
  category?: string;
  metrics: { score: number; commentCount: number; capturedAt: Date }[];
}) {
  seq += 1;
  const externalId = `cat-policy-ext-${seq}`;
  const post = await prisma.post.create({
    data: {
      sourceType: opts.sourceType,
      externalId,
      title: opts.title ?? `タイトル${seq}`,
      body: opts.body ?? `1: 本文${seq}その1\n2: 本文${seq}その2`,
      url: opts.sourceUrl ?? `https://example.com/${opts.sourceType}/${externalId}`,
      postedAt: new Date(T0.getTime() - 2 * 60 * 60 * 1000),
      ...(opts.category ? { category: opts.category } : {}),
    },
  });
  for (const m of opts.metrics) {
    await prisma.postMetricsHistory.create({
      data: { postId: post.id, score: m.score, commentCount: m.commentCount, capturedAt: m.capturedAt },
    });
  }
  return post;
}

describe("generateArticlesFromHotPosts（カテゴリ別公開ポリシー、admincms-S1 F3）", () => {
  it("ポリシー未設定(既定=全カテゴリ要レビュー)なら、安全フィルタ通過済みでもstatus=reviewで保存される", async () => {
    const post = await createPost({
      sourceType: "5ch",
      category: "5chの反応",
      metrics: [{ score: 0, commentCount: 50, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    const result = summary.results.find((r) => r.postId === post.id);
    expect(result).toMatchObject({ status: "success", publicationStatus: "review" });

    const article = await prisma.article.findUniqueOrThrow({ where: { postId: post.id } });
    expect(article.status).toBe("review");
  });

  it("カテゴリのポリシーがautoPublish=trueなら、そのカテゴリの記事はstatus=publishedで保存される", async () => {
    await prisma.categoryPublishPolicy.create({ data: { category: "5chの反応", autoPublish: true } });
    const post = await createPost({
      sourceType: "5ch",
      category: "5chの反応",
      metrics: [{ score: 0, commentCount: 50, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    const result = summary.results.find((r) => r.postId === post.id);
    expect(result).toMatchObject({ status: "success", publicationStatus: "published" });

    const article = await prisma.article.findUniqueOrThrow({ where: { postId: post.id } });
    expect(article.status).toBe("published");
  });

  it("同じ実行で、autoPublish=trueなカテゴリはpublished・他カテゴリはreviewに分かれる", async () => {
    await prisma.categoryPublishPolicy.create({ data: { category: "パッチ/メタ", autoPublish: true } });
    const riotPost = await createPost({
      sourceType: "riot",
      category: "パッチ/メタ",
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });
    const fivechPost = await createPost({
      sourceType: "5ch",
      category: "5chの反応",
      metrics: [{ score: 0, commentCount: 50, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    const riotArticle = await prisma.article.findUniqueOrThrow({ where: { postId: riotPost.id } });
    const fivechArticle = await prisma.article.findUniqueOrThrow({ where: { postId: fivechPost.id } });
    expect(riotArticle.status).toBe("published");
    expect(fivechArticle.status).toBe("review");
    expect(summary.results.find((r) => r.postId === riotPost.id)).toMatchObject({ publicationStatus: "published" });
    expect(summary.results.find((r) => r.postId === fivechPost.id)).toMatchObject({ publicationStatus: "review" });
  });

  it("安全フィルタ不通過(重複)は、カテゴリがautoPublish=trueでも公開されずheldになる(held優先・要レビューにもならない)", async () => {
    await prisma.categoryPublishPolicy.create({ data: { category: "パッチ/メタ", autoPublish: true } });
    const riotTitle = "パッチ26.14ノート公開（admincms-S1 post-pipeline held優先テスト）";
    const riotContent = "本パッチではジャングルモンスターの経験値量が引き下げられ、序盤のペースに変化が生まれた。";
    const postA = await createPost({
      sourceType: "riot",
      title: riotTitle,
      body: riotContent,
      sourceUrl: "https://example.com/riot/post-held-priority-a",
      category: "パッチ/メタ",
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });
    const postB = await createPost({
      sourceType: "riot",
      title: riotTitle,
      body: riotContent,
      sourceUrl: "https://example.com/riot/post-held-priority-b",
      category: "パッチ/メタ",
      metrics: [{ score: 0, commentCount: 0, capturedAt: T0 }],
    });

    await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    const articleA = await prisma.article.findUniqueOrThrow({ where: { postId: postA.id } });
    const articleB = await prisma.article.findUniqueOrThrow({ where: { postId: postB.id } });
    const statuses = [articleA.status, articleB.status].sort();
    expect(statuses).toEqual(["held", "published"]);
    const heldArticle = [articleA, articleB].find((a) => a.status === "held");
    expect(heldArticle?.heldReason).toBe("duplicate");
  });

  it("要レビュー(review)記事は同一実行内の重複判定プールに入らない（後続の同内容記事がheld(duplicate)で失われない・admincms-S1 code-review修正）", async () => {
    // ポリシー未設定＝両ポストとも要レビュー(review)カテゴリ。同一内容だが、reviewはプールに
    // 入らないため2件目が重複で弾かれず、両方ともreviewとして作られる（却下時の記事ロス防止）。
    const title = "同内容の要レビュー記事（プール除外テスト）";
    const body = "1: まったく同じ本文その1\n2: まったく同じ本文その2";
    const postA = await createPost({
      sourceType: "5ch",
      title,
      body,
      sourceUrl: "https://example.com/5ch/review-dedup-a",
      category: "5chの反応",
      metrics: [{ score: 0, commentCount: 50, capturedAt: T0 }],
    });
    const postB = await createPost({
      sourceType: "5ch",
      title,
      body,
      sourceUrl: "https://example.com/5ch/review-dedup-b",
      category: "5chの反応",
      metrics: [{ score: 0, commentCount: 50, capturedAt: T0 }],
    });

    await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    const articleA = await prisma.article.findUniqueOrThrow({ where: { postId: postA.id } });
    const articleB = await prisma.article.findUniqueOrThrow({ where: { postId: postB.id } });
    expect(articleA.status).toBe("review");
    expect(articleB.status).toBe("review");
    expect([articleA.heldReason, articleB.heldReason]).toEqual([null, null]);
  });
});
