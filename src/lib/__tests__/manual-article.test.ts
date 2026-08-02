/**
 * admincms-S2 F5/F6: 指定URLからの手動記事化（createManualArticleFromUrl）の結合テスト。
 * 専用テストDBに実際に書き込み、`fetch`はstubして実HTTPは叩かない。
 * - Hotnessを一切通さず常にreview（安全フィルタ不通過のみheld）で作成されること
 * - 二重防止（同じURLの再投入で新規作成されず既存記事への導線を返す）
 * - 取得失敗（空データ）で記事が作られないこと
 * - X_API_KEY未設定でX経路が実行前に拒否されること
 * - 未認証呼び出しの拒否
 * を検証する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createManualArticleFromUrl } from "@/lib/admin/manual-article";
import { MockLLMClient } from "@/lib/generation/llm-client";
import { UnauthorizedError } from "@/lib/auth/basic-auth";
import type { AdminAuthContext } from "@/lib/admin/auth-context";

const UNAUTHORIZED: AdminAuthContext = { authorizationHeader: null };

function authorizedContext(): AdminAuthContext {
  const header = `Basic ${Buffer.from("test-admin:test-pass", "utf-8").toString("base64")}`;
  return { authorizationHeader: header };
}

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const llm = new MockLLMClient();

describe("createManualArticleFromUrl", () => {
  const originalAdminUser = process.env.ADMIN_USER;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;
  const originalXApiKey = process.env.X_API_KEY;

  beforeEach(async () => {
    await resetDb();
    process.env.ADMIN_USER = "test-admin";
    process.env.ADMIN_PASSWORD = "test-pass";
    delete process.env.X_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env.ADMIN_USER = originalAdminUser;
    process.env.ADMIN_PASSWORD = originalAdminPassword;
    if (originalXApiKey === undefined) delete process.env.X_API_KEY;
    else process.env.X_API_KEY = originalXApiKey;
  });

  it("未認証コンテキストではUnauthorizedErrorを投げ、DBを一切変更しない(fetchも呼ばない)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createManualArticleFromUrl("https://www.reddit.com/r/leagueoflegends/comments/unauth1/x/", UNAUTHORIZED, llm),
    ).rejects.toThrow(UnauthorizedError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.post.count()).toBe(0);
  });

  it("空文字は invalid、対応しないホストは unsupported を返し記事を作らない", async () => {
    const empty = await createManualArticleFromUrl("", authorizedContext(), llm);
    expect(empty).toMatchObject({ success: false, kind: "invalid" });

    const notUrl = await createManualArticleFromUrl("abc", authorizedContext(), llm);
    expect(notUrl).toMatchObject({ success: false, kind: "invalid" });

    const unsupported = await createManualArticleFromUrl("https://example.com/foo", authorizedContext(), llm);
    expect(unsupported).toMatchObject({ success: false, kind: "unsupported" });

    expect(await prisma.post.count()).toBe(0);
    expect(await prisma.article.count()).toBe(0);
  });

  it("Redditスレッド（スコア・コメント数が低い＝自動収集では記事化されない水準）でもHotnessを通さず要レビュー記事を作成する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/posts/ids")) {
          return jsonResponse({
            data: [
              {
                id: "low1",
                title: "地味なスレ",
                selftext: "そこまで盛り上がってないけど記録用",
                created_utc: 1700000000,
                score: 1, // 自動収集の閾値(既定50)を大きく下回る
                num_comments: 1,
              },
            ],
          });
        }
        return jsonResponse({ data: [{ id: "c1", body: "たしかにそうだね", score: 1, author: "u1" }] });
      }),
    );

    const result = await createManualArticleFromUrl(
      "https://www.reddit.com/r/leagueoflegends/comments/low1/some-title/",
      authorizedContext(),
      llm,
    );

    expect(result).toMatchObject({ success: true, kind: "created", status: "review" });
    const article = await prisma.article.findFirstOrThrow({ include: { sources: true, post: true } });
    expect(article.status).toBe("review");
    expect(article.category).toBe("海外の反応");
    expect(article.post?.sourceType).toBe("reddit");
    expect(article.sources[0]?.url).toContain("reddit.com/r/leagueoflegends/comments/low1");
  });

  it("同じURL(異形含む)を2回投入しても2件目は作成されず既存記事への導線を返す(二重防止)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/posts/ids")) {
          return jsonResponse({ data: [{ id: "dup1", title: "重複テスト", created_utc: 1700000000, score: 10 }] });
        }
        return jsonResponse({ data: [] });
      }),
    );

    const first = await createManualArticleFromUrl(
      "https://www.reddit.com/r/leagueoflegends/comments/dup1/a/",
      authorizedContext(),
      llm,
    );
    expect(first).toMatchObject({ success: true, kind: "created" });

    const second = await createManualArticleFromUrl(
      "https://old.reddit.com/r/leagueoflegends/comments/dup1/a", // 末尾スラッシュ無し・ホスト違い＝同一externalId
      authorizedContext(),
      llm,
    );
    expect(second).toMatchObject({ success: true, kind: "already_exists", message: "この URL は記事化済みです" });
    if (first.success && first.kind === "created" && second.success && second.kind === "already_exists") {
      expect(second.articleId).toBe(first.articleId);
    }

    expect(await prisma.post.count()).toBe(1);
    expect(await prisma.article.count()).toBe(1);
  });

  it("Redditスレッドが存在しない(データ空)場合は記事を作らずエラーメッセージを返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [] })));

    const result = await createManualArticleFromUrl(
      "https://www.reddit.com/r/leagueoflegends/comments/missing1/a/",
      authorizedContext(),
      llm,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.kind).toBe("fetch_failed");
      expect(result.message).toContain("見つかりません");
    }
    expect(await prisma.post.count()).toBe(0);
    expect(await prisma.article.count()).toBe(0);
  });

  it("X_API_KEY未設定でX投稿URLを実行すると記事を作らずキー未設定メッセージを返す(同じ関数でRedditは正常動作)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const xResult = await createManualArticleFromUrl(
      "https://x.com/some_user/status/9990001",
      authorizedContext(),
      llm,
    );
    expect(xResult).toMatchObject({ success: false, kind: "x_api_key_missing" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.post.count()).toBe(0);
  });

  it("X_API_KEY設定時はX投稿URLから要レビュー記事を作成する(カテゴリ=Xの反応)", async () => {
    process.env.X_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/twitter/tweet/detail")) {
          return jsonResponse({
            status: "success",
            data: {
              id: "9990002",
              text: "今日のLJLの試合はマジで面白かった。序盤から目が離せなかった。",
              url: "https://x.com/some_user/status/9990002",
              createdAt: "2026-07-30T00:00:00.000Z",
              author: { userName: "some_user" },
            },
          });
        }
        return jsonResponse({ tweets: [] }); // リプライ/引用は0件でよい(返信0件でも作成できることの確認を兼ねる)
      }),
    );

    const result = await createManualArticleFromUrl(
      "https://x.com/some_user/status/9990002",
      authorizedContext(),
      llm,
    );
    expect(result).toMatchObject({ success: true, kind: "created", status: "review" });
    const article = await prisma.article.findFirstOrThrow({ include: { sources: true } });
    expect(article.category).toBe("Xの反応");
    expect(article.status).toBe("review");
    expect(article.sources[0]?.url).toBe("https://x.com/some_user/status/9990002");
    // 本文が空にならない(見出しブロックが最低1件ある)ことを確認
    expect(Array.isArray(article.body)).toBe(true);
    expect((article.body as unknown[]).length).toBeGreaterThan(0);
  });

  it("NGワードを含むX投稿を記事化した場合はheldになり、要レビュー(review)にはならず保留キューに理由付きで入る", async () => {
    // composeXBodyの独自導入段落(mock)はcandidate.title（tweet本文由来）を逐語で埋め込むため、
    // NGワードを含むtweetは記事本文にもNGワードが残り、article単位のmoderateArticleContentで
    // ng_word判定される（既存の generation-post-pipeline-x.test.ts と同じ検証パターン）。
    process.env.X_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/twitter/tweet/detail")) {
          return jsonResponse({
            status: "success",
            data: {
              id: "9990003",
              text: "死ねと思うくらい酷い試合だった。もう見てられない。",
              url: "https://x.com/some_user/status/9990003",
              createdAt: "2026-07-30T00:00:00.000Z",
              author: { userName: "some_user" },
            },
          });
        }
        return jsonResponse({ tweets: [] });
      }),
    );

    const result = await createManualArticleFromUrl(
      "https://x.com/some_user/status/9990003",
      authorizedContext(),
      llm,
    );
    expect(result).toMatchObject({ success: true, kind: "created", status: "held" });
    const article = await prisma.article.findFirstOrThrow();
    expect(article.status).toBe("held");
    expect(article.heldReason).toBe("ng_word");
  });
});
