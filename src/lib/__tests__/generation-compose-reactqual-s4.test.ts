/**
 * reactqual-S4（5ch反応のレスを「新しめ/活発な会話」優先に、バグ2修正）のテスト。
 * 実データで確認したバグ: 5ch反応で古いレス（58・61番等）が選ばれ、直近の活発な議論でなかった。
 * 5chも統一選定（`selectScoredAnchorReses`、resel-S2）に載せ、レス番号を疑似score（新しい＝高score）
 * として使うことで「新しめの活発レス＋親アンカー文脈」を選ぶ（F-RQ4-1）。
 * 実HTTPは叩かない（MockLLMClient/スタブLLMのみ）。
 */
import { describe, expect, it } from "vitest";
import { composeArticleBody } from "@/lib/generation/compose";
import { MockLLMClient } from "@/lib/generation/llm-client";
import type { ArticleBodyReactionBlock } from "@/lib/article-body";

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

describe("5ch統一選定（reactqual-S4 F-RQ4-1）: 新しめ/活発な会話優先", () => {
  it("新しめの独立クラスタが選ばれ、古いクラスタだけに偏らない・親文脈がチェーン整合順(親→子)で含まれる", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules", REACTION_MAX_RESES: "3" }, async () => {
      // 古いクラスタ(10→11→12、アンカーで連結)と、新しいクラスタ(200→201→202、アンカーで連結)。
      // target=3・hardCapなので、新しいクラスタ(疑似score200番台)だけがprimary+文脈で採用され、
      // 古いクラスタ(10,11,12)は完全に除外される(新しめ優先・古いクラスタに偏らない)。
      const content =
        "10: 古い話題の最初。\n" +
        "11: >>10 それについて。\n" +
        "12: >>11 さらに続き。\n" +
        "200: 新しい話題の最初。\n" +
        "201: >>200 それについて。\n" +
        "202: >>201 さらに続き。";
      const body = await composeArticleBody({ sourceType: "5ch", title: "新しめ優先テスト", content }, llm);
      // 親→子のチェーン整合順で新しいクラスタのみが選ばれる。
      expect(reactionNumbers(body)).toEqual([200, 201, 202]);
    });
  });

  it("新しめの独立レス(primary)と古いクラスタが混在する場合、新しめが先に出てその親文脈も連なる", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules", REACTION_MAX_RESES: "2" }, async () => {
      // target=2: primaryは50(score50)・40(score40)。40の親30(score30、低score)が文脈として追加される。
      const content = "30: 古い発言。\n" + "40: >>30 それに反応。\n" + "50: 独立した新しい発言。";
      const body = await composeArticleBody({ sourceType: "5ch", title: "混在テスト", content }, llm);
      // primary(score降順): 50,40。40の親30が文脈追加されチェーン整合順(親→子)で出る。
      expect(reactionNumbers(body)).toEqual([50, 30, 40]);
    });
  });
});

describe("5chの>>NからparentIndexが導出される（reactqual-S4 F-RQ4-1、parentNumber注釈なし）", () => {
  it("本文の>>Nから親を辿り、親が文脈としてチェーン整合順(親→子)で選ばれる", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules", REACTION_MAX_RESES: "1" }, async () => {
      // target=1: primaryは12(score12)のみ。>>10から親(res10)が文脈追加される。res11(score11)は
      // primaryでも親でもないため選ばれない。
      const content = "10: >>10 自己参照のみのレス。\n11: >>999 存在しない番号への参照。\n12: >>10 有効な親参照。";
      const body = await composeArticleBody({ sourceType: "5ch", title: "アンカー由来parentテスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([10, 12]);
    });
  });

  it("自己参照(>>自分自身)は自身の親にならない(無限ループ・自己ループにならず単独のプライマリとして扱われる)", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules" }, async () => {
      const content = "1: >>1 自分自身への参照だけを含むレス。";
      const body = await composeArticleBody({ sourceType: "5ch", title: "自己参照テスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([1]);
    });
  });

  it("存在しない番号への参照はparentIndex=nullとして扱われ、選定・表示ともに落ちない", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules" }, async () => {
      const content = "1: >>999 存在しない番号を参照するレス。";
      const body = await composeArticleBody({ sourceType: "5ch", title: "存在しない参照テスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([1]);
    });
  });
});

describe("reactqual-S3再現テスト不変（reactqual-S4後も#102の本文保持・空レス非掲載ガードが維持される）", () => {
  it("101〜104のアンカーチェーンで#102に本文が保持される(新しめ選定でも104(最新)＋親101〜103が文脈として選ばれる)", async () => {
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

      const body = await composeArticleBody({ sourceType: "5ch", title: "S4後もS3不変テスト", content }, llm);
      const reactions = body.filter((b): b is ArticleBodyReactionBlock => b.type === "reaction");
      // 104(最新・primary)が親チェーン(101→102→103→104)を伴って選ばれる。
      expect(reactions.map((r) => r.number)).toEqual([101, 102, 103, 104]);
      const res102 = reactions.find((r) => r.number === 102)!;
      expect(res102.lines.map((l) => l.text).join(" ")).toContain("グレイブスのスモークスクリーンか？");
      expect(res102.anchors).toEqual([101]);
    });
  });

  it("アンカーのみ／NG全消レスは非掲載のまま(空レス非掲載ガード不変)", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules" }, async () => {
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

      const body = await composeArticleBody({ sourceType: "5ch", title: "S4後も空レスガード不変テスト", content }, llm);
      const reactions = body.filter((b): b is ArticleBodyReactionBlock => b.type === "reaction");
      expect(reactions.map((r) => r.number)).toEqual([101, 104]);
    });
  });
});

describe("reddit/llm/X不変（reactqual-S4は5chの選定順のみ変更）", () => {
  it("reddit rulesモードはscore注釈のまま統一選定を使う(不変)", async () => {
    await withEnv({ REACTION_SELECT_MODE: "rules" }, async () => {
      const content =
        "50 (score:3): Old low-score comment.\n" +
        "60 (score:80 parent:50): High score reply referencing 50.\n" +
        "70 (score:95): Highest independent comment.";
      const body = await composeArticleBody({ sourceType: "reddit", title: "reddit不変テスト", content }, llm);
      expect(reactionNumbers(body)).toEqual([70, 50, 60]);
    });
  });

  it("5ch llmモードはselectReactionReses(AI選定)のまま(不変、統一選定は使わない)", async () => {
    await withEnv({ REACTION_SELECT_MODE: "llm" }, async () => {
      const stubLLM = {
        generate: async (messages: { role: string; content: string }[]) => {
          const user = messages.find((m) => m.role === "user");
          const task = user ? (JSON.parse(user.content) as { kind?: string }) : {};
          // AIが独立した古いレス(index0=res10)だけをkeepと返す想定。統一選定なら新しいレス(res200)が
          // 優先されるはずだが、llmモードは不変のためAIの指定どおりres10だけが採用される。
          if (task.kind === "reaction-select") return JSON.stringify({ keep: [0], emphasize: [] });
          return "";
        },
      };
      const content = "10: 古いレス。\n200: 新しいレス。";
      const body = await composeArticleBody({ sourceType: "5ch", title: "5ch llm不変テスト", content }, stubLLM);
      expect(reactionNumbers(body)).toEqual([10]);
    });
  });
});
