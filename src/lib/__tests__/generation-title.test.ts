import { describe, expect, it } from "vitest";
import {
  LABELS,
  HOOKS,
  checkTitleQuality,
  extractConcreteElements,
  generateHookTitle,
  zenkakuLength,
  type TitleGenInput,
} from "@/lib/generation/title";

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

  it("生成タイトルの文字数(全角相当)は20〜48に収まる", () => {
    for (const sample of SAMPLES) {
      const title = generateHookTitle(sample);
      const len = zenkakuLength(title);
      expect(len).toBeGreaterThanOrEqual(20);
      expect(len).toBeLessThanOrEqual(48);
    }
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
