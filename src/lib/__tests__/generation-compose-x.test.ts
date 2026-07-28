/**
 * composeXBody（X由来記事の本文組み立て、成長G7 F-G7-4）のテスト（ブリーフ テスト5）。
 * 「独自の見出し・導入・要約が主、tweet埋め込み/短い引用＋出典が従」の著作権配慮構成と、
 * 翻訳が既存reddit経路（reaction-translate）に合流することを検証する。実APIは叩かない。
 */
import { describe, expect, it } from "vitest";
import {
  composeArticleBody,
  REACTION_TRANSLATE_SYSTEM_PROMPT,
  type GenerationCandidateInput,
} from "@/lib/generation/compose";
import { MockLLMClient, type LLMClient, type LLMMessage } from "@/lib/generation/llm-client";
import { blockText } from "@/lib/article-body";

const llm = new MockLLMClient();

function candidate(overrides: Partial<GenerationCandidateInput> = {}): GenerationCandidateInput {
  return {
    sourceType: "x",
    title: "今日のLJL、レッドブルの動きがヤバい",
    content: "今日のLJL、レッドブルの動きが本当にヤバい。序盤から圧倒的だった。",
    sourceUrl: "https://x.com/lol_jp_fan/status/1810000000000000099",
    ...overrides,
  };
}

/** reaction-translateタスクにだけ指定JSONを返し、それ以外はMockLLMClientへ委譲するスタブ。 */
class TranslateStubLLMClient implements LLMClient {
  private readonly mock = new MockLLMClient();
  constructor(private readonly translated: string) {}
  async generate(messages: LLMMessage[]): Promise<string> {
    if (messages.some((m) => m.role === "system" && m.content === REACTION_TRANSLATE_SYSTEM_PROMPT)) {
      return JSON.stringify({ translations: [{ index: 0, text: this.translated }] });
    }
    return this.mock.generate(messages);
  }
}

describe("composeArticleBody（sourceType=x、成長G7 F-G7-4）", () => {
  it("見出し「Xでの反応」を含む独自導入＋結び段落が主になる", async () => {
    const body = await composeArticleBody(candidate(), llm);
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["Xでの反応"]);
    const paragraphs = body.filter((b) => b.type === "paragraph");
    expect(paragraphs.length).toBeGreaterThanOrEqual(2); // 導入＋結び
    expect(paragraphs.every((p) => p.text.trim().length > 0)).toBe(true);
  });

  it("tweet status URLが有効ならtwitter providerのembedブロックになる（tweet全文コピペしない）", async () => {
    const body = await composeArticleBody(candidate(), llm);
    const embed = body.find((b) => b.type === "embed");
    expect(embed).toMatchObject({ type: "embed", provider: "twitter", url: candidate().sourceUrl });
    // embedを使う場合はquoteブロックを併用しない(主従の二重表現を避ける)
    expect(body.some((b) => b.type === "quote")).toBe(false);
  });

  it("sourceUrlが無効/status URLでない場合は短い引用(excerpt)＋出典(カテゴリラベル)の代替になる", async () => {
    const body = await composeArticleBody(candidate({ sourceUrl: "https://x.com/lol_jp_fan" }), llm);
    expect(body.some((b) => b.type === "embed")).toBe(false);
    const quote = body.find((b) => b.type === "quote");
    expect(quote).toBeDefined();
    // 全文コピペではなく短い抜粋であること（主従関係）
    expect((quote as { text: string }).text.length).toBeLessThan(candidate().content.length);
    expect((quote as { source?: string }).source).toBe("Xの反応");
  });

  it("author指定時は引用の出典に作者名が併記される（著作権法32条の出典明記）", async () => {
    const body = await composeArticleBody(
      candidate({ sourceUrl: "https://x.com/lol_jp_fan", author: "lol_jp_fan" }),
      llm,
    );
    const quote = body.find((b) => b.type === "quote") as { source?: string };
    expect(quote.source).toBe("Xの反応（lol_jp_fan）");
  });

  it("日本語本文(lang:ja相当)は翻訳を呼ばずそのまま抜粋する", async () => {
    const stub = new TranslateStubLLMClient("呼ばれてはいけない訳文");
    const body = await composeArticleBody(
      candidate({ sourceUrl: "https://x.com/lol_jp_fan", content: "今日は最高の試合だった。" }),
      stub,
    );
    const quote = body.find((b) => b.type === "quote") as { text: string };
    expect(quote.text).not.toContain("呼ばれてはいけない訳文");
  });

  it("英語本文(lang:en相当)は既存reddit経路の翻訳(reaction-translate)に合流して日本語化される", async () => {
    // excerptForQuote(30字上限・原文の半分まで)で短く抜粋されるため、翻訳文の先頭部分が
    // 使われていること(=翻訳結果が採用されたこと)を確認する(英語原文がそのまま残っていないこと)。
    const translated = "このジャングルナーフは今後のメタを大きく変えることになりそうだと多くのプレイヤーが指摘している";
    const stub = new TranslateStubLLMClient(translated);
    const body = await composeArticleBody(
      candidate({
        sourceUrl: "https://x.com/na_lol_analyst",
        content: "This jungle nerf is going to completely change the meta.",
      }),
      stub,
    );
    const quote = body.find((b) => b.type === "quote") as { text: string };
    expect(translated.startsWith(quote.text.replace("…", ""))).toBe(true);
    expect(quote.text).not.toContain("jungle nerf");
  });

  it("翻訳失敗（mock既定応答）時は英語原文をそのまま抜粋する（本体を止めない）", async () => {
    const body = await composeArticleBody(
      candidate({
        sourceUrl: "https://x.com/na_lol_analyst",
        content: "This jungle nerf is going to completely change the meta.",
      }),
      llm, // MockLLMClientのreaction-translateは常に空文字を返す(翻訳失敗扱い)
    );
    const quote = body.find((b) => b.type === "quote") as { text: string };
    expect(quote.text.length).toBeGreaterThan(0);
  });

  it("記事全体としてArticleBodyとしてparseできる（DB保存形式として壊れない）", async () => {
    const body = await composeArticleBody(candidate(), llm);
    expect(body.map(blockText).join("").length).toBeGreaterThan(0);
  });
});
