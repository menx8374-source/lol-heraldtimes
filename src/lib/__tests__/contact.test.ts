import { afterEach, describe, expect, it } from "vitest";
import { resolveContactEmail } from "@/lib/contact";

describe("resolveContactEmail", () => {
  const originalEnv = process.env.CONTACT_EMAIL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CONTACT_EMAIL;
    } else {
      process.env.CONTACT_EMAIL = originalEnv;
    }
  });

  it("CONTACT_EMAIL が設定されていればそれをそのまま返す", () => {
    process.env.CONTACT_EMAIL = "owner@example.jp";
    expect(resolveContactEmail("http://localhost:3000")).toBe("owner@example.jp");
  });

  it("前後の空白をトリムする", () => {
    process.env.CONTACT_EMAIL = "  owner@example.jp  ";
    expect(resolveContactEmail("http://localhost:3000")).toBe("owner@example.jp");
  });

  it("未設定時はサイトURLのホスト名から contact@<host> を組み立てる", () => {
    delete process.env.CONTACT_EMAIL;
    expect(resolveContactEmail("https://lol-matome.example.com")).toBe(
      "contact@lol-matome.example.com",
    );
  });

  it("未設定かつsiteUrlが不正な形式でも例外を投げずフォールバック値を返す", () => {
    delete process.env.CONTACT_EMAIL;
    expect(resolveContactEmail("not-a-valid-url")).toBe("contact@example.com");
  });
});
