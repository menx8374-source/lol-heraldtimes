/**
 * CDragon PBE のチャンピオン基本ステータス/cost/cooldown/ammo diff（純関数・DB非依存、PBE-S2 F-PBE2-2）。
 *
 * `latest`（現行live）と`pbe`（本番の1つ先）の `CDragonChampion`（cdragon-pbe.ts、id一致）を比較し、
 * 変更のあったチャンピオンだけを `PbeChampionChange` として返す。比較対象は `docs/pbe-research.md` §3.4の
 * 結論に従い**ラベル明瞭なフィールドのみ**（基本ステータス`stats`・スキルの`costCoefficients`/
 * `cooldownCoefficients`/`ammo`）。
 * **スキル効果量（effectAmounts/coefficients）はこのモジュールが扱う対象に一切含まれていない**
 * （型自体に存在せず、cdragon-pbe.tsの`pickAbility`が取得段階で除外済み）。
 *
 * 全てのbefore/afterは元データの数値をそのまま文字列化したもの（配列はランク順に"/"区切り。
 * 数値・文言の捏造はしない）。変化が無いチャンピオンは結果に含めない（0件なら空配列）。AI不使用。
 */
import { classifyPatchChange } from "@/lib/generation/compose";
import type {
  CDragonChampion,
  CDragonChampionAbility,
  CDragonChampionBaseStats,
  JaChampionName,
} from "@/lib/collection/adapters/cdragon-pbe";
import { buildCDragonChampionIconUrl } from "@/lib/collection/adapters/cdragon-pbe";
import type { ArticleBodyPatchChangeBlock, ArticleBodyPatchChangeGroup } from "@/lib/article-body";

/** チャンピオン単位の変更点（対象ID=`id`は英語alias、誤帰属ゼロのためのキー）。 */
export type PbeChampionChange = {
  key: number;
  id: string;
  name: string;
  iconUrl?: string;
  groups: {
    abilityKey?: "passive" | "Q" | "W" | "E" | "R" | "base";
    abilityName?: string;
    changes: { stat: string; before: string; after: string }[];
  }[];
};

/** 基本ステータス(stats)の比較対象（ラベル明瞭のみ）＋日本語ラベル。増加=強化（`classifyPatchChange`既定）。 */
const BASE_STAT_LABELS: { key: keyof CDragonChampionBaseStats; label: string }[] = [
  { key: "baseHP", label: "HP" },
  { key: "hpPerLevel", label: "HP成長" },
  { key: "baseDamage", label: "攻撃力" },
  { key: "damagePerLevel", label: "攻撃力成長" },
  { key: "baseArmor", label: "物理防御" },
  { key: "armorPerLevel", label: "物理防御成長" },
  { key: "baseMR", label: "魔法防御" },
  { key: "baseMoveSpeed", label: "移動速度" },
  { key: "attackRange", label: "攻撃射程" },
  { key: "attackSpeed", label: "攻撃速度" },
  { key: "attackSpeedPerLevel", label: "攻撃速度成長" },
];

const ABILITY_ORDER: ("Q" | "W" | "E" | "R")[] = ["Q", "W", "E", "R"];

/** ランク別数値配列を"/"区切りの逐語文字列にする（例 [60,65,70] → "60/65/70"）。捏造しない。 */
function formatRankArray(values: number[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  return values.join("/");
}

/** 基本ステータス差分（変更のあったフィールドのみ）。 */
function diffBaseStats(
  pbeStats: CDragonChampionBaseStats | undefined,
  latestStats: CDragonChampionBaseStats | undefined,
): { stat: string; before: string; after: string }[] {
  if (!pbeStats || !latestStats) return [];
  const changes: { stat: string; before: string; after: string }[] = [];
  for (const { key, label } of BASE_STAT_LABELS) {
    const beforeVal = latestStats[key];
    const afterVal = pbeStats[key];
    if (typeof beforeVal !== "number" || typeof afterVal !== "number") continue;
    if (beforeVal === afterVal) continue;
    changes.push({ stat: label, before: String(beforeVal), after: String(afterVal) });
  }
  return changes;
}

/** 1スキル/パッシブ分のcost/cooldown/ammo差分（変更のあったフィールドのみ）。 */
function diffAbility(
  pbeAbility: CDragonChampionAbility | undefined,
  latestAbility: CDragonChampionAbility | undefined,
): { stat: string; before: string; after: string }[] {
  if (!pbeAbility || !latestAbility) return [];
  const changes: { stat: string; before: string; after: string }[] = [];

  const beforeCost = formatRankArray(latestAbility.costCoefficients);
  const afterCost = formatRankArray(pbeAbility.costCoefficients);
  if (beforeCost !== undefined && afterCost !== undefined && beforeCost !== afterCost) {
    changes.push({ stat: "コスト", before: beforeCost, after: afterCost });
  }

  const beforeCooldown = formatRankArray(latestAbility.cooldownCoefficients);
  const afterCooldown = formatRankArray(pbeAbility.cooldownCoefficients);
  if (beforeCooldown !== undefined && afterCooldown !== undefined && beforeCooldown !== afterCooldown) {
    changes.push({ stat: "クールダウン", before: beforeCooldown, after: afterCooldown });
  }

  const beforeMaxAmmo = formatRankArray(latestAbility.ammo?.maxAmmo);
  const afterMaxAmmo = formatRankArray(pbeAbility.ammo?.maxAmmo);
  if (beforeMaxAmmo !== undefined && afterMaxAmmo !== undefined && beforeMaxAmmo !== afterMaxAmmo) {
    changes.push({ stat: "弾数", before: beforeMaxAmmo, after: afterMaxAmmo });
  }

  const beforeRecharge = formatRankArray(latestAbility.ammo?.ammoRechargeTime);
  const afterRecharge = formatRankArray(pbeAbility.ammo?.ammoRechargeTime);
  if (beforeRecharge !== undefined && afterRecharge !== undefined && beforeRecharge !== afterRecharge) {
    changes.push({ stat: "弾薬回復時間", before: beforeRecharge, after: afterRecharge });
  }

  return changes;
}

/**
 * `pbeChamps`（本番の1つ先）と`latestChamps`（現行live）をid一致で比較し、変更チャンピオンだけを返す。
 * `before`はlatestChamps（現行）側、`after`はpbeChamps（次パッチ候補）側の値。
 * `jaNames`（`buildJaChampionNameMap(ja_jpで取得したチャンピオン配列)`）があれば日本語のチャンピオン名/
 * スキル名、無ければ英名にフォールバックする。
 * 対応するlatestChamps側の要素が無い（PBEのみに存在する新規チャンピオン）場合は、比較対象の本番側
 * データが無く安全な逐語diffが作れないため対象外にする（捏造しない、`diffItems`と同じ思想）。
 */
export function diffChampions(
  pbeChamps: CDragonChampion[],
  latestChamps: CDragonChampion[],
  jaNames?: Record<number, JaChampionName>,
): PbeChampionChange[] {
  const latestById = new Map(latestChamps.map((c) => [c.id, c] as const));
  const result: PbeChampionChange[] = [];

  for (const pbeChamp of pbeChamps) {
    const latestChamp = latestById.get(pbeChamp.id);
    if (!latestChamp) continue;

    const ja = jaNames?.[pbeChamp.id];
    const groups: PbeChampionChange["groups"] = [];

    const baseChanges = diffBaseStats(pbeChamp.stats, latestChamp.stats);
    if (baseChanges.length > 0) {
      groups.push({ abilityKey: "base", changes: baseChanges });
    }

    const passiveChanges = diffAbility(pbeChamp.passive, latestChamp.passive);
    if (passiveChanges.length > 0) {
      groups.push({
        abilityKey: "passive",
        abilityName: ja?.abilityNames.passive ?? pbeChamp.passive?.name ?? latestChamp.passive?.name,
        changes: passiveChanges,
      });
    }

    ABILITY_ORDER.forEach((key, index) => {
      const pbeSpell = pbeChamp.spells?.[index];
      const latestSpell = latestChamp.spells?.[index];
      const changes = diffAbility(pbeSpell, latestSpell);
      if (changes.length === 0) return;
      groups.push({
        abilityKey: key,
        abilityName: ja?.abilityNames[key] ?? pbeSpell?.name ?? latestSpell?.name,
        changes,
      });
    });

    if (groups.length === 0) continue;

    result.push({
      key: pbeChamp.id,
      id: latestChamp.alias || pbeChamp.alias || String(pbeChamp.id),
      name: ja?.name ?? pbeChamp.name,
      iconUrl: buildCDragonChampionIconUrl(pbeChamp.squarePortraitPath),
      groups,
    });
  }

  return result;
}

/**
 * `PbeChampionChange`を既存`ArticleBodyPatchChangeBlock`（kind:"champion"）へ変換する純関数
 * （PBE-S2 F-PBE2-3、`pbe-item-diff.ts`のitem変換と対）。実際の記事化・PBE記事枠への組み込みは
 * P4以降。本関数はcompose/pipeline/表示のいずれからも呼び出されておらず、既存挙動には一切影響しない。
 *
 * `direction`判定: `cost`/`クールダウン`は減少=強化で反転、基本ステータス（攻撃力/hp等）は増加=強化
 * （既存`classifyPatchChange`（compose.ts）をそのまま流用。`LOWER_IS_BETTER_TERMS`に"コスト"/
 * "クールダウン"が含まれるため反転が効く）。全変更を分類し、全てbuffならbuff、全てnerfならnerf、
 * 混在・判定不能・変更0件はadjust（曖昧はadjust、既存`classifyPatchTargetDirection`と同じ思想）。
 */
export function toArticleBodyPatchChangeBlock(change: PbeChampionChange): ArticleBodyPatchChangeBlock {
  const allChanges = change.groups.flatMap((g) => g.changes);
  const classifications = allChanges.map(classifyPatchChange);
  const hasBuff = classifications.includes("buff");
  const hasNerf = classifications.includes("nerf");
  const direction: ArticleBodyPatchChangeBlock["direction"] =
    hasBuff && hasNerf ? "adjust" : hasBuff ? "buff" : hasNerf ? "nerf" : "adjust";

  const groups: ArticleBodyPatchChangeGroup[] = change.groups.map((g) => ({
    ...(g.abilityKey ? { abilityKey: g.abilityKey } : {}),
    ...(g.abilityName ? { abilityName: g.abilityName } : {}),
    changes: g.changes.map((c) => ({ stat: c.stat, before: c.before, after: c.after })),
  }));

  return {
    type: "patchChange",
    targetName: change.name,
    ...(change.iconUrl ? { targetIconUrl: change.iconUrl } : {}),
    targetKind: "champion",
    direction,
    groups,
  };
}
