import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteFooter } from "@/components/site-footer";

describe("SiteFooter", () => {
  const html = renderToStaticMarkup(<SiteFooter />);

  it("Riot 非公認ディスクレーマー（承認・関与・後援するものではない旨）を表示する（F15）", () => {
    expect(html).toContain("Riot Games");
    expect(html).toContain("承認・関与・後援するものではありません");
  });

  it("記事が AI により自動生成されている旨を表示する（F15）", () => {
    expect(html).toContain("AI により自動生成された");
  });

  it("免責事項・プライバシーポリシー・お問い合わせ（掲載削除依頼）への導線を持つ（F15）", () => {
    expect(html).toContain('href="/disclaimer"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/contact"');
  });
});
