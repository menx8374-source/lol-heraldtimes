/**
 * 運営CMS（拡張E7）の Basic 認証・純関数のテスト。env を直接読まず引数で受け取れる設計にしているため、
 * process.env を汚さずに「未設定」「正しい資格情報」「誤った資格情報」を検証できる。
 */
import { describe, expect, it } from "vitest";
import {
  getAdminCredentialsFromEnv,
  isAdminAuthConfigured,
  timingSafeEqual,
  parseBasicAuthHeader,
  verifyCredentials,
  verifyBasicAuthHeader,
  assertAuthorizedHeader,
  UnauthorizedError,
} from "@/lib/auth/basic-auth";

function basicHeaderFor(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf-8").toString("base64")}`;
}

describe("getAdminCredentialsFromEnv / isAdminAuthConfigured", () => {
  it("ADMIN_USER/ADMIN_PASSWORDが両方揃っていれば資格情報を返す", () => {
    const env = { ADMIN_USER: "admin", ADMIN_PASSWORD: "s3cret" };
    expect(getAdminCredentialsFromEnv(env)).toEqual({ user: "admin", password: "s3cret" });
    expect(isAdminAuthConfigured(env)).toBe(true);
  });

  it("片方でも未設定ならnull（未設定扱い）", () => {
    expect(getAdminCredentialsFromEnv({ ADMIN_USER: "admin" })).toBeNull();
    expect(getAdminCredentialsFromEnv({ ADMIN_PASSWORD: "s3cret" })).toBeNull();
    expect(getAdminCredentialsFromEnv({})).toBeNull();
    expect(isAdminAuthConfigured({})).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("同一文字列はtrue", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });
  it("異なる文字列はfalse（長さ同一）", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });
  it("長さが異なる文字列もfalse", () => {
    expect(timingSafeEqual("short", "much-longer-string")).toBe(false);
  });
  it("空文字列同士はtrue", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("parseBasicAuthHeader", () => {
  it("正しいBasicヘッダーをパースできる", () => {
    expect(parseBasicAuthHeader(basicHeaderFor("admin", "pass:word"))).toEqual({
      user: "admin",
      password: "pass:word",
    });
  });
  it("nullヘッダーはnull", () => {
    expect(parseBasicAuthHeader(null)).toBeNull();
  });
  it("Basicで始まらないヘッダーはnull", () => {
    expect(parseBasicAuthHeader("Bearer xyz")).toBeNull();
  });
  it("コロン区切りが無い不正なbase64はnull", () => {
    expect(parseBasicAuthHeader(`Basic ${Buffer.from("nocolonhere").toString("base64")}`)).toBeNull();
  });
});

describe("verifyCredentials", () => {
  const expected = { user: "admin", password: "correct-pass" };

  it("正しい資格情報はtrue", () => {
    expect(verifyCredentials({ user: "admin", password: "correct-pass" }, expected)).toBe(true);
  });
  it("誤ったパスワードはfalse", () => {
    expect(verifyCredentials({ user: "admin", password: "wrong-pass" }, expected)).toBe(false);
  });
  it("誤ったユーザー名はfalse", () => {
    expect(verifyCredentials({ user: "someone-else", password: "correct-pass" }, expected)).toBe(false);
  });
  it("expectedがnull（未設定）なら常にfalse", () => {
    expect(verifyCredentials({ user: "admin", password: "correct-pass" }, null)).toBe(false);
  });
  it("providedがnullならfalse", () => {
    expect(verifyCredentials(null, expected)).toBe(false);
  });
});

describe("verifyBasicAuthHeader（未認証拒否の統合的な確認）", () => {
  const env = { ADMIN_USER: "admin", ADMIN_PASSWORD: "correct-pass" };

  it("正しい資格情報のヘッダーはtrue", () => {
    expect(verifyBasicAuthHeader(basicHeaderFor("admin", "correct-pass"), env)).toBe(true);
  });
  it("誤った資格情報のヘッダーはfalse", () => {
    expect(verifyBasicAuthHeader(basicHeaderFor("admin", "wrong-pass"), env)).toBe(false);
  });
  it("ヘッダー無し（未認証アクセス）はfalse", () => {
    expect(verifyBasicAuthHeader(null, env)).toBe(false);
  });
  it("env未設定（ADMIN_USER/ADMIN_PASSWORD無し）は、正しいヘッダーを送っても常にfalse（管理機能ごと無効化）", () => {
    expect(verifyBasicAuthHeader(basicHeaderFor("admin", "correct-pass"), {})).toBe(false);
  });
});

describe("assertAuthorizedHeader（サーバーアクション/APIの入口ガード）", () => {
  const env = { ADMIN_USER: "admin", ADMIN_PASSWORD: "correct-pass" };

  it("正しい資格情報では例外を投げない", () => {
    expect(() => assertAuthorizedHeader(basicHeaderFor("admin", "correct-pass"), env)).not.toThrow();
  });
  it("未認証（ヘッダー無し）はUnauthorizedErrorを投げ、処理を止める", () => {
    expect(() => assertAuthorizedHeader(null, env)).toThrow(UnauthorizedError);
  });
  it("誤った資格情報もUnauthorizedErrorを投げる", () => {
    expect(() => assertAuthorizedHeader(basicHeaderFor("admin", "wrong"), env)).toThrow(UnauthorizedError);
  });
  it("認証情報が未設定の環境では、正しそうなヘッダーでも拒否する", () => {
    expect(() => assertAuthorizedHeader(basicHeaderFor("admin", "correct-pass"), {})).toThrow(UnauthorizedError);
  });
});
