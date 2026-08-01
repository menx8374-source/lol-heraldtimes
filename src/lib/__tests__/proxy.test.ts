/**
 * proxy.ts（Basic認証）のテスト（polish-S1 F-P1-1）。
 * `/api/revalidate` は独自の REVALIDATE_SECRET（Route Handler側）で保護済みのため、
 * SITE_PRIVATE=true 下でも Basic 認証を課さず素通しする（B=公開後のオンデマンド再検証を有効化）。
 * 除外は完全一致のみ・`/admin`保護とSITE_PRIVATE時の他ページ保護は不変。
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

function req(pathname: string, init?: { method?: string; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(new URL(`https://example.test${pathname}`), {
    method: init?.method ?? "GET",
    headers: init?.headers,
  });
}

describe("proxy（Basic認証、polish-S1 F-P1-1）", () => {
  it("SITE_PRIVATE=trueでも /api/revalidate はBasic認証を課さず素通し（NextResponse.next()相当=200経路）", async () => {
    await withEnv({ SITE_PRIVATE: "true", ADMIN_USER: undefined, ADMIN_PASSWORD: undefined }, () => {
      const res = proxy(req("/api/revalidate", { method: "POST" }));
      // Basic認証を課していれば認証情報未設定時は503・ヘッダー無しなら401になるはずだが、
      // 除外により素通し（NextResponse.next()）= レスポンスに認証拒否用のbody/ステータスが付かない。
      expect(res.status).toBe(200);
      expect(res.headers.get("WWW-Authenticate")).toBeNull();
    });
  });

  it("SITE_PRIVATE=false（既定）でも /api/revalidate は素通し（従来どおり公開）", async () => {
    await withEnv({ SITE_PRIVATE: undefined }, () => {
      const res = proxy(req("/api/revalidate", { method: "POST" }));
      expect(res.status).toBe(200);
    });
  });

  it("/admin は SITE_PRIVATE=false でも保護される（認証情報未設定なら503）", async () => {
    await withEnv({ SITE_PRIVATE: undefined, ADMIN_USER: undefined, ADMIN_PASSWORD: undefined }, () => {
      const res = proxy(req("/admin"));
      expect(res.status).toBe(503);
    });
  });

  it("/admin は SITE_PRIVATE=true でも保護される（認証ヘッダー無しなら401）", async () => {
    await withEnv(
      { SITE_PRIVATE: "true", ADMIN_USER: "admin", ADMIN_PASSWORD: "correct-pass" },
      () => {
        const res = proxy(req("/admin"));
        expect(res.status).toBe(401);
      },
    );
  });

  it("SITE_PRIVATE=true のとき、/ や /category/x 等の他ページは従来どおり保護される（認証ヘッダー無しなら401）", async () => {
    await withEnv(
      { SITE_PRIVATE: "true", ADMIN_USER: "admin", ADMIN_PASSWORD: "correct-pass" },
      () => {
        expect(proxy(req("/")).status).toBe(401);
        expect(proxy(req("/category/x")).status).toBe(401);
      },
    );
  });

  it("SITE_PRIVATE=true のとき、正しいBasic認証ヘッダーがあれば他ページも通る（200）", async () => {
    await withEnv(
      { SITE_PRIVATE: "true", ADMIN_USER: "admin", ADMIN_PASSWORD: "correct-pass" },
      () => {
        const header = `Basic ${Buffer.from("admin:correct-pass", "utf-8").toString("base64")}`;
        const res = proxy(req("/", { headers: { authorization: header } }));
        expect(res.status).toBe(200);
      },
    );
  });

  it("除外は完全一致のみ：/api/revalidate-something や /api/other はSITE_PRIVATE=true時に保護される（401/503）", async () => {
    await withEnv({ SITE_PRIVATE: "true", ADMIN_USER: undefined, ADMIN_PASSWORD: undefined }, () => {
      expect(proxy(req("/api/revalidate-something")).status).toBe(503);
      expect(proxy(req("/api/other")).status).toBe(503);
    });
  });
});
