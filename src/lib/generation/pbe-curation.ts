/**
 * PBE-S5 F-PBE5-3: 人手キュレーション枠（半自動・任意・ファイルベース）。
 *
 * 画像内の数値等、CDragon/X本文から自動で拾えない情報を、運営者が手で書き起こして転記するための
 * 任意ファイル（既定 `data/pbe-curation.json`、gitignore可・VPSで直接編集する想定）を読み込む。
 * ファイルが存在しない/壊れている場合は何もしない（空配列を返すだけで本体を止めない）。
 * **捏造しない**: このモジュール自身は数値・文言を一切生成せず、ファイルの内容を逐語で返すだけ
 * （管理UIも作らない・ファイル編集で足りる半自動の現実解）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export type PbeCurationNote = {
  champion?: string;
  skill?: string;
  /** 逐語の書き起こし文（人が公式/Spideraxe氏の投稿等を見て転記する前提。捏造しない）。 */
  text: string;
  /** 出典（URL・投稿者名等の文字列）。 */
  source: string;
};

type PbeCurationFileShape = { patch?: string; notes?: unknown };

/** キュレーションファイルの既定パス（`data/`配下、gitignore対象・任意ファイル）。 */
export function getPbeCurationFilePath(): string {
  return path.join(process.cwd(), "data", "pbe-curation.json");
}

/** raw の1件が最小要件（text/sourceが非空文字列）を満たす場合のみ整形して返す。不正な要素は無視する。 */
function normalizeCurationNote(raw: unknown): PbeCurationNote | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== "string" || r.text.trim().length === 0) return null;
  if (typeof r.source !== "string" || r.source.trim().length === 0) return null;
  return {
    text: r.text,
    source: r.source,
    ...(typeof r.champion === "string" && r.champion.trim().length > 0 ? { champion: r.champion } : {}),
    ...(typeof r.skill === "string" && r.skill.trim().length > 0 ? { skill: r.skill } : {}),
  };
}

/**
 * 人手キュレーションノートを読み込む（F-PBE5-3、信頼境界=ファイルI/O）。ファイルが無い・JSON不正・
 * 形式不正（notesが配列でない等）はいずれも空配列（何もしない・例外を投げない）。
 * `pbeVersion` を渡した場合、ファイルの `patch` フィールドが設定済みかつ現在のPBEバージョンと
 * 一致しないときは古いキュレーションとみなし空配列を返す（別パッチの記事への誤混入防止）。
 * `patch` 未設定のファイルは常に全ノートを適用する。
 */
export function readPbeCurationNotes(
  pbeVersion?: string,
  filePath: string = getPbeCurationFilePath(),
): PbeCurationNote[] {
  let parsed: PbeCurationFileShape;
  try {
    const raw = readFileSync(filePath, "utf-8");
    parsed = JSON.parse(raw) as PbeCurationFileShape;
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.notes)) return [];
  if (
    typeof parsed.patch === "string" &&
    parsed.patch.trim().length > 0 &&
    pbeVersion &&
    parsed.patch !== pbeVersion
  ) {
    return [];
  }

  const notes: PbeCurationNote[] = [];
  for (const item of parsed.notes) {
    const note = normalizeCurationNote(item);
    if (note) notes.push(note);
  }
  return notes;
}
