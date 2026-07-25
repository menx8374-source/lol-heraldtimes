import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignToggle } from "@/components/design-toggle";

describe("DesignToggle（拡張E14: 現行/ニュースデザイン切替）", () => {
  it("SSR初期表示（未保存=classic想定）はニュース切替を促すラベルとaria-labelを持つ", () => {
    const html = renderToStaticMarkup(<DesignToggle />);
    expect(html).toContain("ニュース");
    expect(html).toContain('aria-label="デザイン切替"');
    expect(html).toContain('type="button"');
  });
});
