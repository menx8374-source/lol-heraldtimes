/**
 * pbe-curation.ts（PBE-S5 F-PBE5-3、人手キュレーション枠・ファイルベース・任意）の単体テスト。
 * ファイルI/Oは一時ディレクトリ配下の専用パスを使い、本番の`data/`配下には一切書き込まない。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPbeCurationNotes } from "@/lib/generation/pbe-curation";

describe("readPbeCurationNotes", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("ファイルが存在しなければ空配列（何もしない）", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-curation-test-"));
    const missingPath = path.join(dir, "does-not-exist.json");
    expect(readPbeCurationNotes("16.16", missingPath)).toEqual([]);
  });

  it("壊れたJSONでも例外を投げず空配列を返す", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-curation-test-"));
    const filePath = path.join(dir, "broken.json");
    writeFileSync(filePath, "{not valid json", "utf-8");
    expect(readPbeCurationNotes("16.16", filePath)).toEqual([]);
  });

  it("存在すれば逐語のnotesを差し込む（champion/skill/text/sourceを転記、捏造しない）", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-curation-test-"));
    const filePath = path.join(dir, "pbe-curation.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        patch: "16.16",
        notes: [
          {
            champion: "アジール",
            skill: "Q",
            text: "ダメージ 60/85/110/135/160 -> 60/90/120/150/180（インフォグラフィックより書き起こし）",
            source: "https://x.com/Spideraxe30/status/1820000000000000001",
          },
        ],
      }),
      "utf-8",
    );

    const notes = readPbeCurationNotes("16.16", filePath);
    expect(notes).toEqual([
      {
        champion: "アジール",
        skill: "Q",
        text: "ダメージ 60/85/110/135/160 -> 60/90/120/150/180（インフォグラフィックより書き起こし）",
        source: "https://x.com/Spideraxe30/status/1820000000000000001",
      },
    ]);
  });

  it("patchフィールドが現在のpbeVersionと異なる場合は空配列（別パッチへの誤混入防止）", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-curation-test-"));
    const filePath = path.join(dir, "pbe-curation.json");
    writeFileSync(
      filePath,
      JSON.stringify({ patch: "16.15", notes: [{ text: "古い情報", source: "https://x.com/a/status/1" }] }),
      "utf-8",
    );
    expect(readPbeCurationNotes("16.16", filePath)).toEqual([]);
  });

  it("patch未設定のファイルは常に全ノートを適用する", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-curation-test-"));
    const filePath = path.join(dir, "pbe-curation.json");
    writeFileSync(
      filePath,
      JSON.stringify({ notes: [{ text: "パッチ非依存の情報", source: "https://x.com/a/status/1" }] }),
      "utf-8",
    );
    expect(readPbeCurationNotes("16.16", filePath)).toHaveLength(1);
    expect(readPbeCurationNotes("99.99", filePath)).toHaveLength(1);
  });

  it("text/sourceが欠落・空文字の要素は無視する（不正な要素だけ除外、他は生かす）", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-curation-test-"));
    const filePath = path.join(dir, "pbe-curation.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        notes: [
          { text: "", source: "https://x.com/a/status/1" },
          { text: "sourceが無い", source: "" },
          { text: "有効なノート", source: "https://x.com/a/status/2" },
          "not-an-object",
        ],
      }),
      "utf-8",
    );
    const notes = readPbeCurationNotes(undefined, filePath);
    expect(notes).toEqual([{ text: "有効なノート", source: "https://x.com/a/status/2" }]);
  });

  it("notesが配列でない不正な形式は空配列", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-curation-test-"));
    const filePath = path.join(dir, "pbe-curation.json");
    writeFileSync(filePath, JSON.stringify({ notes: "not-an-array" }), "utf-8");
    expect(readPbeCurationNotes(undefined, filePath)).toEqual([]);
  });
});
