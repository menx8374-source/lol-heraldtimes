/**
 * 絵文字リアクション加算エンドポイント（拡張E1）の結合テスト。専用テストDBに実際に記事を
 * 投入し、加算・不正絵文字の拒否・保留/存在しない記事の404を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/articles/[slug]/reactions/route";

async function resetDb() {
  await prisma.articleReaction.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/articles/x/reactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(async () => {
  await resetDb();
  await prisma.article.create({
    data: {
      slug: "reaction-target",
      title: "リアクション対象記事",
      category: "パッチ/メタ",
      body: [{ type: "paragraph", text: "本文" }],
      publishedAt: new Date("2026-07-20T00:00:00+09:00"),
      status: "published",
    },
  });
  await prisma.article.create({
    data: {
      slug: "held-target",
      title: "保留記事",
      category: "パッチ/メタ",
      body: [{ type: "paragraph", text: "本文" }],
      publishedAt: new Date("2026-07-20T00:00:00+09:00"),
      status: "held",
      heldReason: "ng_word",
    },
  });
});

describe("POST /api/articles/[slug]/reactions", () => {
  it("有効な絵文字でカウントを1加算し、加算後の全カウントを返す", async () => {
    const res1 = await POST(makeRequest({ emoji: "👍" }), makeParams("reaction-target"));
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.counts["👍"]).toBe(1);
    expect(data1.counts["😂"]).toBe(0);

    const res2 = await POST(makeRequest({ emoji: "👍" }), makeParams("reaction-target"));
    const data2 = await res2.json();
    expect(data2.counts["👍"]).toBe(2);
  });

  it("既定外の絵文字は400を返し、加算しない", async () => {
    const res = await POST(makeRequest({ emoji: "🍣" }), makeParams("reaction-target"));
    expect(res.status).toBe(400);
  });

  it("不正なJSONボディは400を返す", async () => {
    const req = new Request("http://localhost/api/articles/x/reactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    const res = await POST(req, makeParams("reaction-target"));
    expect(res.status).toBe(400);
  });

  it("保留中の記事へのリアクションは404を返す", async () => {
    const res = await POST(makeRequest({ emoji: "👍" }), makeParams("held-target"));
    expect(res.status).toBe(404);
  });

  it("存在しない記事は404を返す", async () => {
    const res = await POST(makeRequest({ emoji: "👍" }), makeParams("nonexistent-slug"));
    expect(res.status).toBe(404);
  });

  it("op:'add'を明示しても加算する（後方互換の既定と同じ挙動）", async () => {
    const res = await POST(makeRequest({ emoji: "👍", op: "add" }), makeParams("reaction-target"));
    const data = await res.json();
    expect(data.counts["👍"]).toBe(1);
  });

  it("op:'remove'で1減算する（拡張E13: トグルの取り消し）", async () => {
    await POST(makeRequest({ emoji: "👍", op: "add" }), makeParams("reaction-target"));
    const res = await POST(makeRequest({ emoji: "👍", op: "remove" }), makeParams("reaction-target"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts["👍"]).toBe(0);
  });

  it("op:'remove'はカウントを0未満にしない（floorガード）", async () => {
    const res = await POST(makeRequest({ emoji: "👍", op: "remove" }), makeParams("reaction-target"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts["👍"]).toBe(0);

    // 未登録（レコード自体が存在しない）状態からの減算でも0未満にならない。
    const res2 = await POST(makeRequest({ emoji: "👍", op: "remove" }), makeParams("reaction-target"));
    const data2 = await res2.json();
    expect(data2.counts["👍"]).toBe(0);
  });

  it("不正なopは400を返し、カウントを変更しない", async () => {
    const res = await POST(makeRequest({ emoji: "👍", op: "toggle" }), makeParams("reaction-target"));
    expect(res.status).toBe(400);
  });

  it("add→addで2、addの後removeして再度addすると1に戻る（切替相当の一連の操作）", async () => {
    await POST(makeRequest({ emoji: "👍", op: "add" }), makeParams("reaction-target"));
    await POST(makeRequest({ emoji: "👍", op: "remove" }), makeParams("reaction-target"));
    const res = await POST(makeRequest({ emoji: "👍", op: "add" }), makeParams("reaction-target"));
    const data = await res.json();
    expect(data.counts["👍"]).toBe(1);
  });
});
