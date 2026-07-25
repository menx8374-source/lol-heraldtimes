import { describe, expect, it, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdSlot } from "@/components/ad-slot";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("AdSlot（拡張E11: 未設定時は非表示）", () => {
  it("広告コード未設定時は何も描画しない（null、枠・ラベル・余白も残さない）", () => {
    delete process.env.AD_SLOT_SIDEBAR;
    const html = renderToStaticMarkup(<AdSlot position="sidebar" />);
    expect(html).toBe("");
  });

  it("空白のみのコードも未設定として扱い何も描画しない", () => {
    process.env.AD_SLOT_ARTICLE_TOP = "   ";
    const html = renderToStaticMarkup(<AdSlot position="article-top" />);
    expect(html).toBe("");
  });

  it("広告コード設定時は「広告 / PR」ラベル付きの枠にコードを描画する", () => {
    process.env.AD_SLOT_ARTICLE_BOTTOM = "<div>AD-CODE</div>";
    const html = renderToStaticMarkup(<AdSlot position="article-bottom" />);
    expect(html).toContain("広告 / PR");
    expect(html).toContain("AD-CODE");
    expect(html).toContain('data-ad-slot="article-bottom"');
  });
});
