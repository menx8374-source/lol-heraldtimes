/**
 * `/api/revalidate`（revalidate-S1 F-RV1-2、B）の単体テスト（ブリーフ テスト1）。
 * next/cache の revalidatePath をモックし、実際のNextキャッシュには触れない。
 * - 正しいシークレットで200＋固定パス群がrevalidatePathされること
 * - 誤/欠落シークレットで401、REVALIDATE_SECRET未設定でも401（機能無効）
 * - GETは405
 * - bodyに任意パスを混ぜても固定パスしか再検証されない（ユーザー入力のパスを渡さない）
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

import { POST, GET } from "@/app/api/revalidate/route";

const FIXED_PATHS = [
  ["/"],
  ["/tags"],
  ["/patches"],
  ["/archive"],
  ["/tier"],
  ["/champions"],
  ["/category/[slug]", "page"],
  ["/tags/[tag]", "page"],
  ["/patches/[version]", "page"],
  ["/archive/[key]", "page"],
];

function makeRequest(init: { headers?: Record<string, string>; body?: unknown } = {}): Request {
  return new Request("http://127.0.0.1:3000/api/revalidate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

describe("/api/revalidate", () => {
  const originalSecret = process.env.REVALIDATE_SECRET;

  beforeEach(() => {
    revalidatePathMock.mockClear();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.REVALIDATE_SECRET;
    else process.env.REVALIDATE_SECRET = originalSecret;
  });

  it("REVALIDATE_SECRET未設定なら正しそうなヘッダを送っても401(機能無効)", async () => {
    delete process.env.REVALIDATE_SECRET;
    const res = await POST(makeRequest({ headers: { "x-revalidate-secret": "anything" } }));
    expect(res.status).toBe(401);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("シークレット欠落は401", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("誤ったシークレットは401", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    const res = await POST(makeRequest({ headers: { "x-revalidate-secret": "wrong-secret" } }));
    expect(res.status).toBe(401);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("正しいx-revalidate-secretヘッダで200＋固定パス群がrevalidatePathされる", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    const res = await POST(makeRequest({ headers: { "x-revalidate-secret": "correct-secret" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ revalidated: true });

    expect(revalidatePathMock).toHaveBeenCalledTimes(FIXED_PATHS.length);
    for (const args of FIXED_PATHS) {
      expect(revalidatePathMock).toHaveBeenCalledWith(...args);
    }
  });

  it("bodyのsecretでも認証できる(ヘッダが無い場合)", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    const res = await POST(makeRequest({ body: { secret: "correct-secret" } }));
    expect(res.status).toBe(200);
    expect(revalidatePathMock).toHaveBeenCalledTimes(FIXED_PATHS.length);
  });

  it("bodyに任意パスを混ぜても固定パスしか再検証されない(ユーザー入力のパスを渡さない)", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    const res = await POST(
      makeRequest({
        headers: { "x-revalidate-secret": "correct-secret" },
        body: { secret: "correct-secret", path: "/admin", pages: ["/../etc/passwd"] },
      }),
    );
    expect(res.status).toBe(200);
    expect(revalidatePathMock).not.toHaveBeenCalledWith("/admin");
    expect(revalidatePathMock).not.toHaveBeenCalledWith("/../etc/passwd");
    expect(revalidatePathMock).toHaveBeenCalledTimes(FIXED_PATHS.length);
  });

  it("GETは405", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });
});
