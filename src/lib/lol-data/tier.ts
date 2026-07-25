/**
 * Tier表（拡張E6）。ロール別(TOP/JG/MID/ADC/SUP)にチャンピオンをS/A/B/Cへ分類する。
 *
 * ⚠ Tierランクはチャンピオンデータ（`champions.ts`）の `tier` フィールドを唯一の source of truth
 * とし、当サイトが独自に作成した見解（オリジナル創作）。実在のTier表サイトのランクを転記したもの
 * ではない。表示ページ側で「当サイト独自の見解」である旨を明記すること。
 */
import { ROLES, TIERS, type Role, type Tier } from "./types";
import { CHAMPIONS, type ChampionEntry } from "./champions";

export type TierRow = { tier: Tier; champions: ChampionEntry[] };
export type TierTable = { role: Role; rows: TierRow[] };

/** 指定ロールのTier表（S→A→B→Cの4行）を作る。各行のチャンピオンは名前の五十音順。 */
export function buildTierTable(role: Role): TierRow[] {
  return TIERS.map((tier) => ({
    tier,
    champions: CHAMPIONS.filter((c) => c.role === role && c.tier === tier).sort((a, b) =>
      a.name.localeCompare(b.name, "ja"),
    ),
  }));
}

/** 全ロールぶんのTier表をまとめて作る（/tier ページ用）。 */
export function buildAllTierTables(): TierTable[] {
  return ROLES.map((role) => ({ role, rows: buildTierTable(role) }));
}
