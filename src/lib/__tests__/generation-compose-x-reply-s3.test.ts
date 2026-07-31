/**
 * X-reply-S3（F-XR3-1〜F-XR3-3）のテスト。
 * - buildXReactionBlocks: XReplyItem[]→reactionブロック変換（連番・name＝@handle＋評価＋引用/返信
 *   ラベル・日本語は無翻訳/英語は翻訳・翻訳失敗フォールバック・NG文削除・空レス除去・anchors無し）。
 * - composeXBody: xReplies≥1で「導入→元ポストembed→『反応まとめ』見出し→reaction群→結び」の順、
 *   xReplies=0/未設定は従来構成と完全同一（回帰ゼロ）、embed生成不可URLでもembedブロックは維持され
 *   （表示側EmbedBlockViewが自動でカードにフォールバックする既存機構に委ねる）。
 * 実HTTPは叩かない（MockLLMClient/スタブLLMのみ）。
 */
import { describe, expect, it } from "vitest";
import {
  buildXReactionBlocks,
  composeArticleBody,
  REACTION_TRANSLATE_SYSTEM_PROMPT,
  type GenerationCandidateInput,
} from "@/lib/generation/compose";
import { MockLLMClient, type LLMClient, type LLMMessage } from "@/lib/generation/llm-client";
import type { ArticleBodyReactionBlock } from "@/lib/article-body";
import type { XReplyItem } from "@/lib/collection/adapters/x";

const llm = new MockLLMClient();

function reply(overrides: Partial<XReplyItem> = {}): XReplyItem {
  return {
    id: "1",
    text: "That jungle diff was insane, GG.",
    author: "na_fan1",
    likeCount: 1234,
    replyCount: 56,
    quoteCount: 2,
    url: "https://x.com/na_fan1/status/1",
    isQuote: false,
    ...overrides,
  };
}

/** reaction-translateタスクにだけ指定JSONを返し、それ以外はMockLLMClientへ委譲するスタブ（indexごとに訳を切替可能）。 */
class TranslateStubLLMClient implements LLMClient {
  private readonly mock = new MockLLMClient();
  constructor(private readonly translations: Record<number, string>) {}
  async generate(messages: LLMMessage[]): Promise<string> {
    const systemMsg = messages.find((m) => m.role === "system");
    if (systemMsg?.content === REACTION_TRANSLATE_SYSTEM_PROMPT) {
      const userMsg = messages.find((m) => m.role === "user");
      const task = JSON.parse(userMsg?.content ?? "{}") as { reses: { index: number; text: string }[] };
      const translations = task.reses
        .filter((r) => this.translations[r.index] !== undefined)
        .map((r) => ({ index: r.index, text: this.translations[r.index] }));
      return JSON.stringify({ translations });
    }
    return this.mock.generate(messages);
  }
}

describe("buildXReactionBlocks（X-reply-S3 F-XR3-2）", () => {
  it("連番number・name(@handle＋評価＋引用/返信ラベル)・lines(逐語)を組み立てる", async () => {
    const items: XReplyItem[] = [
      reply({ id: "1", author: "na_fan1", likeCount: 1234, replyCount: 56, isQuote: false, lang: "ja", text: "序盤の集団戦が全てだった" }),
      reply({ id: "2", author: "jp_fan2", likeCount: 10, replyCount: 2, isQuote: true, lang: "ja", text: "このピック本当に強い" }),
    ];
    const blocks = await buildXReactionBlocks(items, llm);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].number).toBe(1);
    expect(blocks[1].number).toBe(2);
    expect(blocks[0].name).toBe("@na_fan1 ・ 👍1,234 💬56 [返信]");
    expect(blocks[1].name).toBe("@jp_fan2 ・ 👍10 💬2 [引用]");
    expect(blocks[0].lines[0].text).toBe("序盤の集団戦が全てだった");
    expect(blocks[1].lines[0].text).toBe("このピック本当に強い");
    // anchors(">>N")は付けない
    expect(blocks[0].anchors).toBeUndefined();
    expect(blocks[1].anchors).toBeUndefined();
  });

  it("数値はカンマ区切りで整形するのみ(捏造しない)", async () => {
    const blocks = await buildXReactionBlocks(
      [reply({ likeCount: 123456, replyCount: 7890, lang: "ja", text: "コメント本文" })],
      llm,
    );
    expect(blocks[0].name).toBe("@na_fan1 ・ 👍123,456 💬7,890 [返信]");
  });

  it("日本語(lang:ja)は翻訳を呼ばずそのまま採用する", async () => {
    const stub = new TranslateStubLLMClient({ 0: "呼ばれてはいけない訳文" });
    const blocks = await buildXReactionBlocks([reply({ lang: "ja", text: "今日は最高の試合だった" })], stub);
    expect(blocks[0].lines[0].text).toBe("今日は最高の試合だった");
  });

  it("日本語判定はlang未設定でもcontainsJapaneseTextで検出する", async () => {
    const stub = new TranslateStubLLMClient({ 0: "呼ばれてはいけない訳文" });
    const blocks = await buildXReactionBlocks([reply({ text: "普通に強いと思う" })], stub);
    expect(blocks[0].lines[0].text).toBe("普通に強いと思う");
  });

  it("英語(lang未設定・日本語含まず)は既存translateReactionLinesで翻訳される", async () => {
    const translated = "このジャングルの差はマジでヤバかった、GG";
    const stub = new TranslateStubLLMClient({ 0: translated });
    const blocks = await buildXReactionBlocks([reply({ text: "That jungle diff was insane, GG." })], stub);
    expect(blocks[0].lines[0].text).toBe(translated);
  });

  it("翻訳失敗(mock既定は空応答)時は英語原文のままフォールバックする(本体を止めない)", async () => {
    const blocks = await buildXReactionBlocks([reply({ text: "That jungle diff was insane, GG." })], llm);
    expect(blocks[0].lines[0].text).toBe("That jungle diff was insane, GG.");
  });

  it("NGワードを含む文は削除され、全行NGで空になったレスは除外される(番号が詰まる)", async () => {
    const items: XReplyItem[] = [
      reply({ id: "1", lang: "ja", text: "このチームはカスだ。" }), // 全文NGで空→除外
      reply({ id: "2", lang: "ja", text: "普通に良い試合だった" }),
    ];
    const blocks = await buildXReactionBlocks(items, llm);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].number).toBe(1); // 除外後に連番が詰まる
    expect(blocks[0].lines[0].text).toBe("普通に良い試合だった");
  });

  it("xRepliesが空配列なら空配列を返す", async () => {
    expect(await buildXReactionBlocks([], llm)).toEqual([]);
  });
});

function candidate(overrides: Partial<GenerationCandidateInput> = {}): GenerationCandidateInput {
  return {
    sourceType: "x",
    title: "今日のLJL、レッドブルの動きがヤバい",
    content: "今日のLJL、レッドブルの動きが本当にヤバい。序盤から圧倒的だった。",
    sourceUrl: "https://x.com/lol_jp_fan/status/1810000000000000099",
    ...overrides,
  };
}

describe("composeArticleBody（sourceType=x, xReplies有り, X-reply-S3 F-XR3-1）", () => {
  it("導入→元ポストembed→『反応まとめ』見出し→reaction群→結びの順で組み立てる", async () => {
    const xReplies: XReplyItem[] = [
      reply({ id: "1", lang: "ja", text: "序盤の集団戦が全てだった", likeCount: 5, replyCount: 1 }),
      reply({ id: "2", lang: "ja", text: "このピック強い", isQuote: true, likeCount: 3, replyCount: 0 }),
    ];
    const body = await composeArticleBody(candidate({ xReplies }), llm);

    const types = body.map((b) => b.type);
    expect(types).toEqual(["heading", "paragraph", "embed", "heading", "reaction", "reaction", "paragraph"]);
    expect((body[0] as { text: string }).text).toBe("Xでの反応");
    expect(body[2]).toMatchObject({ type: "embed", provider: "twitter", url: candidate().sourceUrl });
    expect((body[3] as { text: string }).text).toBe("反応まとめ");
    const reactionBlocks = body.filter((b): b is ArticleBodyReactionBlock => b.type === "reaction");
    expect(reactionBlocks[0].name).toContain("@na_fan1");
    expect(reactionBlocks[1].name).toContain("引用");
  });

  it("xRepliesが未設定(従来どおり)は回帰ゼロ: reaction/『反応まとめ』を含まない従来構成", async () => {
    const bodyWithout = await composeArticleBody(candidate(), llm);
    const bodyEmpty = await composeArticleBody(candidate({ xReplies: [] }), llm);
    expect(bodyWithout.some((b) => b.type === "reaction")).toBe(false);
    expect(bodyEmpty.some((b) => b.type === "reaction")).toBe(false);
    expect(bodyWithout.some((b) => b.type === "heading" && (b as { text: string }).text === "反応まとめ")).toBe(
      false,
    );
    // xReplies有無以外は完全同一の構成(type配列一致)
    expect(bodyWithout.map((b) => b.type)).toEqual(bodyEmpty.map((b) => b.type));
    expect(bodyWithout.map((b) => b.type)).toEqual(["heading", "paragraph", "embed", "paragraph"]);
  });

  it("embed生成不可(statusURL形式でないx.com URL)でもembedブロックは維持される(表示側が自動でカードにフォールバック)", async () => {
    const xReplies: XReplyItem[] = [reply({ lang: "ja", text: "コメント本文" })];
    const body = await composeArticleBody(
      candidate({ sourceUrl: "https://x.com/lol_jp_fan", xReplies }),
      llm,
    );
    const embed = body.find((b) => b.type === "embed");
    expect(embed).toMatchObject({ type: "embed", provider: "twitter", url: "https://x.com/lol_jp_fan" });
    expect(body.some((b) => b.type === "quote")).toBe(false);
  });

  it("reaction変換の結果が全て除外(全レスNG等)された場合は『反応まとめ』見出しを追加しない", async () => {
    const xReplies: XReplyItem[] = [reply({ lang: "ja", text: "カスだな" })];
    const body = await composeArticleBody(candidate({ xReplies }), llm);
    expect(body.some((b) => b.type === "reaction")).toBe(false);
    expect(body.some((b) => b.type === "heading" && (b as { text: string }).text === "反応まとめ")).toBe(false);
  });

  it("記事全体としてArticleBodyとしてparseできる(DB保存形式として壊れない)", async () => {
    const xReplies: XReplyItem[] = [reply({ lang: "ja", text: "序盤の集団戦が全てだった" })];
    const body = await composeArticleBody(candidate({ xReplies }), llm);
    expect(body.length).toBeGreaterThan(0);
  });
});
