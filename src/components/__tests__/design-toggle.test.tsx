import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignToggle } from "@/components/design-toggle";

describe("DesignToggle（拡張E14: 標準/新聞風 セグメント切替）", () => {
  const html = renderToStaticMarkup(<DesignToggle />);

  it("「デザイン」ラベルと標準・新聞風の2択セグメントを持ち、切替機能だと分かる", () => {
    expect(html).toContain("デザイン");
    expect(html).toContain("標準");
    expect(html).toContain("新聞風");
    expect(html).toContain('aria-label="サイトの表示デザインを切り替え"');
    expect(html).toContain('type="button"');
  });

  it("SSR初期（既定=classic）は「標準」が選択中(aria-pressed=true)としてハイライトされる", () => {
    // getServerSnapshot が classic を返すため、標準ボタンが押下状態・新聞風が非押下になる。
    const standardActive = /標準<\/button>/.test(html) && html.includes('aria-pressed="true"');
    expect(standardActive).toBe(true);
    // 選択中は2択のうち1つだけ（新聞風は非押下）。
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
  });
});
