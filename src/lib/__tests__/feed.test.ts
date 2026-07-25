/**
 * RSS フィード組み立て（拡張E4）の純関数テスト。XMLエスケープ・アイテム構成を検証する。
 */
import { describe, expect, it } from "vitest";
import { buildRssFeed, escapeXml, type FeedItem } from "@/lib/feed";

describe("escapeXml", () => {
  it("XML予約文字をすべて実体参照に置き換える", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  it("予約文字を含まない文字列はそのまま返す", () => {
    expect(escapeXml("通常の日本語テキスト")).toBe("通常の日本語テキスト");
  });
});

describe("buildRssFeed", () => {
  const baseItem: FeedItem = {
    title: "テスト記事タイトル",
    url: "https://example.com/articles/test-slug",
    description: "テスト記事の抜粋です。",
    publishedAt: new Date("2026-07-20T00:00:00+09:00"),
  };

  it("正しいRSS 2.0構造（channel/title/link/description/item）を組み立てる", () => {
    const xml = buildRssFeed({
      siteUrl: "https://example.com",
      title: "サイトタイトル",
      description: "サイトの説明",
      items: [baseItem],
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<rss version=\"2.0\"");
    expect(xml).toContain("<channel>");
    expect(xml).toContain("<title>サイトタイトル</title>");
    expect(xml).toContain("<link>https://example.com</link>");
    expect(xml).toContain("<item>");
    expect(xml).toContain("<title>テスト記事タイトル</title>");
    expect(xml).toContain("<link>https://example.com/articles/test-slug</link>");
    expect(xml).toContain("<description>テスト記事の抜粋です。</description>");
    expect(xml).toContain("<guid isPermaLink=\"true\">https://example.com/articles/test-slug</guid>");
  });

  it("タイトル・抜粋に含まれる予約文字（<や&等）をエスケープし、XMLタグとして解釈されないようにする", () => {
    const xml = buildRssFeed({
      siteUrl: "https://example.com",
      title: "サイトタイトル",
      description: "サイトの説明",
      items: [
        {
          ...baseItem,
          title: "海外の反応 <script>alert(1)</script> & 続報",
          description: "本文に < と & と \"引用\" を含む",
        },
      ],
    });

    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&quot;引用&quot;");
  });

  it("記事0件でも channel 構造自体は壊れずに組み立てられる", () => {
    const xml = buildRssFeed({
      siteUrl: "https://example.com",
      title: "サイトタイトル",
      description: "サイトの説明",
      items: [],
    });

    expect(xml).toContain("<channel>");
    expect(xml).toContain("</channel>");
    expect(xml).not.toContain("<item>");
  });

  it("複数記事は渡した順にitemを並べる", () => {
    const xml = buildRssFeed({
      siteUrl: "https://example.com",
      title: "サイトタイトル",
      description: "サイトの説明",
      items: [
        { ...baseItem, title: "記事A" },
        { ...baseItem, title: "記事B" },
      ],
    });

    const indexA = xml.indexOf("記事A");
    const indexB = xml.indexOf("記事B");
    expect(indexA).toBeGreaterThan(-1);
    expect(indexB).toBeGreaterThan(indexA);
  });
});
