import { describe, expect, it } from "vitest";
import { composeArticleBody } from "@/lib/generation/compose";
import { MockLLMClient, type LLMClient, type LLMMessage } from "@/lib/generation/llm-client";
import { hasStructuredHeadings } from "@/lib/article-body";

const llm = new MockLLMClient();

/** テスト用のスタブLLMClient(拡張E25)。指定した応答文字列(または関数)をそのまま返す。実APIは叩かない。 */
class StubLLMClient implements LLMClient {
  public readonly calls: LLMMessage[][] = [];
  constructor(private readonly response: string | (() => string) | (() => never)) {}
  async generate(messages: LLMMessage[]): Promise<string> {
    this.calls.push(messages);
    return typeof this.response === "function" ? this.response() : this.response;
  }
}

/** 常に例外を投げるスタブLLMClient(APIエラー再現用)。 */
class ThrowingLLMClient implements LLMClient {
  async generate(): Promise<string> {
    throw new Error("simulated API error");
  }
}

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

describe("composeArticleBody（反応記事のLLMレス抜粋＋重要レス強調、拡張E25 F-E25-1/F-E25-2）", () => {
  const threeResContent = "1: 最初のレス。\n2: 二番目のレス。\n3: 三番目のレス。";

  it("LLMがkeep/emphasizeを返したとき、keepのレスだけが逐語で元スレ順に並び、emphasizeのレスに強調フラグが立つ", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [0, 2], emphasize: [2] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "抜粋テスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(2);
    expect(reactions.map((b) => (b.type === "reaction" ? b.number : -1))).toEqual([1, 3]);
    // レス本文は逐語のまま(LLMに書き換えさせない)
    expect(reactions[0].type === "reaction" && reactions[0].lines.map((l) => l.text)).toEqual(["最初のレス。"]);
    expect(reactions[1].type === "reaction" && reactions[1].lines.map((l) => l.text)).toEqual(["三番目のレス。"]);
    // emphasize指定(index=2 → レス3)にのみ強調フラグが立つ
    expect(reactions[0].type === "reaction" && reactions[0].emphasis).toBeUndefined();
    expect(reactions[1].type === "reaction" && reactions[1].emphasis).toBe(true);

    // LLMへはreaction-selectタスクとしてJSON(reses=index/number/text)が渡っている(逐語のまま伝える)
    const lastCall = stub.calls[stub.calls.length - 1];
    const userMessage = lastCall.find((m) => m.role === "user");
    expect(userMessage).toBeTruthy();
    const sentTask = JSON.parse(userMessage!.content) as { kind: string; reses: { text: string }[] };
    expect(sentTask.kind).toBe("reaction-select");
    expect(sentTask.reses.map((r) => r.text)).toEqual(["最初のレス。", "二番目のレス。", "三番目のレス。"]);
  });

  it("範囲外・重複・emphasize⊄keepのインデックスが正規化される(実在範囲・keep部分集合)", async () => {
    // keep: 0を重複、-1と99は範囲外(3レスなのでindexは0-2)。emphasize: 1はkeepに含まれないため除外、2は含まれるため採用。
    const stub = new StubLLMClient(JSON.stringify({ keep: [0, 0, -1, 99, 2], emphasize: [1, 2] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "正規化テスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions.map((b) => (b.type === "reaction" ? b.number : -1))).toEqual([1, 3]);
    expect(reactions[0].type === "reaction" && reactions[0].emphasis).toBeUndefined();
    expect(reactions[1].type === "reaction" && reactions[1].emphasis).toBe(true);
  });

  it("抜粋件数が上限(12件)を超える場合は先頭優先で切る", async () => {
    const content = Array.from({ length: 15 }, (_, i) => `${i + 1}: レス${i + 1}。`).join("\n");
    const allIndices = Array.from({ length: 15 }, (_, i) => i);
    const stub = new StubLLMClient(JSON.stringify({ keep: allIndices, emphasize: [] }));
    const body = await composeArticleBody({ sourceType: "5ch", title: "上限テスト", content }, stub);
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(12);
    expect(reactions.map((b) => (b.type === "reaction" ? b.number : -1))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("JSON parse失敗時は例外を投げず、全レス・強調なしにフォールバックする", async () => {
    const stub = new StubLLMClient("これはJSONではない応答です");
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "パース失敗テスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(3);
    expect(reactions.every((b) => b.type === "reaction" && b.emphasis === undefined)).toBe(true);
  });

  it("keepが空配列のとき、全レス・強調なしにフォールバックする", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [], emphasize: [] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "keep空テスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(3);
  });

  it("keepの要素が全て範囲外(不正)のとき、全レス・強調なしにフォールバックする", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [99, -1, "x"], emphasize: [] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "keep全不正テスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(3);
  });

  it("空文字の応答のとき、全レス・強調なしにフォールバックする", async () => {
    const stub = new StubLLMClient("");
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "空応答テスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(3);
  });

  it("LLM呼び出しが例外を投げても、例外を外に漏らさず全レス・強調なしにフォールバックする", async () => {
    const throwing = new ThrowingLLMClient();
    const body = await composeArticleBody(
      { sourceType: "reddit", title: "APIエラーテスト", content: threeResContent },
      throwing,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(3);
    expect(reactions.every((b) => b.type === "reaction" && b.emphasis === undefined)).toBe(true);
  });

  it("mockモード(MockLLMClient)では従来どおり全レス・強調なしになる(回帰なし)", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "mock回帰テスト", content: threeResContent },
      new MockLLMClient(),
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(3);
    expect(reactions.every((b) => b.type === "reaction" && b.emphasis === undefined)).toBe(true);
  });
});
