import { describe, expect, it } from "vitest";
import { linkifyText } from "@/lib/linkify";

describe("linkifyText（reactqual-S2 F-RQ2-1、バグ4修正）", () => {
  it("URLを含まない文字列は1つのtextセグメント(value=元text)を返す", () => {
    const segs = linkifyText("普通の反応です");
    expect(segs).toEqual([{ type: "text", value: "普通の反応です" }]);
  });

  it("文中に1つURLがある場合、[前テキスト, link, 後テキスト]の順で返す", () => {
    const segs = linkifyText("見て→https://example.com/path すごい");
    expect(segs).toEqual([
      { type: "text", value: "見て→" },
      { type: "link", value: "https://example.com/path", href: "https://example.com/path" },
      { type: "text", value: " すごい" },
    ]);
  });

  it("複数URLがある場合はテキストとリンクが交互になる", () => {
    const segs = linkifyText("1つ目 https://a.example/1 と2つ目 https://b.example/2 だよ");
    expect(segs).toEqual([
      { type: "text", value: "1つ目 " },
      { type: "link", value: "https://a.example/1", href: "https://a.example/1" },
      { type: "text", value: " と2つ目 " },
      { type: "link", value: "https://b.example/2", href: "https://b.example/2" },
      { type: "text", value: " だよ" },
    ]);
  });

  it("URL末尾の句読点はリンクに含めず後続テキストに回す（全角句読点）", () => {
    const segs = linkifyText("これ→https://x.com/a。続き");
    const link = segs.find((s) => s.type === "link");
    expect(link?.href).toBe("https://x.com/a");
    expect(link?.value).not.toContain("。");
    const tailText = segs[segs.length - 1];
    expect(tailText).toEqual({ type: "text", value: "。続き" });
  });

  it("URL末尾の句読点はリンクに含めず後続テキストに回す（半角句読点）", () => {
    const segs = linkifyText("参考: https://x.com/a. 以上");
    const link = segs.find((s) => s.type === "link");
    expect(link?.href).toBe("https://x.com/a");
    expect(link?.value.endsWith(".")).toBe(false);
  });

  it("javascript:等 http/https以外のスキームはリンク化されない（危険スキーム排除）", () => {
    const segs = linkifyText("javascript:alert(1) を試す");
    expect(segs).toEqual([{ type: "text", value: "javascript:alert(1) を試す" }]);
    expect(segs.some((s) => s.type === "link")).toBe(false);
  });

  it("data:スキームもリンク化されない", () => {
    const segs = linkifyText("data:text/html,<script>alert(1)</script> を貼る人がいた");
    expect(segs.some((s) => s.type === "link")).toBe(false);
  });

  it("全セグメントのvalueを連結すると元のtextに完全一致する（逐語不変）", () => {
    const samples = [
      "普通のテキスト",
      "見て→https://example.com/path←すごい",
      "1つ目 https://a.example/1 と2つ目 https://b.example/2 だよ",
      "これ→https://x.com/a。続き",
      "javascript:alert(1) を試す",
      "",
    ];
    for (const text of samples) {
      const segs = linkifyText(text);
      expect(segs.map((s) => s.value).join("")).toBe(text);
    }
  });

  it("空文字列は1つのtextセグメント(空文字)を返す", () => {
    expect(linkifyText("")).toEqual([{ type: "text", value: "" }]);
  });

  it("hrefはlinkセグメントのみに付与され、valueと同じ絶対URLになる", () => {
    const segs = linkifyText("https://example.com/only");
    expect(segs).toEqual([{ type: "link", value: "https://example.com/only", href: "https://example.com/only" }]);
  });
});
