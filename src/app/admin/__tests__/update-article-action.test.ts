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

  it("目次(toc)に記事内に存在しないアンカーを指定すると{success:false}を返し、記事を変更しない（admincms-S4）", async () => {
    const article = await createArticle();
    const drafts = [
      { type: "heading", text: "見出し", anchor: "sec-1" },
      { type: "toc", items: [{ label: "存在しない章", anchor: "sec-999" }] },
    ];
    const result = await updateArticleAction(null, baseFormData(article.id, JSON.stringify(drafts)));

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("toc itemsに存在しないアンカーがあります: sec-999"),
    });
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).toBe("元タイトル");
  });

  it("画像のaltが空だと{success:false}を返し、記事を変更しない（admincms-S4）", async () => {
    const article = await createArticle();
    const drafts = [{ type: "image", url: "https://example.com/a.png", alt: "", credit: "" }];
    const result = await updateArticleAction(null, baseFormData(article.id, JSON.stringify(drafts)));

    expect(result).toEqual({ success: false, error: expect.stringContaining("画像altが空") });
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).toBe("元タイトル");
  });

  it("リンクボタンのurlが非httpsだと{success:false}を返し、記事を変更しない（admincms-S4）", async () => {
    const article = await createArticle();
    const drafts = [{ type: "linkButton", url: "http://example.com/notes", label: "公式サイト" }];
    const result = await updateArticleAction(null, baseFormData(article.id, JSON.stringify(drafts)));

    expect(result).toEqual({ success: false, error: expect.stringContaining("linkButton url") });
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).toBe("元タイトル");
  });

  it("パッチ変更の数値変更が欠落していると{success:false}を返し、記事を変更しない（admincms-S4）", async () => {
    const article = await createArticle();
    const drafts = [
      {
        type: "patchChange",
        targetName: "コーキ",
        targetIconUrl: "",
        targetKind: "champion",
        direction: "buff",
        intent: "",
        groups: [
          {
            abilityKey: "",
            abilityName: "",
            abilityIconUrl: "",
            changes: [{ kind: "numeric", stat: "攻撃力", before: "", after: "2.5", text: "" }],
          },
        ],
      },
    ];
    const result = await updateArticleAction(null, baseFormData(article.id, JSON.stringify(drafts)));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/groups\[0\]のchanges\[0\]/);
    }
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.title).toBe("元タイトル");
  });

  it("パッチ記事を無変更で保存すると、パッチ変更表・目次・バナー画像・公式リンクボタンの内容が一切変化しない（admincms-S4 往復同一性）", async () => {
    const patchBody: unknown[] = [
      { type: "image", url: "https://example.com/patch-banner.png", alt: "パッチ14.1バナー", credit: "Riot Games" },
      { type: "heading", text: "主な強化", anchor: "sec-buff" },
      { type: "toc", items: [{ label: "主な強化", anchor: "sec-buff" }] },
      {
        type: "patchChange",
        targetName: "コーキ",
        targetIconUrl: "https://ddragon.leagueoflegends.com/cdn/img/champion/Corki.png",
        targetKind: "champion",
        direction: "buff",
        intent: "試合終盤のコーキの出撃時の火力を少し高めました。",
        groups: [
          { abilityKey: "base", changes: [{ stat: "レベルアップごとの攻撃力", before: "2", after: "2.5" }] },
          {
            abilityKey: "R",
            abilityName: "R - 連発ミサイル",
            changes: [
              { stat: "リチャージ時間短縮量", before: "2秒～4秒", after: "2秒～6秒" },
              { text: "R使用中に移動できるようになりました。" },
            ],
          },
        ],
      },
      { type: "linkButton", url: "https://www.leagueoflegends.com/patch-notes/", label: "公式パッチノートを見る" },
    ];
    const article = await prisma.article.create({
      data: {
        slug: `patch-article-${Math.random().toString(36).slice(2)}`,
        title: "パッチ14.1ノート",
        category: "パッチ/メタ",
        body: patchBody as never,
        publishedAt: new Date("2026-07-20T00:00:00+09:00"),
        status: "published",
      },
    });

    // getArticleForEditと同じ経路（DB検証済みブロック→blockToDraft）でフォーム初期値を組み立て、
    // 無編集のままblocksJsonとして送信する（実際のエディタが行う往復と同じ形）。
    const { getArticleForEdit } = await import("@/lib/admin/articles-admin");
    const { blockToDraft } = await import("@/lib/admin/article-editor-form");
    const editData = await getArticleForEdit(article.id);
    if (!editData) throw new Error("記事が見つかりません");
    const drafts = editData.body.map(blockToDraft);

    const fd = new FormData();
    fd.set("articleId", article.id);
    fd.set("title", editData.title);
    fd.set("category", editData.category);
    fd.set("metaDescription", editData.metaDescription);
    fd.set("thumbnailUrl", editData.thumbnailUrl);
    fd.set("tagsJson", JSON.stringify(editData.tags));
    fd.set("blocksJson", JSON.stringify(drafts));

    await expect(updateArticleAction(null, fd)).rejects.toThrow("__REDIRECT__:/admin");

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.body).toEqual(patchBody);
  });
});
