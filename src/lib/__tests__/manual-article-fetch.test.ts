/**
 * admincms-S2 F5/F6: 単発取得（Reddit/X）の単体テスト。実ネットワーク非依存
 * （`vi.stubGlobal("fetch", ...)`）。404/削除済み/認証エラー/レート制限で記事を作れない
 * （呼び出し側が例外を投げず失敗結果を受け取る）ことを検証する。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRedditThreadById, fetchTweetById, isXApiKeyConfigured } from "@/lib/admin/manual-article-fetch";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.X_API_KEY;
});

describe("fetchRedditThreadById", () => {
  it("投稿＋コメントを取得しスレッドダンプを組み立てる", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("/posts/ids")) {
          return jsonResponse({
            data: [{ id: "abc123", title: "テストスレ", selftext: "本文抜粋", created_utc: 1700000000, score: 5 }],
          });
        }
        return jsonResponse({ data: [{ id: "c1", body: "いいね", score: 3, author: "user1" }] });
      }),
    );

    const result = await fetchRedditThreadById("abc123");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe("テストスレ");
      expect(result.data.content).toContain("1: テストスレ");
      expect(result.data.content).toContain("いいね");
      expect(result.data.score).toBe(5);
    }
    expect(calls.some((u) => u.includes("/posts/ids"))).toBe(true);
  });

  it("投稿が見つからない(data空)場合は記事化せず日本語メッセージを返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [] })));
    const result = await fetchRedditThreadById("missing-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("見つかりません");
  });

  it("投稿取得が404の場合は記事化せず日本語メッセージを返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 404)));
    const result = await fetchRedditThreadById("deleted-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("見つかりません");
  });

  it("投稿取得が401(認証エラー)の場合は記事化せず理由が分かる日本語メッセージを返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));
    const result = await fetchRedditThreadById("auth-err");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("認証");
  });

  it("投稿取得が429(レート制限)の場合は記事化せず理由が分かる日本語メッセージを返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 429)));
    const result = await fetchRedditThreadById("rate-limited");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("レート制限");
  });

  it("コメント取得だけが失敗してもOP単体で成功扱いになる（本体は止めない）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/posts/ids")) {
          return jsonResponse({ data: [{ id: "abc123", title: "テストスレ", created_utc: 1700000000 }] });
        }
        return jsonResponse({}, 500);
      }),
    );
    const result = await fetchRedditThreadById("abc123");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.content).toBe("1: テストスレ");
  });
});

describe("isXApiKeyConfigured / fetchTweetById", () => {
  it("X_API_KEY未設定ならfetchTweetByIdは通信せず失敗を返す", async () => {
    delete process.env.X_API_KEY;
    expect(isXApiKeyConfigured()).toBe(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchTweetById("123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("X の API キーが未設定のため利用できません");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("X_API_KEY設定時はtweet本文・作者・リプライを取得する", async () => {
    process.env.X_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        // 単一tweet取得は GET /twitter/tweet/detail（レスポンスは {data: <tweet>}）。
        if (url.includes("/twitter/tweet/detail")) {
          return jsonResponse({
            status: "success",
            msg: "success",
            data: {
              id: "999",
              text: "今日の試合は面白かった",
              url: "https://x.com/user1/status/999",
              createdAt: "2026-07-30T00:00:00.000Z",
              author: { userName: "user1" },
            },
          });
        }
        // conversation_id:.../quoted_tweet_id:... のリプライ/引用検索(advanced_search)は0件でよい
        return jsonResponse({ tweets: [] });
      }),
    );

    const result = await fetchTweetById("999");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.content).toBe("今日の試合は面白かった");
      expect(result.data.author).toBe("user1");
      expect(result.data.xReplies).toEqual([]);
    }
  });

  it("削除済み(dataが空)の場合は記事化せず日本語メッセージを返す", async () => {
    process.env.X_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "success", msg: "success", data: null })));
    const result = await fetchTweetById("deleted-999");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("見つかりません");
  });

  it("404の場合は記事化せず日本語メッセージを返す", async () => {
    process.env.X_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 404)));
    const result = await fetchTweetById("deleted-999");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("見つかりません");
  });

  it("401/403(認証エラー)の場合は記事化せず理由が分かる日本語メッセージを返す", async () => {
    process.env.X_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 403)));
    const result = await fetchTweetById("auth-err");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("認証");
  });

  it("429(レート制限)の場合は記事化せず理由が分かる日本語メッセージを返す", async () => {
    process.env.X_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 429)));
    const result = await fetchTweetById("rate-limited");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("レート制限");
  });
});
