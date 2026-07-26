import { describe, expect, it } from "vitest";
import {
  LABELS,
  HOOKS,
  checkTitleQuality,
  extractConcreteElements,
  generateHookTitle,
  generateHookTitleLLM,
  joinSubjectAndHook,
  zenkakuLength,
  type TitleGenInput,
} from "@/lib/generation/title";
import type { LLMClient, LLMMessage } from "@/lib/generation/llm-client";

/** 10件のサンプル記事化候補（title+content）。ベンチマーク検証(F8受け入れ基準)に使う。 */
const SAMPLES: TitleGenInput[] = [
  {
    title: "パッチ14.6ノート公開",
    content:
      "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。合わせてダリウスのQ技のクールダウンも短縮されている。",
  },
  {
    title: "ヤスオが大幅強化されるとの噂",
    content:
      "海外サイトの情報によれば、次パッチでヤスオの基礎ダメージが引き上げられる可能性があるという。現状の勝率は48%程度で伸び悩んでいた。",
  },
  {
    title: "Worlds 2025 決勝カード決定",
    content:
      "本日行われた準決勝の結果、Worlds決勝に進出する2チームが確定した。ファンからは早くも決勝戦への期待が高まっている。",
  },
  {
    title: "ジンクスの新スキンが公開",
    content:
      "Riot Gamesが新たなジンクスのスキンをティザーで公開した。SNS上ではデザインについて様々な意見が寄せられている。",
  },
  {
    title: "5chで話題のバランス調整案",
    content:
      "スレッドでは、現状のサポート性能について50%近い勝率を誇るセラフィンへの調整を求める声が多く寄せられている。",
  },
  {
    title: "Riot公式がイベント開催を発表",
    content:
      "Riot Gamesは新イベントの開催を公式に発表した。参加者にはMSI観戦チケットが抽選で当たるキャンペーンも予定されている。",
  },
  {
    title: "ゼドの勝率が急上昇中",
    content:
      "直近のランクデータでは、ゼドの勝率が52%まで上昇していることが判明した。海外の集計サイトでも同様の傾向が報告されている。",
  },
  {
    title: "海外勢がLCK王者を絶賛",
    content:
      "Redditのスレッドでは、LCK王者となったチームのプレイスタイルについて称賛のコメントが相次いでいる。",
  },
  {
    title: "パッチ14.7で新アイテム追加か",
    content: "テストサーバーの情報として、次期パッチ14.7で新アイテムが追加される可能性が報じられている。",
  },
  {
    title: "有名実況者がLEC決勝を分析",
    content: "有名実況者がLEC決勝の試合内容を分析する配信を行い、多くの視聴者が集まった。",
  },
];

function sourceTextOf(sample: TitleGenInput): string {
  return `${sample.title}\n${sample.content}`;
}

describe("checkTitleQuality（合格例・不合格例）", () => {
  const sourceText = sourceTextOf(SAMPLES[0]);

  it("ラベル・具体要素・感情フック・文字数の全条件を満たすタイトルは合格になる", () => {
    const title = "【速報】パッチ14.6でジャングルが弱体化、判明";
    const result = checkTitleQuality(title, sourceText);
    expect(result.hasLabel).toBe(true);
    expect(result.hasConcreteElement).toBe(true);
    expect(result.hasEmotionalHook).toBe(true);
    expect(result.lengthOk).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("冒頭に【】ラベルが無いタイトルは不合格になる（ラベル欠如）", () => {
    const title = "パッチ14.6でジャングルが弱体化して判明した件";
    const result = checkTitleQuality(title, sourceText);
    expect(result.hasLabel).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("本文に存在しない話題のタイトルは不合格になる（具体要素欠如）", () => {
    const title = "【速報】謎の変更で盛り上がる展開に";
    const result = checkTitleQuality(title, sourceText);
    expect(result.hasConcreteElement).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("感情フックの語尾を含まないタイトルは不合格になる（感情フック欠如）", () => {
    const title = "【速報】パッチ14.6でジャングルモンスターの経験値量を調整";
    const result = checkTitleQuality(title, sourceText);
    expect(result.hasEmotionalHook).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("文字数が範囲(20〜48全角相当)より短いタイトルは不合格になる（文字数超過/不足）", () => {
    const title = "【速報】ダリウスが強い";
    const result = checkTitleQuality(title, sourceText);
    expect(result.lengthOk).toBe(false);
    expect(result.passed).toBe(false);
  });
});

describe("extractConcreteElements", () => {
  it("本文に含まれるパッチ番号・チャンピオン名を部分文字列として抽出する（捏造しない）", () => {
    const sourceText = sourceTextOf(SAMPLES[0]);
    const elements = extractConcreteElements(sourceText);
    expect(elements.length).toBeGreaterThan(0);
    // 抽出された要素はすべて元のsourceTextの部分文字列である(捏造禁止の担保)
    for (const el of elements) {
      expect(sourceText.includes(el)).toBe(true);
    }
    expect(elements).toContain("パッチ14.6");
  });
});

describe("generateHookTitle", () => {
  it("生成タイトルは冒頭に定義済みラベルを【】付きで含む", () => {
    const title = generateHookTitle(SAMPLES[0]);
    const m = title.match(/^【([^】]+)】/);
    expect(m).not.toBeNull();
    expect((LABELS as readonly string[])).toContain(m?.[1]);
  });

  it("生成タイトルは本文由来の具体要素を最低1つ含み、それは元テキストの部分文字列である（捏造しない）", () => {
    const sourceText = sourceTextOf(SAMPLES[0]);
    const title = generateHookTitle(SAMPLES[0]);
    const elements = extractConcreteElements(sourceText);
    const used = elements.find((el) => title.includes(el));
    expect(used).toBeDefined();
    expect(sourceText.includes(used as string)).toBe(true);
  });

  it("生成タイトルは定義済み感情フックのいずれかで終わる", () => {
    const title = generateHookTitle(SAMPLES[0]);
    const matchedHook = (HOOKS as readonly string[]).find((h) => title.endsWith(h));
    expect(matchedHook).toBeDefined();
  });

  it("生成タイトルの文字数(全角相当)はMAX_TITLE_LENGTHを超えない(拡張E19: MIN未満は自然な区切りが無い場合のみ許容)", () => {
    for (const sample of SAMPLES) {
      const title = generateHookTitle(sample);
      const len = zenkakuLength(title);
      expect(len).toBeLessThanOrEqual(48);
      expect(len).toBeGreaterThan(0);
    }
  });

  it("ほとんどのサンプルはMIN_TITLE_LENGTH(20)以上になる(ベストエフォート。自然な区切りが本文中にあれば埋める)", () => {
    const lengths = SAMPLES.map((sample) => zenkakuLength(generateHookTitle(sample)));
    const meetsMinCount = lengths.filter((len) => len >= 20).length;
    expect(meetsMinCount / lengths.length).toBeGreaterThanOrEqual(0.8);
  });

  it("生成タイトルに省略記号「…」が含まれない(拡張E19 F-E19-4: 完結したタイトルにする)", () => {
    for (const sample of SAMPLES) {
      expect(generateHookTitle(sample)).not.toContain("…");
    }
  });

  it("フックが読点「、」から始まる場合でも、主語との間で二重の読点にならない(拡張E19)", () => {
    // フック候補には「、ついに判明」のように先頭に読点を持つものが含まれるため、
    // 全HOOKSについてjoinSubjectAndHookの結合結果に「、、」が出ず、フックで終わることを確認する。
    for (const hook of HOOKS) {
      const joined = joinSubjectAndHook("ダリウス", hook);
      expect(joined).not.toContain("、、");
      expect(joined.endsWith(hook)).toBe(true);
    }
  });

  it("主語＝本文冒頭のとき、タイトルに主語が二重に出現しない(拡張E20 F-E20-1)", () => {
    const sample: TitleGenInput = {
      title: "【チャンピオン紹介】リサンドラ（氷の魔女）",
      content: "リサンドラはMageタイプのチャンピオン。（以下略）",
    };
    const title = generateHookTitle(sample);
    const occurrences = title.split("リサンドラ").length - 1;
    expect(occurrences).toBeLessThan(2);
  });

  it("本文中のNGワード(差別的・攻撃的な語)は生成タイトルに含まれない（安全フィルタ）", () => {
    const unsafeSample: TitleGenInput = {
      title: "ゼドが強すぎるとアホみたいに叩かれる",
      content: "5chのスレッドでは、ゼドの調整についてアホやカスといった過激な言葉で罵る書き込みが目立った。",
    };
    const title = generateHookTitle(unsafeSample);
    expect(title).not.toContain("アホ");
    expect(title).not.toContain("カス");
  });
});

describe("F8受け入れ基準ベンチマーク: 10件のサンプル記事に対するチェッカー合格率", () => {
  it("チェッカーによる合格率が90%以上になる", () => {
    const results = SAMPLES.map((sample) => {
      const sourceText = sourceTextOf(sample);
      const title = generateHookTitle(sample);
      return { title, quality: checkTitleQuality(title, sourceText) };
    });

    const passedCount = results.filter((r) => r.quality.passed).length;
    const passRate = passedCount / results.length;

    // 参考: 失敗したサンプルがあれば理由を確認できるようにログへ残す
    for (const r of results) {
      if (!r.quality.passed) {
        console.log("不合格サンプル:", r.title, r.quality);
      }
    }

    expect(passRate).toBeGreaterThanOrEqual(0.9);
  });

  it("複数記事に対して生成したとき、ラベル・感情フックのバリエーションが偏りすぎない", () => {
    const titles = SAMPLES.map((sample) => generateHookTitle(sample));

    const usedLabels = new Set(
      titles.map((t) => t.match(/^【([^】]+)】/)?.[1]).filter((v): v is string => !!v),
    );
    const usedHooks = new Set(
      titles.map((t) => (HOOKS as readonly string[]).find((h) => t.endsWith(h))).filter((v): v is string => !!v),
    );

    expect(usedLabels.size).toBeGreaterThanOrEqual(2);
    expect(usedHooks.size).toBeGreaterThanOrEqual(2);
  });
});

/** 固定文字列/例外を返すスタブLLMClient（拡張E24: テストでは実APIを叩かない）。 */
class FixedLLMClient implements LLMClient {
  constructor(private readonly response: string) {}
  async generate(_messages: LLMMessage[]): Promise<string> {
    return this.response;
  }
}

class ThrowingLLMClient implements LLMClient {
  async generate(_messages: LLMMessage[]): Promise<string> {
    throw new Error("APIエラー（テスト用シミュレーション）");
  }
}

describe("generateHookTitleLLM（拡張E24 F-E24-2、LLMはスタブで実APIを叩かない）", () => {
  const sample = SAMPLES[0];
  const sourceText = sourceTextOf(sample);

  it("LLMが検証通過するタイトルを返したとき、そのタイトル（NGワード除去後）をそのまま使う", async () => {
    const llmTitle = "【速報】パッチ14.6でジャングルが弱体化、判明";
    const llm = new FixedLLMClient(llmTitle);
    const title = await generateHookTitleLLM(llm, sample);
    expect(title).toBe(llmTitle);
    expect(checkTitleQuality(title, sourceText).passed).toBe(true);
  });

  it("LLMが空文字を返したときルールベース(generateHookTitle)にフォールバックする", async () => {
    const llm = new FixedLLMClient("");
    const title = await generateHookTitleLLM(llm, sample);
    expect(title).toBe(generateHookTitle(sample));
  });

  it("LLMが検証不通過のタイトル（ラベル無し等）を返したときルールベースにフォールバックする", async () => {
    const llm = new FixedLLMClient("パッチ14.6でジャングルが弱体化した件についての解説");
    const title = await generateHookTitleLLM(llm, sample);
    expect(title).toBe(generateHookTitle(sample));
  });

  it("LLM呼び出しが例外を投げたときルールベースにフォールバックし、例外が外に漏れない", async () => {
    const llm = new ThrowingLLMClient();
    await expect(generateHookTitleLLM(llm, sample)).resolves.toBe(generateHookTitle(sample));
  });

  it("固定フック語彙を含まない自然なLLMタイトルでも、ラベル・具体要素・文字数を満たせば採用される（拡張E24: 過剰フォールバック防止）", async () => {
    // 「だった件」「がヤバいと話題に」等の固定フックを含まないが、ラベル・具体要素(パッチ14.6)・
    // 文字数を満たす自然な完結タイトル。旧checkTitleQuality(フック必須)なら落ちてルールベースに
    // フォールバックしていたが、LLM用の緩い判定では採用される。
    const naturalTitle = "【議論】パッチ14.6のジャングル経験値ナーフにプレイヤーから賛否の声";
    const llm = new FixedLLMClient(naturalTitle);
    const title = await generateHookTitleLLM(llm, sample);
    expect(title).toBe(naturalTitle);
    // 固定フック語彙は含まない＝旧チェッカーでは不合格だったことを確認（緩和が効いている証拠）。
    expect(checkTitleQuality(naturalTitle, sourceText).hasEmotionalHook).toBe(false);
    expect(title).not.toBe(generateHookTitle(sample));
  });

  it("stripNgWordsがLLM出力にも適用される（NGワード除去後も検証通過すればそのタイトルを使う）", async () => {
    const rawWithNg = "【速報】アホなパッチ14.6でジャングルが弱体化、判明";
    const llm = new FixedLLMClient(rawWithNg);
    const title = await generateHookTitleLLM(llm, sample);
    expect(title).not.toContain("アホ");
    expect(title).toBe("【速報】なパッチ14.6でジャングルが弱体化、判明");
    expect(checkTitleQuality(title, sourceText).passed).toBe(true);
  });
});
