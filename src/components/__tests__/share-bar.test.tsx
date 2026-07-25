import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ShareBar } from "@/components/share-bar";
import { buildShareUrl } from "@/lib/share";

const URL = "https://example.com/articles/sample-slug";
const TITLE = "テスト記事";

describe("ShareBar（拡張E11: 固定シェアバー）", () => {
  const html = renderToStaticMarkup(<ShareBar url={URL} title={TITLE} />);

  it("PC用・モバイル用の2つのnav（同一aria-label）を描画する", () => {
    const navCount = (html.match(/<nav /g) ?? []).length;
    expect(navCount).toBe(2);
    expect(html).toContain('aria-label="この記事をシェア"');
  });

  it("PC用バーはlg:stickyで追従し、モバイル用バーはlg:hiddenでフォールバックする", () => {
    expect(html).toContain("lg:sticky");
    expect(html).toContain("lg:hidden");
  });

  it("Xが最優先(最初のリンク)としてaria-label付きで表示される", () => {
    const firstAnchorIndex = html.indexOf("<a ");
    const firstAriaLabelIndex = html.indexOf('aria-label="Xでシェア"');
    expect(firstAriaLabelIndex).toBeGreaterThan(-1);
    // 最初に出現するリンクがXであること(先頭・最優先)
    expect(html.indexOf('aria-label="Xでシェア"')).toBeLessThan(
      html.indexOf('aria-label="LINEでシェア"'),
    );
    expect(firstAnchorIndex).toBeLessThan(firstAriaLabelIndex + 20);
  });

  it("各リンクは新規タブ・noopener noreferrerでbuildShareUrlの結果を開く", () => {
    expect(html).toContain(`href="${buildShareUrl("x", URL, TITLE).replace(/&/g, "&amp;")}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("LINE・はてなブックマーク・Facebookも含む", () => {
    expect(html).toContain('aria-label="LINEでシェア"');
    expect(html).toContain('aria-label="はてなブックマークに追加"');
    expect(html).toContain('aria-label="Facebookでシェア"');
  });
});
