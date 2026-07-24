import { describe, expect, it, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DisclaimerPage from "@/app/disclaimer/page";
import PrivacyPage from "@/app/privacy/page";
import ContactPage from "@/app/contact/page";

describe("固定ページ: /disclaimer（免責事項）", () => {
  const html = renderToStaticMarkup(<DisclaimerPage />);

  it("Riot 非公認・AI自動生成・法的助言でない旨の記載を含む（F15）", () => {
    expect(html).toContain("免責事項");
    expect(html).toContain("承認・関与・後援するもの");
    expect(html).toContain("AI により自動生成");
    expect(html).toContain("法律上の助言");
  });

  it("お問い合わせ（掲載削除依頼）ページへの導線を持つ", () => {
    expect(html).toContain('href="/contact"');
  });
});

describe("固定ページ: /privacy（プライバシーポリシー）", () => {
  const html = renderToStaticMarkup(<PrivacyPage />);

  it("アクセス解析・広告(Cookie)・個人情報の取り扱いに関する一般的な記載を含む（F15）", () => {
    expect(html).toContain("プライバシーポリシー");
    expect(html).toContain("Cookie");
    expect(html).toContain("広告");
    expect(html).toContain("個人情報");
  });
});

describe("固定ページ: /contact（お問い合わせ・掲載削除依頼）", () => {
  afterEach(() => {
    delete process.env.CONTACT_EMAIL;
  });

  it("掲載削除依頼（オプトアウト）の連絡導線として連絡先メールアドレスを表示する（F15）", () => {
    process.env.CONTACT_EMAIL = "opt-out@example.jp";
    const html = renderToStaticMarkup(<ContactPage />);
    expect(html).toContain("削除");
    expect(html).toContain("opt-out@example.jp");
    expect(html).toContain("mailto:opt-out@example.jp");
  });
});
