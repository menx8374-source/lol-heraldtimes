/**
 * notifyPublishedArticles（成長G6 F-G6-3）の単体テスト（ブリーフ テスト3）。
 * DISCORD_WEBHOOK_URL未設定時はfetch自体を呼ばないこと、設定時は正しいペイロードで呼ばれること、
 * 送信失敗時に例外を投げず処理が継続すること(補助処理は本体を止めない)を検証する。実webhookは叩かない(fetchをモック)。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { notifyPublishedArticles } from "@/lib/generation/delivery";

describe("notifyPublishedArticles（成長G6 F-G6-3）", () => {
  const originalFetch = global.fetch;
  const originalWebhook = process.env.DISCORD_WEBHOOK_URL;
  const originalSiteUrl = process.env.SITE_URL;

  beforeEach(() => {
    process.env.SITE_URL = "https://example-lol-matome.test";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalWebhook === undefined) delete process.env.DISCORD_WEBHOOK_URL;
    else process.env.DISCORD_WEBHOOK_URL = originalWebhook;
    if (originalSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = originalSiteUrl;
    vi.restoreAllMocks();
  });

  it("DISCORD_WEBHOOK_URL未設定時はfetchを一切呼ばない(完全no-op)", async () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await notifyPublishedArticles([{ title: "テスト記事", slug: "test-slug" }]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("記事が0件のときはWebhook設定済みでもfetchを呼ばない", async () => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/xxx/yyy";
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await notifyPublishedArticles([]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("設定時はfetchが正しいペイロード(タイトル/URL/allowed_mentions)でPOSTされる", async () => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/xxx/yyy";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await notifyPublishedArticles([{ title: "新パッチ公開！", slug: "patch-notes", category: "パッチ/メタ" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/webhooks/xxx/yyy");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.content).toContain("新パッチ公開！");
    expect(body.content).toContain("https://example-lol-matome.test/articles/patch-notes");
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("複数記事を渡すとそれぞれ個別にfetchが呼ばれる", async () => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/xxx/yyy";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await notifyPublishedArticles([
      { title: "記事A", slug: "a" },
      { title: "記事B", slug: "b" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("送信が例外を投げても notifyPublishedArticles 自体は例外を投げずに正常終了する(本体を止めない)", async () => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/xxx/yyy";
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    global.fetch = fetchMock as unknown as typeof fetch;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(notifyPublishedArticles([{ title: "テスト記事", slug: "test-slug" }])).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("非2xxレスポンスでも例外を投げずに正常終了する", async () => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/xxx/yyy";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    global.fetch = fetchMock as unknown as typeof fetch;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(notifyPublishedArticles([{ title: "テスト記事", slug: "test-slug" }])).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
