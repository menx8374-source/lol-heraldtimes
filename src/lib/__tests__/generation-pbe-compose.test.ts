import { describe, expect, it } from "vitest";
import {
  composePbeArticleBody,
  buildPbeArticleTitle,
  extractPbeVersionLabel,
  PBE_ARTICLE_BADGE_TEXT,
  PBE_SKILL_DETAIL_NOTICE_TEXT,
  PBE_ARTICLE_SOURCE_TEXT,
  CDRAGON_SITE_URL,
} from "@/lib/generation/pbe-compose";
import { parseArticleBody, blockText, type ArticleBodyPatchChangeBlock } from "@/lib/article-body";

function championBlock(
  overrides: Partial<ArticleBodyPatchChangeBlock> = {},
): ArticleBodyPatchChangeBlock {
  return {
    type: "patchChange",
    targetName: "アジール",
    targetKind: "champion",
    direction: "buff",
    groups: [{ abilityKey: "base", changes: [{ stat: "HP", before: "575", after: "620" }] }],
    ...overrides,
  };
}

function itemBlock(overrides: Partial<ArticleBodyPatchChangeBlock> = {}): ArticleBodyPatchChangeBlock {
  return {
    type: "patchChange",
    targetName: "インフィニティエッジ",
    targetKind: "item",
    direction: "adjust",
    groups: [{ changes: [{ stat: "合計コスト", before: "3400", after: "3300" }] }],
    ...overrides,
  };
}

describe("extractPbeVersionLabel", () => {
  it("先頭のmajor.minorだけを抜き出す", () => {
    expect(extractPbeVersionLabel("16.16.8000032+branch.main.content.beta")).toBe("16.16");
  });
  it("パターンに一致しない文字列はそのまま返す（捏造しない）", () => {
    expect(extractPbeVersionLabel("unknown")).toBe("unknown");
  });
});

describe("buildPbeArticleTitle（F-PBE4-3）", () => {
  it("ルール生成のタイトルを組み立てる（AI不使用・捏造しない）", () => {
    expect(buildPbeArticleTitle("16.16")).toBe(
      "【PBE先行】パッチ16.16のチャンピオン・アイテム変更まとめ（テストサーバー・随時更新）",
    );
  });
});

describe("composePbeArticleBody（F-PBE4-1）", () => {
  it("先頭に未確定バッジ段落、2番目に冒頭サマリ段落を置く（テスト2）", () => {
    const body = composePbeArticleBody({
      pbeVersion: "16.16",
      championBlocks: [championBlock()],
      itemBlocks: [itemBlock()],
    });
    expect(body[0]).toEqual({ type: "paragraph", text: PBE_ARTICLE_BADGE_TEXT });
    expect(body[1]).toEqual({
      type: "paragraph",
      text: "PBE 16.16 時点で、チャンピオン1体・アイテム1件の変更が確認されています（スキル効果量の詳細は公式パッチノートで確定）。",
    });
  });

  it("チャンピオンの変更(基本ステータス/cost/cooldown)とアイテムの変更を逐語のまま含む（テスト2）", () => {
    const champ = championBlock({
      groups: [{ abilityKey: "Q", changes: [{ stat: "コスト", before: "80", after: "60" }] }],
    });
    const item = itemBlock();
    const body = composePbeArticleBody({ pbeVersion: "16.16", championBlocks: [champ], itemBlocks: [item] });

    const patchChangeBlocks = body.filter(
      (b): b is ArticleBodyPatchChangeBlock => b.type === "patchChange",
    );
    expect(patchChangeBlocks).toContainEqual(champ); // 内容そのまま(逐語維持)
    expect(patchChangeBlocks).toContainEqual(item);
    expect(patchChangeBlocks.some((b) => b.targetKind === "champion")).toBe(true);
    expect(patchChangeBlocks.some((b) => b.targetKind === "item")).toBe(true);

    // 見出し（3グループ振り分け＋アイテムの変更）が存在する
    const headingTexts = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headingTexts).toContain("主な強化"); // champ.direction === "buff"
    expect(headingTexts).toContain("アイテムの変更");
  });

  it("チャンピオンをdirectionで3グループ(主な強化/主な弱体化/その他の調整)に振り分ける", () => {
    const buff = championBlock({ targetName: "強化対象", direction: "buff" });
    const nerf = championBlock({ targetName: "弱体化対象", direction: "nerf" });
    const adjust = championBlock({ targetName: "調整対象", direction: "adjust" });
    const body = composePbeArticleBody({
      pbeVersion: "16.16",
      championBlocks: [buff, nerf, adjust],
      itemBlocks: [],
    });
    const headingTexts = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headingTexts).toEqual(["主な強化", "主な弱体化", "その他の調整", "スキル詳細について"]);
  });

  it("該当データが無いグループの見出しは出さない（0件のグループは省略）", () => {
    const body = composePbeArticleBody({
      pbeVersion: "16.16",
      championBlocks: [championBlock({ direction: "buff" })],
      itemBlocks: [],
    });
    const headingTexts = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headingTexts).not.toContain("主な弱体化");
    expect(headingTexts).not.toContain("その他の調整");
    expect(headingTexts).not.toContain("アイテムの変更");
  });

  it("「スキル詳細は公式で」を明示し、スキル効果量に相当する語を一切含まない（テスト2・5）", () => {
    const body = composePbeArticleBody({
      pbeVersion: "16.16",
      championBlocks: [championBlock()],
      itemBlocks: [itemBlock()],
    });
    const text = body.map(blockText).join("\n");
    expect(text).toContain(PBE_SKILL_DETAIL_NOTICE_TEXT);

    // patchChangeブロック(実データ)自体にスキル効果量に相当する語が一切含まれない
    // （注意書き段落は自サイト定型文であり検査対象外。実データ側の担保を確認する）。
    const patchChangeText = JSON.stringify(
      body.filter((b) => b.type === "patchChange"),
    );
    expect(patchChangeText).not.toMatch(/effectAmounts|coefficients/);

    // 本文中の全ての数値変更statは既知のラベル(基本ステータス/cost/cooldown/ammo/アイテム系)のみ
    const knownStats = new Set([
      "HP",
      "HP成長",
      "攻撃力",
      "攻撃力成長",
      "物理防御",
      "物理防御成長",
      "魔法防御",
      "移動速度",
      "攻撃射程",
      "攻撃速度",
      "攻撃速度成長",
      "コスト",
      "クールダウン",
      "弾数",
      "弾薬回復時間",
      "合計コスト",
      "ステータス",
      "説明",
      "素材",
      "合成先",
      "店舗掲載",
    ]);
    const stats = body
      .filter((b): b is ArticleBodyPatchChangeBlock => b.type === "patchChange")
      .flatMap((b) => b.groups.flatMap((g) => g.changes.map((c) => c.stat)))
      .filter((s): s is string => Boolean(s));
    for (const stat of stats) {
      expect(knownStats.has(stat)).toBe(true);
    }
  });

  it("出典(CommunityDragon / Riot Games)を明記し、CDragonへのリンクボタンを出す（テスト2）", () => {
    const body = composePbeArticleBody({ pbeVersion: "16.16", championBlocks: [], itemBlocks: [] });
    expect(body.some((b) => b.type === "paragraph" && b.text === PBE_ARTICLE_SOURCE_TEXT)).toBe(true);
    const linkButton = body.find((b) => b.type === "linkButton");
    expect(linkButton).toMatchObject({ type: "linkButton", url: CDRAGON_SITE_URL });
  });

  it("目次(toc)を組み立て、見出しのanchorと対応する", () => {
    const body = composePbeArticleBody({
      pbeVersion: "16.16",
      championBlocks: [championBlock()],
      itemBlocks: [itemBlock()],
    });
    const toc = body.find((b) => b.type === "toc");
    expect(toc).toBeDefined();
    const headings = body.filter((b) => b.type === "heading");
    expect(toc!.type).toBe("toc");
    if (toc!.type === "toc") {
      expect(toc!.items.map((i) => i.anchor)).toEqual(headings.map((h) => h.anchor));
    }
  });

  it("champion/itemともに0件でも例外を投げず、バッジ・サマリ・スキル注意・出典のみの本文を返す", () => {
    const body = composePbeArticleBody({ pbeVersion: "16.16", championBlocks: [], itemBlocks: [] });
    expect(body[0]).toEqual({ type: "paragraph", text: PBE_ARTICLE_BADGE_TEXT });
    expect(body.some((b) => b.type === "patchChange")).toBe(false);
    expect(() => parseArticleBody(body)).not.toThrow();
  });

  it("生成した本文はparseArticleBodyの検証を必ず通過する（有効な本文形式）", () => {
    const body = composePbeArticleBody({
      pbeVersion: "16.16",
      championBlocks: [championBlock(), championBlock({ targetName: "弱体化対象", direction: "nerf" })],
      itemBlocks: [itemBlock()],
    });
    expect(() => parseArticleBody(body)).not.toThrow();
  });
});
