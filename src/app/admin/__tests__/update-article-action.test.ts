/**
 * admincms-S3補完: `updateArticleAction`（構造化エディタの保存アクション）が、検証NGの入力に対して
 * redirectせず`{success:false, error}`を返し、記事を一切変更しないことを検証する（入力中の他の編集
 * 内容を画面から失わせないための挙動変更、コーディネーターからのフィードバック対応）。
 * `next/headers`（リクエストスコープ必須のAPI）はVitest実行環境では使えないため、認可ヘッダーを
 * 固定値で返すようにモックする（他のlib層テストと同じBasic認証資格情報を使う）。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateArticleAction } from "@/app/admin/actions";

const AUTH_HEADER = `Basic ${Buffer.from("test-admin:test-pass", "utf-8").toString("base64")}`;

// vi.mockはファイル内で自動的にトップへhoistされるため、上のimport文より後に書いても
// `@/app/admin/actions`が読み込む`next/headers`等はこのモック実装で解決される。
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => (key.toLowerCase() === "authorization" ? AUTH_HEADER : null),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

async function resetDb() {
  await prisma.articleTag.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createArticle() {
  return prisma.article.create({
    data: {
      slug: `article-${Math.random().toString(36).slice(2)}`,
      title: "元タイトル",
      category: "パッチ/メタ",
      body: [{ type: "paragraph", text: "元本文" }],
      publishedAt: new Date("2026-07-20T00:00:00+09:00"),
      status: "published",
    },
  });
}

function baseFormData(articleId: string, blocksJson: string): FormData {
  const fd = new FormData();
  fd.set("articleId", articleId);
  fd.set("title", "編集後タイトル");
  fd.set("category", "パッチ/メタ");
  fd.set("metaDescription", "");
  fd.set("thumbnailUrl", "");
  fd.set("tagsJson", "[]");
  fd.set("blocksJson", blocksJson);
  return fd;
}

describe("updateArticleAction（構造化エディタの保存アクション、admincms-S3補完）", () => {
  const originalAdminUser = process.env.ADMIN_USER;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  beforeEach(async () => {
    await resetDb();
    process.env.ADMIN_USER = "test-admin";
    process.env.ADMIN_PASSWORD = "test-pass";
  });

  afterAll(() => {
    process.env.ADMIN_USER = originalAdminUser;
    process.env.ADMIN_PASSWORD = originalAdminPassword;
  });

  it("ブロック0件は{success:false}を返し、記事を変更しない（redirectしない）", async () => {
    const article = await createArticle();
    const result = await updateArticleAction(null, baseFormData(article.id, JSON.stringify([])));

    expect(result).toEqual({ success: false, error: expect.stringContaining("ブロックの配列（1件以上）") });
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).toBe("元タイトル");
  });

  it("レスの本文行が空だと、どのブロックのlinesかが分かるエラーを返し、記事を変更しない", async () => {
    const article = await createArticle();
    const drafts = [
      {
        type: "reaction",
        number: "1",
        name: "名無し",
        lines: [{ text: "", emphasis: "", original: "" }],
        anchors: "",
        emphasis: false,
        emphasisColor: "",
      },
    ];
    const result = await updateArticleAction(null, baseFormData(article.id, JSON.stringify(drafts)));

    expect(result).toEqual({ success: false, error: expect.stringContaining("lines[0]のtextが空") });
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).toBe("元タイトル");
  });

  it("存在しないアンカー番号は、どのブロックかが分かるエラーを返し、記事を変更しない", async () => {
    const article = await createArticle();
    const drafts = [
      {
        type: "reaction",
        number: "1",
        name: "A",
        lines: [{ text: "本文", emphasis: "", original: "" }],
        anchors: "",
        emphasis: false,
        emphasisColor: "",
      },
      {
        type: "reaction",
        number: "2",
        name: "B",
        lines: [{ text: "本文2", emphasis: "", original: "" }],
        anchors: "99",
        emphasis: false,
        emphasisColor: "",
      },
    ];
    const result = await updateArticleAction(null, baseFormData(article.id, JSON.stringify(drafts)));

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("本文ブロック[1]のanchorsに存在しないレス番号があります: 99"),
    });
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).toBe("元タイトル");
  });

  it("reddit以外のURLは拒否され、記事を変更しない", async () => {
    const article = await createArticle();
    const drafts = [{ type: "redditSource", title: "タイトル", author: "", subreddit: "", url: "https://example.com/x" }];
    const result = await updateArticleAction(null, baseFormData(article.id, JSON.stringify(drafts)));

    expect(result).toEqual({ success: false, error: expect.stringContaining("redditSource url") });
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).toBe("元タイトル");
  });

  it("ホワイトリスト外の埋め込みURLは拒否され、記事を変更しない", async () => {
    const article = await createArticle();
    const drafts = [{ type: "embed", provider: "youtube", url: "https://evil.example.com/watch?v=abcdefghijk", caption: "" }];
    const result = await updateArticleAction(null, baseFormData(article.id, JSON.stringify(drafts)));

    expect(result).toEqual({ success: false, error: expect.stringContaining("埋め込みurl") });
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).toBe("元タイトル");
  });

  it("フォームJSONが壊れている場合も{success:false}を返し、記事を変更しない", async () => {
    const article = await createArticle();
    const result = await updateArticleAction(null, baseFormData(article.id, "not json"));

    expect(result.success).toBe(false);
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).toBe("元タイトル");
  });

  it("有効な入力なら記事を更新し、成功時のみredirectする", async () => {
    const article = await createArticle();
    const drafts = [{ type: "paragraph", text: "新しい本文" }];

    await expect(
      updateArticleAction(null, baseFormData(article.id, JSON.stringify(drafts))),
    ).rejects.toThrow("__REDIRECT__:/admin");

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.title).toBe("編集後タイトル");
    expect(updated.body).toEqual([{ type: "paragraph", text: "新しい本文" }]);
  });
});
