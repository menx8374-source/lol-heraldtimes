import { describe, expect, it } from "vitest";
import { composeArticleBody } from "@/lib/generation/compose";
import type { LLMClient, LLMMessage } from "@/lib/generation/llm-client";

/**
 * `buildReactionBlocks` の反応レス選別モード切替（リファクタリングS3 F-S3-3）を検証する。
 * 要件「AIによる話題性判定・分類・スコアリングは禁止」に合わせ、既定（未設定 or "rules"）は
 * AI(`selectReactionReses`)を一切呼ばず数値ルール（会話クラスタ選定＋決定論強調）になり、
 * `REACTION_SELECT_MODE=llm` のときだけ従来どおりAI選別を使う。
 */

/** LLMへの各呼び出しのタスク種別(kind)を記録するスパイLLMClient。実APIは叩かない。 */
class SpyLLMClient implements LLMClient {
  public readonly kinds: string[] = [];
  constructor(private readonly response: string = "") {}
  async generate(messages: LLMMessage[]): Promise<string> {
    const user = messages.find((m) => m.role === "user");
    if (user) {
      try {
        const task = JSON.parse(user.content) as { kind?: string };
        if (task.kind) this.kinds.push(task.kind);
      } catch {
        // JSONでないメッセージは無視(呼び出し記録のみが目的)
      }
    }
    return this.response;
  }
}

async function withReactionSelectMode<T>(mode: "rules" | "llm" | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.REACTION_SELECT_MODE;
  if (mode === undefined) delete process.env.REACTION_SELECT_MODE;
  else process.env.REACTION_SELECT_MODE = mode;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.REACTION_SELECT_MODE;
    else process.env.REACTION_SELECT_MODE = prev;
  }
}

// 58-59-61が>>Nアンカーで連結した会話クラスタ(サイズ3)、413は無関係な独立レス(アンカー無し)。
const anchoredContent =
  "58: 拮抗してるゲームだった。\n59: >>58 それについてもう少し話そう。\n61: >>59 拮抗してるゲームが面白かった。\n413: 無関係な独立レス。";

describe("buildReactionBlocks（REACTION_SELECT_MODEによる反応レス選別モード切替、リファクタリングS3 F-S3-3）", () => {
  it("既定（未設定）はrulesモード: reaction-selectタスク(AI)が一切呼ばれず、会話クラスタ選定＋決定論強調になる", async () => {
    await withReactionSelectMode(undefined, async () => {
      // AIが呼ばれれば独立レス(index3=413)だけを選ぶ応答を用意しておくが、rulesモードでは無視されるはず。
      const spy = new SpyLLMClient(JSON.stringify({ keep: [3], emphasize: [] }));
      const body = await composeArticleBody(
        { sourceType: "5ch", title: "rules既定テスト", content: anchoredContent },
        spy,
      );
      expect(spy.kinds).not.toContain("reaction-select");
      const reactions = body.filter((b) => b.type === "reaction");
      const numbers = reactions.map((b) => (b.type === "reaction" ? b.number : -1));
      // 最大クラスタ(58,59,61)のみ採用され、無関係な独立レス(413)は含まれない(AIには従わない)。
      expect(numbers).toEqual([58, 59, 61]);
    });
  });

  it('REACTION_SELECT_MODE="rules"を明示しても同じ挙動になる', async () => {
    await withReactionSelectMode("rules", async () => {
      const spy = new SpyLLMClient(JSON.stringify({ keep: [3], emphasize: [] }));
      const body = await composeArticleBody(
        { sourceType: "5ch", title: "rules明示テスト", content: anchoredContent },
        spy,
      );
      expect(spy.kinds).not.toContain("reaction-select");
      const reactions = body.filter((b) => b.type === "reaction");
      expect(reactions.map((b) => (b.type === "reaction" ? b.number : -1))).toEqual([58, 59, 61]);
    });
  });

  it("rulesモードでも反応レス2件以上・強調ゼロなら決定論の色付き強調最低保証(applyMinColorFallback)が働く(AI不使用でも全黒字にならない)", async () => {
    await withReactionSelectMode("rules", async () => {
      const spy = new SpyLLMClient("");
      const body = await composeArticleBody(
        { sourceType: "5ch", title: "強調最低保証テスト", content: anchoredContent },
        spy,
      );
      const reactions = body.filter((b) => b.type === "reaction");
      expect(reactions.length).toBeGreaterThanOrEqual(2);
      expect(reactions.some((b) => b.type === "reaction" && b.emphasis === true)).toBe(true);
    });
  });

  it("REACTION_SELECT_MODE=llmを指定すると、reaction-selectタスク(AI)が呼ばれ、返したkeepのレスだけが採用される(旧挙動)", async () => {
    await withReactionSelectMode("llm", async () => {
      const spy = new SpyLLMClient(JSON.stringify({ keep: [3], emphasize: [] })); // index3 = レス413(独立レス)のみ選定
      const body = await composeArticleBody(
        { sourceType: "5ch", title: "llmモードテスト", content: anchoredContent },
        spy,
      );
      expect(spy.kinds).toContain("reaction-select");
      const reactions = body.filter((b) => b.type === "reaction");
      expect(reactions.map((b) => (b.type === "reaction" ? b.number : -1))).toEqual([413]);
    });
  });

  it("reddit由来はrulesモードでもreaction-translate(翻訳AI)は従来どおり呼ばれる(判定・選別のみAI不使用、翻訳はAI許容)", async () => {
    await withReactionSelectMode("rules", async () => {
      const redditContent = "1: Nice teamfight there.\n2: >>1 That was so good, I love this play.";
      const spy = new SpyLLMClient(
        JSON.stringify({
          translations: [
            { index: 0, lines: ["いいチームファイトだった。"] },
            { index: 1, lines: [">>1 それめっちゃ良かった。"] },
          ],
        }),
      );
      const body = await composeArticleBody(
        { sourceType: "reddit", title: "翻訳テスト", content: redditContent },
        spy,
      );
      expect(spy.kinds).not.toContain("reaction-select");
      expect(spy.kinds).toContain("reaction-translate");
      const reactions = body.filter((b) => b.type === "reaction");
      expect(reactions[0].type === "reaction" && reactions[0].lines[0].text).toBe("いいチームファイトだった。");
    });
  });
});
