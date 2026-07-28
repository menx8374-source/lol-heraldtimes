import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { composeArticleBody, classifyPatchChange } from "@/lib/generation/compose";
import { MockLLMClient } from "@/lib/generation/llm-client";
import type { ArticleBodyBlock, ArticleBodyPatchChangeBlock } from "@/lib/article-body";

/**
 * パッチ刷新S2（F-S2-2/F-S2-3）: composeArticleBody（riot・detailedモード）がDOM抽出
 * （`parsePatchNotesHtml`）ベースの`patchChange`ブロックで本文を組み立てることの結合テスト。
 * S1のフィクスチャ（実際に取得した公式パッチノート26.14のHTML抜粋）をそのまま使う。
 */

const FIXTURE_PATH = path.join(__dirname, "..", "generation", "__fixtures__", "patch-26-14.html");
const fixtureHtml = fs.readFileSync(FIXTURE_PATH, "utf8");

const llm = new MockLLMClient();
const sourceUrl = "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-26-14-notes";
// DOM抽出優先時、contentの中身自体は使われない（PATCH_NOTES_MIN_LENGTH判定にも関与しない経路）が、
// GenerationCandidateInputの必須フィールドを満たすためのプレースホルダー。
const dummyContent = "本文プレースホルダー。".repeat(20);

function patchChangeBlocks(body: ArticleBodyBlock[]): ArticleBodyPatchChangeBlock[] {
  return body.filter((b): b is ArticleBodyPatchChangeBlock => b.type === "patchChange");
}

function headingTexts(body: ArticleBodyBlock[]): string[] {
  return body.filter((b): b is Extract<ArticleBodyBlock, { type: "heading" }> => b.type === "heading").map((h) => h.text);
}

describe("composeArticleBody（riot detailedパッチ本文、DOM抽出、パッチ刷新S2 F-S2-2）", () => {
  it("candidate.htmlがあればDOM抽出を使い、アジール=W/R・コーキ=base(2⇒2.5)/Rが正しい対象カード(patchChange)で出る(誤帰属ゼロ)", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: dummyContent, sourceUrl, html: fixtureHtml },
      llm,
    );

    const blocks = patchChangeBlocks(body);
    expect(blocks.length).toBeGreaterThan(0);

    const azir = blocks.find((b) => b.targetName === "アジール");
    expect(azir).toBeDefined();
    expect(azir!.groups.map((g) => g.abilityKey)).toEqual(["W", "R"]);
    expect(azir!.groups.flatMap((g) => g.changes).some((c) => c.stat === "レベルアップごとの攻撃力")).toBe(false);

    const corki = blocks.find((b) => b.targetName === "コーキ");
    expect(corki).toBeDefined();
    expect(corki!.targetKind).toBe("champion");
    expect(corki!.groups.map((g) => g.abilityKey)).toEqual(["base", "R"]);
    const baseGroup = corki!.groups.find((g) => g.abilityKey === "base")!;
    expect(baseGroup.changes).toEqual([{ stat: "レベルアップごとの攻撃力", before: "2", after: "2.5" }]);
    const rGroup = corki!.groups.find((g) => g.abilityKey === "R")!;
    expect(rGroup.abilityName).toBe("R - 連発ミサイル");
    expect(rGroup.changes[0].stat).toBe("通常攻撃による残りリチャージ時間短縮量");
    expect(corki!.intent).toContain("試合終盤のコーキの出撃時の火力を少し高め");
    // 攻撃力2⇒2.5(増加)、短縮量の増加(2秒～4秒⇒2秒～6秒)、いずれも強化 → 対象全体はbuff
    expect(corki!.direction).toBe("buff");
  });

  it("アイテム/システムが対象名付き(総称に潰れない)で出る", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: dummyContent, sourceUrl, html: fixtureHtml },
      llm,
    );

    const names = patchChangeBlocks(body).map((b) => b.targetName);
    expect(names).toEqual(
      expect.arrayContaining(["不滅の道", "プロトプラズム ハーネス", "ヘクステック ロケットベルト", "ブルーバフ"]),
    );
    // 総称(「アイテム」「システム」)自体はpatchChangeブロックのtargetNameとしては出ない(個別名のみ)
    expect(names).not.toContain("アイテム");
    expect(names).not.toContain("システム");

    // ただし見出し(グルーピング単位)としては「アイテム」「システム」が出る
    const headings = headingTexts(body);
    expect(headings).toContain("アイテム");
    expect(headings).toContain("システム");

    const immortalPath = patchChangeBlocks(body).find((b) => b.targetName === "不滅の道")!;
    expect(immortalPath.targetKind).toBe("item");
    const blueBuff = patchChangeBlocks(body).find((b) => b.targetName === "ブルーバフ")!;
    expect(blueBuff.targetKind).toBe("system");
  });

  it("3グループ見出し(主な強化/主な弱体化/その他の調整)・冒頭サマリ・目次が出る", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ26.14ノート公開",
        content: dummyContent,
        sourceUrl,
        imageUrl: "https://cmsassets.rgpub.io/sanity/images/patch-26-14-banner-1920x1087.jpg",
        html: fixtureHtml,
      },
      llm,
    );

    expect(body[0].type).toBe("image");
    expect(body[1].type).toBe("paragraph");
    expect(body[2].type).toBe("toc");

    const headings = headingTexts(body);
    expect(headings).toEqual(expect.arrayContaining(["主な強化", "主な弱体化", "その他の調整", "アイテム", "システム"]));

    const toc = body.find((b) => b.type === "toc");
    expect(toc?.type === "toc" && toc.items.map((i) => i.label)).toEqual(headings);
    for (const h of body.filter((b): b is Extract<ArticleBodyBlock, { type: "heading" }> => b.type === "heading")) {
      expect(h.anchor).toMatch(/^sec-\d+$/);
    }

    const last = body[body.length - 1];
    expect(last.type).toBe("linkButton");
    expect(last.type === "linkButton" && last.url).toBe(sourceUrl);
  });

  it("imageUrl未指定でもDOM抽出本文が組まれる(バナー省略、冒頭サマリから始まる)", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: dummyContent, sourceUrl, html: fixtureHtml },
      llm,
    );
    expect(body[0].type).toBe("paragraph");
    expect(body[1].type).toBe("toc");
  });
});

describe("composeArticleBody（patchChangeブロックのアイコンURL、パッチ記事刷新S3 F-S3-1/F-S3-3）", () => {
  it("対象アイコン/スキルアイコンが正規化後のDDragon直URLで出る(akamaihdラッパー解除)", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: dummyContent, sourceUrl, html: fixtureHtml },
      llm,
    );
    const corki = patchChangeBlocks(body).find((b) => b.targetName === "コーキ")!;
    expect(corki.targetIconUrl).toBe("https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Corki.png");
    const rGroup = corki.groups.find((g) => g.abilityKey === "R")!;
    expect(rGroup.abilityIconUrl).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/MissileBarrage.png",
    );
  });

  it("http(非https)のf=しか持たないアイテムはtargetIconUrlがDDragonバージョン推定によるフォールバックで補完される", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: dummyContent, sourceUrl, html: fixtureHtml },
      llm,
    );
    const immortalPath = patchChangeBlocks(body).find((b) => b.targetName === "不滅の道")!;
    // フィクスチャのf=は http(非https) のためDOM抽出のiconUrl自体はundefinedになるが、
    // 同一パッチ内の他アイコン(champion)からDDragonバージョンが推定され、idからitemアイコンURLが補完される。
    expect(immortalPath.targetIconUrl).toBe("https://ddragon.leagueoflegends.com/cdn/16.13.1/img/item/3168.png");
  });

  it("https直のf=を持つアイテムはDOM抽出のiconUrlがそのまま使われる(フォールバック不要)", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: dummyContent, sourceUrl, html: fixtureHtml },
      llm,
    );
    const rocketbelt = patchChangeBlocks(body).find((b) => b.targetName === "ヘクステック ロケットベルト")!;
    expect(rocketbelt.targetIconUrl).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/item/223152.png",
    );
  });

  it("system対象(ブルーバフ)はアイコンURLを持たない(壊れない・undefinedのまま)", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: dummyContent, sourceUrl, html: fixtureHtml },
      llm,
    );
    const blueBuff = patchChangeBlocks(body).find((b) => b.targetName === "ブルーバフ")!;
    expect(blueBuff.targetIconUrl).toBeUndefined();
  });
});

describe("classifyPatchChange（direction算出、パッチ刷新S2 F-S2-3）", () => {
  it("攻撃力2⇒2.5(単一値の増加)はbuff", () => {
    expect(classifyPatchChange({ stat: "レベルアップごとの攻撃力", before: "2", after: "2.5" })).toBe("buff");
  });

  it("短縮量(2秒～4秒⇒2秒～6秒、範囲の最大値が増加)はbuff(反転しない、量は増加=強化の語のため)", () => {
    expect(
      classifyPatchChange({
        stat: "通常攻撃による残りリチャージ時間短縮量",
        before: "2秒～4秒（クリティカル率に応じて）",
        after: "2秒～6秒",
      }),
    ).toBe("buff");
  });

  it("曖昧な範囲表記(200～300⇒100～300、最大値が同値)はadjustに安全側で倒す", () => {
    expect(classifyPatchChange({ stat: "増加体力", before: "200～300", after: "100～300" })).toBe("adjust");
  });

  it("コスト増加(反転語)はnerf", () => {
    expect(classifyPatchChange({ stat: "コスト", before: "2500ゴールド", after: "2600ゴールド" })).toBe("nerf");
  });

  it("クールダウン増加(反転語)はnerf", () => {
    expect(classifyPatchChange({ stat: "発動効果のクールダウン", before: "40秒", after: "50秒" })).toBe("nerf");
  });

  it("スラッシュ複数値の単純減少(150/250/350⇒125/200/275)はnerf", () => {
    expect(
      classifyPatchChange({ stat: "確定ダメージ", before: "150 / 250 / 350", after: "125 / 200 / 275" }),
    ).toBe("nerf");
  });

  it("代表数値が抽出できない(数値を含まない)場合はadjust", () => {
    expect(classifyPatchChange({ stat: "何らかの調整", before: "変更前の記述", after: "変更後の記述" })).toBe(
      "adjust",
    );
  });

  it("種類(単一/範囲/スラッシュ)が前後で食い違う場合はadjustに安全側で倒す", () => {
    expect(classifyPatchChange({ stat: "スキルヘイスト", before: "10", after: "10 / 15 / 20" })).toBe("adjust");
  });

  it("文中に数値候補が複数あり判別できない場合(魔力100ごとに10%⇒魔力100ごとに7%)はadjustに安全側で倒す", () => {
    expect(
      classifyPatchChange({ stat: "スロウ効果の魔力反映率", before: "魔力100ごとに10%", after: "魔力100ごとに7%" }),
    ).toBe("adjust");
  });
});

describe("composeArticleBody（S6: 記述式変更のdirection・非チャンピオン対象の反映）", () => {
  it("アジールは全変更が記述式(⇒なし)のためdirectionはadjust(安全側)になる", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: dummyContent, sourceUrl, html: fixtureHtml },
      llm,
    );
    const azir = patchChangeBlocks(body).find((b) => b.targetName === "アジール")!;
    expect(azir.direction).toBe("adjust");
    const wGroup = azir.groups.find((g) => g.abilityKey === "W")!;
    expect(wGroup.changes.every((c) => c.text !== undefined)).toBe(true);
  });

  it("リー・シン/死神の残り火/アリーナ(対象名「アリーナ」、S7 F-S7-2で「チャンピオン」から解消)が対象名付きカードで出る(総称に潰れない)", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: dummyContent, sourceUrl, html: fixtureHtml },
      llm,
    );
    const names = patchChangeBlocks(body).map((b) => b.targetName);
    expect(names).toEqual(expect.arrayContaining(["リー・シン", "死神の残り火", "アリーナ"]));
    const deathfire = patchChangeBlocks(body).find((b) => b.targetName === "死神の残り火")!;
    expect(deathfire.targetKind).toBe("rune");
    const arena = patchChangeBlocks(body).find((b) => b.targetName === "アリーナ" && b.targetKind === "arena")!;
    expect(arena).toBeDefined();
  });

  it("バグ修正＆QoLの変更ブロックが記述式変更を含んだまま(数値化しない)出る", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: dummyContent, sourceUrl, html: fixtureHtml },
      llm,
    );
    const bugfix = patchChangeBlocks(body).find((b) => b.targetName === "バグ修正＆QoLの変更")!;
    expect(bugfix).toBeDefined();
    expect(bugfix.targetKind).toBe("bugfix");
    const allChanges = bugfix.groups.flatMap((g) => g.changes);
    expect(allChanges.some((c) => c.text?.includes("ケイトリンの「ヘッドショット」"))).toBe(true);
  });
});

describe("composeArticleBody（DOM抽出フォールバック、パッチ刷新S2 F-S2-2）", () => {
  const textContent = [
    "パッチ26.14ノートへようこそ。今回のアップデートでは複数のチャンピオンとアイテムに調整が加わっています。",
    "エディタ: サンプルライター",
    "T1がLCKを制覇し3連覇を達成しました。今シーズンも熱い戦いが繰り広げられ、多くのファンが試合の行方を見守りました。",
    "",
    "アジール",
    "基本ステータス",
    "攻撃力: 55 ⇒ 58",
    "",
    "ガレン",
    "R - デマーシアの正義",
    "確定ダメージ: 150/250/350 ⇒ 130/230/330",
    "",
    "TFTのお知らせ",
    "TFTセット14が近日公開予定です。詳細は追ってお知らせします。新しいシナジーやチャンピオンが多数追加され、環境が大きく変化する見込みです。今後のアップデートにもご期待ください。",
  ].join("\n");

  it("candidate.html未指定なら平テキスト経路(既存フォールバック)にそのまま落ちる", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: textContent, sourceUrl },
      llm,
    );
    expect(body.some((b) => b.type === "patchChange")).toBe(false);
    expect(headingTexts(body)).toContain("アジール");
  });

  it("candidate.htmlが構造不一致(patch-change-blockを含まない)なら空配列となり、平テキスト経路にフォールバックする", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ26.14ノート公開",
        content: textContent,
        sourceUrl,
        html: "<html><body><p>関係ないページ</p></body></html>",
      },
      llm,
    );
    expect(body.some((b) => b.type === "patchChange")).toBe(false);
    expect(headingTexts(body)).toContain("アジール");
  });

  it("candidate.html・contentともに使えない場合は事実速報にフォールバックする(既存挙動)", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: "短い本文", sourceUrl, html: "" },
      llm,
    );
    expect(headingTexts(body)).toEqual(["パッチ26.14が公開"]);
  });
});
