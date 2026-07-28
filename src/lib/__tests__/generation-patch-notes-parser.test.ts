import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parsePatchNotesHtml,
  normalizePatchIconUrl,
  inferDdragonVersionFromTargets,
  buildChampionSquareIconUrl,
  buildItemIconUrl,
  type PatchChangeTarget,
} from "@/lib/generation/patch-notes-parser";
import { classifyChange } from "@/lib/generation/compose";

/**
 * パッチ刷新S1（F-S1-2/F-S1-3）: 公式パッチノートHTMLのDOM構造抽出パーサのテスト。
 * フィクスチャは実際に取得した公式パッチノート26.14のHTML（チャンピオン/アイテム/システム/
 * バグ修正の各セクション抜粋。`docs/patch-accuracy-research.md` §1.3(c)で確認済みのDOM構造）。
 * 誤帰属ゼロ（アジール=W/R、コーキ=基本ステータス(2⇒2.5)/R が正しい対象に）を最重要項目として検証する。
 */

const FIXTURE_PATH = path.join(__dirname, "..", "generation", "__fixtures__", "patch-26-14.html");
const fixtureHtml = fs.readFileSync(FIXTURE_PATH, "utf8");

function findByName(targets: PatchChangeTarget[], name: string): PatchChangeTarget | undefined {
  return targets.find((t) => t.name === name);
}

describe("parsePatchNotesHtml（誤帰属ゼロの検証・最重要）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it("アジールとコーキがそれぞれ独立したPatchChangeTargetとして抽出される", () => {
    expect(findByName(targets, "アジール")).toBeDefined();
    expect(findByName(targets, "コーキ")).toBeDefined();
  });

  it("アジールのgroupsはWとRのみ(基本ステータスの攻撃力変更を含まない)", () => {
    const azir = findByName(targets, "アジール")!;
    const abilityKeys = azir.groups.map((g) => g.abilityKey);
    expect(abilityKeys).toEqual(["W", "R"]);
    // アジールの変更にコーキの攻撃力変更(2⇒2.5)が紛れ込んでいない(誤帰属ゼロ)
    const allChanges = azir.groups.flatMap((g) => g.changes);
    expect(allChanges.some((c) => c.stat === "レベルアップごとの攻撃力")).toBe(false);
  });

  it("コーキは基本ステータス(レベルアップごとの攻撃力 2⇒2.5)とRを持つ独立した対象になる", () => {
    const corki = findByName(targets, "コーキ")!;
    expect(corki.groups.map((g) => g.abilityKey)).toEqual(["base", "R"]);
    const baseGroup = corki.groups.find((g) => g.abilityKey === "base")!;
    expect(baseGroup.changes).toEqual([
      { stat: "レベルアップごとの攻撃力", before: "2", after: "2.5" },
    ]);
    const rGroup = corki.groups.find((g) => g.abilityKey === "R")!;
    expect(rGroup.abilityName).toBe("R - 連発ミサイル");
    expect(rGroup.changes[0].stat).toBe("通常攻撃による残りリチャージ時間短縮量");
  });

  it("コーキのidはアイコンURLのファイル名から取得され、名前マップに依存しない(Corki)", () => {
    const corki = findByName(targets, "コーキ")!;
    expect(corki.id).toBe("Corki");
    expect(corki.kind).toBe("champion");
    expect(corki.iconUrl).toContain("Corki.png");
  });

  it("アジールのidも同様にアイコンURLのファイル名から取得される(Azir)", () => {
    const azir = findByName(targets, "アジール")!;
    expect(azir.id).toBe("Azir");
    expect(azir.kind).toBe("champion");
  });
});

describe("parsePatchNotesHtml（スキルキー判定）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it('"R - 連発ミサイル" → abilityKey="R"', () => {
    const corki = findByName(targets, "コーキ")!;
    const rGroup = corki.groups.find((g) => g.abilityName === "R - 連発ミサイル");
    expect(rGroup?.abilityKey).toBe("R");
  });

  it('"基本ステータス" → abilityKey="base"', () => {
    const corki = findByName(targets, "コーキ")!;
    const baseGroup = corki.groups.find((g) => g.abilityName === "基本ステータス");
    expect(baseGroup?.abilityKey).toBe("base");
  });

  it('"固有スキル - ..." はパッチ記事刷新S6の決定ルールでabilityKey="passive"と判定される(固有スキルもスキルグループ扱い)', () => {
    const jayce = findByName(targets, "ジェイス")!;
    const passiveGroup = jayce.groups.find((g) => g.abilityName?.includes("固有スキル"));
    expect(passiveGroup).toBeDefined();
    expect(passiveGroup?.abilityKey).toBe("passive");
  });
});

describe("parsePatchNotesHtml（対象種別/ID・意図・アイコンURL）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it("アイテムのpatch-change-blockはkind=item・idがアイコンURLの数値ファイル名から取れる", () => {
    const immortalPath = findByName(targets, "不滅の道")!;
    expect(immortalPath.kind).toBe("item");
    expect(immortalPath.id).toBe("3168");
    const rocketbelt = findByName(targets, "ヘクステック ロケットベルト")!;
    expect(rocketbelt.kind).toBe("item");
    expect(rocketbelt.id).toBe("223152");
  });

  it("アイテムの対象名(h3)は個別に残り、総称(例:「アイテム」)に潰れない", () => {
    const names = targets.filter((t) => t.kind === "item").map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["不滅の道", "プロトプラズム ハーネス", "ヘクステック ロケットベルト"]),
    );
    expect(names).not.toContain("アイテム");
  });

  it("blockquoteの変更意図(intent)が本文の文字のまま抽出される", () => {
    const corki = findByName(targets, "コーキ")!;
    expect(corki.intent).toContain("試合終盤のコーキの出撃時の火力を少し高め");
  });

  it("対象アイコンURL(iconUrl)がブロック先頭のimg srcから取れる(パッチ刷新S3: akamaihdラッパー正規化後のDDragon直URL)", () => {
    const azir = findByName(targets, "アジール")!;
    expect(azir.iconUrl).toBe("https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Azir.png");
  });

  it("コーキの対象アイコン(iconUrl)も正規化後のDDragon champion square URLになる(パッチ刷新S3 F-S3-1)", () => {
    const corki = findByName(targets, "コーキ")!;
    expect(corki.iconUrl).toBe("https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Corki.png");
  });

  it("コーキのRスキルのabilityIconUrlが正規化後のDDragon spell URLになる(パッチ刷新S3 F-S3-1)", () => {
    const corki = findByName(targets, "コーキ")!;
    const rGroup = corki.groups.find((g) => g.abilityKey === "R")!;
    expect(rGroup.abilityIconUrl).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/MissileBarrage.png",
    );
  });

  it("http(非https)のf=を持つアイテムアイコンはiconUrlがundefinedになる(idは維持され種別解決は壊れない)", () => {
    const immortalPath = findByName(targets, "不滅の道")!;
    expect(immortalPath.iconUrl).toBeUndefined();
    expect(immortalPath.id).toBe("3168");
    expect(immortalPath.kind).toBe("item");
  });

  it("h3が無いシステム節のブロック(実データ: ブルーバフ)もkind=systemで抽出され、クラッシュしない", () => {
    const blueBuff = findByName(targets, "ブルーバフ");
    expect(blueBuff).toBeDefined();
    expect(blueBuff?.kind).toBe("system");
    expect(blueBuff?.groups.flatMap((g) => g.changes).length).toBeGreaterThan(0);
  });

  it("sectionにはそのブロック直近のh2見出しが入る", () => {
    const azir = findByName(targets, "アジール")!;
    expect(azir.section).toBe("チャンピオン");
    const immortalPath = findByName(targets, "不滅の道")!;
    expect(immortalPath.section).toBe("アイテム");
  });
});

describe("parsePatchNotesHtml（逐語維持）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it("before/after/statがフィクスチャ本文の文字と完全一致する(改変なし)", () => {
    const garen = findByName(targets, "ガレン")!;
    const change = garen.groups[0].changes[0];
    expect(change.stat).toBe("確定ダメージ");
    expect(change.before).toBe("150 / 250 / 350（+対象の減少体力の25 / 30 / 35%）");
    expect(change.after).toBe("125 / 200 / 275（+対象の減少体力の25 / 30 / 35%）");
  });

  it("レシピのような記号混じりの値もそのまま抽出される(捏造しない)", () => {
    const rocketbelt = findByName(targets, "ヘクステック ロケットベルト")!;
    const recipe = rocketbelt.groups[0].changes.find((c) => c.stat === "レシピ")!;
    expect(recipe.before).toBe("ヘクステック オルタネーター + フィンディッシュの古書 + 増魔の書 + 300ゴールド");
    expect(recipe.after).toBe("ヘクステック オルタネーター + キンドルジェム + ルビー クリスタル + 350ゴールド");
  });
});

describe("parsePatchNotesHtml（F-S1-3: 既存classifyChangeの適用）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  function changeLine(c: { stat?: string; before?: string; after?: string }): string {
    return `${c.stat}：${c.before} ⇒ ${c.after}`;
  }

  it("コーキの基本ステータス変更(攻撃力増加)にclassifyChangeを適用するとbuffになる", () => {
    const corki = findByName(targets, "コーキ")!;
    const baseChange = corki.groups.find((g) => g.abilityKey === "base")!.changes[0];
    expect(classifyChange(changeLine(baseChange))).toBe("buff");
  });

  it("コスト増加(反転語)にclassifyChangeを適用するとnerfになる(反転ロジックがそのまま効く)", () => {
    const protoplasm = findByName(targets, "プロトプラズム ハーネス")!;
    const costChange = protoplasm.groups[0].changes.find((c) => c.stat === "コスト")!;
    expect(costChange.before).toBe("2500ゴールド");
    expect(costChange.after).toBe("2600ゴールド");
    expect(classifyChange(changeLine(costChange))).toBe("nerf");
  });

  it("割合の単純減少にclassifyChangeを適用するとnerfになる", () => {
    const immortalPath = findByName(targets, "不滅の道")!;
    const change = immortalPath.groups[0].changes.find(
      (c) => c.stat === "最大体力50%以上時のダメージ増加割合",
    )!;
    expect(classifyChange(changeLine(change))).toBe("nerf");
  });
});

describe("normalizePatchIconUrl（パッチ記事刷新S3 F-S3-1）", () => {
  it("akamaihdラッパー(f=に直接埋め込み)をデコードしてDDragon直URLを返す", () => {
    expect(
      normalizePatchIconUrl(
        "https://am-a.akamaihd.net/image?f=https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/MissileBarrage.png",
      ),
    ).toBe("https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/MissileBarrage.png");
  });

  it("f=がURLエンコードされていてもデコードできる", () => {
    const encoded =
      "https://am-a.akamaihd.net/image?f=" +
      encodeURIComponent("https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Corki.png");
    expect(normalizePatchIconUrl(encoded)).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Corki.png",
    );
  });

  it("既にDDragon直URLのものはそのまま返す", () => {
    const url = "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/passive/Jayce_Passive.png";
    expect(normalizePatchIconUrl(url)).toBe(url);
  });

  it("その他のhttps画像URLもそのまま返す", () => {
    const url = "https://example.com/some-image.png";
    expect(normalizePatchIconUrl(url)).toBe(url);
  });

  it("f=の中身がhttp(非https)の場合はisSafeImageUrlを満たさずundefinedを返す", () => {
    expect(
      normalizePatchIconUrl(
        "https://am-a.akamaihd.net/image?f=http://ddragon.leagueoflegends.com/cdn/16.13.1/img/item/3168.png",
      ),
    ).toBeUndefined();
  });

  it("不正なスキーム(javascript:)・空文字・undefinedはundefinedを返す", () => {
    expect(normalizePatchIconUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizePatchIconUrl("")).toBeUndefined();
    expect(normalizePatchIconUrl(undefined)).toBeUndefined();
  });
});

describe("inferDdragonVersionFromTargets / buildChampionSquareIconUrl / buildItemIconUrl（パッチ記事刷新S3 F-S3-3）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it("同一パッチ内の既存アイコンURLからDDragonバージョンを推定する", () => {
    expect(inferDdragonVersionFromTargets(targets)).toBe("16.13.1");
  });

  it("アイコンURLを1件も含まない対象配列はundefinedを返す(例外を投げない)", () => {
    expect(inferDdragonVersionFromTargets([])).toBeUndefined();
  });

  it("buildChampionSquareIconUrlはchampionId+versionからDDragon square URLを組み立てる", () => {
    expect(buildChampionSquareIconUrl("Corki", "16.13.1")).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Corki.png",
    );
  });

  it("buildItemIconUrlはitemId+versionからDDragonアイテムアイコンURLを組み立てる", () => {
    expect(buildItemIconUrl("3168", "16.13.1")).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/item/3168.png",
    );
  });
});

describe("parsePatchNotesHtml（異常系）", () => {
  it("空文字は空配列を返す(例外を投げない)", () => {
    expect(parsePatchNotesHtml("")).toEqual([]);
  });

  it("patch-change-blockを含まない構造不一致HTMLは空配列を返す(例外を投げない)", () => {
    expect(parsePatchNotesHtml("<html><body><p>関係ないページ</p></body></html>")).toEqual([]);
  });

  it("壊れた/閉じタグの無いHTMLでも例外を投げず配列を返す", () => {
    const broken =
      '<h2>チャンピオン</h2><div class="patch-change-block"><h3 class="change-title">壊れチャンピオン</h3><blockquote><p>意図';
    expect(() => parsePatchNotesHtml(broken)).not.toThrow();
    expect(Array.isArray(parsePatchNotesHtml(broken))).toBe(true);
  });

  it("null/undefinedを渡しても例外を投げず空配列を返す", () => {
    // @ts-expect-error 実行時の不正入力(null)に対する防御を確認する意図的な型違反
    expect(parsePatchNotesHtml(null)).toEqual([]);
    // @ts-expect-error 実行時の不正入力(undefined)に対する防御を確認する意図的な型違反
    expect(parsePatchNotesHtml(undefined)).toEqual([]);
  });
});

/**
 * パッチ記事刷新S6: 過去5パッチ実データ（26.10〜26.14）で判明した未対応パターンの回帰テスト。
 * フィクスチャ（`__fixtures__/patch-26-14.html`）は本来のアジール/コーキ等に加え、リー・シン
 * （26.12実データ・Q1/Q2の非スキルh4）・死神の残り火（26.11実データ・ルーンのh3付きブロック、
 * kindがセクション名フォールバックで解決）・アリーナ（2614実データ・h4=チャンピオン/アイテム/
 * オーグメントの多様な小見出し・NEWバッジ付き記述式変更）を実データのまま追記している
 * （docs/sprints/patch-s6-brief.md「テスト」1〜7に対応）。
 */
describe("parsePatchNotesHtml（S6 テスト1: アジールWの記述式変更が埋まる）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it("アジールのW group(見出し=W - 目覚めよ！)に記述式変更が3件、逐語のまま入る(空にならない)", () => {
    const azir = findByName(targets, "アジール")!;
    const wGroup = azir.groups.find((g) => g.abilityKey === "W")!;
    expect(wGroup.changes.length).toBe(3);
    expect(wGroup.changes.every((c) => c.text !== undefined)).toBe(true);
    expect(wGroup.changes.every((c) => c.before === undefined && c.after === undefined)).toBe(true);

    const texts = wGroup.changes.map((c) => c.text);
    expect(texts.some((t) => t?.includes("征服者") && t?.includes("2スタックを適用するようになりました"))).toBe(
      true,
    );
    expect(texts.some((t) => t?.includes("プレスアタック") && t?.includes("最初に命中した対象"))).toBe(true);
    expect(texts.some((t) => t?.includes("通常攻撃時に50%ではなく100%のダメージ"))).toBe(true);

    // ラベル(stat)は先頭<strong>から取れる(例: "ダブルタップ")
    const doubleTap = wGroup.changes.find((c) => c.text?.includes("征服者"))!;
    expect(doubleTap.stat).toBe("ダブルタップ");
  });

  it("アジールのRにも記述式変更(ノックバック)が1件入る", () => {
    const azir = findByName(targets, "アジール")!;
    const rGroup = azir.groups.find((g) => g.abilityKey === "R")!;
    expect(rGroup.changes.length).toBe(1);
    expect(rGroup.changes[0].text).toContain("ジャングルモンスターをノックバックするようになりました");
    expect(rGroup.changes[0].stat).toBe("失せろ、下民！");
  });
});

describe("parsePatchNotesHtml（S6 テスト3: h3無しシステムブロックの対象名解決）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it("h3が無いブロックは先頭の非スキルh4(ブルーバフ)を対象名として使い、その見出し自体は重複表示しない(無名グループになる)", () => {
    const blueBuff = findByName(targets, "ブルーバフ")!;
    expect(blueBuff.kind).toBe("system");
    expect(blueBuff.groups.length).toBe(1);
    expect(blueBuff.groups[0].abilityName).toBeUndefined();
    expect(blueBuff.groups[0].abilityKey).toBeUndefined();
  });

  it("スキルヘイスト：10 ⇒ 10/15/20 が数値変更として正しく抽出される(コロンがstrongタグ内側にあるパターン)", () => {
    const blueBuff = findByName(targets, "ブルーバフ")!;
    const change = blueBuff.groups[0].changes[0];
    expect(change.stat).toBe("スキルヘイスト");
    expect(change.before).toBe("10");
    expect(change.after).toContain("10 / 15 / 20");
  });
});

describe("parsePatchNotesHtml（S6 テスト4: white-stone非pcbバグ修正ブロックが欠落しない）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it("patch-change-blockクラスを持たないバグ修正ブロックが対象として抽出される(対象名はセクション名フォールバック)", () => {
    const bugfix = findByName(targets, "バグ修正＆QoLの変更")!;
    expect(bugfix).toBeDefined();
    expect(bugfix.kind).toBe("bugfix");
  });

  it("複数のul(意図→変更→意図→変更)にまたがる7件の変更が全て取れる(欠落ゼロ)。前のブロックにも吸い込まれない", () => {
    const bugfix = findByName(targets, "バグ修正＆QoLの変更")!;
    const allChanges = bugfix.groups.flatMap((g) => g.changes);
    expect(allChanges.length).toBe(7);
    expect(allChanges.some((c) => c.text?.includes("ケイトリンの「ヘッドショット」") && c.text?.includes("修正しました"))).toBe(
      true,
    );
    expect(allChanges.some((c) => c.text?.includes("/remake"))).toBe(true);

    // 前のブロック(システム=ブルーバフ)にバグ修正の変更が紛れ込んでいない(誤帰属ゼロ)
    const blueBuff = findByName(targets, "ブルーバフ")!;
    expect(blueBuff.groups.flatMap((g) => g.changes).some((c) => c.text?.includes("ヘッドショット"))).toBe(false);
  });

  it("複数のblockquoteが結合されintentに反映される", () => {
    const bugfix = findByName(targets, "バグ修正＆QoLの変更")!;
    expect(bugfix.intent).toContain("バフバーに重要度の低い情報");
    expect(bugfix.intent).toContain("以前はあった重要な情報が見つからない");
  });
});

describe("parsePatchNotesHtml（S6 テスト5: 多様なh4は小見出しとして扱われスキル誤認しない）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it("リー・シンのQ1/Q2はabilityNameを持つが、単独のQ/Rトークンに一致しないためabilityKeyは未判定(小見出しグループ)", () => {
    const leeSin = findByName(targets, "リー・シン")!;
    const q1 = leeSin.groups.find((g) => g.abilityName === "Q1 - 響掌")!;
    const q2 = leeSin.groups.find((g) => g.abilityName === "Q2 - 共鳴撃")!;
    expect(q1).toBeDefined();
    expect(q1.abilityKey).toBeUndefined();
    expect(q2).toBeDefined();
    expect(q2.abilityKey).toBeUndefined();
    const base = leeSin.groups.find((g) => g.abilityKey === "base")!;
    expect(base.changes[0]).toEqual({ stat: "レベルアップごとの攻撃力", before: "3.7", after: "3.4" });
  });

  it("アリーナのh4=アイテム/オーグメントも小見出しグループとして表示され、スキルキーを持たない", () => {
    const arena = findByName(targets, "チャンピオン")!; // h3無し・先頭h4(チャンピオン)が対象名に消費される
    expect(arena.kind).toBe("arena");
    const itemGroup = arena.groups.find((g) => g.abilityName === "アイテム")!;
    const augmentGroup = arena.groups.find((g) => g.abilityName === "オーグメント")!;
    expect(itemGroup).toBeDefined();
    expect(itemGroup.abilityKey).toBeUndefined();
    expect(augmentGroup).toBeDefined();
    expect(augmentGroup.abilityKey).toBeUndefined();
  });

  it("アリーナのNEWバッジ付き記述式変更は装飾バッジを飛ばして正しいラベルを取る(オーグメント)", () => {
    const arena = findByName(targets, "チャンピオン")!;
    const augmentGroup = arena.groups.find((g) => g.abilityName === "オーグメント")!;
    const hexbolt = augmentGroup.changes.find((c) => c.stat === "「ヘクスボルト」のインタラクション")!;
    expect(hexbolt).toBeDefined();
    expect(hexbolt.text).toContain("クールダウンが2秒短縮されるようになりました");
    expect(hexbolt.text).not.toContain("NEW");
  });
});

describe("parsePatchNotesHtml（S6: ルーン節はアイコンURLがitem/champion/runeパターンに一致しなくてもセクション名からkind=runeに解決される）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it("死神の残り火はh3を持ち、kind=rune・数値変更(ダメージ)が正しく抽出される", () => {
    const deathfire = findByName(targets, "死神の残り火")!;
    expect(deathfire.kind).toBe("rune");
    expect(deathfire.section).toBe("ルーン");
    const change = deathfire.groups[0].changes[0];
    expect(change.stat).toBe("ダメージ");
    expect(change.before).toBe("自身の攻撃力と魔力のうち、高い方に応じて変動");
    expect(change.after).toBe("魔法ダメージ");
  });
});

describe("parsePatchNotesHtml（S6 テスト7: 誤帰属ゼロ・欠落ゼロの総合確認）", () => {
  const targets = parsePatchNotesHtml(fixtureHtml);

  it("装飾のみ(見出しやアイコンだけ)のブロックは対象として出ない(空カードにならない)", () => {
    for (const t of targets) {
      const totalChanges = t.groups.reduce((n, g) => n + g.changes.length, 0);
      expect(totalChanges).toBeGreaterThan(0);
    }
  });

  it("全対象が一意の名前を持つか、少なくとも異なるsection/kindに属する(意図しない重複統合が無い)", () => {
    const names = targets.map((t) => t.name);
    // アジール/コーキ/ガレン/ジェイス/ロック/モルデカイザー/ナミ/セナ/セラフィーン/ユナラ/リー・シン(11)
    // + アイテム3 + ルーン1 + システム1 + アリーナ1(先頭h4名"チャンピオン") + バグ修正1 = 18対象
    expect(names.length).toBe(18);
  });
});
