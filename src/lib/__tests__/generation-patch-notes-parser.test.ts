import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parsePatchNotesHtml, type PatchChangeTarget } from "@/lib/generation/patch-notes-parser";
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

  it('"固有スキル - ..." のようなパッシブ表記は"パッシブ"を含まないため未判定(undefined)のままになる(捏造しない)', () => {
    const jayce = findByName(targets, "ジェイス")!;
    const passiveGroup = jayce.groups.find((g) => g.abilityName?.includes("固有スキル"));
    expect(passiveGroup).toBeDefined();
    expect(passiveGroup?.abilityKey).toBeUndefined();
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

  it("対象アイコンURL(iconUrl)がブロック先頭のimg srcから取れる", () => {
    const azir = findByName(targets, "アジール")!;
    expect(azir.iconUrl).toMatch(/^https:\/\//);
    expect(azir.iconUrl).toContain("Azir.png");
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

  function changeLine(c: { stat: string; before: string; after: string }): string {
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
