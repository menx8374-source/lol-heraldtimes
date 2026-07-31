/**
 * resel-S2（統一レス選定「score優先＋アンカー文脈」・Reddit/X共通）のテスト。
 * - reddit `buildReactionBlocks`: rulesモードで`selectScoredAnchorReses`に置き換わり、score上位＋親文脈
 *   （score/parent注釈）がチェーン整合順（親→子）で選ばれる。5ch・llmモードは不変（selectMajorConversationCluster
 *   /selectReactionResesのまま）。
 * - X `buildXReactionBlocks`: inReplyToIdで親を辿り、likeCount優先＋文脈で選ぶ。
 * - env `REACTION_MAX_RESES`/`REACTION_ANCHOR_DEPTH` で目安件数・遡り段数が変わる。
 * 実HTTPは叩かない（MockLLMClient/スタブLLMのみ）。
 */
import { describe, expect, it } from "vitest";
import { composeArticleBody, buildXReactionBlocks } from "@/lib/generation/compose";
import { MockLLMClient } from "@/lib/generation/llm-client";
import type { ArticleBodyReactionBlock } from "@/lib/article-body";
import type { XReplyItem } from "@/lib/collection/adapters/x";

const llm = new MockLLMClient();

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

function reactionNumbers(body: { type: string; number?: number }[]): number[] {
  return body.filter((b): b is ArticleBodyReactionBlock => b.type === "reaction").map((b) => b.number);
}

describe("buildReactionBlocks（reddit統一選定、resel-S2 F-RS2-2）", () => {
  it("rulesモード: scoreの高いレス＋親文脈(score/parent注釈)がチェーン整合順(親→子)で選ばれる", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules" }, async () => {
      // res70(score95,親なし)が最高score・独立。res60(score80)はres50(score3,低score)への返信。
      // 元スレ順は50→60→70だが、統一選定はscore降順でprimaryを走査するため70が先、
      // 次にres60(80)の親res50(3、低scoreだが文脈として採用)→res60の順で出力される。
      const content =
        "50 (score:3): Old low-score comment.\n" +
        "60 (score:80 parent:50): High score reply referencing 50.\n" +
        "70 (score:95): Highest independent comment.";
      const body = await composeArticleBody({ sourceType: "reddit", title: "統一選定テスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([70, 50, 60]);
    });
  });

  it("hardCap超過はcontextの低scoreから間引かれる（REACTION_MAX_RESESで絞る）", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules", REACTION_MAX_RESES: "1" }, async () => {
      // target=1・hardCap=4。primaryは最高score(70)のみ。70の親はいないので文脈追加なし。
      const content =
        "50 (score:3): Old low-score comment.\n" +
        "60 (score:80 parent:50): High score reply referencing 50.\n" +
        "70 (score:95): Highest independent comment.";
      const body = await composeArticleBody({ sourceType: "reddit", title: "hardCapテスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([70]);
    });
  });

  it("REACTION_MAX_RESESで目安件数が変わる(既定より広げると全件採用される)", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules", REACTION_MAX_RESES: "2" }, async () => {
      const content =
        "50 (score:3): Old low-score comment.\n" +
        "60 (score:80 parent:50): High score reply referencing 50.\n" +
        "70 (score:95): Highest independent comment.";
      // target=2: primaryは70(95)・60(80)。60の親50(score3)が文脈追加される。
      const body = await composeArticleBody({ sourceType: "reddit", title: "target拡張テスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([70, 50, 60]);
    });
  });

  it("REACTION_ANCHOR_DEPTH=1(既定)は親文脈を追加するが、0にすると追加されない(遡り段数)", async () => {
    const content = "50 (score:3): Old low-score comment.\n60 (score:80 parent:50): High score reply.";

    // target=1: primaryは60(score80)のみ。既定anchorDepth=1なら親50が文脈追加され[50,60]になる。
    await withEnv({ REACTION_SELECT_MODE: "rules", REACTION_MAX_RESES: "1" }, async () => {
      const body = await composeArticleBody({ sourceType: "reddit", title: "anchorDepth既定テスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([50, 60]);
    });

    // anchorDepth=0にすると親を遡らないため、60のみが選ばれる(文脈追加なし)。
    await withEnv({ REACTION_SELECT_MODE: "rules", REACTION_MAX_RESES: "1", REACTION_ANCHOR_DEPTH: "0" }, async () => {
      const body = await composeArticleBody({ sourceType: "reddit", title: "anchorDepth0テスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([60]);
    });
  });

  it("score注釈が無いレスはscore0として扱われ、scoreが高いレスが優先される", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules", REACTION_MAX_RESES: "1" }, async () => {
      const content = "1: 注釈なしレス(score0扱い)。\n2 (score:10): 高scoreレス。";
      const body = await composeArticleBody({ sourceType: "reddit", title: "score省略テスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([2]);
    });
  });

  it("5chはscore/parent注釈があってもselectMajorConversationCluster据え置き(不変・score無視)", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules" }, async () => {
      // 5chの選定はscoreを見ず、>>N本文アンカーで連結したクラスタのみを見る。
      // score注釈があっても無視され、>>Nアンカーの無い独立レスは高scoreでも除外される。
      const content =
        "1: 最初の話題。\n" + "2: >>1 それについて。\n" + "3 (score:999): 高scoreだが独立(アンカー無し)レス。";
      const body = await composeArticleBody({ sourceType: "5ch", title: "5ch不変テスト", content }, llm);
      // クラスタ(1,2)のみ採用、高scoreの独立レス(3)は選ばれない(5chはscore無視のまま)。
      expect(reactionNumbers(body)).toEqual([1, 2]);
    });
  });

  it("REACTION_SELECT_MODE=llmのreddit記事はscore/parent注釈があっても統一選定を使わずAI選定(selectReactionReses)のまま(不変)", async () => {
    await withEnv({ REACTION_SELECT_MODE: "llm" }, async () => {
      // AIがindex0(res50, score3の低scoreレス)だけをkeepと返す想定。統一選定ならscore80のres60が
      // 優先されるはずだが、llmモードは不変のためAIの指定どおりres50だけが採用される。
      const stubLLM = {
        generate: async (messages: { role: string; content: string }[]) => {
          const user = messages.find((m) => m.role === "user");
          const task = user ? (JSON.parse(user.content) as { kind?: string }) : {};
          if (task.kind === "reaction-select") return JSON.stringify({ keep: [0], emphasize: [] });
          return "";
        },
      };
      const content = "50 (score:3): Old low-score comment.\n60 (score:80 parent:50): High score reply.";
      const body = await composeArticleBody({ sourceType: "reddit", title: "llmモード不変テスト", content }, stubLLM);
      expect(reactionNumbers(body)).toEqual([50]);
    });
  });
});

describe("buildXReactionBlocks（X統一選定、resel-S2 F-RS2-3）", () => {
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

  it("likeCountの高いレス＋inReplyToIdで連結した親文脈がチェーン整合順で選ばれる", async () => {
    await withEnv({ REACTION_MAX_RESES: "1" }, async () => {
      const items: XReplyItem[] = [
        xreply({ id: "parent", text: "親リプ(低いいね)", likeCount: 3 }),
        xreply({ id: "child", text: "子リプ(高いいね)", likeCount: 90, inReplyToId: "parent" }),
        xreply({ id: "independent", text: "無関係な独立リプ(中程度いいね)", likeCount: 20 }),
      ];
      const blocks = await buildXReactionBlocks(items, llm);
      // target=1: primaryはchild(90)のみ。childの親(parent,likeCount3)が文脈追加され親→子の順。
      expect(blocks.map((b) => b.name.split(" ")[0])).toEqual(["@fan1", "@fan1"]);
      expect(blocks.map((b) => b.lines[0].text)).toEqual(["親リプ(低いいね)", "子リプ(高いいね)"]);
    });
  });

  it("inReplyToIdがプール外(同プール内に一致するidが無い)ならparentIndexはnull扱いで落ちない", async () => {
    const items: XReplyItem[] = [xreply({ id: "only", text: "唯一のリプ", likeCount: 5, inReplyToId: "not-in-pool" })];
    const blocks = await buildXReactionBlocks(items, llm);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines[0].text).toBe("唯一のリプ");
  });

  it("REACTION_MAX_RESESでX側も目安件数が変わる", async () => {
    await withEnv({ REACTION_MAX_RESES: "2" }, async () => {
      const items: XReplyItem[] = [
        xreply({ id: "a", text: "a", likeCount: 10 }),
        xreply({ id: "b", text: "b", likeCount: 30 }),
        xreply({ id: "c", text: "c", likeCount: 20 }),
      ];
      const blocks = await buildXReactionBlocks(items, llm);
      expect(blocks).toHaveLength(2);
      expect(blocks.map((b) => b.lines[0].text)).toEqual(["b", "c"]);
    });
  });
});
