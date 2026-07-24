import { describe, expect, it } from "vitest";
import { composeArticleBody } from "@/lib/generation/compose";
import { MockLLMClient } from "@/lib/generation/llm-client";
import { hasStructuredHeadings } from "@/lib/article-body";

const llm = new MockLLMClient();

describe("composeArticleBody", () => {
  it("Riot公式(riot)由来は「速報」→「要点整理」→「まとめ」の見出し構成になる", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ14.6ノート公開",
        content: "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
      },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["速報", "要点整理", "まとめ"]);
    expect(hasStructuredHeadings(body)).toBe(true);
    // 事実の要点を引用として保持している(出典裏付け)
    expect(body.some((b) => b.type === "quote")).toBe(true);
  });

  it("5ch/Reddit由来は「話題」→「寄せられた反応」→「まとめ」の見出し構成になる(複数の反応を要約して並べる)", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "5ch",
        title: "【LoL】パッチ14.6のジャングル弱体化について語るスレ",
        content: "経験値ナーフでジャングラー涙目という意見が多数。序盤のレベル差がつきにくくなったとの声も。",
      },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["話題", "寄せられた反応", "まとめ"]);

    // 元ソースの2文それぞれが「反応」として個別の段落+引用のペアで並んでいる(複数の反応を要約して並べる構成)
    const quoteBlocks = body.filter((b) => b.type === "quote");
    expect(quoteBlocks.length).toBe(2);
  });

  it("reddit由来も5chと同じ反応まとめ構成になる", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "reddit",
        title: "Patch 14.6 Jungle Nerf Discussion Thread",
        content: "Riot pushed a big jungle XP nerf in patch 14.6. Community reactions are mixed.",
      },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["話題", "寄せられた反応", "まとめ"]);
  });

  it("引用ブロックには出典ラベル(source)が付与される", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "テスト発表", content: "これはテスト用の公式発表内容です。詳細は追って告知される。" },
      llm,
    );
    const quotes = body.filter((b) => b.type === "quote");
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) {
      expect(q.source).toBeTruthy();
    }
  });
});
