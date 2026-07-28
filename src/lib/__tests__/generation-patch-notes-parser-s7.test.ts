import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parsePatchNotesHtml, type PatchChangeTarget } from "@/lib/generation/patch-notes-parser";

/**
 * パッチ記事刷新S7: 11パッチ実データ（大型26.1・前シーズン25系含む）で判明した構造パターンの回帰テスト。
 * フィクスチャは各実パッチから抜粋した軽量ファイル（フル11パッチHTMLはコミットしない。分析後削除済み）。
 * S6の残課題（アリーナ対象名が「チャンピオン」になる／`<p><strong>個別名</strong></p>`という
 * 中間ラベルが1グループに潰れる）の解消と、大型26.1固有の構造（h3.change-titleを使わずチャンピオン/
 * アイテムアイコン付き見出しを連続列挙する「ミッドパッチアップデート」節）を検証する。
 */

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "..", "generation", "__fixtures__", name), "utf8");
}

function findByName(targets: PatchChangeTarget[], name: string): PatchChangeTarget | undefined {
  return targets.find((t) => t.name === name);
}

describe("parsePatchNotesHtml（S7 F-S7-1: 大型26.1のミッドパッチアップデート節・h3.change-titleを使わないチャンピオン/アイテムの連続列挙）", () => {
  const html = loadFixture("patch-26-1-midpatch-excerpt.html");
  const targets = parsePatchNotesHtml(html);

  it("例外を投げない・対象が0件でない", () => {
    expect(() => parsePatchNotesHtml(html)).not.toThrow();
    expect(targets.length).toBeGreaterThan(0);
  });

  it("h3.change-titleが無くても、チャンピオンアイコン付き見出し(h3.ability-title)ごとに独立した対象に分割される(誤帰属ゼロ)", () => {
    const aphelios = findByName(targets, "アフェリオス")!;
    const graves = findByName(targets, "グレイブス")!;
    const kayle = findByName(targets, "ケイル")!;
    expect(aphelios).toBeDefined();
    expect(aphelios.kind).toBe("champion");
    expect(aphelios.id).toBe("Aphelios");
    expect(graves).toBeDefined();
    expect(graves.kind).toBe("champion");
    expect(graves.id).toBe("Graves");
    expect(kayle).toBeDefined();
    expect(kayle.kind).toBe("champion");
    // グレイブスの変更がアフェリオスの対象に混入していない(誤帰属ゼロ)
    const apheliosChanges = aphelios.groups.flatMap((g) => g.changes);
    expect(apheliosChanges.some((c) => c.stat === "クリティカルスケーリング")).toBe(false);
    const gravesChanges = graves.groups.flatMap((g) => g.changes);
    expect(gravesChanges.some((c) => c.stat === "クリティカルスケーリング")).toBe(true);
  });

  it("ケイルは固有スキルとQの2グループを持つ(欠落ゼロ)", () => {
    const kayle = findByName(targets, "ケイル")!;
    expect(kayle.groups.length).toBe(2);
    const qGroup = kayle.groups.find((g) => g.abilityKey === "Q")!;
    expect(qGroup.changes.length).toBe(2);
  });

  it("h4.ability-title(アイテムアイコン)のエッセンス リーバーも独立したitem対象になる", () => {
    const essence = findByName(targets, "エッセンス リーバー")!;
    expect(essence).toBeDefined();
    expect(essence.kind).toBe("item");
    expect(essence.id).toBe("3508");
    expect(essence.groups.flatMap((g) => g.changes).length).toBe(3);
  });

  it("末尾のプレーンなh4見出し(Clash最新スケジュール等)はエッセンス リーバーに混入せず、既知の問題が独立した対象になる(欠落ゼロ・誤帰属ゼロ)", () => {
    const essence = findByName(targets, "エッセンス リーバー")!;
    const essenceChanges = essence.groups.flatMap((g) => g.changes);
    expect(essenceChanges.some((c) => c.text?.includes("ランク戦で一部の設定"))).toBe(false);

    const knownIssues = findByName(targets, "既知の問題")!;
    expect(knownIssues).toBeDefined();
    expect(knownIssues.groups.flatMap((g) => g.changes).length).toBe(3);
    const texts = knownIssues.groups.flatMap((g) => g.changes).map((c) => c.text);
    expect(texts.some((t) => t?.includes("ランク戦で一部の設定が利用できない"))).toBe(true);
  });

  it("逐語一致: アフェリオスの変更値が実HTMLの文字と完全一致する", () => {
    const aphelios = findByName(targets, "アフェリオス")!;
    const change = aphelios.groups[0].changes[0];
    expect(change).toEqual({ stat: "Eのスキルレベルごとの増加脅威", before: "5.5", after: "4.5" });
  });
});

describe("parsePatchNotesHtml（S7 F-S7-2: エピック オブジェクトの調整、個別名は具体名を維持）", () => {
  const html = loadFixture("patch-26-1-epicobjective-excerpt.html");
  const targets = parsePatchNotesHtml(html);

  it("例外を投げない・欠落ゼロ", () => {
    expect(() => parsePatchNotesHtml(html)).not.toThrow();
    expect(targets.length).toBeGreaterThan(0);
  });

  it("h3が無くても具体的な個別名(エレメンタルドレイク)が対象名になる(総称に潰れない)", () => {
    const drake = findByName(targets, "エレメンタルドレイク")!;
    expect(drake).toBeDefined();
    // セクション自体がチャンピオン/アイテム等の総称ではないため、具体的な個別名がそのまま使われる
    const elderDragonGroup = drake.groups.find((g) => g.abilityName === "エルダードラゴン")!;
    expect(elderDragonGroup).toBeDefined();
    expect(elderDragonGroup.changes.length).toBe(9);
  });

  it("逐語一致: 体力の変更が本文の文字のまま抽出される(記述式)", () => {
    const drake = findByName(targets, "エレメンタルドレイク")!;
    const hpChange = drake.groups[0].changes.find((c) => c.text?.startsWith("体力："))!;
    expect(hpChange.text).toBe("体力：5,730～13,790 ⇒ 3,625 + レベルごとに375（5,106～10,000）");
  });
});

describe("parsePatchNotesHtml（S7 F-S7-1/F-S7-3: アップデートされたアイテムのアイコン付き見出しも独立したitem対象に分割される）", () => {
  const html = loadFixture("patch-26-1-updateditems-excerpt.html");
  const targets = parsePatchNotesHtml(html);

  it("例外を投げない", () => {
    expect(() => parsePatchNotesHtml(html)).not.toThrow();
  });

  it("終わりなき絶望とイージスの盾がそれぞれ独立したitem対象になる(誤帰属ゼロ)", () => {
    const yasuo1 = findByName(targets, "終わりなき絶望")!;
    const aegis = findByName(targets, "イージスの盾")!;
    expect(yasuo1).toBeDefined();
    expect(yasuo1.kind).toBe("item");
    expect(yasuo1.id).toBe("2502");
    expect(aegis).toBeDefined();
    expect(aegis.kind).toBe("item");
    expect(aegis.id).toBe("3105");
    // イージスの盾の変更が終わりなき絶望に混入していない
    const yasuo1Changes = yasuo1.groups.flatMap((g) => g.changes);
    expect(yasuo1Changes.some((c) => c.text === "ゲームから削除")).toBe(false);
  });
});

describe("parsePatchNotesHtml（S7 F-S7-3: 新アイテム(CMSアイコン=DDragon未登録)は単一対象内の複数グループのまま・kind=item）", () => {
  const html = loadFixture("patch-26-1-newitems-excerpt.html");
  const targets = parsePatchNotesHtml(html);

  it("例外を投げない・欠落ゼロ", () => {
    expect(() => parsePatchNotesHtml(html)).not.toThrow();
  });

  it("先頭アイテム(黄昏と暁)が対象名になり、2件目(フィーンドハンターの矢)はグループとして個別名を維持する(kind=item)", () => {
    const target = findByName(targets, "黄昏と暁")!;
    expect(target).toBeDefined();
    expect(target.kind).toBe("item");
    const secondGroup = target.groups.find((g) => g.abilityName === "フィーンドハンターの矢")!;
    expect(secondGroup).toBeDefined();
    expect(secondGroup.changes.length).toBe(7);
  });
});

describe("parsePatchNotesHtml（S7: 前シーズン25系markup（25.19）も崩れない・「チャンピオン/アイテム」という総称に対象名が潰れない）", () => {
  const html = loadFixture("patch-25-19-season-excerpt.html");
  const targets = parsePatchNotesHtml(html);

  it("例外を投げない・欠落ゼロ", () => {
    expect(() => parsePatchNotesHtml(html)).not.toThrow();
    expect(targets.length).toBeGreaterThan(0);
  });

  it("対象名は総称(チャンピオン/アイテム)にならずセクション名にフォールバックする(F-S7-2)", () => {
    const target = findByName(targets, "ランダムミッドのバランス調整")!;
    expect(target).toBeDefined();
    expect(findByName(targets, "チャンピオン")).toBeUndefined();
    expect(findByName(targets, "アイテム")).toBeUndefined();
  });

  it("チャンピオン(アカリ/ブライアー)とアイテム(ステラックの篭手/マルモティウスの胃袋)がそれぞれ個別のグループとして残る(誤帰属ゼロ・欠落ゼロ)", () => {
    const target = findByName(targets, "ランダムミッドのバランス調整")!;
    const akali = target.groups.find((g) => g.abilityName === "アカリ")!;
    const briar = target.groups.find((g) => g.abilityName === "ブライアー")!;
    const stridebreaker = target.groups.find((g) => g.abilityName === "ステラックの篭手")!;
    expect(akali).toBeDefined();
    expect(akali.changes).toEqual([{ stat: "Rのクールダウン", before: "120 / 90 / 60秒", after: "90 / 75 / 60秒" }]);
    expect(briar).toBeDefined();
    expect(briar.changes.length).toBe(2);
    expect(stridebreaker).toBeDefined();
  });
});
