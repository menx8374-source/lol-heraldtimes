import { describe, expect, it } from "vitest";
import {
  generateArticleForCandidate,
  GenerationError,
  MIN_BODY_LENGTH,
  type GenerationCandidate,
} from "@/lib/generation/generate-article";
import { MockLLMClient, type LLMClient, type LLMMessage } from "@/lib/generation/llm-client";
import { blockText, parseArticleBody } from "@/lib/article-body";

const llm = new MockLLMClient();

function candidate(overrides: Partial<GenerationCandidate> = {}): GenerationCandidate {
  return {
    id: "c1",
    sourceType: "riot",
    sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-14-6-notes/",
    title: "パッチ14.6ノート公開",
    content:
      "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
    ...overrides,
  };
}

describe("generateArticleForCandidate（成功パス）", () => {
  it("見出し・段落を持つ構造化本文が最低300文字以上で生成され、出典が付与される", async () => {
    const result = await generateArticleForCandidate(candidate(), llm);

    const totalLength = result.body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeGreaterThanOrEqual(MIN_BODY_LENGTH);
    expect(result.body.some((b) => b.type === "heading")).toBe(true);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources[0].url).toBe(candidate().sourceUrl);
    // DBに保存する形式(JSON)としても壊れずパースできる
    expect(() => parseArticleBody(result.body)).not.toThrow();
  });

  it("riot由来はカテゴリ「公式ニュース」、5ch由来は「5chの反応」、reddit由来は「海外の反応」になる", async () => {
    const riot = await generateArticleForCandidate(candidate({ sourceType: "riot" }), llm);
    const ch5 = await generateArticleForCandidate(candidate({ sourceType: "5ch" }), llm);
    const reddit = await generateArticleForCandidate(candidate({ sourceType: "reddit" }), llm);
    expect(riot.category).toBe("公式ニュース");
    expect(ch5.category).toBe("5chの反応");
    expect(reddit.category).toBe("海外の反応");
  });
});

describe("generateArticleForCandidate（失敗パス）", () => {
  it("出典URLが無い候補はGenerationErrorになる", async () => {
    await expect(generateArticleForCandidate(candidate({ sourceUrl: "" }), llm)).rejects.toBeInstanceOf(
      GenerationError,
    );
  });

  it("内容が空で本文が最低文字数に満たない候補はGenerationErrorになる", async () => {
    await expect(generateArticleForCandidate(candidate({ content: "" }), llm)).rejects.toBeInstanceOf(
      GenerationError,
    );
  });

  it("生成文が元ソースの逐語コピーに近い場合はGenerationErrorになり、正常な候補の生成は妨げない", async () => {
    // 常に元本文をそのまま返す「悪い」LLMクライアント(逐語コピー再現用スタブ)
    class VerbatimCopyLLMClient implements LLMClient {
      constructor(private readonly sourceContent: string) {}
      async generate(_messages: LLMMessage[]): Promise<string> {
        return this.sourceContent.repeat(5); // 300字以上にするため繰り返すが、内容は完全コピー
      }
    }
    const c = candidate();
    const badLlm = new VerbatimCopyLLMClient(c.content);

    await expect(generateArticleForCandidate(c, badLlm)).rejects.toBeInstanceOf(GenerationError);

    // 同じ候補集合の中の別候補(正常なMockLLMClient)は影響を受けず生成継続できる
    const other = await generateArticleForCandidate(candidate({ id: "c2" }), llm);
    expect(other.body.length).toBeGreaterThan(0);
  });
});

describe("generateArticleForCandidate（まとめ速報レス形式=5ch/reddit、逐語チェック対象外）", () => {
  it("5ch由来はレス本文が元ソースと完全一致(逐語)でもGenerationErrorにならない(意図的な転載のため)", async () => {
    const content =
      "1: このジャングルナーフはマジでキツい。\nパワースパイクが遅れるとか勘弁してくれ。\n\n2: >>1\n同意、ジャングルメインは今回のパッチ悲惨すぎる。\n\n3: 一方でトップレーンからは歓迎の声も多いんだよな。";
    const result = await generateArticleForCandidate(
      candidate({
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/1/",
        content,
      }),
      llm,
    );
    // レス本文ブロックが逐語のまま含まれている(要約・言い換えされていない)
    const reactionBlocks = result.body.filter((b) => b.type === "reaction");
    expect(reactionBlocks.length).toBe(3);
    expect(
      reactionBlocks[0].type === "reaction" && reactionBlocks[0].lines.map((l) => l.text),
    ).toEqual(["このジャングルナーフはマジでキツい。", "パワースパイクが遅れるとか勘弁してくれ。"]);

    // body は「反応まとめ」見出し＋reactionブロックのみ(AI導入・まとめ段落なし)
    expect(result.body[0]).toEqual({ type: "heading", text: "反応まとめ" });
    expect(result.body.every((b) => b.type === "heading" || b.type === "reaction")).toBe(true);
  });

  it("300字未満の短いレスでもGenerationErrorにならない(AI要約段落を持たないため最低文字数チェック対象外)", async () => {
    const content = "1: 短いけど盛り上がってるスレ。";
    const result = await generateArticleForCandidate(
      candidate({
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/2/",
        content,
      }),
      llm,
    );
    const totalLength = result.body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeLessThan(MIN_BODY_LENGTH);
    expect(result.body.some((b) => b.type === "reaction")).toBe(true);
  });

  it("reactionブロックが1件も組み立てられない(空content)場合はGenerationErrorになる", async () => {
    await expect(
      generateArticleForCandidate(
        candidate({ sourceType: "5ch", content: "" }),
        llm,
      ),
    ).rejects.toBeInstanceOf(GenerationError);
  });
});
