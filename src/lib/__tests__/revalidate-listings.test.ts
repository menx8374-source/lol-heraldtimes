/**
 * revalidatePublishedListings（revalidate-S1 F-RV1-3、B）の単体テスト（ブリーフ テスト2）。
 * REVALIDATE_SECRET未設定時はfetchを一切呼ばない(no-op)こと、設定時はREVALIDATE_URL
 * （既定の内部localhost）へシークレット付きPOSTすること、失敗しても例外を投げないことを検証する。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { revalidatePublishedListings } from "@/lib/generation/revalidate-listings";

describe("revalidatePublishedListings（revalidate-S1 F-RV1-3）", () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.REVALIDATE_SECRET;
  const originalUrl = process.env.REVALIDATE_URL;
  const originalPort = process.env.PORT;

  beforeEach(() => {
    delete process.env.REVALIDATE_SECRET;
    delete process.env.REVALIDATE_URL;
    delete process.env.PORT;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.REVALIDATE_SECRET;
    else process.env.REVALIDATE_SECRET = originalSecret;
    if (originalUrl === undefined) delete process.env.REVALIDATE_URL;
    else process.env.REVALIDATE_URL = originalUrl;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    vi.restoreAllMocks();
  });

  it("REVALIDATE_SECRET未設定時はfetchを一切呼ばない(完全no-op)", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await revalidatePublishedListings();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("設定時は既定の内部URL(http://127.0.0.1:3000/api/revalidate)へシークレット付きPOSTする", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await revalidatePublishedListings();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3000/api/revalidate");
    expect(init.method).toBe("POST");
    expect(init.headers["x-revalidate-secret"]).toBe("correct-secret");
  });

  it("PORT設定時は既定URLのポートに反映される", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    process.env.PORT = "4000";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await revalidatePublishedListings();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4000/api/revalidate");
  });

  it("REVALIDATE_URLを明示指定した場合はそちらを使う", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    process.env.REVALIDATE_URL = "http://127.0.0.1:9999/api/revalidate";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await revalidatePublishedListings();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:9999/api/revalidate");
  });

  it("fetchが例外を投げても例外を伝播せず正常終了する(補助処理は本体を止めない)", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    global.fetch = fetchMock as unknown as typeof fetch;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(revalidatePublishedListings()).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("非2xxレスポンスでも例外を投げずに正常終了する", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    global.fetch = fetchMock as unknown as typeof fetch;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(revalidatePublishedListings()).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
