import { describe, expect, it } from "vitest";
import { composeArticleBody } from "@/lib/generation/compose";
import { MockLLMClient, type LLMClient, type LLMMessage } from "@/lib/generation/llm-client";
import { hasStructuredHeadings } from "@/lib/article-body";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { findNgWord } from "@/lib/moderation/ng-words";
import { bodyBlocksToText } from "@/lib/search";

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

    // LLMへはreaction-selectタスクとしてJSON(reses=index/number/lines[行配列])が渡っている(逐語のまま伝える、拡張E28)
    const lastCall = stub.calls[stub.calls.length - 1];
    const userMessage = lastCall.find((m) => m.role === "user");
    expect(userMessage).toBeTruthy();
    const sentTask = JSON.parse(userMessage!.content) as { kind: string; reses: { lines: string[] }[] };
    expect(sentTask.kind).toBe("reaction-select");
    expect(sentTask.reses.map((r) => r.lines)).toEqual([
      ["最初のレス。"],
      ["二番目のレス。"],
      ["三番目のレス。"],
    ]);
  });

  it("LLMがコードフェンス付きJSON(```json ... ```)を返しても抜粋・強調が効く（拡張E26で頑健化）", async () => {
    const stub = new StubLLMClient("```json\n" + JSON.stringify({ keep: [1], emphasize: [1] }) + "\n```");
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "フェンステスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(1);
    expect(reactions[0].type === "reaction" && reactions[0].number).toBe(2);
    expect(reactions[0].type === "reaction" && reactions[0].lines.map((l) => l.text)).toEqual(["二番目のレス。"]);
    expect(reactions[0].type === "reaction" && reactions[0].emphasis).toBe(true);
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

describe("composeArticleBody（強調レスの色分け、拡張E32 F-E32-2）", () => {
  const threeResContent = "1: 最初のレス。\n2: 二番目のレス。\n3: 三番目のレス。";

  it("emphasize=[{index:1,color:'blue'}]のとき、レス2にemphasis:true＋emphasisColor:'blue'が付く", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [0, 1, 2], emphasize: [{ index: 1, color: "blue" }] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "色分けテスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions[1].type === "reaction" && reactions[1].emphasis).toBe(true);
    expect(reactions[1].type === "reaction" && reactions[1].emphasisColor).toBe("blue");
    // 他のレスは強調なし・色なし
    expect(reactions[0].type === "reaction" && reactions[0].emphasis).toBeUndefined();
    expect(reactions[0].type === "reaction" && reactions[0].emphasisColor).toBeUndefined();
  });

  it("emphasize=[1](数値・後方互換)のとき、レス2はemphasis:trueのみでemphasisColorは付かない", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [0, 1, 2], emphasize: [1] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "数値emphasizeテスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions[1].type === "reaction" && reactions[1].emphasis).toBe(true);
    expect(reactions[1].type === "reaction" && reactions[1].emphasisColor).toBeUndefined();
  });

  it("不正なcolor(例:'pink')は無視され色なしの強調になる", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [0, 1, 2], emphasize: [{ index: 1, color: "pink" }] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "不正色テスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions[1].type === "reaction" && reactions[1].emphasis).toBe(true);
    expect(reactions[1].type === "reaction" && reactions[1].emphasisColor).toBeUndefined();
  });

  it("emphasizeのindexがkeep外(例:{index:2,color:'green'}だがkeepは[0,1]のみ)なら色付き強調自体が付かない", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [0, 1], emphasize: [{ index: 2, color: "green" }] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "keep外emphasizeテスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(2);
    expect(reactions.every((b) => b.type === "reaction" && b.emphasis === undefined)).toBe(true);
  });

  it("mockモードでは従来どおり強調・色分けなし(回帰なし)", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "mock色分け回帰テスト", content: threeResContent },
      new MockLLMClient(),
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions.every((b) => b.type === "reaction" && b.emphasisColor === undefined)).toBe(true);
  });
});

describe("composeArticleBody（NGワードの伏字化、拡張E27 F-E27-2）", () => {
  it("反応記事(5ch)のレス本文にNGワードが含まれる場合、生成後の本文で伏字化される（生のNG語は残らない）", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "5ch",
        title: "【LoL】あるチャンピオンについて語るスレ",
        content: "1: このチャンピオンはカスだと思う\n2: 同意、正直ゴミだわ",
      },
      llm,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(2);
    const texts = reactions.flatMap((b) => (b.type === "reaction" ? b.lines.map((l) => l.text) : []));
    // 逐語は保たれつつNG語のみアスタリスクになっている
    expect(texts).toEqual(["このチャンピオンは**だと思う", "同意、正直**だわ"]);
    expect(texts.every((t) => findNgWord(t) === null)).toBe(true);
  });

  it("NGワードを含む反応記事(reddit)がmoderateArticleContentでng_word保留されず公開される（伏字化後の本文でfindNgWordがnull）", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "reddit",
        title: "Discussion about a champion",
        content: "1: This champion player is 死ね worthy according to some toxic fans",
      },
      llm,
    );
    const bodyText = bodyBlocksToText(body);
    expect(findNgWord(bodyText)).toBeNull();
    const result = moderateArticleContent({
      title: "Discussion about a champion",
      bodyText,
      sourceCount: 1,
    });
    expect(result.status).toBe("published");
  });

  it("NGワードを含まない反応記事は伏字化による変化がなく、従来どおり逐語のまま公開される（回帰なし）", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "普通のスレ", content: "1: 壁飛び5連続でキャリーとか草生える\n2: それな" },
      llm,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    const texts = reactions.flatMap((b) => (b.type === "reaction" ? b.lines.map((l) => l.text) : []));
    expect(texts).toEqual(["壁飛び5連続でキャリーとか草生える", "それな"]);
  });
});

describe("composeArticleBody（長レスのレス内文抽出、拡張E28 F-E28-2）", () => {
  // レス2(index=1)は3行構成の長レス。0行目・2行目は話題に沿った行、1行目は雑談行という想定。
  const multiLineContent =
    "1: 最初のレス。\n2: 二番目1行目。\n二番目2行目（余談）。\n二番目3行目。\n3: 三番目のレス。";

  it("keep=[{index,lines}]のとき、指定した行indexだけが逐語で残り、指定外の行は落ちる", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [{ index: 1, lines: [0, 2] }], emphasize: [] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "行抽出テスト", content: multiLineContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(1);
    expect(reactions[0].type === "reaction" && reactions[0].number).toBe(2);
    expect(reactions[0].type === "reaction" && reactions[0].lines.map((l) => l.text)).toEqual([
      "二番目1行目。",
      "二番目3行目。",
    ]);
  });

  it("keep=[1]（数値・後方互換）のとき、そのレスの全行が残る", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [1], emphasize: [] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "後方互換テスト", content: multiLineContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(1);
    expect(reactions[0].type === "reaction" && reactions[0].lines.map((l) => l.text)).toEqual([
      "二番目1行目。",
      "二番目2行目（余談）。",
      "二番目3行目。",
    ]);
  });

  it("linesに範囲外・重複が含まれるときは無視して正規化される（有効な行だけ元順で残る）", async () => {
    const stub = new StubLLMClient(
      JSON.stringify({ keep: [{ index: 1, lines: [2, 2, 99, -1, 0] }], emphasize: [] }),
    );
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "行正規化テスト", content: multiLineContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(1);
    // 0,2のみが有効(重複99/-1は無視)。元の行順(0→2)で残る。
    expect(reactions[0].type === "reaction" && reactions[0].lines.map((l) => l.text)).toEqual([
      "二番目1行目。",
      "二番目3行目。",
    ]);
  });

  it("linesが全て不正（範囲外のみ）のときは、そのレスの全行採用にフォールバックする", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [{ index: 1, lines: [99, -1] }], emphasize: [] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "行全不正テスト", content: multiLineContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(1);
    expect(reactions[0].type === "reaction" && reactions[0].lines.map((l) => l.text)).toEqual([
      "二番目1行目。",
      "二番目2行目（余談）。",
      "二番目3行目。",
    ]);
  });

  it("厳選プロンプト強化後もmock（全keep）時は従来どおり全レス・全行になる（回帰なし）", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "厳選プロンプト回帰テスト", content: multiLineContent },
      new MockLLMClient(),
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(3);
    expect(reactions[1].type === "reaction" && reactions[1].lines.map((l) => l.text)).toEqual([
      "二番目1行目。",
      "二番目2行目（余談）。",
      "二番目3行目。",
    ]);
  });

  it("抽出後の行にNG伏字・行強調・アンカーが整合的に効く（抽出前の行indexに依存しない）", async () => {
    // レス2(index=1): 0行目に「>>1」アンカー、1行目にNGワード「カス」、2行目に強調キーワード「草」。
    // keepでlines=[0,2]を指定し、NGワードを含む1行目を除外する。
    const content = "1: 最初のレス。\n2: >>1 その通り。\nこれはカスだと思う。\nこれは草生えるわ。\n3: 三番目。";
    const stub = new StubLLMClient(JSON.stringify({ keep: [{ index: 1, lines: [0, 2] }], emphasize: [1] }));
    const body = await composeArticleBody({ sourceType: "5ch", title: "整合性テスト", content }, stub);
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(1);
    const res = reactions[0];
    expect(res.type === "reaction" && res.lines.map((l) => l.text)).toEqual([">>1 その通り。", "これは草生えるわ。"]);
    // NGワード「カス」を含む行は除外されているので、伏字にする対象すら残らない(=NGワードは出てこない)
    expect(res.type === "reaction" && res.lines.every((l) => findNgWord(l.text) === null)).toBe(true);
    // アンカー(>>1)は抽出後の0行目に残っているので検出される
    expect(res.type === "reaction" && res.anchors).toEqual([1]);
    // 強調: 抽出後の行配列で計算されるため、抽出後1行目("これは草生えるわ")がred強調になる
    expect(res.type === "reaction" && res.lines[1].emphasis).toBe("red");
    expect(res.type === "reaction" && res.lines[0].emphasis).toBe("orange");
    expect(res.type === "reaction" && res.emphasis).toBe(true);
  });
});
