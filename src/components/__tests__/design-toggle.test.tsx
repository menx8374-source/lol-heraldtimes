import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignToggle } from "@/components/design-toggle";

describe("DesignToggle（拡張E14/E45: 標準/ニュース記事風/Hextech セグメント切替）", () => {
  const html = renderToStaticMarkup(<DesignToggle />);

  it("「デザイン」ラベルと標準・ニュース記事風・Hextechの3択セグメントを持ち、切替機能だと分かる", () => {
    expect(html).toContain("デザイン");
    expect(html).toContain("標準");
    expect(html).toContain("ニュース記事風");
    expect(html).toContain("Hextech");
    expect(html).toContain('aria-label="サイトの表示デザインを切り替え"');
    expect(html).toContain('type="button"');
  });

  it("SSR初期（既定=classic）は「標準」が選択中(aria-pressed=true)としてハイライトされる", () => {
    // getServerSnapshot が classic（クラス無しの既定選択肢）を返すため、標準ボタンだけが押下状態。
    const standardActive = /標準<\/button>/.test(html) && html.includes('aria-pressed="true"');
    expect(standardActive).toBe(true);
    // 選択中は3択のうち1つだけ（ニュース記事風・Hextechは非押下）。
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
  });
});
