/**
 * resel-S3（NG文を「削除」→「LLMで婉曲に言い換えて表示」・全反応経路）のテスト。
 * - `softenNgSentences`（compose.ts内部）: ng-softenタスクでバッチ送信、結果をfindNgWordで再検査し
 *   NG残存/空/欠落は不採用、採用分のMapを返す。失敗/空応答は空Map（本体を止めない）。
 * - `buildReactionDisplayLines`（buildReactionBlocks/buildXReactionBlocks経由）: NG文をLLMの言い換え
 *   結果（再検査済み）で置換（既定soften）。採用不可のNG文は削除にフォールバック。非NG行は逐語。
 *   NG文が無い記事はLLM(ng-soften)を呼ばない。
 * - `NG_REPHRASE_MODE`（既定soften/remove/mask）。moderation整合（ng_word保留を招かない）。
 * 実HTTPは叩かない（自作のスタブLLMのみ、ng-softenタスクの応答を制御する）。
 */
import { describe, expect, it } from "vitest";
import { composeArticleBody, buildXReactionBlocks } from "@/lib/generation/compose";
import type { LLMClient, LLMMessage } from "@/lib/generation/llm-client";
import { findNgWord } from "@/lib/moderation/ng-words";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { bodyBlocksToText } from "@/lib/search";
import type { ArticleBodyBlock, ArticleBodyReactionBlock } from "@/lib/article-body";
import type { XReplyItem } from "@/lib/collection/adapters/x";

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

function reactionBlocksOf(body: ArticleBodyBlock[]): ArticleBodyReactionBlock[] {
  return body.filter((b): b is ArticleBodyReactionBlock => b.type === "reaction");
}

/**
 * `kind: "ng-soften"` タスクのときだけ指定応答（固定文字列 or 送信文からの生成関数）を返し、
 * それ以外のタスク（reaction-select/reaction-translate等）は空文字（mock同様のフォールバック）を
 * 返すテスト用スタブ。ng-softenタスクの呼び出し回数・送信内容を`ngSoftenCalls`に記録する。
 */
class NgSoftenStub implements LLMClient {
  public readonly ngSoftenCalls: { index: number; text: string }[][] = [];
  constructor(
    private readonly response: string | ((sentences: { index: number; text: string }[]) => string),
  ) {}
  async generate(messages: LLMMessage[]): Promise<string> {
    const user = messages.find((m) => m.role === "user");
    if (!user) return "";
    let task: { kind?: string; sentences?: { index: number; text: string }[] };
    try {
      task = JSON.parse(user.content) as typeof task;
    } catch {
      return "";
    }
    if (task.kind !== "ng-soften") return "";
    const sentences = task.sentences ?? [];
    this.ngSoftenCalls.push(sentences);
    return typeof this.response === "function" ? this.response(sentences) : this.response;
  }
}

describe("compose NG文の言い換え表示（resel-S3、既定soften）", () => {
  it("NG文がLLMの言い換え結果（再検査済み・NG語なし）に置換され、非NG行は逐語のまま", async () => {
    const stub = new NgSoftenStub((sentences) =>
      JSON.stringify({ softened: sentences.map((s) => ({ index: s.index, text: "そのプレイは残念だと思う。" })) }),
    );
    const body = await composeArticleBody(
      {
        sourceType: "5ch",
        title: "softenテスト",
        content: "1: このチャンピオンはカスだと思う。でも強いと思う。\n2: 普通の反応だけ。",
      },
      stub,
    );
    const reactions = reactionBlocksOf(body);
    const texts = reactions.flatMap((b) => b.lines.map((l) => l.text));
    // reactqual-S4: 5chはレス番号を疑似score(新しい=高score)とする統一選定になるため、
    // 番号の大きい2(独立・親なし)がprimaryとして先に選ばれ、続けて1が出る(親子関係が無い独立レス同士)。
    expect(texts).toEqual(["普通の反応だけ。", "そのプレイは残念だと思う。でも強いと思う。"]);
    expect(texts.every((t) => findNgWord(t) === null)).toBe(true);
  });

  it("1レス内の複数NG文をまとめて1回のLLM呼び出し(ng-soften)にバッチ送信する", async () => {
    const stub = new NgSoftenStub((sentences) =>
      JSON.stringify({ softened: sentences.map((s) => ({ index: s.index, text: `穏当な文${s.index}。` })) }),
    );
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "バッチテスト", content: "1: カスだと思う。ゴミだと思う。" },
      stub,
    );
    expect(stub.ngSoftenCalls).toHaveLength(1);
    expect(stub.ngSoftenCalls[0]).toHaveLength(2);
    const texts = reactionBlocksOf(body).flatMap((b) => b.lines.map((l) => l.text));
    expect(texts).toEqual(["穏当な文0。穏当な文1。"]);
  });

  it("コスト最適化: NGを含む複数レスがあっても1記事(=1回のbuildReactionBlocks呼び出し)につきng-softenは最大1回にまとめる", async () => {
    const stub = new NgSoftenStub((sentences) =>
      JSON.stringify({ softened: sentences.map((s) => ({ index: s.index, text: `穏当な言い換え${s.index}。` })) }),
    );
    const body = await composeArticleBody(
      {
        sourceType: "5ch",
        title: "記事横断バッチテスト",
        content: ["1: カスだと思う。", "2: ゴミすぎる。", "3: 普通の反応だけ。", "4: これもクズだと思う。"].join(
          "\n",
        ),
      },
      stub,
    );
    // NGを含むレスが3件(1,2,4)あっても、ng-softenのLLM呼び出しは記事全体で1回だけ。
    expect(stub.ngSoftenCalls).toHaveLength(1);
    expect(stub.ngSoftenCalls[0]).toHaveLength(3);
    const texts = reactionBlocksOf(body).flatMap((b) => b.lines.map((l) => l.text));
    expect(texts).toContain("普通の反応だけ。");
    expect(texts.every((t) => findNgWord(t) === null)).toBe(true);
  });

  it("言い換え結果にNGワードが残る場合は再検査で不採用となり、削除にフォールバックする", async () => {
    const stub = new NgSoftenStub((sentences) =>
      JSON.stringify({ softened: sentences.map((s) => ({ index: s.index, text: "やっぱりカスだと思う。" })) }),
    );
    const body = await composeArticleBody(
      {
        sourceType: "5ch",
        title: "不採用テスト",
        content: "1: このチャンピオンはカスだと思う。でも強いと思う。",
      },
      stub,
    );
    const texts = reactionBlocksOf(body).flatMap((b) => b.lines.map((l) => l.text));
    // NG文の言い換え("やっぱりカスだと思う。")はまだNGワードを含むため不採用→削除。残りの文は逐語。
    expect(texts).toEqual(["でも強いと思う。"]);
    expect(texts.every((t) => findNgWord(t) === null)).toBe(true);
  });

  it("LLMが空応答/parse不能を返した場合は空Mapとして扱われ、NG文は削除にフォールバックする（本体を止めない）", async () => {
    const stub = new NgSoftenStub("");
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "空応答テスト", content: "1: カスすぎる。ゴミだと思う。" },
      stub,
    );
    // 全文がNGかつ言い換え失敗のため両方削除→行が空→レス自体不掲載（全行不採用のレスは不掲載）。
    expect(reactionBlocksOf(body)).toHaveLength(0);
  });

  it("NG文を含まない記事はng-softenのLLM呼び出しを一切行わない（コスト最小）", async () => {
    const stub = new NgSoftenStub("should-not-be-called");
    await composeArticleBody(
      { sourceType: "5ch", title: "NG無しテスト", content: "1: 壁飛び5連続でキャリーとか草生える\n2: それな" },
      stub,
    );
    expect(stub.ngSoftenCalls).toHaveLength(0);
  });

  it("NG_REPHRASE_MODE=removeで従来どおり削除され、ng-softenのLLM呼び出しは行われない", async () => {
    await withEnv({ NG_REPHRASE_MODE: "remove" }, async () => {
      const stub = new NgSoftenStub("should-not-be-called");
      const body = await composeArticleBody(
        {
          sourceType: "5ch",
          title: "removeモードテスト",
          content: "1: このチャンピオンはカスだと思う。でも強いと思う。",
        },
        stub,
      );
      const texts = reactionBlocksOf(body).flatMap((b) => b.lines.map((l) => l.text));
      expect(texts).toEqual(["でも強いと思う。"]);
      expect(stub.ngSoftenCalls).toHaveLength(0);
    });
  });

  it("NG_REPHRASE_MODE=maskでNGワードだけが伏字(*)になり文自体は残る、ng-softenは呼ばれない", async () => {
    await withEnv({ NG_REPHRASE_MODE: "mask" }, async () => {
      const stub = new NgSoftenStub("should-not-be-called");
      const body = await composeArticleBody(
        {
          sourceType: "5ch",
          title: "maskモードテスト",
          content: "1: このチャンピオンはカスだと思う。でも強いと思う。",
        },
        stub,
      );
      const texts = reactionBlocksOf(body).flatMap((b) => b.lines.map((l) => l.text));
      expect(texts).toEqual(["このチャンピオンは**だと思う。でも強いと思う。"]);
      expect(stub.ngSoftenCalls).toHaveLength(0);
    });
  });

  it("moderation整合: soften後の本文にNGワードが残らず、moderateArticleContentがng_word保留しない(reddit経路)", async () => {
    const stub = new NgSoftenStub((sentences) =>
      JSON.stringify({
        softened: sentences.map((s) => ({
          index: s.index,
          text: "This player's actions were criticized by some fans",
        })),
      }),
    );
    const title = "Discussion about a champion";
    const body = await composeArticleBody(
      {
        sourceType: "reddit",
        title,
        content: "1: This champion player is 死ね worthy according to some toxic fans",
      },
      stub,
    );
    const bodyText = bodyBlocksToText(body);
    expect(findNgWord(bodyText)).toBeNull();
    const result = moderateArticleContent({ title, bodyText, sourceCount: 1 });
    expect(result.status).toBe("published");
  });

  it("事実/数値/固有名詞は言い換え結果として渡されたテキストがそのまま採用される（改変・捏造はしない、compose側は再検査のみ）", async () => {
    // compose.ts はLLMの言い換え文をfindNgWordで再検査するだけで内容を書き換えない。
    // 事実・数値・固有名詞の不改変はNG_SOFTEN_SYSTEM_PROMPT側の指示＋LLM側の責務であり、
    // ここではcompose側が言い換え結果を改変せずそのまま採用することだけを確認する。
    const stub = new NgSoftenStub((sentences) =>
      JSON.stringify({
        softened: sentences.map((s) => ({ index: s.index, text: "Aatroxは3勝2敗で調整が必要だと思う。" })),
      }),
    );
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "固有名詞テスト", content: "1: Aatroxはカスで3勝2敗だと思う。" },
      stub,
    );
    const texts = reactionBlocksOf(body).flatMap((b) => b.lines.map((l) => l.text));
    expect(texts).toEqual(["Aatroxは3勝2敗で調整が必要だと思う。"]);
  });
});

describe("buildXReactionBlocks NG文の言い換え表示（resel-S3 F-RS3-3、全反応経路への適用）", () => {
  function xreply(overrides: Partial<XReplyItem> = {}): XReplyItem {
    return {
      id: "x1",
      text: "コメント本文",
      author: "fan1",
      likeCount: 1,
      replyCount: 0,
      quoteCount: 0,
      url: "https://x.com/fan1/status/x1",
      isQuote: false,
      lang: "ja",
      ...overrides,
    };
  }

  it("X経由の反応もsoftenが適用され、NGワードを含まない言い換え文で表示される", async () => {
    const stub = new NgSoftenStub((sentences) =>
      JSON.stringify({ softened: sentences.map((s) => ({ index: s.index, text: "残念な行動だったと思う。" })) }),
    );
    const items: XReplyItem[] = [xreply({ id: "1", text: "このプレイはカスだと思う。", likeCount: 10 })];
    const blocks = await buildXReactionBlocks(items, stub);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines[0].text).toBe("残念な行動だったと思う。");
    expect(findNgWord(blocks[0].lines[0].text)).toBeNull();
  });

  it("コスト最適化: X経由でもNGを含む複数リプがあれば1回のbuildXReactionBlocks呼び出しにつきng-softenは最大1回にまとめる", async () => {
    const stub = new NgSoftenStub((sentences) =>
      JSON.stringify({ softened: sentences.map((s) => ({ index: s.index, text: `穏当な言い換え${s.index}。` })) }),
    );
    const items: XReplyItem[] = [
      xreply({ id: "1", text: "このプレイはカスだと思う。", likeCount: 10 }),
      xreply({ id: "2", text: "普通のコメントだけ", likeCount: 5 }),
      xreply({ id: "3", text: "こいつゴミだろ", likeCount: 3 }),
    ];
    const blocks = await buildXReactionBlocks(items, stub);
    // NGを含むリプが2件(1,3)あっても、ng-softenのLLM呼び出しは記事全体で1回だけ。
    expect(stub.ngSoftenCalls).toHaveLength(1);
    expect(stub.ngSoftenCalls[0]).toHaveLength(2);
    const texts = blocks.flatMap((b) => b.lines.map((l) => l.text));
    expect(texts.every((t) => findNgWord(t) === null)).toBe(true);
  });

  it("X経由でNGワードを含まないリプはng-softenを呼ばない（コスト最小）", async () => {
    const stub = new NgSoftenStub("should-not-be-called");
    const items: XReplyItem[] = [xreply({ id: "1", text: "いいプレイだった", likeCount: 10 })];
    await buildXReactionBlocks(items, stub);
    expect(stub.ngSoftenCalls).toHaveLength(0);
  });
});
