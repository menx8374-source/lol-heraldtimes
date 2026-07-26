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

  it("5ch由来は「反応まとめ」見出し＋レス群のみになる(AI要約段落なし・まとめ速報レス形式)", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "5ch",
        title: "【LoL】パッチ14.6のジャングル弱体化について語るスレ",
        content:
          "1: 経験値ナーフでジャングラー涙目という意見が多数。\n序盤のレベル差がつきにくくなったとの声も。\n\n2: >>1\nわかる、正直きつい。",
      },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["反応まとめ"]);
    // AI導入段落・contextの雑談段落は無い(見出し＋reactionブロックのみ)
    expect(body.every((b) => b.type === "heading" || b.type === "reaction")).toBe(true);

    // レス群がreactionブロックとして番号付きで並んでいる(逐語表示・まとめ速報レス形式)
    const reactionBlocks = body.filter((b) => b.type === "reaction");
    expect(reactionBlocks).toHaveLength(2);
    expect(reactionBlocks.map((b) => (b.type === "reaction" ? b.number : -1))).toEqual([1, 2]);
    expect(reactionBlocks.every((b) => b.type === "reaction" && b.name === "国内プレイヤーさん")).toBe(true);

    // レス2は">>1"アンカーを持ち、参照先(1)が存在する
    const res2 = reactionBlocks[1];
    expect(res2.type === "reaction" && res2.anchors).toEqual([1]);

    // レス本文は逐語(元のcontentのまま)で保持されている(要約・言い換えされていない)
    const res1 = reactionBlocks[0];
    expect(res1.type === "reaction" && res1.lines.map((l) => l.text)).toEqual([
      "経験値ナーフでジャングラー涙目という意見が多数。",
      "序盤のレベル差がつきにくくなったとの声も。",
    ]);

    // quoteブロックは使わない(reaction形式では引用ではなく本文そのものとして扱う)
    expect(body.some((b) => b.type === "quote")).toBe(false);
  });

  it("reddit由来も5chと同じまとめ速報レス形式になり、名前は「海外プレイヤーさん」になる", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "reddit",
        title: "Patch 14.6 Jungle Nerf Discussion Thread",
        content: "1: Riot pushed a big jungle XP nerf in patch 14.6.\n2: Community reactions are mixed.",
      },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["反応まとめ"]);
    const reactionBlocks = body.filter((b) => b.type === "reaction");
    expect(reactionBlocks.every((b) => b.type === "reaction" && b.name === "海外プレイヤーさん")).toBe(true);
  });

  it("引用ブロックには出典ラベル(source)が付与される(riot由来)", async () => {
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

  it("clip由来は「注目クリップ」見出し＋紹介文＋embedブロック(youtube)の埋め込み紹介形式になる", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "clip",
        title: "LoLハイライト動画",
        content: "今週のLoL神プレイをまとめました。",
        sourceUrl: "https://www.youtube.com/watch?v=abc123",
      },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["注目クリップ"]);
    expect(body.some((b) => b.type === "paragraph")).toBe(true);
    const embeds = body.filter((b) => b.type === "embed");
    expect(embeds).toHaveLength(1);
    expect(embeds[0].type === "embed" && embeds[0].provider).toBe("youtube");
    expect(embeds[0].type === "embed" && embeds[0].url).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("clip由来のsourceUrlがTwitchクリップの場合はembedのproviderが clip になる", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "clip",
        title: "ヤスオの神プレイ",
        content: "配信者によるクリップ。",
        sourceUrl: "https://clips.twitch.tv/SampleClip",
      },
      llm,
    );
    const embeds = body.filter((b) => b.type === "embed");
    expect(embeds).toHaveLength(1);
    expect(embeds[0].type === "embed" && embeds[0].provider).toBe("clip");
  });

  it("「N: 」形式ではないcontent(fixture未整備等)は全体を1件のレスにフォールバックする", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "単発コメントのスレ", content: "壁飛びから連続でキャリーする神プレイに賞賛の声が相次いだ実況スレ。" },
      llm,
    );
    const reactionBlocks = body.filter((b) => b.type === "reaction");
    expect(reactionBlocks).toHaveLength(1);
    expect(reactionBlocks[0].type === "reaction" && reactionBlocks[0].number).toBe(1);
  });

  it("反応記事(5ch)の本文にYouTube URLが含まれるとembedブロックが1件追加される(拡張E22 F-E22-1)", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "5ch",
        title: "神プレイスレ",
        content: "1: これ見て https://youtu.be/dQw4w9WgXcQ 神プレイすぎる\n2: マジで草生えた",
      },
      llm,
    );
    const embeds = body.filter((b) => b.type === "embed");
    expect(embeds).toHaveLength(1);
    expect(embeds[0].type === "embed" && embeds[0].provider).toBe("youtube");
    expect(embeds[0].type === "embed" && embeds[0].url).toBe("https://youtu.be/dQw4w9WgXcQ");
    // 逐語テキストはそのまま保持されている(embedは加算のみ)
    const reactionBlocks = body.filter((b) => b.type === "reaction");
    expect(
      reactionBlocks[0].type === "reaction" &&
        reactionBlocks[0].lines.some((l) => l.text.includes("https://youtu.be/dQw4w9WgXcQ")),
    ).toBe(true);
  });

  it("反応記事(reddit)の本文にTwitchクリップURLが含まれるとembedブロック(provider=clip)が追加される", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "reddit",
        title: "Clip discussion",
        content: "1: check this out https://clips.twitch.tv/SampleClip amazing play",
      },
      llm,
    );
    const embeds = body.filter((b) => b.type === "embed");
    expect(embeds).toHaveLength(1);
    expect(embeds[0].type === "embed" && embeds[0].provider).toBe("clip");
  });

  it("クリップURLを含まない反応記事にはembedが増えない(回帰なし)", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "普通のスレ", content: "1: 普通の反応だけで特にURLは無い\n2: そうだね" },
      llm,
    );
    expect(body.some((b) => b.type === "embed")).toBe(false);
  });

  it("同一URLが重複して含まれる場合は重複排除され1件になる", async () => {
    const url = "https://youtu.be/dQw4w9WgXcQ";
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "重複URLスレ", content: `1: これ見て ${url}\n2: これも同じやつ ${url}` },
      llm,
    );
    const embeds = body.filter((b) => b.type === "embed");
    expect(embeds).toHaveLength(1);
  });

  it("クリップURLが4件以上あっても最大3件までしかembedを追加しない", async () => {
    const content = [
      "1: https://youtu.be/dQw4w9WgXcQ",
      "2: https://youtu.be/AbCdEfGhIjK",
      "3: https://clips.twitch.tv/ClipOne",
      "4: https://clips.twitch.tv/ClipTwo",
    ].join("\n");
    const body = await composeArticleBody({ sourceType: "5ch", title: "大量URLスレ", content }, llm);
    const embeds = body.filter((b) => b.type === "embed");
    expect(embeds).toHaveLength(3);
  });

  it("許可外ドメインのURL(twitter/x.com)が本文にあってもembedを追加しない(youtube/clipのみ検出対象)", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "5ch",
        title: "Xリンクスレ",
        content: "1: これ参照 https://x.com/example/status/123",
      },
      llm,
    );
    expect(body.some((b) => b.type === "embed")).toBe(false);
  });
});
