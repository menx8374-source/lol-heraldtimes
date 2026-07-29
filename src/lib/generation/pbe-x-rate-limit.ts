/**
 * PBE-S5 F-PBE5-1: X取得のレート制限（コスト安全設計）。
 *
 * 「DBスキーマ変更なし」の制約のもと、前回X取得時刻をプロジェクトローカルのJSONファイル
 * （既定 `data/pbe-x-last-fetch.json`、gitignore対象・VPSローカルの実行時状態）に保存する
 * 簡易実装（brief F-PBE5-1「最終取得時刻は既存の状態保存 or Post/媒体で管理。無ければ簡易に
 * 最小実装」）。ファイルI/O失敗（未作成・権限・破損JSON等）は例外を投げず「前回取得なし」
 * として扱い（安全側=初回はレート制限にかからない）、本体を止めない。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** レート制限の既定間隔(時間)。env `PBE_X_MIN_INTERVAL_HOURS` で上書き可能。 */
const DEFAULT_MIN_INTERVAL_HOURS = 6;

/** 前回X取得時刻を保存するファイルの既定パス（`data/`配下、gitignore対象）。 */
export function getPbeXStateFilePath(): string {
  return path.join(process.cwd(), "data", "pbe-x-last-fetch.json");
}

/** env `PBE_X_MIN_INTERVAL_HOURS` をパースする。未設定・0以下・不正値は既定6時間。 */
export function getPbeXMinIntervalHours(): number {
  const raw = Number(process.env.PBE_X_MIN_INTERVAL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_INTERVAL_HOURS;
}

type PbeXStateFileShape = { lastFetchAt?: string };

/**
 * 前回X取得時刻を読み込む（信頼境界=ファイルI/O）。ファイル無し・壊れたJSON・不正な日付は
 * いずれも null（＝初回扱い・レート制限しない安全側）。
 */
export function readLastPbeXFetchAt(filePath: string = getPbeXStateFilePath()): Date | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as PbeXStateFileShape;
    if (typeof parsed.lastFetchAt !== "string") return null;
    const date = new Date(parsed.lastFetchAt);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * 前回X取得時刻を保存する（信頼境界=ファイルI/O）。書き込み失敗（権限・ディスク等）は
 * ログのみで例外を投げない（本体=記事生成を止めない。次回実行時に再度レート制限なしで
 * 取得を試みるだけで済む安全側の失敗モード）。
 */
export function writeLastPbeXFetchAt(at: Date, filePath: string = getPbeXStateFilePath()): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: PbeXStateFileShape = { lastFetchAt: at.toISOString() };
    writeFileSync(filePath, JSON.stringify(payload), "utf-8");
  } catch (err) {
    console.error("[pbe-x-rate-limit] 前回取得時刻の保存に失敗しました（次回実行時も取得を試みます）:", err);
  }
}

/**
 * 前回取得時刻から `minIntervalHours`（既定はenv由来）以内なら true（レート制限中）を返す純関数。
 * `lastFetchAt` が null（初回・状態未取得）の場合は false（レート制限しない）。
 */
export function isPbeXRateLimited(
  now: Date,
  lastFetchAt: Date | null,
  minIntervalHours: number = getPbeXMinIntervalHours(),
): boolean {
  if (!lastFetchAt) return false;
  const elapsedMs = now.getTime() - lastFetchAt.getTime();
  return elapsedMs < minIntervalHours * 60 * 60 * 1000;
}
