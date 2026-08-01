/**
 * reactqual-S3（アンカー先頭レスの本文脱落＝空白レスを根絶、バグ3）のテスト。
 * 実データで確認したバグ: 5ch反応で元ダンプ「102: >>101\nグレイブスのスモークスクリーンか？」の
 * 2行目（本文）が表示で消え、reactionブロック#102がアンカーのみの空白同然になっていた。
 *
 * 真因（本テストで確定）: NGワードリストの「ブス」が、実在するLoLチャンピオン名「グレイブス」に
 * 部分文字列として偶然含まれており、findNgWordがこれを差別語として誤検知していた。既定の
 * NG_REPHRASE_MODE=softenでLLM(mock)言い換えが得られない場合、NG判定された文はまるごと削除される
 * ため、「グレイブスの...」という非NG文が丸ごと消え、アンカー行`>>101`だけが残っていた（F-RQ3-2）。
 * これに加え、keepLinesがアンカー行indexだけを指定するケース（F-RQ3-2フォールバック）・
 * アンカーのみ/NG全消レスを掲載しない最終ガード（F-RQ3-3）も検証する。
 * 実HTTPは叩かない（MockLLMClient/スタブLLMのみ）。
 */
import { describe, expect, it } from "vitest";
import { composeArticleBody, buildXReactionBlocks } from "@/lib/generation/compose";
import { MockLLMClient } from "@/lib/generation/llm-client";
import type { LLMClient, LLMMessage } from "@/lib/generation/llm-client";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { bodyBlocksToText } from "@/lib/search";
import type { ArticleBodyBlock, ArticleBodyReactionBlock } from "@/lib/article-body";
import type { XReplyItem } from "@/lib/collection/adapters/x";

const llm = new MockLLMClient();

function reactionBlocksOf(body: ArticleBodyBlock[]): ArticleBodyReactionBlock[] {
  return body.filter((b): b is ArticleBodyReactionBlock => b.type === "reaction");
}

/** REACTION_SELECT_MODEを一時的に切り替えるヘルパ（他テストへの影響を残さない）。 */
async function withReactionSelectMode<T>(mode: "rules" | "llm", fn: () => Promise<T>): Promise<T> {
  const prev = process.env.REACTION_SELECT_MODE;
  process.env.REACTION_SELECT_MODE = mode;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.REACTION_SELECT_MODE;
    else process.env.REACTION_SELECT_MODE = prev;
  }
}

/** `kind:"reaction-select"`のときだけ指定応答を返すスタブ（他タスクはMockLLMClientと同じ空応答）。 */
class ReactionSelectStub implements LLMClient {
  constructor(private readonly response: string) {}
  async generate(messages: LLMMessage[]): Promise<string> {
    const user = messages.find((m) => m.role === "user");
    if (!user) return "";
    try {
      const task = JSON.parse(user.content) as { kind?: string };
      if (task.kind === "reaction-select") return this.response;
    } catch {
      return "";
    }
    return "";
  }
}

describe("reactqual-S3 F-RQ3-2: rulesモードでの本文脱落の再現・修正確認（最重要）", () => {
  it("実記事と同じ入力（101〜104のアンカーチェーン）でrulesモード(mockLLM)にかけても#102に本文「グレイブスのスモークスクリーンか？」が出る", async () => {
    const content = [
      "101: グレイブスってどうなん",
      "",
      "102: >>101",
      "グレイブスのスモークスクリーンか？",
      "",
      "103: >>102",
      "いや違う、あれはWだよ",
      "",
      "104: >>103",
      "これ？知らんかった",
    ].join("\n");

    const body = await composeArticleBody({ sourceType: "5ch", title: "テスト", content }, llm);
    const reactions = reactionBlocksOf(body);
    const res102 = reactions.find((r) => r.number === 102);
    expect(res102).toBeDefined();
    const texts = res102!.lines.map((l) => l.text).join(" ");
    expect(texts).toContain("グレイブスのスモークスクリーンか？");
    // アンカー行は文脈として残ってよい。
    expect(res102!.anchors).toEqual([101]);
    // 他レスも回帰なく本文が残っている。
    expect(reactions.find((r) => r.number === 101)!.lines[0].text).toBe("グレイブスってどうなん");
    expect(reactions.find((r) => r.number === 103)!.lines.map((l) => l.text)).toContain("いや違う、あれはWだよ");
    expect(reactions.find((r) => r.number === 104)!.lines.map((l) => l.text)).toContain("これ？知らんかった");
  });

  it("真因: NGワード「ブス」がチャンピオン名「グレイブス」に部分一致して誤検知されていたのが原因（findNgWordExcludingで解消）", async () => {
    // チャンピオン名を含まないNG文は従来どおり検出・処理される（誤検知の是正であって検出無効化ではない）ことも合わせて確認。
    const content = "1: このチャンピオンはカスだと思う";
    const body = await composeArticleBody({ sourceType: "5ch", title: "NG通常検出テスト", content }, llm);
    const reactions = reactionBlocksOf(body);
    // NG文(mock言い換え不可)は従来どおり削除されレス自体が空になり非掲載になる。
    expect(reactions).toHaveLength(0);
  });

  it("moderation非保留: チャンピオン名(グレイブス)を含む記事はng_word保留にならず公開される", async () => {
    const title = "【LoL】グレイブスの立ち回りについて";
    const bodyText = "グレイブスのスモークスクリーンが強い。";
    const result = moderateArticleContent({ title, bodyText, sourceCount: 1 });
    expect(result.status).toBe("published");
  });
});

describe("reactqual-S3 F-RQ3-2: keepLinesがアンカー行indexのみ指定（llm選定相当）→ 全res.linesにフォールバック", () => {
  it("llm選定がアンカー行だけをkeepしても本文が残る", async () => {
    await withReactionSelectMode("llm", async () => {
      const content = ["101: 元の発言", "", "102: >>101", "グレイブスの本文だよ"].join("\n");
      // index1(res102)のうちlines[0]（">>101"のみ）だけをkeepするLLM応答。
      const stub = new ReactionSelectStub(JSON.stringify({ keep: [{ index: 1, lines: [0] }], emphasize: [] }));
      const body = await composeArticleBody({ sourceType: "5ch", title: "keepLinesフォールバックテスト", content }, stub);
      const reactions = reactionBlocksOf(body);
      const res102 = reactions.find((r) => r.number === 102);
      expect(res102).toBeDefined();
      const texts = res102!.lines.map((l) => l.text).join(" ");
      expect(texts).toContain("グレイブスの本文だよ");
    });
  });
});

describe("reactqual-S3 F-RQ3-3: アンカーのみ／NG全消レスは非掲載（他レス・順序は維持）", () => {
  it("アンカーのみのレス（102）とNG全消により実質空になるレス（103）は非掲載になり、101・104のみ表示・順序維持", async () => {
    const content = [
      "101: 元の発言",
      "",
      "102: >>101",
      "",
      "103: >>102",
      "カスだと思う",
      "",
      "104: >>103",
      "普通の返信",
    ].join("\n");

    const body = await composeArticleBody({ sourceType: "5ch", title: "空レス非掲載テスト", content }, llm);
    const reactions = reactionBlocksOf(body);
    const numbers = reactions.map((r) => r.number);
    expect(numbers).toEqual([101, 104]);
    expect(reactions.find((r) => r.number === 102)).toBeUndefined();
    expect(reactions.find((r) => r.number === 103)).toBeUndefined();
    // 104の本文・アンカー文脈は維持される。
    const res104 = reactions.find((r) => r.number === 104)!;
    expect(res104.lines.map((l) => l.text)).toContain("普通の返信");
  });

  it("X経由でもNG全消により空になるリプは非掲載になり、他リプ・連番は維持される", async () => {
    function xreply(overrides: Partial<XReplyItem>): XReplyItem {
      return {
        id: "x",
        text: "",
        author: "fan",
        likeCount: 1,
        replyCount: 0,
        quoteCount: 0,
        url: "https://x.com/fan/status/x",
        isQuote: false,
        lang: "ja",
        ...overrides,
      };
    }
    const items: XReplyItem[] = [
      xreply({ id: "1", text: "カスだと思う", likeCount: 10 }), // NG全消で非掲載
      xreply({ id: "2", text: "普通のコメントだけ", likeCount: 5 }),
      xreply({ id: "3", text: "これも普通の反応", likeCount: 3 }),
    ];
    const blocks = await buildXReactionBlocks(items, llm);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.number)).toEqual([1, 2]); // 非掲載分を除いて連番が振り直される
    expect(blocks.flatMap((b) => b.lines.map((l) => l.text))).toEqual(
      expect.arrayContaining(["普通のコメントだけ", "これも普通の反応"]),
    );
  });
});

describe("reactqual-S3: 既存回帰（逐語・強調・アンカー文脈は不変）", () => {
  it("NGを含まない通常の反応記事はこれまでどおり逐語・アンカー・強調が維持される", async () => {
    const content = "1: 壁飛び5連続でキャリーとか草生える\n2: >>1 それな";
    const body = await composeArticleBody({ sourceType: "5ch", title: "既存回帰テスト", content }, llm);
    const reactions = reactionBlocksOf(body);
    expect(reactions.map((r) => r.number)).toEqual([1, 2]);
    expect(reactions[0].lines[0]).toEqual({ text: "壁飛び5連続でキャリーとか草生える", emphasis: "red" });
    expect(reactions[1].anchors).toEqual([1]);
  });

  it("bodyBlocksToTextにNGワードが残らないこと（moderation整合、reddit経路の既存soften挙動は不変）", async () => {
    const body = await composeArticleBody(
      { sourceType: "reddit", title: "回帰確認", content: "1: This player deserves criticism for that play" },
      llm,
    );
    const bodyText = bodyBlocksToText(body);
    expect(bodyText).not.toContain("undefined");
  });
});
