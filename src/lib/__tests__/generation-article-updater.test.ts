/**
 * updateHotArticles（リファクタリングS6 F-S6-3）の結合テスト（ブリーフ テスト4）。
 * 専用テストDB（vitest.global-setup.ts でDATABASE_URLを差し替え済み）に対して実際にPrisma経由で
 * 書き込み、「トリガしたPostのみ再AI更新・in-place更新(slug/id/postId/publishedAt不変)・
 * ArticleUpdateHistory追記」「非トリガ・riot・cooldown中・updateMaxCount到達はskip」
 * 「moderation不通過は更新しない」「maxPostsPerRun有界・sleep注入・1件失敗でも継続し例外を投げない」
 * を検証する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateHotArticles } from "@/lib/generation/article-updater";
import { MockLLMClient, type LLMClient, type LLMMessage } from "@/lib/generation/llm-client";
import { LLM_TITLE_SYSTEM_PROMPT } from "@/lib/generation/title";
import type { SourceAdapter, SourceType } from "@/lib/collection/types";

async function resetDb() {
  await prisma.articleUpdateHistory.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
}

beforeEach(async () => {
  await resetDb();
  delete process.env.HOTNESS_EXEMPT_SOURCE_TYPES;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const llm = new MockLLMClient();
const T0 = new Date("2026-07-27T12:00:00.000Z");
const hours = (n: number) => n * 3600000;

/** LLM_TITLE_SYSTEM_PROMPT向けの呼び出しだけ個人中傷を含むタイトルを返し、それ以外はMockLLMClientに
 * 委譲するスタブ（moderation不通過(personal_attack)を意図的に発生させるテスト用）。 */
class PersonalAttackTitleLLMClient implements LLMClient {
  private readonly mock = new MockLLMClient();
  async generate(messages: LLMMessage[]): Promise<string> {
    if (messages.some((m) => m.role === "system" && m.content === LLM_TITLE_SYSTEM_PROMPT)) {
      return "【速報】Fakerの無能采配が話題に";
    }
    return this.mock.generate(messages);
  }
}

let seq = 0;
type SetupOptions = {
  sourceType: SourceType;
  postedAt?: Date;
  articleCreatedAt?: Date;
  updateHistory?: { reason: string; updatedAt: Date }[];
  metrics: { score: number; commentCount: number; capturedAt: Date }[];
  monitoring?: boolean;
};

const CATEGORY_BY_SOURCE: Record<SourceType, string> = {
  "5ch": "5chの反応",
  reddit: "海外の反応",
  riot: "パッチ/メタ",
};

/** Post+Article(1対1)+PostMetricsHistory+(任意)ArticleUpdateHistoryをまとめて用意するヘルパ。 */
async function setupArticledPost(opts: SetupOptions) {
  seq += 1;
  const externalId = `ext-${seq}`;
  const post = await prisma.post.create({
    data: {
      sourceType: opts.sourceType,
      externalId,
      title: `旧タイトル${seq}`,
      body: `1: 旧本文${seq}その1\n2: 旧本文${seq}その2`,
      url: `https://example.com/${opts.sourceType}/${externalId}`,
      postedAt: opts.postedAt ?? new Date(T0.getTime() - hours(2)),
      monitoring: opts.monitoring ?? true,
    },
  });
  for (const m of opts.metrics) {
    await prisma.postMetricsHistory.create({
      data: { postId: post.id, score: m.score, commentCount: m.commentCount, capturedAt: m.capturedAt },
    });
  }
  const article = await prisma.article.create({
    data: {
      slug: `slug-${seq}`,
      title: `旧タイトル${seq}`,
      category: CATEGORY_BY_SOURCE[opts.sourceType],
      body: [{ type: "paragraph", text: "旧本文" }],
      publishedAt: T0,
      createdAt: opts.articleCreatedAt ?? new Date(T0.getTime() - hours(24)),
      postId: post.id,
    },
  });
  if (opts.updateHistory) {
    for (const h of opts.updateHistory) {
      await prisma.articleUpdateHistory.create({ data: { articleId: article.id, reason: h.reason, updatedAt: h.updatedAt } });
    }
  }
  return { post, article };
}

function fakeAdapter(sourceType: SourceType, fetchContent: SourceAdapter["fetchContent"]): SourceAdapter {
  return { sourceType, fetchItems: async () => [], fetchContent };
}

const FRESH_CONTENT = "1: Fresh OP body about the surge\n\n2: Fresh reply comment about the surge";

describe("updateHotArticles（リファクタリングS6 F-S6-3）", () => {
  it("Score大幅増でトリガしたPostのみ再AI更新され、既存Articleがin-place更新(slug/id/postId/publishedAt不変)されArticleUpdateHistoryに追記される", async () => {
    const { post, article } = await setupArticledPost({
      sourceType: "reddit",
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) }, // baseline(article.createdAt=T0-24hより前)
        { score: 300, commentCount: 20, capturedAt: T0 }, // current: scoreDelta=200>=100
      ],
    });

    const fetchContent = vi.fn(async () => ({ title: "Fresh Title After Surge", content: FRESH_CONTENT, imageUrl: null }));
    const result = await updateHotArticles({
      now: T0,
      llmClient: llm,
      adapters: { reddit: fakeAdapter("reddit", fetchContent) },
      sleep: async () => {},
      delayMs: 0,
    });

    expect(result).toEqual({ checked: 1, updated: 1, skipped: 0 });
    expect(fetchContent).toHaveBeenCalledWith(post.externalId);

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.slug).toBe(article.slug);
    expect(updated.id).toBe(article.id);
    expect(updated.postId).toBe(post.id);
    expect(updated.publishedAt).toEqual(article.publishedAt);
    expect(updated.title).not.toBe(article.title); // 新タイトルに更新されている

    const history = await prisma.articleUpdateHistory.findMany({ where: { articleId: article.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ reason: "score_surge" });
    expect(history[0].updatedAt).toEqual(T0);
  });

  it("5ch: コメント急増(score常時0)でトリガするとreason=comment_surgeで更新される", async () => {
    const { post, article } = await setupArticledPost({
      sourceType: "5ch",
      metrics: [
        { score: 0, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
        { score: 0, commentCount: 60, capturedAt: T0 }, // commentDelta=50>=30
      ],
    });

    const fetchContent = vi.fn(async () => ({ title: "Fresh 5ch Title", content: FRESH_CONTENT, imageUrl: null }));
    const result = await updateHotArticles({
      now: T0,
      llmClient: llm,
      adapters: { "5ch": fakeAdapter("5ch", fetchContent) },
      sleep: async () => {},
      delayMs: 0,
    });

    expect(result).toEqual({ checked: 1, updated: 1, skipped: 0 });
    const history = await prisma.articleUpdateHistory.findMany({ where: { articleId: article.id } });
    expect(history[0]).toMatchObject({ reason: "comment_surge" });
    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.postId).toBe(post.id);
  });

  it("Score/コメントとも増加量が閾値未満(非トリガ)ならskipされ、Articleは変更されない", async () => {
    const { article } = await setupArticledPost({
      sourceType: "reddit",
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
        { score: 120, commentCount: 15, capturedAt: T0 }, // scoreDelta=20,commentDelta=5、どちらも閾値未満
      ],
    });

    const fetchContent = vi.fn();
    const result = await updateHotArticles({
      now: T0,
      llmClient: llm,
      adapters: { reddit: fakeAdapter("reddit", fetchContent) },
      sleep: async () => {},
      delayMs: 0,
    });

    expect(result).toEqual({ checked: 1, updated: 0, skipped: 1 });
    expect(fetchContent).not.toHaveBeenCalled();
    const untouched = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(untouched.title).toBe(article.title);
    expect(await prisma.articleUpdateHistory.count({ where: { articleId: article.id } })).toBe(0);
  });

  it("免除ソース(riot、既定)は大幅な変化があってもそもそも対象にならない(checkedにも含まれない)", async () => {
    await setupArticledPost({
      sourceType: "riot",
      metrics: [
        { score: 0, commentCount: 0, capturedAt: new Date(T0.getTime() - hours(30)) },
        { score: 999, commentCount: 999, capturedAt: T0 },
      ],
    });

    const result = await updateHotArticles({ now: T0, llmClient: llm, adapters: {}, sleep: async () => {}, delayMs: 0 });
    expect(result).toEqual({ checked: 0, updated: 0, skipped: 0 });
  });

  it("cooldown未経過(記事作成から間もない)ならトリガ条件を満たしていてもskipされる", async () => {
    const { article } = await setupArticledPost({
      sourceType: "reddit",
      articleCreatedAt: new Date(T0.getTime() - hours(2)), // cooldown(既定6h)未経過
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(3)) },
        { score: 300, commentCount: 20, capturedAt: T0 },
      ],
    });

    const fetchContent = vi.fn();
    const result = await updateHotArticles({
      now: T0,
      llmClient: llm,
      adapters: { reddit: fakeAdapter("reddit", fetchContent) },
      sleep: async () => {},
      delayMs: 0,
    });

    expect(result).toEqual({ checked: 1, updated: 0, skipped: 1 });
    expect(fetchContent).not.toHaveBeenCalled();
    expect((await prisma.article.findUniqueOrThrow({ where: { id: article.id } })).title).toBe(article.title);
  });

  it("updateMaxCount(既定2)に達した記事はトリガ条件を満たしていてもskipされる", async () => {
    const { article } = await setupArticledPost({
      sourceType: "reddit",
      updateHistory: [
        { reason: "score_surge", updatedAt: new Date(T0.getTime() - hours(40)) },
        { reason: "comment_surge", updatedAt: new Date(T0.getTime() - hours(20)) }, // これでupdateCount=2=maxCount
      ],
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(21)) },
        { score: 500, commentCount: 100, capturedAt: T0 },
      ],
    });

    const fetchContent = vi.fn();
    const result = await updateHotArticles({
      now: T0,
      llmClient: llm,
      adapters: { reddit: fakeAdapter("reddit", fetchContent) },
      sleep: async () => {},
      delayMs: 0,
    });

    expect(result).toEqual({ checked: 1, updated: 0, skipped: 1 });
    expect(fetchContent).not.toHaveBeenCalled();
    expect(await prisma.articleUpdateHistory.count({ where: { articleId: article.id } })).toBe(2);
  });

  it("moderation不通過(personal_attack)の場合は更新せず、既存Articleを変更しない", async () => {
    const { article } = await setupArticledPost({
      sourceType: "reddit",
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
        { score: 300, commentCount: 20, capturedAt: T0 },
      ],
    });

    const fetchContent = vi.fn(async () => ({ title: "Fresh Title", content: FRESH_CONTENT, imageUrl: null }));
    const result = await updateHotArticles({
      now: T0,
      llmClient: new PersonalAttackTitleLLMClient(),
      adapters: { reddit: fakeAdapter("reddit", fetchContent) },
      sleep: async () => {},
      delayMs: 0,
    });

    expect(result).toEqual({ checked: 1, updated: 0, skipped: 1 });
    const untouched = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(untouched.title).toBe(article.title);
    expect(await prisma.articleUpdateHistory.count({ where: { articleId: article.id } })).toBe(0);
  });

  it("fetchContentがnullを返す(取得失敗)場合はskipされ、Articleは変更されない", async () => {
    const { article } = await setupArticledPost({
      sourceType: "reddit",
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
        { score: 300, commentCount: 20, capturedAt: T0 },
      ],
    });

    const result = await updateHotArticles({
      now: T0,
      llmClient: llm,
      adapters: { reddit: fakeAdapter("reddit", async () => null) },
      sleep: async () => {},
      delayMs: 0,
    });

    expect(result).toEqual({ checked: 1, updated: 0, skipped: 1 });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: article.id } })).title).toBe(article.title);
  });

  it("fetchContent未対応(adapter登録なし)の場合はskipされる(例外を投げない)", async () => {
    await setupArticledPost({
      sourceType: "reddit",
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
        { score: 300, commentCount: 20, capturedAt: T0 },
      ],
    });

    const result = await updateHotArticles({ now: T0, llmClient: llm, adapters: {}, sleep: async () => {}, delayMs: 0 });
    expect(result).toEqual({ checked: 1, updated: 0, skipped: 1 });
  });

  it("1件が生成失敗(空本文でreactionブロック0件)しても他は継続処理され、全体としても例外を投げない", async () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { post: failPost, article: failArticle } = await setupArticledPost({
      sourceType: "reddit",
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
        { score: 300, commentCount: 20, capturedAt: T0 },
      ],
    });
    const { article: okArticle } = await setupArticledPost({
      sourceType: "reddit",
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
        { score: 300, commentCount: 20, capturedAt: T0 },
      ],
    });

    const fetchContent = vi.fn(async (externalId: string) => {
      if (externalId === failPost.externalId) return { title: "Empty", content: "", imageUrl: null };
      return { title: "Fresh Title", content: FRESH_CONTENT, imageUrl: null };
    });

    await expect(
      updateHotArticles({
        now: T0,
        llmClient: llm,
        adapters: { reddit: fakeAdapter("reddit", fetchContent) },
        sleep: async () => {},
        delayMs: 0,
      }),
    ).resolves.toEqual({ checked: 2, updated: 1, skipped: 1 });
    expect(errorLogSpy).toHaveBeenCalled();

    const untouchedFail = await prisma.article.findUniqueOrThrow({ where: { id: failArticle.id } });
    expect(untouchedFail.title).toBe(failArticle.title);
    const updatedOk = await prisma.article.findUniqueOrThrow({ where: { id: okArticle.id } });
    expect(updatedOk.title).not.toBe(okArticle.title);
  });

  it("maxPostsPerRunで1回の実行で調べる件数が上限になる(有界)", async () => {
    for (let i = 0; i < 5; i++) {
      await setupArticledPost({
        sourceType: "reddit",
        metrics: [
          { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
          { score: 300, commentCount: 20, capturedAt: T0 },
        ],
      });
    }

    const fetchContent = vi.fn(async () => ({ title: "Fresh Title", content: FRESH_CONTENT, imageUrl: null }));
    const result = await updateHotArticles({
      now: T0,
      llmClient: llm,
      adapters: { reddit: fakeAdapter("reddit", fetchContent) },
      maxPostsPerRun: 2,
      sleep: async () => {},
      delayMs: 0,
    });

    expect(result.checked).toBe(2);
    expect(result.updated).toBe(2);
    expect(fetchContent).toHaveBeenCalledTimes(2);
  });

  it("連続fetch間でsleepが呼ばれる(delayMs:0+noop注入で実待機なし)", async () => {
    for (let i = 0; i < 3; i++) {
      await setupArticledPost({
        sourceType: "reddit",
        metrics: [
          { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
          { score: 300, commentCount: 20, capturedAt: T0 },
        ],
      });
    }

    const sleepMock = vi.fn(async () => {});
    const fetchContent = vi.fn(async () => ({ title: "Fresh Title", content: FRESH_CONTENT, imageUrl: null }));
    await updateHotArticles({
      now: T0,
      llmClient: llm,
      adapters: { reddit: fakeAdapter("reddit", fetchContent) },
      sleep: sleepMock,
      delayMs: 0,
    });

    // 3件トリガのうち最初はディレイ無し、以降2回sleepが呼ばれる。
    expect(sleepMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(0);
  });

  it("対象Postが1件も無い場合は0件で正常終了する(例外なし)", async () => {
    const result = await updateHotArticles({ now: T0, llmClient: llm, adapters: {}, sleep: async () => {}, delayMs: 0 });
    expect(result).toEqual({ checked: 0, updated: 0, skipped: 0 });
  });

  it("monitoring=falseのPostは対象にならない", async () => {
    await setupArticledPost({
      sourceType: "reddit",
      monitoring: false,
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
        { score: 300, commentCount: 20, capturedAt: T0 },
      ],
    });
    const result = await updateHotArticles({ now: T0, llmClient: llm, adapters: {}, sleep: async () => {}, delayMs: 0 });
    expect(result).toEqual({ checked: 0, updated: 0, skipped: 0 });
  });

  it("adapters省略時は例外を投げない(getAllAdapters()から構築、mockモード既定)", async () => {
    await setupArticledPost({
      sourceType: "reddit",
      metrics: [
        { score: 100, commentCount: 10, capturedAt: new Date(T0.getTime() - hours(30)) },
        { score: 300, commentCount: 20, capturedAt: T0 },
      ],
    });
    await expect(updateHotArticles({ now: T0, llmClient: llm, sleep: async () => {}, delayMs: 0 })).resolves.toBeDefined();
  });
});
