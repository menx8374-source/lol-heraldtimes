/**
 * 攻略・データ固定ページ（拡張E6）で共有する型と語彙。
 * チャンピオン一覧・Tier表で共通のロール区分（TOP/JG/MID/ADC/SUP）と、
 * Tier表のランク区分（S/A/B/C）をここに一元化する。
 */

/** ロール種別。5ロール制のLoLに準じるが、区分自体は一般名詞でありオリジナル性の対象外。 */
export const ROLES = ["TOP", "JG", "MID", "ADC", "SUP"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  TOP: "トップ",
  JG: "ジャングル",
  MID: "ミッド",
  ADC: "ボット(ADC)",
  SUP: "サポート",
};

/** Tier表のランク区分（強い順 S > A > B > C）。 */
export const TIERS = ["S", "A", "B", "C"] as const;
export type Tier = (typeof TIERS)[number];
