/**
 * コメント投稿・一覧取得（拡張E2）のDB結合テスト。専用テストDBに実際に記事を投入し、
 * 採番・NGワード/中傷によるheld・commentCount加算・新着コメント取得を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createComment,
  listPublishedCommentsBySlug,
  listFeaturedComments,
  voteOnComment,
} from "@/lib/comments-db";
import { POST } from "@/app/api/articles/[slug]/comments/route";
import { POST as votePOST } from "@/app/api/articles/[slug]/comments/[number]/vote/route";

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

describe("createComment（返信スレッド, 拡張E8）", () => {
  it("parentNumberを指定すると返信として保存され、listPublishedCommentsBySlugでネストして返る", async () => {
    const article = await createArticle();
    const parent = await createComment(article.id, { body: "親コメント" });
    expect(parent.outcome).toBe("published");
    const parentNumber = parent.outcome === "published" ? parent.comment.number : -1;

    const reply = await createComment(article.id, { name: "返信者", body: "返信です", parentNumber });
    expect(reply).toMatchObject({ outcome: "published", parentNumber, comment: { number: 2, name: "返信者" } });

    const list = await listPublishedCommentsBySlug(article.slug);
    expect(list).toHaveLength(1);
    expect(list[0].number).toBe(parentNumber);
    expect(list[0].replies).toHaveLength(1);
    expect(list[0].replies[0]).toMatchObject({ number: 2, name: "返信者", body: "返信です" });
  });

  it("返信への返信は大元の親にぶら下げられる（1階層のみ）", async () => {
    const article = await createArticle();
    const parent = await createComment(article.id, { body: "親コメント" });
    const parentNumber = parent.outcome === "published" ? parent.comment.number : -1;
    const reply = await createComment(article.id, { body: "1段目の返信", parentNumber });
    const replyNumber = reply.outcome === "published" ? reply.comment.number : -1;

    const replyToReply = await createComment(article.id, { body: "2段目のつもりの返信", parentNumber: replyNumber });
    expect(replyToReply).toMatchObject({ outcome: "published", parentNumber });

    const list = await listPublishedCommentsBySlug(article.slug);
    expect(list).toHaveLength(1);
    expect(list[0].replies.map((r) => r.body)).toEqual(["1段目の返信", "2段目のつもりの返信"]);
  });

  it("NGワードを含む返信はheldになり、公開一覧のネストにも出ない", async () => {
    const article = await createArticle();
    const parent = await createComment(article.id, { body: "親コメント" });
    const parentNumber = parent.outcome === "published" ? parent.comment.number : -1;

    const result = await createComment(article.id, { body: "このチャンピオンはカスだと思う", parentNumber });
    expect(result).toEqual({ outcome: "held" });

    const list = await listPublishedCommentsBySlug(article.slug);
    expect(list[0].replies).toHaveLength(0);

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.commentCount).toBe(1); // 親コメントの分のみ加算
  });

  it("存在しない/held番号への返信はinvalid_parentで拒否される", async () => {
    const article = await createArticle();
    const missing = await createComment(article.id, { body: "返信のつもり", parentNumber: 999 });
    expect(missing).toEqual({ outcome: "rejected", reason: "invalid_parent" });

    const heldParent = await createComment(article.id, { body: "このチャンピオンはカスだと思う" });
    expect(heldParent).toEqual({ outcome: "held" });
    const heldRow = await prisma.articleComment.findFirstOrThrow({ where: { articleId: article.id } });
    const toHeld = await createComment(article.id, { body: "held宛の返信", parentNumber: heldRow.number });
    expect(toHeld).toEqual({ outcome: "rejected", reason: "invalid_parent" });
  });

  it("公開された返信の投稿もArticle.commentCountに加算される", async () => {
    const article = await createArticle();
    const parent = await createComment(article.id, { body: "親コメント" });
    const parentNumber = parent.outcome === "published" ? parent.comment.number : -1;
    await createComment(article.id, { body: "返信1", parentNumber });
    await createComment(article.id, { body: "返信2", parentNumber });

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.commentCount).toBe(3);
  });
});

describe("voteOnComment（賛否投票, 拡張E8）", () => {
  it("publishedコメントへの投票でgoodCount/badCountが1加算される", async () => {
    const article = await createArticle();
    const created = await createComment(article.id, { body: "投票対象" });
    const number = created.outcome === "published" ? created.comment.number : -1;

    const good1 = await voteOnComment(article.slug, number, "good");
    expect(good1).toEqual({ ok: true, goodCount: 1, badCount: 0 });
    const good2 = await voteOnComment(article.slug, number, "good");
    expect(good2).toEqual({ ok: true, goodCount: 2, badCount: 0 });
    const bad1 = await voteOnComment(article.slug, number, "bad");
    expect(bad1).toEqual({ ok: true, goodCount: 2, badCount: 1 });
  });

  it("存在しない番号への投票はok:falseで加算しない", async () => {
    const article = await createArticle();
    const result = await voteOnComment(article.slug, 999, "good");
    expect(result).toEqual({ ok: false });
  });

  it("heldコメントへの投票はok:falseで加算しない", async () => {
    const article = await createArticle();
    await createComment(article.id, { body: "このチャンピオンはカスだと思う" });
    const heldRow = await prisma.articleComment.findFirstOrThrow({ where: { articleId: article.id } });

    const result = await voteOnComment(article.slug, heldRow.number, "good");
    expect(result).toEqual({ ok: false });
    const unchanged = await prisma.articleComment.findUniqueOrThrow({ where: { id: heldRow.id } });
    expect(unchanged.goodCount).toBe(0);
  });

  it("非公開(held)記事のコメントへの投票はok:falseで加算しない", async () => {
    const article = await createArticle({ slug: "held-vote-target", status: "held" });
    const comment = await prisma.articleComment.create({
      data: { articleId: article.id, number: 1, name: "名無しさん", body: "本文", status: "published" },
    });

    const result = await voteOnComment(article.slug, comment.number, "good");
    expect(result).toEqual({ ok: false });
  });

  it("op:'remove'で1減算する（拡張E13: トグルの取り消し）", async () => {
    const article = await createArticle();
    const created = await createComment(article.id, { body: "投票対象2" });
    const number = created.outcome === "published" ? created.comment.number : -1;

    await voteOnComment(article.slug, number, "good", "add");
    const removed = await voteOnComment(article.slug, number, "good", "remove");
    expect(removed).toEqual({ ok: true, goodCount: 0, badCount: 0 });
  });

  it("op:'remove'はカウントを0未満にしない（floorガード）", async () => {
    const article = await createArticle();
    const created = await createComment(article.id, { body: "投票対象3" });
    const number = created.outcome === "published" ? created.comment.number : -1;

    const result = await voteOnComment(article.slug, number, "bad", "remove");
    expect(result).toEqual({ ok: true, goodCount: 0, badCount: 0 });
  });

  it("op省略時は後方互換で'add'扱いになる", async () => {
    const article = await createArticle();
    const created = await createComment(article.id, { body: "投票対象4" });
    const number = created.outcome === "published" ? created.comment.number : -1;

    const result = await voteOnComment(article.slug, number, "good");
    expect(result).toEqual({ ok: true, goodCount: 1, badCount: 0 });
  });
});

function makeVoteRequest(body: unknown): Request {
  return new Request("http://localhost/api/articles/x/comments/1/vote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeVoteParams(slug: string, number: string) {
  return { params: Promise.resolve({ slug, number }) };
}

describe("POST /api/articles/[slug]/comments/[number]/vote（Route Handler, 拡張E8）", () => {
  it("有効な種別でカウントを1加算し、加算後のカウントを返す", async () => {
    await createArticle();
    const created = await createComment((await prisma.article.findFirstOrThrow({ where: { slug: "comment-target" } })).id, {
      body: "投票対象",
    });
    const number = created.outcome === "published" ? created.comment.number : -1;

    const res = await votePOST(makeVoteRequest({ type: "good" }), makeVoteParams("comment-target", String(number)));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ goodCount: 1, badCount: 0 });
  });

  it("不正な種別は400を返す", async () => {
    await createArticle();
    const res = await votePOST(makeVoteRequest({ type: "up" }), makeVoteParams("comment-target", "1"));
    expect(res.status).toBe(400);
  });

  it("数値でない番号は400を返す", async () => {
    await createArticle();
    const res = await votePOST(makeVoteRequest({ type: "good" }), makeVoteParams("comment-target", "abc"));
    expect(res.status).toBe(400);
  });

  it("不正なJSONボディは400を返す", async () => {
    await createArticle();
    const req = new Request("http://localhost/api/articles/x/comments/1/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    const res = await votePOST(req, makeVoteParams("comment-target", "1"));
    expect(res.status).toBe(400);
  });

  it("存在しないコメント番号は404を返す", async () => {
    await createArticle();
    const res = await votePOST(makeVoteRequest({ type: "good" }), makeVoteParams("comment-target", "999"));
    expect(res.status).toBe(404);
  });

  it("op:'remove'で1減算し、0未満にはならない（拡張E13）", async () => {
    const article = await createArticle({ slug: "vote-route-op-target" });
    const created = await createComment(article.id, { body: "投票対象route" });
    const number = created.outcome === "published" ? created.comment.number : -1;
    const params = () => makeVoteParams("vote-route-op-target", String(number));

    await votePOST(makeVoteRequest({ type: "good", op: "add" }), params());
    const removed = await votePOST(makeVoteRequest({ type: "good", op: "remove" }), params());
    const removedData = await removed.json();
    expect(removedData).toEqual({ goodCount: 0, badCount: 0 });

    const floored = await votePOST(makeVoteRequest({ type: "good", op: "remove" }), params());
    const flooredData = await floored.json();
    expect(flooredData).toEqual({ goodCount: 0, badCount: 0 });
  });

  it("不正なopは400を返す", async () => {
    await createArticle();
    const res = await votePOST(makeVoteRequest({ type: "good", op: "toggle" }), makeVoteParams("comment-target", "1"));
    expect(res.status).toBe(400);
  });
});

describe("listFeaturedComments（注目コメント: 直近3日・返信+賛否の多い順）", () => {
  it("直近3日の公開コメントを返信+賛否の多い順に返し、無反応・保留記事・期間外は除外する", async () => {
    const published = await createArticle({ slug: "published-article" });
    const held = await createArticle({ slug: "held-article", status: "held" });

    // A: 返信2 + good1 → score 3（最も注目）
    const a = await createComment(published.id, { body: "注目される親コメントA" });
    const aNumber = a.outcome === "published" ? a.comment.number : 0;
    await createComment(published.id, { body: "Aへの返信その1", parentNumber: aNumber });
    await createComment(published.id, { body: "Aへの返信その2", parentNumber: aNumber });
    // B: good2 → score 2
    await createComment(published.id, { body: "そこそこ注目コメントB" });
    // C: 返信・賛否なし → score 0（注目に含めない）
    await createComment(published.id, { body: "無風のコメントC" });
    await prisma.articleComment.updateMany({
      where: { articleId: published.id, body: "注目される親コメントA" },
      data: { goodCount: 1 },
    });
    await prisma.articleComment.updateMany({
      where: { articleId: published.id, body: "そこそこ注目コメントB" },
      data: { goodCount: 2 },
    });

    // 保留記事の公開コメント（高good）は公開サイトに露出しないため除外される。
    await prisma.articleComment.create({
      data: { articleId: held.id, number: 1, name: "名無しさん", body: "保留記事の注目コメント", status: "published", goodCount: 9 },
    });
    // 期間外（4日前）の高エンゲージメントコメントは直近3日の対象外。
    await createComment(published.id, { body: "4日前の古い注目コメント" });
    await prisma.articleComment.updateMany({
      where: { articleId: published.id, body: "4日前の古い注目コメント" },
      data: { goodCount: 20, createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });

    const featured = await listFeaturedComments(5);
    const excerpts = featured.map((c) => c.excerpt);
    expect(featured).toHaveLength(2); // A, B のみ（C=無反応・保留記事・期間外は除外）
    expect(excerpts[0]).toContain("親コメントA"); // score3 が先頭
    expect(excerpts[1]).toContain("コメントB");
    expect(excerpts.some((e) => e.includes("無風"))).toBe(false);
    expect(excerpts.some((e) => e.includes("保留記事"))).toBe(false);
    expect(excerpts.some((e) => e.includes("古い"))).toBe(false);
    expect(featured[0].replyCount).toBe(2);
    expect(featured[0].goodCount).toBe(1);
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
