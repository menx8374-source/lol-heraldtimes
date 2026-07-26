import { describe, expect, it } from "vitest";
import { findNgWord, stripNgWords, maskNgWords } from "@/lib/moderation/ng-words";
import { detectPersonalAttack } from "@/lib/moderation/personal-attack";
import { containsRumorMarker } from "@/lib/moderation/rumor";
import { findDuplicateArticle } from "@/lib/moderation/duplicate";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { bodyBlocksToText } from "@/lib/search";
import type { ArticleBodyBlock } from "@/lib/article-body";

describe("findNgWord / stripNgWords（NGワード検出, F9）", () => {
  it("定義済みNGワードを含む文からその語を検出する", () => {
    expect(findNgWord("この選手は本当にカスだ")).toBe("カス");
    expect(findNgWord("死ねばいいのに")).toBe("死ね");
  });

  it("NGワードを含まない文では null を返す", () => {
    expect(findNgWord("今回のパッチはとても良い調整だった")).toBeNull();
  });

  it("stripNgWordsはNGワードだけを除去する", () => {
    expect(stripNgWords("このゴミチャンピオンは強い")).toBe("このチャンピオンは強い");
  });

  it("maskNgWordsはNGワードを同じ文字数のアスタリスクに置換し、他の文字列は変えない（拡張E27）", () => {
    expect(maskNgWords("このゴミチャンピオンは強い")).toBe("この**チャンピオンは強い");
    expect(maskNgWords("このチャンピオンはアホだ")).toBe("このチャンピオンは**だ");
    expect(findNgWord(maskNgWords("このチャンピオンはアホだ"))).toBeNull();
  });

  it("maskNgWordsは複数出現・複数種のNGワードすべてを伏字化する（拡張E27）", () => {
    const masked = maskNgWords("死ねばいいのに、あとカスでゴミなやつ");
    expect(masked).toBe("**ばいいのに、あと**で**なやつ");
    expect(findNgWord(masked)).toBeNull();
  });

  it("maskNgWordsはNGワードを含まない文をそのまま返す", () => {
    expect(maskNgWords("今回のパッチはとても良い調整だった")).toBe("今回のパッチはとても良い調整だった");
  });
});

describe("detectPersonalAttack（特定個人への中傷／晒し検出, F9）", () => {
  it("人物名＋攻撃語が同一文中にある場合は中傷として検出する", () => {
    const result = detectPersonalAttack("田中選手は本当に無能だ。プレイは酷かった。");
    expect(result.detected).toBe(true);
  });

  it("英字の個人名＋攻撃語が同一文中にある場合も検出する", () => {
    const result = detectPersonalAttack("Suzukiのプレイは嘘つきだと言われても仕方ない。");
    expect(result.detected).toBe(true);
  });

  it("個人情報の暴露（晒し）を示す表現は攻撃語が無くても検出する", () => {
    const result = detectPersonalAttack("この配信者の本名は山田太郎で住所は東京都渋谷区です。");
    expect(result.detected).toBe(true);
  });

  it("人物名の言及があっても攻撃語が伴わなければ検出しない", () => {
    const result = detectPersonalAttack("田中選手が素晴らしいプレイを見せた。ファンから称賛の声が相次いだ。");
    expect(result.detected).toBe(false);
  });

  it("チャンピオンや一般名詞への言及だけでは検出しない", () => {
    const result = detectPersonalAttack("今回のパッチでヤスオが弱体化され、海外の反応は賛否両論だった。");
    expect(result.detected).toBe(false);
  });
});

describe("containsRumorMarker（未確定・噂レベルの検出, F9）", () => {
  it("噂・未確定を示す語を含む場合はtrue", () => {
    expect(containsRumorMarker("新チャンピオンが近日実装されるとの噂が広がっている")).toBe(true);
    expect(containsRumorMarker("この情報は現時点で真偽不明である")).toBe(true);
  });

  it("噂を示す語を含まない場合はfalse", () => {
    expect(containsRumorMarker("Riot Gamesが公式に新パッチノートを発表した")).toBe(false);
  });
});

describe("findDuplicateArticle（記事レベルの重複検出, F9）", () => {
  const existing = [
    {
      title: "【悲報】パッチ14.6でジャングル大幅弱体化、海外勢が阿鼻叫喚してる件",
      content: "本日配信されたパッチ14.6では、ジャングルモンスターの経験値量が全体的に引き下げられた。",
    },
  ];

  it("既存記事と高い類似度を持つ候補は重複と判定する", () => {
    const dup = findDuplicateArticle(
      {
        title: "【悲報】パッチ14.6でジャングル大幅弱体化、海外勢が阿鼻叫喚してる件",
        content: "本日配信されたパッチ14.6では、ジャングルモンスターの経験値量が全体的に引き下げられた。",
      },
      existing,
    );
    expect(dup).not.toBeNull();
  });

  it("既存記事と無関係な候補は重複と判定しない", () => {
    const dup = findDuplicateArticle(
      { title: "【速報】新チャンピオンのティザー映像が公開", content: "Riot Gamesが新チャンピオンを示唆する映像を公開した。" },
      existing,
    );
    expect(dup).toBeNull();
  });
});

describe("moderateArticleContent（公開前安全フィルタの統合判定, F9）", () => {
  it("安全な通常記事はフィルタを通過してpublishedになる", () => {
    const result = moderateArticleContent({
      title: "【速報】パッチ14.6ノート公開、新たな調整が話題に",
      bodyText: "本日Riot Gamesはパッチ14.6のノートを公式に発表した。多くのプレイヤーが注目している。",
      sourceCount: 1,
    });
    expect(result.status).toBe("published");
  });

  it("NGワードを含む記事はheldになり理由がng_wordになる", () => {
    const result = moderateArticleContent({
      title: "【速報】このチャンピオンはカスだと話題に",
      bodyText: "本文中にも問題のある表現が含まれている。",
      sourceCount: 1,
    });
    expect(result).toMatchObject({ status: "held", reason: "ng_word" });
  });

  it("出典リンクを持たない記事はheldになり理由がmissing_sourceになる", () => {
    const result = moderateArticleContent({
      title: "【速報】出典の無い記事",
      bodyText: "この記事には出典が付与されていない。",
      sourceCount: 0,
    });
    expect(result).toMatchObject({ status: "held", reason: "missing_source" });
  });

  it("特定個人への中傷を含む記事はheldになり理由がpersonal_attackになる", () => {
    const result = moderateArticleContent({
      title: "【速報】ある選手について",
      bodyText: "田中選手は本当に無能だという声が多数寄せられている。",
      sourceCount: 1,
    });
    expect(result).toMatchObject({ status: "held", reason: "personal_attack" });
  });

  it("既存記事と重複する記事はheldになり理由がduplicateになる", () => {
    const existing = [
      { title: "【悲報】パッチ14.6でジャングル大幅弱体化、海外勢が阿鼻叫喚してる件", content: "ジャングルモンスターの経験値量が引き下げられた。" },
    ];
    const result = moderateArticleContent(
      {
        title: "【悲報】パッチ14.6でジャングル大幅弱体化、海外勢が阿鼻叫喚してる件",
        bodyText: "ジャングルモンスターの経験値量が引き下げられた。",
        sourceCount: 1,
      },
      {
        candidate: {
          title: "【悲報】パッチ14.6でジャングル大幅弱体化、海外勢が阿鼻叫喚してる件",
          content: "ジャングルモンスターの経験値量が引き下げられた。",
        },
        existing,
      },
    );
    expect(result).toMatchObject({ status: "held", reason: "duplicate" });
  });

  it("未確定・噂レベルの表現を含む記事はunconfirmed=trueで公開される", () => {
    const result = moderateArticleContent({
      title: "【速報】新チャンピオン実装の噂が浮上",
      bodyText: "海外フォーラムで新チャンピオンが近日実装されるとの噂が広がっている。",
      sourceCount: 1,
    });
    expect(result).toMatchObject({ status: "published", unconfirmed: true });
  });

  it("まとめ速報レス形式(reactionブロック)のレス本文にNGワードが含まれる場合もheldになる(F9はレス本文も対象)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "話題" },
      { type: "paragraph", text: "スレッドが投稿され反応が寄せられている。" },
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "このチャンピオンはカスだと思う" }],
      },
    ];
    const bodyText = bodyBlocksToText(blocks);
    const result = moderateArticleContent({
      title: "【LoL】あるチャンピオンについて語るスレ",
      bodyText,
      sourceCount: 1,
    });
    expect(result).toMatchObject({ status: "held", reason: "ng_word" });
  });

  it("reactionブロックのレス本文がmaskNgWordsで伏字化済みであればheldにならず公開される（拡張E27）", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "話題" },
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: `このチャンピオンは${"*".repeat(2)}だと思う` }],
      },
    ];
    const bodyText = bodyBlocksToText(blocks);
    const result = moderateArticleContent({
      title: "【LoL】あるチャンピオンについて語るスレ",
      bodyText,
      sourceCount: 1,
    });
    expect(result.status).toBe("published");
  });

  it("NGワード・中傷の無い通常のreactionブロック記事は公開される", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "話題" },
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "壁飛び5連続でキャリーとか草生える", emphasis: "red" }],
      },
    ];
    const result = moderateArticleContent({
      title: "【5ch】ヤスオの伝説的プレイ",
      bodyText: bodyBlocksToText(blocks),
      sourceCount: 1,
    });
    expect(result.status).toBe("published");
  });
});
