/**
 * 運営CMS（拡張E7）記事管理ロジックの結合テスト。専用テストDBに実際に書き込み、
 * 承認/却下によるstatus遷移・編集時の安全フィルタ再チェック・ピン留め優先表示・予約公開設定・
 * 未認証呼び出しの拒否・公開限定クエリがheld/scheduled/rejectedを除外することを検証する。
 */
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  approveHeldArticle,
  rejectHeldArticle,
  updateArticleContent,
  toggleArticlePinned,
  scheduleArticlePublish,
  cancelScheduledPublish,
  getArticleForEdit,
  listReviewQueue,
  countReviewQueue,
  approveReviewArticle,
  rejectReviewArticle,
} from "@/lib/admin/articles-admin";
import { UnauthorizedError } from "@/lib/auth/basic-auth";
import { listArticles, listPopularArticles, PUBLISHED_ONLY } from "@/lib/articles";
import type { AdminAuthContext } from "@/lib/admin/auth-context";

const UNAUTHORIZED: AdminAuthContext = { authorizationHeader: null };

async function resetDb() {
  await prisma.articleComment.deleteMany();
  await prisma.articleReaction.deleteMany();
  await prisma.articleView.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.collectedItem.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createArticle(overrides: Partial<Record<string, unknown>> = {}) {
  return prisma.article.create({
    data: {
      slug: (overrides.slug as string) ?? `article-${Math.random().toString(36).slice(2)}`,
      title: (overrides.title as string) ?? "テスト記事タイトル",
      category: "パッチ/メタ",
      body: (overrides.body as object) ?? [{ type: "paragraph", text: "本文" }],
      publishedAt: (overrides.publishedAt as Date) ?? new Date("2026-07-20T00:00:00+09:00"),
      status: (overrides.status as string) ?? "held",
      heldReason: (overrides.heldReason as string) ?? "ng_word",
      heldDetail: (overrides.heldDetail as string) ?? "NGワードを検出",
      pinned: (overrides.pinned as boolean) ?? false,
      scheduledAt: (overrides.scheduledAt as Date) ?? null,
      viewCount: (overrides.viewCount as number) ?? 0,
      sources: { create: [{ label: "reddit", url: "https://reddit.com/r/leagueoflegends/example" }] },
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

// テストで使う「認証済み」コンテキストを実際のBasic認証ヘッダーで作る（env設定→ヘッダー生成→検証まで一気通貫）。
function authorizedContext(): AdminAuthContext {
  const header = `Basic ${Buffer.from("test-admin:test-pass", "utf-8").toString("base64")}`;
  return { authorizationHeader: header };
}

describe("運営CMS 記事管理（認可ゲート含む）", () => {
  const originalAdminUser = process.env.ADMIN_USER;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    process.env.ADMIN_USER = "test-admin";
    process.env.ADMIN_PASSWORD = "test-pass";
  });

  afterAll(() => {
    process.env.ADMIN_USER = originalAdminUser;
    process.env.ADMIN_PASSWORD = originalAdminPassword;
  });

  it("未認証コンテキストではapproveHeldArticleがUnauthorizedErrorを投げ、DBを変更しない", async () => {
    const article = await createArticle({ status: "held" });
    await expect(approveHeldArticle(article.id, UNAUTHORIZED)).rejects.toThrow(UnauthorizedError);

    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.status).toBe("held");
  });

  it("認証済みでapproveHeldArticleを呼ぶと公開状態に遷移し、publishedAtが更新される", async () => {
    const article = await createArticle({ status: "held", publishedAt: new Date("2020-01-01T00:00:00Z") });
    await approveHeldArticle(article.id, authorizedContext());

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.status).toBe("published");
    expect(updated.heldReason).toBeNull();
    expect(updated.publishedAt.getFullYear()).toBeGreaterThan(2020);

    const publicList = await listArticles(1, 20);
    expect(publicList.items.some((a) => a.slug === article.slug)).toBe(true);
  });

  it("rejectHeldArticleはstatus=rejectedにし、公開限定クエリから除外する", async () => {
    const article = await createArticle({ status: "held" });
    await rejectHeldArticle(article.id, authorizedContext());

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.status).toBe("rejected");

    const publicList = await listArticles(1, 20);
    expect(publicList.items.some((a) => a.slug === article.slug)).toBe(false);
  });

  it("未認証コンテキストではrejectHeldArticleも拒否される", async () => {
    const article = await createArticle({ status: "held" });
    await expect(rejectHeldArticle(article.id, UNAUTHORIZED)).rejects.toThrow(UnauthorizedError);
  });

  it("updateArticleContentは公開中記事のタイトル/本文を更新できる（不変条件を壊さない編集）", async () => {
    const article = await createArticle({
      status: "published",
      title: "旧タイトル",
      body: [{ type: "paragraph", text: "旧本文" }],
    });
    const newBody = JSON.stringify([{ type: "paragraph", text: "新しい本文です" }]);
    await updateArticleContent(article.id, { title: "新タイトル", bodyText: newBody }, authorizedContext());

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.title).toBe("新タイトル");
    expect(updated.status).toBe("published"); // 安全フィルタ通過なので公開のまま
  });

  it("updateArticleContentは編集後にNGワードを含む場合、公開中記事を保留(held)へ落とす（公開不変条件を維持）", async () => {
    const article = await createArticle({ status: "published", title: "元タイトル" });
    const ngBody = JSON.stringify([{ type: "paragraph", text: "死ね" }]);
    await updateArticleContent(article.id, { title: "編集後タイトル", bodyText: ngBody }, authorizedContext());

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.status).toBe("held");
    expect(updated.heldReason).toBe("ng_word");

    const publicList = await listArticles(1, 20);
    expect(publicList.items.some((a) => a.slug === article.slug)).toBe(false);
  });

  it("updateArticleContentは不正なJSON本文を保存せず例外を投げる", async () => {
    const article = await createArticle({ status: "published" });
    await expect(
      updateArticleContent(article.id, { title: "x", bodyText: "not json" }, authorizedContext()),
    ).rejects.toThrow();

    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).not.toBe("x");
  });

  it("toggleArticlePinnedでピン留めされた記事は、公開が古くても一覧・注目枠の先頭に来る", async () => {
    const old = await createArticle({
      status: "published",
      slug: "old-article",
      publishedAt: new Date("2020-01-01T00:00:00Z"),
      pinned: false,
    });
    const recent = await createArticle({
      status: "published",
      slug: "recent-article",
      publishedAt: new Date("2026-07-24T00:00:00Z"),
      viewCount: 0,
    });
    await toggleArticlePinned(old.id, true, authorizedContext());

    const list = await listArticles(1, 20);
    expect(list.items[0].slug).toBe("old-article");
    expect(list.items[1].slug).toBe(recent.slug);

    const popular = await listPopularArticles(10);
    expect(popular[0].slug).toBe("old-article");
  });

  it("scheduleArticlePublishはstatus=scheduledにし、時刻到来まで公開限定クエリから除外する", async () => {
    const article = await createArticle({ status: "held" });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await scheduleArticlePublish(article.id, future, authorizedContext());

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.status).toBe("scheduled");
    expect(updated.scheduledAt?.getTime()).toBe(future.getTime());

    const count = await prisma.article.count({ where: { id: article.id, ...PUBLISHED_ONLY } });
    expect(count).toBe(0);
  });

  it("cancelScheduledPublishは予約を解除し保留(held)へ戻す", async () => {
    const article = await createArticle({ status: "held" });
    await scheduleArticlePublish(article.id, new Date(Date.now() + 60_000), authorizedContext());
    await cancelScheduledPublish(article.id, authorizedContext());

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.status).toBe("held");
    expect(updated.scheduledAt).toBeNull();
  });

  it("未認証コンテキストではscheduleArticlePublish/toggleArticlePinnedも拒否される", async () => {
    const article = await createArticle({ status: "held" });
    await expect(scheduleArticlePublish(article.id, new Date(), UNAUTHORIZED)).rejects.toThrow(UnauthorizedError);
    await expect(toggleArticlePinned(article.id, true, UNAUTHORIZED)).rejects.toThrow(UnauthorizedError);
  });

  it("getArticleForEditはタイトルと整形済み本文JSONを返し、存在しないIDはnullを返す", async () => {
    const article = await createArticle({ title: "編集対象", body: [{ type: "paragraph", text: "本文テキスト" }] });
    const editData = await getArticleForEdit(article.id);
    expect(editData?.title).toBe("編集対象");
    expect(JSON.parse(editData!.bodyText)).toEqual([{ type: "paragraph", text: "本文テキスト" }]);

    expect(await getArticleForEdit("nonexistent-id")).toBeNull();
  });

  it("公開限定クエリ(PUBLISHED_ONLY)はheld/scheduled/rejected/reviewをすべて除外する", async () => {
    await createArticle({ slug: "s-held", status: "held" });
    await createArticle({ slug: "s-scheduled", status: "scheduled", scheduledAt: new Date(Date.now() + 3600_000) });
    await createArticle({ slug: "s-rejected", status: "rejected" });
    await createArticle({ slug: "s-review", status: "review" });
    await createArticle({ slug: "s-published", status: "published" });

    const list = await listArticles(1, 20);
    expect(list.items.map((a) => a.slug)).toEqual(["s-published"]);
  });
});

describe("レビューキュー（admincms-S1 F2、要レビュー状態の承認/却下）", () => {
  const originalAdminUser = process.env.ADMIN_USER;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    process.env.ADMIN_USER = "test-admin";
    process.env.ADMIN_PASSWORD = "test-pass";
  });

  afterAll(() => {
    process.env.ADMIN_USER = originalAdminUser;
    process.env.ADMIN_PASSWORD = originalAdminPassword;
  });

  it("listReviewQueueはstatus=reviewの記事のみを新しい順(createdAt)で返し、出典URLを含める", async () => {
    // createArticleヘルパーはcreatedAtを明示指定できない(@default(now())のため)ため、
    // 順序を決定論的に検証するにはこのテストだけ直接prisma.article.createでcreatedAtを指定する。
    const older = await prisma.article.create({
      data: {
        slug: "review-old",
        title: "古い要レビュー記事",
        category: "パッチ/メタ",
        body: [{ type: "paragraph", text: "本文" }],
        publishedAt: new Date("2026-07-20T00:00:00+09:00"),
        createdAt: new Date("2026-07-20T00:00:00+09:00"),
        status: "review",
        sources: { create: [{ label: "reddit", url: "https://reddit.com/r/leagueoflegends/example" }] },
      },
    });
    const newer = await prisma.article.create({
      data: {
        slug: "review-new",
        title: "新しい要レビュー記事",
        category: "パッチ/メタ",
        body: [{ type: "paragraph", text: "本文" }],
        publishedAt: new Date("2026-07-21T00:00:00+09:00"),
        createdAt: new Date("2026-07-21T00:00:00+09:00"),
        status: "review",
        sources: { create: [{ label: "reddit", url: "https://reddit.com/r/leagueoflegends/newer" }] },
      },
    });
    await createArticle({ slug: "not-review", status: "held" });
    void older;

    const queue = await listReviewQueue();
    expect(queue.map((a) => a.slug)).toEqual(["review-new", "review-old"]);
    expect(queue.find((a) => a.id === newer.id)?.sourceUrl).toBe(
      "https://reddit.com/r/leagueoflegends/newer",
    );
  });

  it("レビューキューが0件のときは空配列、countReviewQueueは0を返す", async () => {
    expect(await listReviewQueue()).toEqual([]);
    expect(await countReviewQueue()).toBe(0);
  });

  it("approveReviewArticleはstatus=reviewの記事のみpublishedへ遷移でき、未レビュー件数が減る", async () => {
    const article = await createArticle({ slug: "to-approve", status: "review" });
    expect(await countReviewQueue()).toBe(1);

    await approveReviewArticle(article.id, authorizedContext());

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.status).toBe("published");
    expect(await countReviewQueue()).toBe(0);

    const publicList = await listArticles(1, 20);
    expect(publicList.items.some((a) => a.slug === article.slug)).toBe(true);
  });

  it("rejectReviewArticleはstatus=reviewの記事のみrejectedへ遷移でき、公開限定クエリから除外される", async () => {
    const article = await createArticle({ slug: "to-reject", status: "review" });
    await rejectReviewArticle(article.id, authorizedContext());

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.status).toBe("rejected");

    const publicList = await listArticles(1, 20);
    expect(publicList.items.some((a) => a.slug === article.slug)).toBe(false);
  });

  it("approveReviewArticle/rejectReviewArticleはstatus=review以外の記事には不正な遷移として拒否し、状態を変えない", async () => {
    const heldArticle = await createArticle({ slug: "not-review-for-approve", status: "held" });
    await expect(approveReviewArticle(heldArticle.id, authorizedContext())).rejects.toThrow();
    const unchanged1 = await prisma.article.findUniqueOrThrow({ where: { id: heldArticle.id } });
    expect(unchanged1.status).toBe("held");

    const publishedArticle = await createArticle({ slug: "not-review-for-reject", status: "published" });
    await expect(rejectReviewArticle(publishedArticle.id, authorizedContext())).rejects.toThrow();
    const unchanged2 = await prisma.article.findUniqueOrThrow({ where: { id: publishedArticle.id } });
    expect(unchanged2.status).toBe("published");
  });

  it("未認証コンテキストではapproveReviewArticle/rejectReviewArticleが拒否され、DBを変更しない", async () => {
    const article = await createArticle({ slug: "review-unauth", status: "review" });
    await expect(approveReviewArticle(article.id, UNAUTHORIZED)).rejects.toThrow(UnauthorizedError);
    await expect(rejectReviewArticle(article.id, UNAUTHORIZED)).rejects.toThrow(UnauthorizedError);

    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.status).toBe("review");
  });
});
