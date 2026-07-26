import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeArticleBody, extractPatchChangesDeterministic } from "@/lib/generation/compose";
import { MockLLMClient, type LLMClient, type LLMMessage } from "@/lib/generation/llm-client";
import { hasStructuredHeadings, blockText } from "@/lib/article-body";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { findNgWord } from "@/lib/moderation/ng-words";
import { bodyBlocksToText } from "@/lib/search";
import { computeVerbatimMatchRatio } from "@/lib/generation/verbatim";

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

/**
 * env `PATCH_ARTICLE_MODE` を一時的に指定して関数を実行する(拡張E41 F-E41-2)。
 * "summary"を指定するテストは、後でLLMまとめに戻すとき用に残した従来のE40 3段フォールバックの
 * 回帰確認用。実行後は元の値(未設定含む)に復元する。
 */
async function withPatchMode<T>(mode: "fact" | "summary", fn: () => Promise<T>): Promise<T> {
  const prev = process.env.PATCH_ARTICLE_MODE;
  process.env.PATCH_ARTICLE_MODE = mode;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.PATCH_ARTICLE_MODE;
    else process.env.PATCH_ARTICLE_MODE = prev;
  }
}

describe("composeArticleBody", () => {
  it("Riot公式(riot)由来は既定(PATCH_ARTICLE_MODE未設定)で事実速報(見出し「パッチ<番号>が公開」＋事実段落＋公式リンクボタン)になる（拡張E41 F-E41-2、拡張E42 F-E42-4）", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ14.6ノート公開",
        content: "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
        sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-14-6-notes",
      },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["パッチ14.6が公開"]);
    expect(hasStructuredHeadings(body)).toBe(true);
    // 事実速報はLLM非依存の定型文のみで、引用(quote)ブロックは使わない
    expect(body.some((b) => b.type === "quote")).toBe(false);
    const bodyText = body.map(blockText).join("");
    expect(bodyText).not.toContain("自動要約では");
    expect(bodyText).toContain("14.6");
    // imageUrl未指定なら画像ブロックは省略され、末尾は公式リンクボタン(linkButton)になる（拡張E42）
    expect(body.some((b) => b.type === "image")).toBe(false);
    const linkButtons = body.filter((b) => b.type === "linkButton");
    expect(linkButtons).toHaveLength(1);
    expect(linkButtons[0].type === "linkButton" && linkButtons[0].url).toBe(
      "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-14-6-notes",
    );
    expect(linkButtons[0].type === "linkButton" && linkButtons[0].label).toContain("14.6");
    expect(body[body.length - 1].type).toBe("linkButton");
  });

  it("imageUrl(安全なhttps)が渡されると本文先頭がimageブロックになり、見出し→段落→linkButtonの順で続く（拡張E42 F-E42-4）", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ14.6ノート公開",
        content: "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
        sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-14-6-notes",
        imageUrl: "https://cmsassets.rgpub.io/sanity/images/patch-14-6-banner-1920x1087.jpg",
      },
      llm,
    );
    expect(body[0].type).toBe("image");
    expect(body[0].type === "image" && body[0].url).toBe(
      "https://cmsassets.rgpub.io/sanity/images/patch-14-6-banner-1920x1087.jpg",
    );
    expect(body[0].type === "image" && body[0].alt).toContain("14.6");
    expect(body[0].type === "image" && body[0].credit).toContain("Riot Games");
    expect(body[1]).toEqual({ type: "heading", text: "パッチ14.6が公開" });
    expect(body.some((b) => b.type === "paragraph")).toBe(true);
    expect(body[body.length - 1].type).toBe("linkButton");

    // 本文blockText合計がMIN_BODY_LENGTH(300)以上で、generate-articleでGenerationErrorにならない
    const totalLength = body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeGreaterThanOrEqual(300);
  });

  it("imageUrlが不安全(http等)なら画像ブロックを省略する（拡張E42）", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ14.6ノート公開",
        content: "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
        sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-14-6-notes",
        imageUrl: "http://cmsassets.rgpub.io/sanity/images/insecure.jpg",
      },
      llm,
    );
    expect(body.some((b) => b.type === "image")).toBe(false);
  });

  it("imageUrlが無い場合でも本文blockText合計がMIN_BODY_LENGTH(300)以上を満たす（拡張E42 F-E42-4）", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ14.6ノート公開",
        content: "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
        sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-14-6-notes",
      },
      llm,
    );
    const totalLength = body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeGreaterThanOrEqual(300);
  });

  it("PATCH_ARTICLE_MODE=summaryのとき、riot由来(短い汎用content)は従来どおり「速報」→「要点整理」→「まとめ」の見出し構成になる(回帰なし)", async () => {
    const body = await withPatchMode("summary", () =>
      composeArticleBody(
        {
          sourceType: "riot",
          title: "パッチ14.6ノート公開",
          content: "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
        },
        llm,
      ),
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

  it("PATCH_ARTICLE_MODE=summaryのとき、引用ブロックには出典ラベル(source)が付与される(riot由来、回帰なし)", async () => {
    const body = await withPatchMode("summary", () =>
      composeArticleBody(
        { sourceType: "riot", title: "テスト発表", content: "これはテスト用の公式発表内容です。詳細は追って告知される。" },
        llm,
      ),
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

  it("JSON parse失敗時は例外を投げず全レスにフォールバックし、拡張E33の色付き強調最低保証が効く", async () => {
    const stub = new StubLLMClient("これはJSONではない応答です");
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "パース失敗テスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(3);
    // LLM選定が効かず強調ゼロなので、拡張E33の決定論フォールバックで最も長いレス(2番目)にのみ色が付く
    expect(reactions[1].type === "reaction" && reactions[1].emphasis).toBe(true);
    expect(reactions[1].type === "reaction" && reactions[1].emphasisColor).toBe("red");
    expect(reactions[0].type === "reaction" && reactions[0].emphasis).toBeUndefined();
    expect(reactions[2].type === "reaction" && reactions[2].emphasis).toBeUndefined();
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

  it("LLM呼び出しが例外を投げても、例外を外に漏らさず全レスにフォールバックし、拡張E33の色付き強調最低保証が効く", async () => {
    const throwing = new ThrowingLLMClient();
    const body = await composeArticleBody(
      { sourceType: "reddit", title: "APIエラーテスト", content: threeResContent },
      throwing,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(3);
    expect(reactions[1].type === "reaction" && reactions[1].emphasis).toBe(true);
    expect(reactions[1].type === "reaction" && reactions[1].emphasisColor).toBe("red");
  });

  it("mockモード(MockLLMClient)は全レス・強調なしが元だが、拡張E33の色付き強調最低保証で全黒字にならない", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "mock回帰テスト", content: threeResContent },
      new MockLLMClient(),
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(3);
    // 2件以上あるので必ずどれかに色付き強調が付く(全黒字にならない、拡張E33)
    expect(reactions.some((b) => b.type === "reaction" && b.emphasis === true)).toBe(true);
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

  it("emphasizeのindexがkeep外(例:{index:2,color:'purple'}だがkeepは[0,1]のみ)ならLLM選定の色付き強調は付かないが、拡張E33の最低保証で色が付く", async () => {
    const stub = new StubLLMClient(JSON.stringify({ keep: [0, 1], emphasize: [{ index: 2, color: "purple" }] }));
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "keep外emphasizeテスト", content: threeResContent },
      stub,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(2);
    // LLM選定は無効化されるが、2件以上・強調ゼロなので拡張E33の決定論フォールバックが効く
    // (長いレス優先で2番目のレスに色が付く)
    expect(reactions[1].type === "reaction" && reactions[1].emphasis).toBe(true);
    expect(reactions[1].type === "reaction" && reactions[1].emphasisColor).toBe("red");
    expect(reactions[0].type === "reaction" && reactions[0].emphasis).toBeUndefined();
  });

  it("mockモードは強調・色分けが元は無いが、拡張E33の色付き強調最低保証で全黒字にならない", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "mock色分け回帰テスト", content: threeResContent },
      new MockLLMClient(),
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions.some((b) => b.type === "reaction" && b.emphasisColor !== undefined)).toBe(true);
  });
});

describe("composeArticleBody（NG文の削除、拡張E36 F-E36-3。伏字化(拡張E27)からの置き換え）", () => {
  it("NGワードを含む文だけが削除され、残りの文で意味が通れば結合されて掲載される（逐語は保たれ、伏字は使わない）", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "5ch",
        title: "【LoL】あるチャンピオンについて語るスレ",
        content: "1: このチャンピオンはカスだと思う。でも強いと思う。\n2: 普通の反応だけ。",
      },
      llm,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(2);
    const texts = reactions.flatMap((b) => (b.type === "reaction" ? b.lines.map((l) => l.text) : []));
    // NG文("このチャンピオンはカスだと思う。")のみ削除され、残りの文("でも強いと思う。")だけが残る
    expect(texts).toEqual(["でも強いと思う。", "普通の反応だけ。"]);
    expect(texts.every((t) => findNgWord(t) === null)).toBe(true);
    // 伏字(*)化はしない
    expect(texts.some((t) => t.includes("*"))).toBe(false);
  });

  it("行の全文がNGで消えた場合はその行を落とし、レスの全行が空になった場合はそのレス自体を不掲載にする", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "5ch",
        title: "【LoL】語るスレ",
        content: "1: 通常の反応だけ。\n2: カスすぎる。ゴミだと思う。",
      },
      llm,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    // レス2は全文がNGで消え意味が通らないため不掲載。レス1のみ残る。
    expect(reactions).toHaveLength(1);
    expect(reactions[0].type === "reaction" && reactions[0].number).toBe(1);
  });

  it("NGワードを含む反応記事(reddit)がmoderateArticleContentでng_word保留されず公開される（NG文削除後の本文でfindNgWordがnull）", async () => {
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

  it("NGワードを含まない反応記事は変化がなく、従来どおり逐語のまま公開される（回帰なし）", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "普通のスレ", content: "1: 壁飛び5連続でキャリーとか草生える\n2: それな" },
      llm,
    );
    const reactions = body.filter((b) => b.type === "reaction");
    const texts = reactions.flatMap((b) => (b.type === "reaction" ? b.lines.map((l) => l.text) : []));
    expect(texts).toEqual(["壁飛び5連続でキャリーとか草生える", "それな"]);
  });
});

describe("composeArticleBody（表示レスの返信先(アンカー先)の引用、拡張E41 F-E41-1）", () => {
  it("表示レスが>>Nを含み、Nがcontentに存在するとき、Nも文脈として追加されレス番号順(N→表示レス)で並ぶ", async () => {
    const content =
      "58: 拮抗してるゲームだった。\n59: 何でもない話。\n60: これも何でもない話。\n61: >>58 拮抗してるゲームが面白かった。";
    const stub = new StubLLMClient(JSON.stringify({ keep: [3], emphasize: [] })); // index3 = レス61のみ選定
    const body = await composeArticleBody({ sourceType: "5ch", title: "アンカー文脈テスト", content }, stub);
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(2);
    expect(reactions.map((b) => (b.type === "reaction" ? b.number : -1))).toEqual([58, 61]);
    // 追加された文脈レス(58)は全行・強調なし
    const context = reactions[0];
    expect(context.type === "reaction" && context.lines.map((l) => l.text)).toEqual(["拮抗してるゲームだった。"]);
    expect(context.type === "reaction" && context.emphasis).toBeUndefined();
    expect(context.type === "reaction" && context.emphasisColor).toBeUndefined();
  });

  it("参照先(>>N)が存在しない番号なら追加されない(従来どおり)", async () => {
    const content = "58: 拮抗してるゲームだった。\n61: >>999 存在しない番号への返信。";
    const stub = new StubLLMClient(JSON.stringify({ keep: [1], emphasize: [] })); // index1 = レス61のみ選定
    const body = await composeArticleBody({ sourceType: "5ch", title: "アンカー不在テスト", content }, stub);
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(1);
    expect(reactions[0].type === "reaction" && reactions[0].number).toBe(61);
  });

  it("アンカー先追加は1階層のみ(追加した文脈レスがさらに参照する先は辿らない)", async () => {
    const content =
      "50: 更に前の本文。\n58: >>50 それな。拮抗してるゲームだった。\n59: 何でもない話。\n61: >>58 拮抗してるゲームが面白かった。";
    const stub = new StubLLMClient(JSON.stringify({ keep: [3], emphasize: [] })); // index3 = レス61のみ選定
    const body = await composeArticleBody({ sourceType: "5ch", title: "1階層のみテスト", content }, stub);
    const reactions = body.filter((b) => b.type === "reaction");
    // 61の参照先58は追加されるが、58がさらに参照する50までは辿らない
    expect(reactions.map((b) => (b.type === "reaction" ? b.number : -1))).toEqual([58, 61]);
  });

  it("keepで行を絞った場合、絞った行のアンカーのみ対象になる(アンカー行を除外すれば追加されない)", async () => {
    const content = "58: 参照される側の本文。\n61: 普通のコメント。\n>>58 それな。";
    // 行0(アンカー無し)のみ採用: アンカーが対象行に含まれないため58は追加されない
    const stubExcluding = new StubLLMClient(JSON.stringify({ keep: [{ index: 1, lines: [0] }], emphasize: [] }));
    const bodyExcluding = await composeArticleBody(
      { sourceType: "5ch", title: "行絞り込みテスト(除外)", content },
      stubExcluding,
    );
    const reactionsExcluding = bodyExcluding.filter((b) => b.type === "reaction");
    expect(reactionsExcluding).toHaveLength(1);
    expect(reactionsExcluding[0].type === "reaction" && reactionsExcluding[0].number).toBe(61);

    // 行1(アンカー行)を採用: アンカーが対象行に含まれるため58が追加される
    const stubIncluding = new StubLLMClient(JSON.stringify({ keep: [{ index: 1, lines: [1] }], emphasize: [] }));
    const bodyIncluding = await composeArticleBody(
      { sourceType: "5ch", title: "行絞り込みテスト(包含)", content },
      stubIncluding,
    );
    const reactionsIncluding = bodyIncluding.filter((b) => b.type === "reaction");
    expect(reactionsIncluding.map((b) => (b.type === "reaction" ? b.number : -1))).toEqual([58, 61]);
  });

  it("mock(全レス選定)では追加対象の参照先も既に選ばれているため件数は変化しない(回帰なし)", async () => {
    const content = "1: >>2 それな。\n2: 元の発言。";
    const body = await composeArticleBody({ sourceType: "5ch", title: "mock回帰テスト", content }, new MockLLMClient());
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(2);
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

  it("抽出後の行にNG除外・行強調・アンカーが整合的に効く（抽出前の行indexに依存しない）。拡張E41 F-E41-1で参照先(>>1)のレス1も文脈として追加される", async () => {
    // レス2(index=1): 0行目に「>>1」アンカー、1行目にNGワード「カス」、2行目に強調キーワード「草」。
    // keepでlines=[0,2]を指定し、NGワードを含む1行目を除外する。
    const content = "1: 最初のレス。\n2: >>1 その通り。\nこれはカスだと思う。\nこれは草生えるわ。\n3: 三番目。";
    const stub = new StubLLMClient(JSON.stringify({ keep: [{ index: 1, lines: [0, 2] }], emphasize: [1] }));
    const body = await composeArticleBody({ sourceType: "5ch", title: "整合性テスト", content }, stub);
    const reactions = body.filter((b) => b.type === "reaction");
    // レス2が>>1を参照しているため、参照先のレス1が文脈として追加され、レス番号順(1→2)で並ぶ(拡張E41 F-E41-1)。
    expect(reactions).toHaveLength(2);
    const context = reactions[0];
    expect(context.type === "reaction" && context.number).toBe(1);
    // 追加された文脈レスは全行・強調なし
    expect(context.type === "reaction" && context.lines.map((l) => l.text)).toEqual(["最初のレス。"]);
    expect(context.type === "reaction" && context.emphasis).toBeUndefined();

    const res = reactions[1];
    expect(res.type === "reaction" && res.number).toBe(2);
    expect(res.type === "reaction" && res.lines.map((l) => l.text)).toEqual([">>1 その通り。", "これは草生えるわ。"]);
    // NGワード「カス」を含む行はLLM選定(lines指定)の時点で除外されているので、そもそもNGワードは出てこない
    expect(res.type === "reaction" && res.lines.every((l) => findNgWord(l.text) === null)).toBe(true);
    // アンカー(>>1)は抽出後の0行目に残っているので検出される
    expect(res.type === "reaction" && res.anchors).toEqual([1]);
    // 強調: 抽出後の行配列で計算されるため、抽出後1行目("これは草生えるわ")がred強調になる
    expect(res.type === "reaction" && res.lines[1].emphasis).toBe("red");
    expect(res.type === "reaction" && res.lines[0].emphasis).toBe("orange");
    expect(res.type === "reaction" && res.emphasis).toBe(true);
  });
});

describe("composeArticleBody（riot公式パッチノートのまとめ記事生成、拡張E34 F-E34-2）", () => {
  // 拡張E41 F-E41-2でriotの既定は事実速報(fact)になったため、本describe(従来のsummary挙動)は
  // PATCH_ARTICLE_MODE=summaryに固定して実行する(後でLLMまとめに戻す用にコード・テストを残す)。
  let prevPatchMode: string | undefined;
  beforeAll(() => {
    prevPatchMode = process.env.PATCH_ARTICLE_MODE;
    process.env.PATCH_ARTICLE_MODE = "summary";
  });
  afterAll(() => {
    if (prevPatchMode === undefined) delete process.env.PATCH_ARTICLE_MODE;
    else process.env.PATCH_ARTICLE_MODE = prevPatchMode;
  });

  // PATCH_NOTES_MIN_LENGTH(300字)以上の「実パッチノート本文らしいcontent」(汎用の短いcontentとは別物)。
  const patchNotesContent = "実際のパッチノート本文らしいテキスト。".repeat(30);

  const validSummaryJson = JSON.stringify({
    buffed: [
      "ヤスオ: 基本攻撃力が4から8に引き上げられ、序盤のレーン戦の主導権を握りやすくなり、対面のマッチアップで有利に立ち回りやすくなった。",
      "アーリ: Qのクールダウンが1秒短縮され、連続でスキルを使いやすくなり、コンボの継続力が上がった。",
    ],
    nerfed: [
      "ゼド: シールドスキルの吸収量が20から15に引き下げられ、ダイブ後の生存力がやや下がった。",
      "カタリナ: リセット可能な条件が厳しくなり、連続でキルを取ることが難しくなった。",
    ],
    other: [
      "インフィニティエッジ: 価格が3400から3300に引き下げられ、序盤から購入しやすくなった。",
      "ジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなった。",
    ],
  });

  it("content が実パッチノート本文のとき、スタブLLMの要約が「まとめ体裁」本文(見出し＋要約)になる", async () => {
    const stub = new StubLLMClient(validSummaryJson);
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ14.6ノート公開", content: patchNotesContent },
      stub,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["主な強化チャンピオン", "主な弱体チャンピオン", "アイテム・その他の変更"]);
    // 見出し「速報」「要点整理」等の従来フォーマットにはならない(まとめ体裁への切り替わりを確認)
    expect(headings).not.toContain("速報");
    // 本文に要約テキストがそのまま含まれる(捏造ではなくLLMの要約結果を使っている)
    const paragraphs = body.filter((b) => b.type === "paragraph").map((b) => b.text);
    expect(paragraphs).toEqual([
      "ヤスオ: 基本攻撃力が4から8に引き上げられ、序盤のレーン戦の主導権を握りやすくなり、対面のマッチアップで有利に立ち回りやすくなった。",
      "アーリ: Qのクールダウンが1秒短縮され、連続でスキルを使いやすくなり、コンボの継続力が上がった。",
      "ゼド: シールドスキルの吸収量が20から15に引き下げられ、ダイブ後の生存力がやや下がった。",
      "カタリナ: リセット可能な条件が厳しくなり、連続でキルを取ることが難しくなった。",
      "インフィニティエッジ: 価格が3400から3300に引き下げられ、序盤から購入しやすくなった。",
      "ジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなった。",
    ]);
    // quoteブロックは使わない(まとめ体裁は見出し＋要約段落のみ)
    expect(body.some((b) => b.type === "quote")).toBe(false);

    // 本文最低文字数(300字)・逐語一致率・引用比率(generate-article.ts の受け入れ基準)を満たす
    const totalLength = body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeGreaterThanOrEqual(300);
    const generatedText = body.map(blockText).join("");
    expect(computeVerbatimMatchRatio(generatedText, patchNotesContent)).toBeLessThanOrEqual(0.5);
  });

  it("出典URL(sourceUrl)を伴う候補から生成しても、生成本文自体には変化がなく既存の出典付与(generate-article.ts)と組み合わせられる", async () => {
    const stub = new StubLLMClient(validSummaryJson);
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ14.6ノート公開",
        content: patchNotesContent,
        sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-14-6-notes/",
      },
      stub,
    );
    expect(body.some((b) => b.type === "heading")).toBe(true);
  });

  // 拡張E35 F-E35-3: 要約失敗時は composeFactBody（ノイズ本文の逐文リライト、破綻文の原因）には
  // 落とさず、見出し＋定型段落＋出典のみのクリーンな簡易パッチ記事にする。
  function expectCleanFallback(body: Awaited<ReturnType<typeof composeArticleBody>>) {
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    // 「速報」「要点整理」等の旧composeFactBody見出しにはならない(破綻文の温床だったフォーマットを回避)
    expect(headings).not.toEqual(["速報", "要点整理", "まとめ"]);
    expect(headings).toHaveLength(1);
    expect(headings[0]).toContain("の変更点");
    // quoteブロック(ページ内ノイズ断片の引用)は含まれない
    expect(body.some((b) => b.type === "quote")).toBe(false);
    // ページ内ノイズの断片("14 Notes"・"000Z"等)やLLM破綻文の温床になる逐語コピーはない
    const bodyText = body.map(blockText).join("");
    expect(bodyText).not.toContain("14 Notes");
    expect(bodyText).not.toContain("リライトできません");
    // 本文最低文字数(300字、generate-article.tsの受け入れ基準)を満たす
    const totalLength = body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeGreaterThanOrEqual(300);
  }

  it("content が実パッチノート本文だが mock LLM(MockLLMClient)のときはクリーンな簡易パッチ記事(composeFactBody非経由)になる", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ14.6ノート公開", content: patchNotesContent },
      new MockLLMClient(),
    );
    expectCleanFallback(body);
    expect(body.filter((b) => b.type === "heading")[0].text).toBe("パッチ14.6の変更点");
  });

  it("content が実パッチノート本文だがLLMが不正なJSON(要約失敗)を返す場合はクリーンな簡易パッチ記事になる", async () => {
    const stub = new StubLLMClient("これはJSONではない応答です");
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ14.6ノート公開", content: patchNotesContent },
      stub,
    );
    expectCleanFallback(body);
  });

  it("content が実パッチノート本文だがLLMが空文字を返す場合はクリーンな簡易パッチ記事になる", async () => {
    const stub = new StubLLMClient("");
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ14.6ノート公開", content: patchNotesContent },
      stub,
    );
    expectCleanFallback(body);
  });

  it("content が実パッチノート本文だが全カテゴリ空({buffed:[],nerfed:[],other:[]})の場合はクリーンな簡易パッチ記事になる", async () => {
    const stub = new StubLLMClient(JSON.stringify({ buffed: [], nerfed: [], other: [] }));
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ14.6ノート公開", content: patchNotesContent },
      stub,
    );
    expectCleanFallback(body);
  });

  it("content が実パッチノート本文だがパッチ要約のLLM呼び出しが例外を投げる場合は、例外を外に漏らさずクリーンな簡易パッチ記事になる", async () => {
    // パッチ要約タスク(kindフィールドを持たないJSON)のときだけ例外を投げるスタブ
    // (実際のAPIエラーで要約だけ失敗する状況の再現。フォールバックはcomposeFactBodyを経由しないため
    // 通常タスク用のMockLLMClient委譲は不要だが、他の呼び出しがあっても問題ないことも確認する)。
    class ThrowingOnlyForPatchSummary implements LLMClient {
      private readonly mock = new MockLLMClient();
      async generate(messages: LLMMessage[]): Promise<string> {
        const last = messages[messages.length - 1];
        if (last && !last.content.includes('"kind"')) {
          throw new Error("simulated patch-summary API error");
        }
        return this.mock.generate(messages);
      }
    }
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ14.6ノート公開", content: patchNotesContent },
      new ThrowingOnlyForPatchSummary(),
    );
    expectCleanFallback(body);
  });

  it("出典URL(sourceUrl)を伴う候補が要約失敗した場合、クリーン記事本文に出典URLが含まれる", async () => {
    const sourceUrl = "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-26-14-notes";
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ14.6ノート公開", content: patchNotesContent, sourceUrl },
      new MockLLMClient(),
    );
    expectCleanFallback(body);
    const bodyText = body.map(blockText).join("");
    expect(bodyText).toContain(sourceUrl);
  });

  it("content が汎用(パッチ本文無し、PATCH_NOTES_MIN_LENGTH未満)の場合は、LLMが有効な要約JSONを返してもLLM要約を試みず従来どおりの速報＋要点整理になる(回帰なし)", async () => {
    const stub = new StubLLMClient(validSummaryJson);
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ14.6ノート公開",
        content: "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
      },
      stub,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["速報", "要点整理", "まとめ"]);
  });

  it("コードフェンス付きJSON(```json ... ```)を返してもまとめ体裁が組み立てられる(拡張E26と同様の頑健化)", async () => {
    const stub = new StubLLMClient("```json\n" + validSummaryJson + "\n```");
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ14.6ノート公開", content: patchNotesContent },
      stub,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["主な強化チャンピオン", "主な弱体チャンピオン", "アイテム・その他の変更"]);
  });

  it("LLMが一部カテゴリのみ返した場合(例: nerfedが空)は、該当する見出しのみ組み立てられる", async () => {
    const stub = new StubLLMClient(
      JSON.stringify({
        buffed: ["ヤスオ: 基本攻撃力が4から8に引き上げられた。"],
        nerfed: [],
        other: ["インフィニティエッジ: 価格が3400から3300に引き下げられた。"],
      }),
    );
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ14.6ノート公開", content: patchNotesContent },
      stub,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["主な強化チャンピオン", "アイテム・その他の変更"]);
  });
});

describe("composeArticleBody（色付き強調の最低保証、拡張E33 F-E33-1）", () => {
  // 8レス・文字数が単調増加(A=1文字〜H=8文字)なので、長いレス優先の並びが一意に決まる。
  const eightResContent = Array.from({ length: 8 }, (_, i) => `${i + 1}: ${"X".repeat(i + 1)}`).join("\n");

  it("反応レス2件以上・強調ゼロの記事に、決定論的にminColored件の色付き強調が付く(長いレス優先・red→blue→purple→orangeの順、拡張E36で緑を廃止)", async () => {
    const stub = new StubLLMClient(
      JSON.stringify({ keep: Array.from({ length: 8 }, (_, i) => i), emphasize: [] }),
    );
    const body = await composeArticleBody({ sourceType: "5ch", title: "色最低保証テスト", content: eightResContent }, stub);
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(8);
    // minColored = max(1, round(8/4)) = 2件。最も長いレス(8文字目=index7)がred、次点(7文字目=index6)がblue。
    expect(reactions[7].type === "reaction" && reactions[7].emphasis).toBe(true);
    expect(reactions[7].type === "reaction" && reactions[7].emphasisColor).toBe("red");
    expect(reactions[6].type === "reaction" && reactions[6].emphasis).toBe(true);
    expect(reactions[6].type === "reaction" && reactions[6].emphasisColor).toBe("blue");
    // それ以外のレスには色が付かない
    for (const r of reactions.slice(0, 6)) {
      expect(r.type === "reaction" && r.emphasis).toBeUndefined();
    }
  });

  it("既にいずれかのレスに強調が付いている記事は変更されない(LLM選定を尊重)", async () => {
    const threeResContent = "1: 最初のレス。\n2: 二番目のレス。\n3: 三番目のレス。";
    const stub = new StubLLMClient(
      JSON.stringify({ keep: [0, 1, 2], emphasize: [{ index: 0, color: "purple" }] }),
    );
    const body = await composeArticleBody({ sourceType: "5ch", title: "既存強調尊重テスト", content: threeResContent }, stub);
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions[0].type === "reaction" && reactions[0].emphasis).toBe(true);
    expect(reactions[0].type === "reaction" && reactions[0].emphasisColor).toBe("purple");
    // フォールバックは発動せず、他のレスに勝手に色は付かない
    expect(reactions[1].type === "reaction" && reactions[1].emphasis).toBeUndefined();
    expect(reactions[2].type === "reaction" && reactions[2].emphasis).toBeUndefined();
  });

  it("反応レス1件の記事には色を強制しない", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "単発レステスト", content: "1: 唯一のレスです。" },
      new MockLLMClient(),
    );
    const reactions = body.filter((b) => b.type === "reaction");
    expect(reactions).toHaveLength(1);
    expect(reactions[0].type === "reaction" && reactions[0].emphasis).toBeUndefined();
    expect(reactions[0].type === "reaction" && reactions[0].emphasisColor).toBeUndefined();
  });

  it("mock既定(強調なし)でも2件以上なら色が付き、決定論で毎回同じ結果になる(再現性)", async () => {
    const content = "1: 最初のレス。\n2: 二番目のレス。\n3: 三番目のレス。";
    const body1 = await composeArticleBody({ sourceType: "5ch", title: "再現性テスト", content }, new MockLLMClient());
    const body2 = await composeArticleBody({ sourceType: "5ch", title: "再現性テスト", content }, new MockLLMClient());
    const colors1 = body1.filter((b) => b.type === "reaction").map((b) => (b.type === "reaction" ? b.emphasisColor : undefined));
    const colors2 = body2.filter((b) => b.type === "reaction").map((b) => (b.type === "reaction" ? b.emphasisColor : undefined));
    expect(colors1).toEqual(colors2);
    expect(colors1.some((c) => c !== undefined)).toBe(true);
  });

  it("逐語（本文テキスト）は不変。色付き強調が付いてもレス本文・行は書き換わらない", async () => {
    const content = "1: 最初のレス。\n2: 二番目のレス。\n3: 三番目のレス。";
    const body = await composeArticleBody({ sourceType: "5ch", title: "逐語不変テスト", content }, new MockLLMClient());
    const reactions = body.filter((b) => b.type === "reaction");
    const texts = reactions.flatMap((b) => (b.type === "reaction" ? b.lines.map((l) => l.text) : []));
    expect(texts).toEqual(["最初のレス。", "二番目のレス。", "三番目のレス。"]);
  });
});

describe("extractPatchChangesDeterministic（変更点の決定的・逐語抽出、拡張E40 F-E40-2）", () => {
  it("チャンピオン名の単独行を節開始とみなし、「⇒」を含む行のみを逐語で抽出する（直前の非空行を文脈として前置）", () => {
    const text = [
      "パッチ26.14ノートへようこそ。",
      "エディタ: サンプルライター",
      "T1がLCKを制覇し3連覇を達成しました。",
      "",
      "アジール",
      "基本ステータス",
      "攻撃力: 55 ⇒ 58",
      "",
      "ガレン",
      "R - デマーシアの正義",
      "確定ダメージ: 150/250/350 ⇒ 130/230/330",
      "",
      "TFTのお知らせ",
      "TFTセット14が近日公開予定です。詳細は追ってお知らせします。",
    ].join("\n");

    const result = extractPatchChangesDeterministic(text);
    expect(result).not.toBeNull();
    expect(result!.map((c) => c.champion)).toEqual(["アジール", "ガレン"]);
    // 変更行は本文の部分文字列そのもの(逐語)。直前の非空行(スキル名/項目名)が前置されている。
    expect(result![0].changes).toEqual(["基本ステータス 攻撃力: 55 ⇒ 58"]);
    expect(result![1].changes).toEqual(["R - デマーシアの正義 確定ダメージ: 150/250/350 ⇒ 130/230/330"]);
    // 抽出された各変更行は、元テキストの行(改行区切り)をそのまま繋いだもの(新しい文字列を作らず、
    // 直前の非空行と変更行という既存の2行を空白で連結しているだけ=捏造禁止を満たす)。
    const flattenedLines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join(" ");
    for (const c of result!) {
      for (const change of c.changes) {
        expect(flattenedLines).toContain(change);
      }
    }
  });

  it("「⇒」を含まないノイズ(intro/クレジット/TFT導線)は変更点として拾わない", () => {
    const text = [
      "パッチ26.14ノートへようこそ。",
      "エディタ: サンプルライター",
      "T1がLCKを制覇し3連覇を達成しました。",
      "TFTのお知らせ",
      "TFTセット14が近日公開予定です。詳細は追ってお知らせします。",
    ].join("\n");
    expect(extractPatchChangesDeterministic(text)).toBeNull();
  });

  it("チャンピオン名行があっても配下に「⇒」変更行が無ければそのチャンピオンは結果に含まれない(全体でも0件ならnull)", () => {
    const text = ["アジール", "今回は特に変更がありません。", "ケイトリン", "同じく変更なし。"].join("\n");
    expect(extractPatchChangesDeterministic(text)).toBeNull();
  });

  it("チャンピオン数は最大12体、1体あたりの変更行は最大5行に有界化される", () => {
    const championNames = [
      "アリスター", "アニビア", "アニー", "アフェリオス", "アッシュ", "アジール", "バード", "アムム",
      "ブリッツクランク", "ブランド", "ブラウム", "ケイトリン", "カミール", "キャシオペア", "チョガス",
    ]; // 15体(上限12を超える)
    const sections = championNames.map((name, i) => {
      const changeLines = Array.from({ length: 6 }, (_, j) => `ステータス${j}: ${i + j} ⇒ ${i + j + 1}`);
      return [name, ...changeLines].join("\n");
    });
    const text = sections.join("\n\n");

    const result = extractPatchChangesDeterministic(text);
    expect(result).not.toBeNull();
    // 上限12体まで(13〜15体目は含まれない)
    expect(result!.length).toBe(12);
    expect(result!.map((c) => c.champion)).toEqual(championNames.slice(0, 12));
    // 1体あたり最大5行(6行与えたが5行までに制限される)
    for (const c of result!) {
      expect(c.changes.length).toBe(5);
    }
  });

  it("同じチャンピオン名が本文中で複数回言及されても、単独行と完全一致しない限り節開始として誤検知しない", () => {
    const text = [
      "アジールは今回のパッチで最も注目されているチャンピオンの一つです。",
      "アジール",
      "攻撃力: 50 ⇒ 55",
    ].join("\n");
    const result = extractPatchChangesDeterministic(text);
    expect(result).not.toBeNull();
    expect(result!.map((c) => c.champion)).toEqual(["アジール"]);
    expect(result![0].changes).toEqual(["攻撃力: 50 ⇒ 55"]);
  });

  describe("値が複数行に分割される実データケースの復元（拡張E40b・重大バグ修正）", () => {
    it("「：2 ⇒」で行が終わり変更後の値が次行にある場合、次行を連結して変更後の値まで復元する", () => {
      // 実際の fetchPatchNotesText → stripHtmlToText 出力を模したfixture（ラベル行/矢印行/値行が分割）。
      const text = [
        "アジール",
        "基本ステータス",
        "レベルアップごとの攻撃力",
        "：2 ⇒",
        "2.5",
        "",
        "ジェイス",
        "基本ステータス",
        "増加移動速度",
        "：40 ⇒",
        "45",
      ].join("\n");

      const result = extractPatchChangesDeterministic(text);
      expect(result).not.toBeNull();
      expect(result!.map((c) => c.champion)).toEqual(["アジール", "ジェイス"]);
      // 変更後の値（2.5 / 45）まで含めて復元されている（欠落しない）
      expect(result![0].changes).toEqual(["レベルアップごとの攻撃力 ：2 ⇒ 2.5"]);
      expect(result![1].changes).toEqual(["増加移動速度 ：40 ⇒ 45"]);
      // 矢印だけで終わる壊れた行は残らない
      for (const c of result!) {
        for (const change of c.changes) {
          expect(change.trim().endsWith("⇒")).toBe(false);
        }
      }
    });

    it("矢印の前後が同一行に収まっている従来ケースも引き続き正しく抽出される（回帰なし）", () => {
      const text = ["ガレン", "R - デマーシアの正義", "確定ダメージ: 150/250/350 ⇒ 130/230/330"].join("\n");
      const result = extractPatchChangesDeterministic(text);
      expect(result).not.toBeNull();
      expect(result![0].changes).toEqual(["R - デマーシアの正義 確定ダメージ: 150/250/350 ⇒ 130/230/330"]);
    });

    it("変更後の値が本当に存在しない異常系（矢印の直後が次のチャンピオン節）では、矢印だけの不完全な行を残さず捨てる", () => {
      const text = [
        "アジール",
        "レベルアップごとの攻撃力",
        "：2 ⇒",
        "",
        "ケイトリン",
        "攻撃力: 10 ⇒ 12",
      ].join("\n");
      const result = extractPatchChangesDeterministic(text);
      expect(result).not.toBeNull();
      // アジールは値が復元できず変更点0件になり結果から除外される。ケイトリンのみ残る。
      expect(result!.map((c) => c.champion)).toEqual(["ケイトリン"]);
      expect(result![0].changes).toEqual(["攻撃力: 10 ⇒ 12"]);
    });

    it("変更後の値が本当に存在しない異常系（矢印の直後が次の項目ラベル）でも、矢印だけの不完全な行を残さず捨てる", () => {
      const text = [
        "アジール",
        "レベルアップごとの攻撃力",
        "：2 ⇒",
        "次のスキル名っぽい項目ラベル",
        "攻撃力: 10 ⇒ 12",
      ].join("\n");
      const result = extractPatchChangesDeterministic(text);
      expect(result).not.toBeNull();
      expect(result!.map((c) => c.champion)).toEqual(["アジール"]);
      // 「：2 ⇒」の壊れた行は捨てられ、後続の完全な変更行のみが残る
      expect(result![0].changes).toEqual(["次のスキル名っぽい項目ラベル 攻撃力: 10 ⇒ 12"]);
    });

    it("値が1行の連結で復元できた後は、それ以降の数値らしい行を余分に飲み込まない(非貪欲)", () => {
      const text = ["セナ", "ダメージ", "：70 ⇒", "75", "80"].join("\n");
      const result = extractPatchChangesDeterministic(text);
      expect(result).not.toBeNull();
      // "75"を連結した時点で矢印の後が空でなくなるため、後続の"80"は連結されない
      expect(result![0].changes).toEqual(["ダメージ ：70 ⇒ 75"]);
    });
  });
});

describe("composeArticleBody（riotパッチ記事の3段フォールバック: LLM要約→決定的抽出→クリーン定型、拡張E40 F-E40-2）", () => {
  // 拡張E41 F-E41-2でriotの既定は事実速報(fact)になったため、本describe(従来のsummary挙動)は
  // PATCH_ARTICLE_MODE=summaryに固定して実行する(後でLLMまとめに戻す用にコード・テストを残す)。
  let prevPatchMode: string | undefined;
  beforeAll(() => {
    prevPatchMode = process.env.PATCH_ARTICLE_MODE;
    process.env.PATCH_ARTICLE_MODE = "summary";
  });
  afterAll(() => {
    if (prevPatchMode === undefined) delete process.env.PATCH_ARTICLE_MODE;
    else process.env.PATCH_ARTICLE_MODE = prevPatchMode;
  });

  /** 実パッチノートらしいノイズ(intro/クレジット/TFT導線, ⇒を含まない)を大量に含みつつ、
   * チャンピオン別の「⇒」変更行を複数含む、実運用相当のfixture(PATCH_NOTES_MIN_LENGTH以上)。 */
  function buildRealisticPatchFixture(): string {
    // 単純な繰り返し文だと同じn-gramが大量に重複するため、番号を変えた文を多数連結して
    // 実ページ相当の「大量の非反復ノイズ」を作る(拡張E40)。
    const noise = Array.from(
      { length: 200 },
      (_, i) => `これはテスト用のダミー文${i}です。実際のパッチ内容とは関係ありません。`,
    ).join("");
    const champions = [
      { name: "アジール", context: "基本ステータス", changes: ["攻撃力: 55 ⇒ 58", "体力: 550 ⇒ 570"] },
      { name: "ケイトリン", context: "基本ステータス", changes: ["レベルアップごとの攻撃力: 2 ⇒ 2.5", "移動速度: 335 ⇒ 340"] },
      {
        name: "ガレン",
        context: "R - デマーシアの正義",
        changes: ["確定ダメージ: 150/250/350 ⇒ 130/230/330", "クールダウン: 120/100/80 ⇒ 130/110/90"],
      },
      { name: "ダリウス", context: "Q - 大鎌の一撃", changes: ["クールダウン: 9/8/7/6/5 ⇒ 8/7/6/5/4"] },
      { name: "ヴィエゴ", context: "パッシブ - 王家の運命", changes: ["支配時間: 6秒 ⇒ 8秒"] },
      { name: "セナ", context: "W - 慈悲の光弾", changes: ["ダメージ: 70/115/160/205/250 ⇒ 65/105/145/185/225"] },
    ];
    const sections = champions.map((c) => [c.name, c.context, ...c.changes].join("\n"));
    // 実データ(stripHtmlToText出力)同様に「ラベル行/：X ⇒行/値行」が分割されるケースも1件含める
    // (拡張E40b: 変更後の値が次行に割れても復元できることの回帰確認)。
    const jaceSplitSection = ["ジェイス", "基本ステータス", "増加移動速度", "：40 ⇒", "45"].join("\n");
    return [noise, ...sections, jaceSplitSection, "TFTのお知らせ\nTFTセット14が近日公開予定です。", noise].join(
      "\n\n",
    );
  }

  it("LLM要約が失敗(mock)しても、決定的抽出で変更点があれば「主な変更点」見出し＋チャンピオン別段落の本文になり、クリーン定型には落ちない", async () => {
    const patchText = buildRealisticPatchFixture();
    const body = await composeArticleBody(
      { sourceType: "riot", title: "【パッチ】26.14 の主な変更点まとめ", content: patchText },
      new MockLLMClient(),
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings[0]).toBe("主な変更点（公式パッチノートより）");
    expect(headings).toContain("アジール");
    expect(headings).toContain("ケイトリン");
    expect(headings).toContain("ガレン");
    expect(headings).toContain("ジェイス");
    // クリーン定型(「の変更点」見出し1件のみ)には落ちていない
    expect(headings).not.toEqual(["26.14の変更点"]);
    expect(body.some((b) => b.type === "quote")).toBe(false);

    // 各チャンピオンの変更点が正しく自身の節に紐づいている(隣接チャンピオンへの誤帰属がない)
    const paragraphs = body.filter((b) => b.type === "paragraph").map((b) => b.text);
    expect(paragraphs).toContain("基本ステータス レベルアップごとの攻撃力: 2 ⇒ 2.5");

    // 拡張E40bの重大バグ修正: 値が複数行に割れた実データケース(ジェイス)でも変更後の値まで復元される
    // (欠落していない)。矢印だけで終わる壊れた行が本文に残っていないことも確認する。
    expect(paragraphs).toContain("増加移動速度 ：40 ⇒ 45");
    for (const p of paragraphs) {
      expect(p.trim().endsWith("⇒")).toBe(false);
    }

    // 抽出された変更点は、本文の行(改行区切り)をそのまま連結したもの(逐語。新しい文字列を作らない)
    const flattenedLines = patchText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join(" ");
    for (const p of paragraphs) {
      expect(flattenedLines).toContain(p);
    }
  });

  it("決定的抽出も空(チャンピオン変更点なし)ならクリーン定型フォールバックになる(回帰なし)", async () => {
    const noPatchChanges = "実際のパッチノート本文らしいテキスト。".repeat(30);
    const body = await composeArticleBody(
      { sourceType: "riot", title: "【パッチ】26.14 の主な変更点まとめ", content: noPatchChanges },
      new MockLLMClient(),
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toHaveLength(1);
    expect(headings[0]).toContain("の変更点");
  });

  it("LLM要約が成功すればそれを優先し、決定的抽出は使われない(回帰なし)", async () => {
    const patchText = buildRealisticPatchFixture();
    const validSummaryJson = JSON.stringify({
      buffed: ["アジール: 攻撃力が引き上げられ、序盤の主導権を握りやすくなった。"],
      nerfed: [],
      other: [],
    });
    class StubLLMClient implements LLMClient {
      async generate(): Promise<string> {
        return validSummaryJson;
      }
    }
    const body = await composeArticleBody(
      { sourceType: "riot", title: "【パッチ】26.14 の主な変更点まとめ", content: patchText },
      new StubLLMClient(),
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["主な強化チャンピオン"]);
    expect(headings).not.toContain("主な変更点（公式パッチノートより）");
  });
});
