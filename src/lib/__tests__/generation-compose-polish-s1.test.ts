/**
 * polish-S1 F-P1-2（5ch反応レスの表示順を時系列＝レス番号昇順にする）のテスト。
 * - 5ch（統一選定、REACTION_SELECT_MODE=rules/既定）: 選定される集合は不変（新しめ優先）のまま、
 *   表示順だけをレス番号昇順に並び替える。
 * - reddit（統一選定）: チェーン整合順（upvote由来）は不変（並び替えない）。
 * - X（buildXReactionBlocks）: likeCount由来のチェーン整合順は不変（並び替えない）。
 * - 5ch llm経路（selectMajorConversationCluster/selectReactionReses）は不変。
 * - reactqual-S3再現（#102本文保持・空レス非掲載・逐語・強調）は時系列表示後も維持される。
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

describe("5ch反応の表示順（polish-S1 F-P1-2、時系列＝レス番号昇順）", () => {
  it("brief記載の例: 選定=[404,405,401,402,403,...]相当の新しめ優先集合が、表示ではレス番号昇順になる", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules", REACTION_MAX_RESES: "5" }, async () => {
      // 401→402→403→404→405のアンカーチェーン。新しめ優先選定ではscore(=番号)降順でprimaryを走査する
      // ためチェーン整合順は405,404,403,402,401相当になるが、表示は401,402,403,404,405の昇順になる。
      const content =
        "401: 発端の話題。\n" +
        "402: >>401 それについて。\n" +
        "403: >>402 さらに続き。\n" +
        "404: >>403 続報。\n" +
        "405: >>404 最新の反応。";
      const body = await composeArticleBody({ sourceType: "5ch", title: "時系列表示テスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([401, 402, 403, 404, 405]);
    });
  });

  it("選定される集合自体は不変（新しめ優先のまま）で、表示順のみが変わる（新旧クラスタ混在）", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules", REACTION_MAX_RESES: "3" }, async () => {
      const content =
        "10: 古い話題の最初。\n" +
        "11: >>10 それについて。\n" +
        "12: >>11 さらに続き。\n" +
        "200: 新しい話題の最初。\n" +
        "201: >>200 それについて。\n" +
        "202: >>201 さらに続き。";
      const body = await composeArticleBody({ sourceType: "5ch", title: "選定不変テスト", content }, llm);
      // 選定集合は{200,201,202}のまま(古いクラスタ10-12は含まれない=新しめ優先は不変)。
      // 表示順はレス番号昇順(chainが既に昇順のためこの例では変化なし=集合不変の確認が主目的)。
      expect(reactionNumbers(body)).toEqual([200, 201, 202]);
    });
  });

  it("reactqual-S3再現: #102の本文保持・空レス非掲載・逐語は時系列表示後も維持される", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules" }, async () => {
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
      const body = await composeArticleBody({ sourceType: "5ch", title: "S3再現+時系列テスト", content }, llm);
      const reactions = body.filter((b): b is ArticleBodyReactionBlock => b.type === "reaction");
      expect(reactions.map((r) => r.number)).toEqual([101, 102, 103, 104]);
      const res102 = reactions.find((r) => r.number === 102)!;
      expect(res102.lines.map((l) => l.text).join(" ")).toContain("グレイブスのスモークスクリーンか？");
      expect(res102.anchors).toEqual([101]);
    });
  });

  it("空レス（アンカーのみ/NG全消）は時系列表示でも非掲載のまま", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules" }, async () => {
      const content = [
        "101: 元の発言",
        "",
        "102: >>101",
        "",
        "103: >>102",
        "普通の返信A",
        "",
        "104: >>103",
        "普通の返信B",
      ].join("\n");
      const body = await composeArticleBody({ sourceType: "5ch", title: "空レス非掲載+時系列テスト", content }, llm);
      const reactions = body.filter((b): b is ArticleBodyReactionBlock => b.type === "reaction");
      expect(reactions.map((r) => r.number)).toEqual([101, 103, 104]);
    });
  });
});

describe("reddit/X の表示順は不変（polish-S1では変更しない）", () => {
  it("redditはscore由来のチェーン整合順のまま（レス番号昇順に並び替えない）", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules" }, async () => {
      const content =
        "50 (score:3): Old low-score comment.\n" +
        "60 (score:80 parent:50): High score reply referencing 50.\n" +
        "70 (score:95): Highest independent comment.";
      const body = await composeArticleBody({ sourceType: "reddit", title: "reddit不変テスト", content }, llm);
      // チェーン整合順(70,50,60)のまま。番号昇順(50,60,70)にはならない。
      expect(reactionNumbers(body)).toEqual([70, 50, 60]);
    });
  });

  it("Xはlikecount由来のチェーン整合順のまま（並び替えない）", async () => {
    const items: XReplyItem[] = [
      {
        id: "parent",
        text: "親リプ(低いいね)",
        author: "fan1",
        likeCount: 3,
        replyCount: 0,
        quoteCount: 0,
        url: "https://x.com/fan1/status/parent",
        isQuote: false,
        lang: "ja",
      },
      {
        id: "child",
        text: "子リプ(高いいね)",
        author: "fan1",
        likeCount: 90,
        replyCount: 0,
        quoteCount: 0,
        url: "https://x.com/fan1/status/child",
        isQuote: false,
        lang: "ja",
        inReplyToId: "parent",
      },
    ];
    await withEnv({ REACTION_MAX_RESES: "1" }, async () => {
      const blocks = await buildXReactionBlocks(items, llm);
      // primaryはchild(90)のみ選ばれ、その親(parent)が文脈追加されチェーン整合順(親→子)で出る。
      expect(blocks.map((b) => b.lines[0].text)).toEqual(["親リプ(低いいね)", "子リプ(高いいね)"]);
    });
  });
});
