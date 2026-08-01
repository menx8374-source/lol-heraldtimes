/**
 * generateArticlesFromHotPosts のX（旧Twitter、成長G7）向けE2E結合テスト。
 * 専用テストDB（vitest.global-setup.ts でDATABASE_URLを差し替え済み）に対して実際にPrisma経由で
 * 書き込み、「x由来のPost（score/commentCount/author）→Hotness（論争度含む）判定→記事化
 * （カテゴリ『Xの反応』・tweet埋め込み or 引用＋出典）→moderation通過→公開」までのE2Eを検証する。
 * 発見・記事化判定にAIは使わない（min_faves相当のscore/commentCountとHotnessEvaluatorの数値ルールのみ）。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateArticlesFromHotPosts } from "@/lib/generation/post-pipeline";
import { MockLLMClient } from "@/lib/generation/llm-client";
import { CATEGORY_LABELS } from "@/lib/categories";

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  // admincms-S1: このファイルはX(旧Twitter)経路のE2E検証が目的のため、既定「全カテゴリ要レビュー」に
  // よる回帰を避けるべく全カテゴリを自動公開にしておく。
  await prisma.categoryPublishPolicy.deleteMany();
  await prisma.categoryPublishPolicy.createMany({
    data: CATEGORY_LABELS.map((category) => ({ category, autoPublish: true })),
  });
}

beforeEach(async () => {
  await resetDb();
});

const llm = new MockLLMClient();
const T0 = new Date("2026-07-27T12:00:00.000Z");
const hours = (n: number) => n * 60 * 60 * 1000;

let seq = 0;
async function createXPost(opts: {
  title?: string;
  body?: string;
  sourceUrl?: string;
  author?: string;
  metrics: { score: number; commentCount: number; capturedAt: Date }[];
}) {
  seq += 1;
  const externalId = `x-ext-${seq}`;
  const post = await prisma.post.create({
    data: {
      sourceType: "x",
      externalId,
      title: opts.title ?? `Xタイトル${seq}`,
      body: opts.body ?? `今日のLJLの試合が本当に面白かった${seq}。序盤から目が離せなかった。`,
      url: opts.sourceUrl ?? `https://x.com/lol_jp_fan/status/181000000000000${seq}`,
      author: opts.author ?? "lol_jp_fan",
      postedAt: new Date(T0.getTime() - hours(2)),
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

describe("generateArticlesFromHotPosts（x由来PostのE2E、成長G7）", () => {
  it("hot判定されたx Postがカテゴリ『Xの反応』の記事として公開され、tweet埋め込みブロックを含む", async () => {
    // xのhotness既定(reddit相当): minScore=100・minComments=30。
    const hotPost = await createXPost({
      metrics: [{ score: 320, commentCount: 48, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]).toMatchObject({ postId: hotPost.id, status: "success" });

    const article = await prisma.article.findUnique({ where: { postId: hotPost.id } });
    expect(article).not.toBeNull();
    expect(article!.category).toBe("Xの反応");
    expect(article!.status).toBe("published");

    const body = article!.body as { type: string; provider?: string; url?: string }[];
    expect(body.some((b) => b.type === "heading")).toBe(true);
    const embed = body.find((b) => b.type === "embed");
    expect(embed).toMatchObject({ type: "embed", provider: "twitter", url: hotPost.url });
  });

  it("非hot（score/commentCountが閾値未満）のx Postは記事化されない", async () => {
    await createXPost({
      metrics: [{ score: 5, commentCount: 1, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    expect(summary.results).toHaveLength(0);
  });

  it("tweet status URLでない場合は引用＋出典（作者名）ブロックになる（著作権の主従・出典明記）", async () => {
    const hotPost = await createXPost({
      sourceUrl: "https://x.com/lol_jp_fan", // status URLではない(プロフィールURL相当)
      author: "lol_jp_fan",
      metrics: [{ score: 400, commentCount: 60, capturedAt: T0 }],
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    expect(summary.results[0]).toMatchObject({ postId: hotPost.id, status: "success" });

    const article = await prisma.article.findUnique({ where: { postId: hotPost.id } });
    const body = article!.body as { type: string; source?: string }[];
    expect(body.some((b) => b.type === "embed")).toBe(false);
    const quote = body.find((b) => b.type === "quote");
    expect(quote).toMatchObject({ type: "quote", source: "Xの反応（lol_jp_fan）" });
  });

  it("moderation（NGワード）を通らないx投稿は保留(held)になり公開されない", async () => {
    const hotPost = await createXPost({
      title: "死ねと思うくらい酷い試合だった",
      body: "死ねと思うくらい酷い試合だった。もう見てられない。",
      metrics: [{ score: 500, commentCount: 80, capturedAt: T0 }],
    });

    await generateArticlesFromHotPosts(llm, { now: T0, championMap: null });
    const article = await prisma.article.findUnique({ where: { postId: hotPost.id } });
    expect(article!.status).toBe("held");
    expect(article!.heldReason).toBe("ng_word");
  });
});
