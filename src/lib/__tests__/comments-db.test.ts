/**
 * コメント投稿・一覧取得（拡張E2）のDB結合テスト。専用テストDBに実際に記事を投入し、
 * 採番・NGワード/中傷によるheld・commentCount加算・新着コメント取得を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createComment,
  listPublishedCommentsBySlug,
  listRecentComments,
} from "@/lib/comments-db";
import { POST } from "@/app/api/articles/[slug]/comments/route";

async function resetDb() {
  await prisma.articleComment.deleteMany();
  await prisma.articleReaction.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createArticle(overrides: Partial<{ slug: string; status: string; commentCount: number }> = {}) {
  return prisma.article.create({
    data: {
      slug: overrides.slug ?? "comment-target",
      title: "コメント対象記事",
      category: "パッチ/メタ",
      body: [{ type: "paragraph", text: "本文" }],
      publishedAt: new Date("2026-07-20T00:00:00+09:00"),
      status: overrides.status ?? "published",
      commentCount: overrides.commentCount ?? 0,
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("createComment（コメント投稿, 拡張E2）", () => {
  it("安全なコメントはpublishedになり、番号1から採番されArticle.commentCountが加算される", async () => {
    const article = await createArticle();

    const result1 = await createComment(article.id, { name: "太郎", body: "同意です" });
    expect(result1).toMatchObject({ outcome: "published", comment: { number: 1, name: "太郎", body: "同意です" } });

    const result2 = await createComment(article.id, { body: "自分もそう思う" });
    expect(result2).toMatchObject({ outcome: "published", comment: { number: 2 } });

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.commentCount).toBe(2);
  });

  it("名前未入力は既定名「名無しさん」になる", async () => {
    const article = await createArticle();
    const result = await createComment(article.id, { body: "名前を入力しなかった" });
    expect(result).toMatchObject({ outcome: "published", comment: { name: "名無しさん" } });
  });

  it("NGワードを含むコメントはheldになり、DBには残るが公開一覧には出ずcommentCountも増えない", async () => {
    const article = await createArticle();
    const result = await createComment(article.id, { body: "このチャンピオンはカスだと思う" });
    expect(result).toEqual({ outcome: "held" });

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.commentCount).toBe(0);

    const heldRow = await prisma.articleComment.findFirstOrThrow({ where: { articleId: article.id } });
    expect(heldRow.status).toBe("held");
    expect(heldRow.heldReason).toBe("ng_word");

    const publishedList = await listPublishedCommentsBySlug(article.slug);
    expect(publishedList).toEqual([]);
  });

  it("個人中傷を含むコメントはheldになる", async () => {
    const article = await createArticle();
    const result = await createComment(article.id, { body: "田中選手は本当に無能だと思う" });
    expect(result).toEqual({ outcome: "held" });
  });

  it("本文が空の投稿はvalidationエラーで拒否され、DBに保存されない", async () => {
    const article = await createArticle();
    const result = await createComment(article.id, { body: "   " });
    expect(result).toEqual({ outcome: "rejected", reason: "validation", error: "empty_body" });

    const count = await prisma.articleComment.count({ where: { articleId: article.id } });
    expect(count).toBe(0);
  });

  it("ハニーポットが埋まっている投稿はspamとして拒否され、保存されない", async () => {
    const article = await createArticle();
    const result = await createComment(article.id, { body: "こんにちは", honeypot: "http://spam.example.com" });
    expect(result).toEqual({ outcome: "rejected", reason: "spam" });

    const count = await prisma.articleComment.count({ where: { articleId: article.id } });
    expect(count).toBe(0);
  });

  it("直前と同一本文の短時間連投はspamとして拒否される", async () => {
    const article = await createArticle();
    const first = await createComment(article.id, { body: "連投テスト" });
    expect(first.outcome).toBe("published");

    const second = await createComment(article.id, { body: "連投テスト" });
    expect(second).toEqual({ outcome: "rejected", reason: "spam" });

    const count = await prisma.articleComment.count({ where: { articleId: article.id } });
    expect(count).toBe(1);
  });

  it("本文から>>Nアンカーを抽出しDBに保存する", async () => {
    const article = await createArticle();
    await createComment(article.id, { body: "最初のコメント" });
    const result = await createComment(article.id, { body: ">>1\n同意です" });
    expect(result).toMatchObject({ outcome: "published", comment: { anchors: [1] } });
  });

  it("並行投稿でも番号が重複しない（articleId,numberのunique制約下で採番される）", async () => {
    const article = await createArticle();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createComment(article.id, { body: `並行投稿${i}` })),
    );
    const numbers = results
      .filter((r) => r.outcome === "published")
      .map((r) => (r as Extract<typeof r, { outcome: "published" }>).comment.number)
      .sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("listRecentComments（新着コメントウィジェット, 拡張E2）", () => {
  it("公開記事の公開コメントのみを新しい順に返す", async () => {
    const published = await createArticle({ slug: "published-article" });
    const held = await createArticle({ slug: "held-article", status: "held" });

    await createComment(published.id, { body: "1件目のコメント" });
    await createComment(published.id, { body: "2件目のコメント" });
    // 保留記事へのコメントは直接投入（createCommentは保留記事に対して呼ばれない実装のため、
    // 「保留記事に紐づく公開コメントが万一存在しても露出しない」ことを確認する目的で直接insertする）。
    await prisma.articleComment.create({
      data: { articleId: held.id, number: 1, name: "名無しさん", body: "保留記事へのコメント", status: "published" },
    });

    const recent = await listRecentComments(5);
    expect(recent).toHaveLength(2);
    expect(recent.every((c) => c.articleTitle === "コメント対象記事")).toBe(true);
    expect(recent.some((c) => c.excerpt.includes("保留記事"))).toBe(false);
  });
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/articles/x/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("POST /api/articles/[slug]/comments（Route Handler, 拡張E2）", () => {
  it("公開記事への安全なコメントは201で作成される", async () => {
    await createArticle();
    const res = await POST(makeRequest({ name: "太郎", body: "同意です" }), makeParams("comment-target"));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe("published");
    expect(data.comment.number).toBe(1);
  });

  it("NGワードを含むコメントは422でheldメッセージを返し、詳細な保留理由は含まない", async () => {
    await createArticle();
    const res = await POST(
      makeRequest({ body: "このチャンピオンはカスだと思う" }),
      makeParams("comment-target"),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.status).toBe("held");
    expect(data.message).not.toContain("ng_word");
    expect(data.message).not.toContain("NGワード「カス」");
  });

  it("本文が空の投稿は400を返す", async () => {
    await createArticle();
    const res = await POST(makeRequest({ body: "" }), makeParams("comment-target"));
    expect(res.status).toBe(400);
  });

  it("不正なJSONボディは400を返す", async () => {
    await createArticle();
    const req = new Request("http://localhost/api/articles/x/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    const res = await POST(req, makeParams("comment-target"));
    expect(res.status).toBe(400);
  });

  it("保留中の記事へのコメントは404を返す", async () => {
    await createArticle({ slug: "held-target", status: "held" });
    const res = await POST(makeRequest({ body: "こんにちは" }), makeParams("held-target"));
    expect(res.status).toBe(404);
  });

  it("存在しない記事は404を返す", async () => {
    const res = await POST(makeRequest({ body: "こんにちは" }), makeParams("nonexistent-slug"));
    expect(res.status).toBe(404);
  });
});
