/**
 * generateSeo（リファクタリングS5b F-S5b-1）のユニットテスト（ブリーフ テスト1）。
 * スタブLLMを使い実API/実ネットには依存しない。正常JSON→正規化、空/不正/例外→null、
 * tags の上限・空要素除去を検証する。
 */
import { describe, expect, it } from "vitest";
import { generateSeo } from "@/lib/generation/seo";
import { MockLLMClient, type LLMClient, type LLMMessage } from "@/lib/generation/llm-client";

class StubLLMClient implements LLMClient {
  constructor(private readonly response: string | (() => string)) {}
  async generate(_messages: LLMMessage[]): Promise<string> {
    return typeof this.response === "function" ? this.response() : this.response;
  }
}

class ThrowingLLMClient implements LLMClient {
  async generate(): Promise<string> {
    throw new Error("API呼び出し失敗（テスト用）");
  }
}

const input = {
  title: "【速報】ヤスオがナーフされ阿鼻叫喚",
  bodyText: "ヤスオの基本攻撃力が引き下げられ、序盤のレーン戦が不利になったとの声が多い。",
  category: "パッチ/メタ",
};

describe("generateSeo（正常パス）", () => {
  it("正常なJSONを返すLLMなら、seoTitle/metaDescription/ogTitle/ogDescription/tagsを正規化して返す", async () => {
    const stub = new StubLLMClient(
      JSON.stringify({
        seoTitle: "  ヤスオ大幅ナーフでレーン戦激変！最新パッチ解説  ",
        metaDescription: "最新パッチでヤスオが弱体化。基本攻撃力の変更点と序盤への影響を解説する。",
        ogTitle: "ヤスオ大幅ナーフ、序盤レーン戦はどう変わる？",
        ogDescription: "ヤスオナーフの詳細と序盤への影響をまとめて紹介。",
        tags: ["ヤスオ", "パッチ", "ナーフ", ""],
      }),
    );
    const result = await generateSeo(stub, input);
    expect(result).toEqual({
      seoTitle: "ヤスオ大幅ナーフでレーン戦激変！最新パッチ解説",
      metaDescription: "最新パッチでヤスオが弱体化。基本攻撃力の変更点と序盤への影響を解説する。",
      ogTitle: "ヤスオ大幅ナーフ、序盤レーン戦はどう変わる？",
      ogDescription: "ヤスオナーフの詳細と序盤への影響をまとめて紹介。",
      tags: ["ヤスオ", "パッチ", "ナーフ"],
    });
  });

  it("前置き・コードフェンス付きの出力でも堅牢にJSONを抽出できる", async () => {
    const stub = new StubLLMClient(
      "```json\n" +
        JSON.stringify({
          seoTitle: "ヤスオ弱体化まとめ、最新パッチの変更点を解説",
          metaDescription: "最新パッチでヤスオが弱体化した内容と影響をわかりやすく解説する記事。",
          ogTitle: "",
          ogDescription: "",
          tags: ["ヤスオ"],
        }) +
        "\n```\n以上、SEOメタ生成の出力でした。",
    );
    const result = await generateSeo(stub, input);
    expect(result?.seoTitle).toBe("ヤスオ弱体化まとめ、最新パッチの変更点を解説");
    // ogTitle/ogDescriptionが空文字ならnullに正規化される(表示側フォールバックに委ねる)
    expect(result?.ogTitle).toBeNull();
    expect(result?.ogDescription).toBeNull();
  });

  it("tagsが上限(8件)を超える場合は先頭から上限件数までに切り詰め、重複も除去する", async () => {
    const stub = new StubLLMClient(
      JSON.stringify({
        seoTitle: "タグ上限確認用のSEOタイトルをここに書く",
        metaDescription: "タグの正規化(上限・重複除去・空要素除去)を確認するためのメタディスクリプション。",
        ogTitle: "タグ上限確認",
        ogDescription: "タグ上限確認用の説明文。",
        tags: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "A", "  ", 123],
      }),
    );
    const result = await generateSeo(stub, input);
    expect(result?.tags).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
  });
});

describe("generateSeo（失敗パス→null）", () => {
  it("mock(MockLLMClient)は決定論的にJSONを組み立てないため null になる（追加コストなし）", async () => {
    const result = await generateSeo(new MockLLMClient(), input);
    expect(result).toBeNull();
  });

  it("空文字を返すLLMは null になる", async () => {
    const result = await generateSeo(new StubLLMClient(""), input);
    expect(result).toBeNull();
  });

  it("JSONとして解釈できない出力は null になる", async () => {
    const result = await generateSeo(new StubLLMClient("これはJSONではない説明文です"), input);
    expect(result).toBeNull();
  });

  it("必須値(seoTitle)が欠落したJSONは null になる", async () => {
    const stub = new StubLLMClient(
      JSON.stringify({
        metaDescription: "説明文はあるがseoTitleが無いケース。",
        tags: ["ヤスオ"],
      }),
    );
    const result = await generateSeo(stub, input);
    expect(result).toBeNull();
  });

  it("tagsが空配列のJSONは null になる", async () => {
    const stub = new StubLLMClient(
      JSON.stringify({
        seoTitle: "タグが空のケースを確認するSEOタイトル",
        metaDescription: "タグが1件も無い場合はSEO生成全体を失敗扱いにすることを確認する説明文。",
        tags: [],
      }),
    );
    const result = await generateSeo(stub, input);
    expect(result).toBeNull();
  });

  it("LLM呼び出しが例外を投げても null になる(本体を止めない)", async () => {
    const result = await generateSeo(new ThrowingLLMClient(), input);
    expect(result).toBeNull();
  });
});
