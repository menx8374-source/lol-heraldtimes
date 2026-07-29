/**
 * CommunityDragon PBE クライアント（PBE-S1 F-PBE1-1）。
 *
 * `raw.communitydragon.org/pbe/` は本番の1つ先のパッチを実データで先行配信しており（実測:
 * pbe=16.16 / latest=16.15、`docs/pbe-research.md` §3.1）、本番反映前のアイテム数値を機械取得できる
 * 唯一のソース（DDragonはliveのみ）。キー不要・AI不使用（JSON取得のみ）。
 *
 * 信頼境界（外部API）: 既存 `fetchJsonSafe`（タイムアウト付き・例外を投げず失敗を握り潰す）を再利用する。
 * バージョン取得失敗は null、items取得失敗・非2xxは空配列を返し、いずれも本体を止めない。
 */
import { fetchJsonSafe } from "@/lib/collection/adapters/http";

const CDRAGON_BASE = "https://raw.communitydragon.org";

/** `content-metadata.json` のレスポンス形（実測: `{ "version": "16.16.8000032+branch.main.content.beta" }`）。 */
type CDragonContentMetadata = { version?: string };

/** pbe/latest のバージョン文字列（例 "16.16.8000032+branch.main.content.beta"）。取得失敗はそれぞれ null。 */
export type CDragonVersions = { pbe: string | null; latest: string | null };

async function fetchVersion(channel: "pbe" | "latest"): Promise<string | null> {
  const url = `${CDRAGON_BASE}/${channel}/content-metadata.json`;
  const data = await fetchJsonSafe<CDragonContentMetadata>(url, {}, { logLabel: "cdragon-pbe", context: url });
  if (!data || typeof data.version !== "string" || data.version.length === 0) return null;
  return data.version;
}

/**
 * pbe/latest 両チャンネルの `content-metadata.json` からバージョン文字列を取得する。
 * 差が無ければPBE=live（diff無し）。取得失敗はそれぞれ null（本体を止めない）。
 */
export async function fetchCDragonVersions(): Promise<CDragonVersions> {
  const [pbe, latest] = await Promise.all([fetchVersion("pbe"), fetchVersion("latest")]);
  return { pbe, latest };
}

/** `default`（英語）または `ja_jp`（日本語）ロケール。 */
export type CDragonLocale = "default" | "ja_jp";

/**
 * `items.json` の1件（実測フィールドのみを型定義。ラベル明瞭な `priceTotal`/`description`/`from`/`to`/
 * `inStore` のみを扱い、スキル効果量に相当するフィールドはこのモジュールでは一切扱わない）。
 */
export type CDragonItem = {
  id: number;
  name: string;
  description: string;
  priceTotal: number;
  from: number[];
  to: number[];
  inStore: boolean;
  iconPath?: string;
};

/** `items.json` の要素として最低限必要なフィールドを備えているかを検証する（不正な要素は除外し捏造しない）。 */
function isCDragonItem(value: unknown): value is CDragonItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "number" &&
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.priceTotal === "number" &&
    Array.isArray(v.from) &&
    Array.isArray(v.to) &&
    typeof v.inStore === "boolean"
  );
}

async function fetchItemsFor(channel: "pbe" | "latest", locale: CDragonLocale): Promise<CDragonItem[]> {
  const url = `${CDRAGON_BASE}/${channel}/plugins/rcp-be-lol-game-data/global/${locale}/v1/items.json`;
  const data = await fetchJsonSafe<unknown>(url, {}, { logLabel: "cdragon-pbe", context: url });
  if (!Array.isArray(data)) return [];
  return data.filter(isCDragonItem);
}

/** PBEチャンネルの `items.json` を取得する。取得失敗・非2xx・不正JSONは空配列（本体を止めない）。 */
export function fetchPbeItems(locale: CDragonLocale = "default"): Promise<CDragonItem[]> {
  return fetchItemsFor("pbe", locale);
}

/** latest（現行live）チャンネルの `items.json` を取得する。取得失敗・非2xx・不正JSONは空配列。 */
export function fetchLatestItems(locale: CDragonLocale = "default"): Promise<CDragonItem[]> {
  return fetchItemsFor("latest", locale);
}

/**
 * アイテムID→名前のマップを組み立てる（`ja_jp`で取得した`items.json`をそのまま渡す想定）。
 * `diffItems` の `jaNames` 引数に使う（日本語名フォールバック用、リサーチ§3.2の実測に基づく）。
 */
export function buildJaNameMap(jaItems: CDragonItem[]): Record<number, string> {
  const map: Record<number, string> = {};
  for (const item of jaItems) map[item.id] = item.name;
  return map;
}

/**
 * CDragonのアイコン相対パス（例 "/lol-game-data/assets/ASSETS/Items/Icons2D/1001_....png"）から
 * 配信URLを組み立てる（リサーチ§3.3: `raw.communitydragon.org/pbe/game/<path小文字>`）。
 * `iconPath` が無ければ undefined（表示を諦めるだけで本体は止めない）。
 */
export function buildCDragonItemIconUrl(iconPath: string | undefined): string | undefined {
  if (!iconPath) return undefined;
  return `${CDRAGON_BASE}/pbe/game${iconPath.toLowerCase()}`;
}

/**
 * チャンピオン取得（PBE-S2 F-PBE2-1）。
 *
 * `champion-summary.json`（全チャンピオンのid/name/alias一覧）で候補を絞り、`champions/<key>.json`
 * （chamionの基本識別情報・passive/spellsのcost/cooldown/ammoのみ）を個別取得する。
 * **基本ステータス（HP/攻撃力/物理防御等）はこのエンドポイントに実在しない**ため（実測確認済み）、
 * `game/data/characters/<alias>/<alias>.bin.json`（`CharacterRecords/Root`、キー名自体が
 * `baseHPModifiable`/`baseArmorModifiable`等ラベル明瞭）から補う。`alias`（英名）はchampion-summary/
 * champions/<key>.json双方に含まれ、対象IDの誤帰属を避けるためのキーとして使う。
 * **effectAmounts/coefficients（スキル効果量）はいずれのfetch関数・型にも一切含めない**
 * （§3.4の誤情報リスク回避、pickAbilityで明示的にホワイトリストしたフィールドのみ拾う）。
 */

/** `champion-summary.json` の1件（id/name/aliasのみ扱う。roles等は使わない）。 */
export type CDragonChampionSummaryEntry = { id: number; name: string; alias: string; squarePortraitPath?: string };

function isCDragonChampionSummaryEntry(value: unknown): value is CDragonChampionSummaryEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "number" && typeof v.name === "string" && typeof v.alias === "string";
}

async function fetchChampionSummaryFor(channel: "pbe" | "latest"): Promise<CDragonChampionSummaryEntry[]> {
  const url = `${CDRAGON_BASE}/${channel}/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json`;
  const data = await fetchJsonSafe<unknown>(url, {}, { logLabel: "cdragon-pbe", context: url });
  if (!Array.isArray(data)) return [];
  return data.filter(isCDragonChampionSummaryEntry).filter((c) => c.id > 0); // id=-1("None")等の無効エントリは除外
}

/** PBEチャンネルの `champion-summary.json` を取得する。取得失敗・非2xx・不正JSONは空配列。 */
export function fetchPbeChampionSummary(): Promise<CDragonChampionSummaryEntry[]> {
  return fetchChampionSummaryFor("pbe");
}

/** latest（現行live）チャンネルの `champion-summary.json` を取得する。取得失敗は空配列。 */
export function fetchLatestChampionSummary(): Promise<CDragonChampionSummaryEntry[]> {
  return fetchChampionSummaryFor("latest");
}

/**
 * pbe/latest 両方のchampion-summaryに存在するidだけを候補にする（新規/削除チャンピオンは対応する
 * 比較先データが無く安全な逐語diffが作れないため除外＝`diffItems`と同じ思想）。id昇順ソート済み。
 * 全チャンピオン個別fetchの候補を絞る効率配慮（F-PBE2-1）。
 */
export function resolveCandidateChampionKeys(
  pbeSummary: CDragonChampionSummaryEntry[],
  latestSummary: CDragonChampionSummaryEntry[],
): number[] {
  const latestIds = new Set(latestSummary.map((c) => c.id));
  return pbeSummary
    .map((c) => c.id)
    .filter((id) => latestIds.has(id))
    .sort((a, b) => a - b);
}

/**
 * 1スキル/パッシブ分（`cost`/`cooldown`/`ammo`はラベル明瞭な `costCoefficients`/`cooldownCoefficients`/
 * `ammo`のみ。実測: `cost`/`cooldown`生フィールドは`"@Cost@ @AbilityResourceName@"`のような未解決の
 * 表示テンプレート文字列で数値diffに使えないため採用しない）。
 */
export type CDragonChampionAbility = {
  name?: string;
  abilityIconPath?: string;
  /** ランク別コスト配列（実測ラベル: `costCoefficients`）。 */
  costCoefficients?: number[];
  /** ランク別クールダウン配列（実測ラベル: `cooldownCoefficients`）。 */
  cooldownCoefficients?: number[];
  /** 弾数系（実測: `ammo.maxAmmo`/`ammo.ammoRechargeTime`、いずれもランク別配列）。 */
  ammo?: { ammoRechargeTime?: number[]; maxAmmo?: number[] };
};

/** チャンピオン基本ステータス（`CharacterRecords/Root`のラベル明瞭なフィールドのみ抽出、実測確認済み）。 */
export type CDragonChampionBaseStats = {
  baseHP?: number;
  hpPerLevel?: number;
  baseDamage?: number;
  damagePerLevel?: number;
  baseArmor?: number;
  armorPerLevel?: number;
  baseMR?: number;
  baseMoveSpeed?: number;
  attackRange?: number;
  attackSpeed?: number;
  attackSpeedPerLevel?: number;
};

/** チャンピオン1件分（`champions/<key>.json` + 基本ステータス補完後の合成データ）。 */
export type CDragonChampion = {
  id: number;
  name: string;
  alias: string;
  squarePortraitPath?: string;
  passive?: CDragonChampionAbility;
  /** 並び順: Q, W, E, R（`champions/<key>.json`の`spells`配列の実測順）。 */
  spells?: CDragonChampionAbility[];
  stats?: CDragonChampionBaseStats;
};

/**
 * 生JSONの1スキル/パッシブから、ラベル明瞭なフィールドだけを明示的にホワイトリストして拾う
 * （`effectAmounts`/`coefficients`等は一切参照しない。捏造禁止・誤情報回避の核心部分）。
 */
function pickAbility(raw: unknown): CDragonChampionAbility | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  let ammo: CDragonChampionAbility["ammo"];
  if (r.ammo && typeof r.ammo === "object") {
    const a = r.ammo as Record<string, unknown>;
    ammo = {
      ammoRechargeTime: Array.isArray(a.ammoRechargeTime) ? (a.ammoRechargeTime as number[]) : undefined,
      maxAmmo: Array.isArray(a.maxAmmo) ? (a.maxAmmo as number[]) : undefined,
    };
  }
  return {
    name: typeof r.name === "string" ? r.name : undefined,
    abilityIconPath: typeof r.abilityIconPath === "string" ? r.abilityIconPath : undefined,
    costCoefficients: Array.isArray(r.costCoefficients) ? (r.costCoefficients as number[]) : undefined,
    cooldownCoefficients: Array.isArray(r.cooldownCoefficients) ? (r.cooldownCoefficients as number[]) : undefined,
    ammo,
  };
}

function isCDragonChampionJson(
  value: unknown,
): value is { id: number; name: string; alias: string; passive?: unknown; spells?: unknown } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "number" && typeof v.name === "string" && typeof v.alias === "string";
}

/** `ModifiableFloat`形の `{ baseValue: number, ... }` から `baseValue` だけを取り出す。無ければ undefined。 */
function extractBaseValue(node: unknown): number | undefined {
  if (!node || typeof node !== "object") return undefined;
  const v = (node as Record<string, unknown>).baseValue;
  return typeof v === "number" ? v : undefined;
}

/**
 * `CharacterRecords/Root`から基本ステータスを抽出する。フィールド名自体が`baseHPModifiable`
 * `baseArmorModifiable`等ラベル明瞭で、実測で複数チャンピオン(Azir/Ahri/Jinx/Yasuo)にて命名の一貫性を
 * 確認済み。ハッシュ化された未知キー（`{01262a25}`等）は一切参照しない。
 */
function extractBaseStatsFromRoot(root: Record<string, unknown>): CDragonChampionBaseStats {
  return {
    baseHP: extractBaseValue(root.baseHPModifiable),
    hpPerLevel: extractBaseValue(root.hpPerLevelModifiable),
    baseDamage: extractBaseValue(root.baseDamageModifiable),
    damagePerLevel: extractBaseValue(root.damagePerLevelModifiable),
    baseArmor: extractBaseValue(root.baseArmorModifiable),
    armorPerLevel: extractBaseValue(root.armorPerLevelModifiable),
    baseMR: extractBaseValue(root.baseMR),
    baseMoveSpeed: extractBaseValue(root.baseMoveSpeedModifiable),
    attackRange: extractBaseValue(root.attackRangeModifiable),
    attackSpeed: extractBaseValue(root.attackSpeedModifiable),
    attackSpeedPerLevel: extractBaseValue(root.attackSpeedPerLevelModifiable),
  };
}

/**
 * `game/data/characters/<alias>/<alias>.bin.json`（ゲームデータの生bin→JSON変換、実測で200確認）から
 * `CharacterRecords/Root`を探し基本ステータスを抽出する。取得失敗・該当キー無しは undefined
 * （本体を止めない。呼び出し側はstats無しのチャンピオンとして扱う）。
 */
async function fetchChampionBaseStats(
  channel: "pbe" | "latest",
  alias: string,
): Promise<CDragonChampionBaseStats | undefined> {
  const aliasLower = alias.toLowerCase();
  const url = `${CDRAGON_BASE}/${channel}/game/data/characters/${aliasLower}/${aliasLower}.bin.json`;
  const data = await fetchJsonSafe<Record<string, unknown>>(url, {}, { logLabel: "cdragon-pbe", context: url });
  if (!data || typeof data !== "object") return undefined;
  const rootKey = Object.keys(data).find((k) => k.endsWith("/CharacterRecords/Root"));
  if (!rootKey) return undefined;
  const root = data[rootKey];
  if (!root || typeof root !== "object") return undefined;
  return extractBaseStatsFromRoot(root as Record<string, unknown>);
}

/**
 * `channel`の`champions/<key>.json`を取得し、`locale==="default"`のときのみ基本ステータス
 * （bin.json由来）も補って合成する。不正・欠落は null（本体を止めない）。
 */
async function fetchChampionFor(
  channel: "pbe" | "latest",
  key: number,
  locale: CDragonLocale,
): Promise<CDragonChampion | null> {
  const url = `${CDRAGON_BASE}/${channel}/plugins/rcp-be-lol-game-data/global/${locale}/v1/champions/${key}.json`;
  const data = await fetchJsonSafe<unknown>(url, {}, { logLabel: "cdragon-pbe", context: url });
  if (!isCDragonChampionJson(data)) return null;

  const spellsRaw = Array.isArray(data.spells) ? data.spells : [];
  const champion: CDragonChampion = {
    id: data.id,
    name: data.name,
    alias: data.alias,
    passive: pickAbility(data.passive),
    spells: spellsRaw
      .map(pickAbility)
      .filter((a): a is CDragonChampionAbility => a !== undefined),
  };

  if (locale === "default") {
    champion.stats = await fetchChampionBaseStats(channel, data.alias);
  }

  return champion;
}

/** PBEチャンネルの1チャンピオンを取得する。取得失敗・不正形は null（本体を止めない）。 */
export function fetchPbeChampion(key: number, locale: CDragonLocale = "default"): Promise<CDragonChampion | null> {
  return fetchChampionFor("pbe", key, locale);
}

/** latest（現行live）チャンネルの1チャンピオンを取得する。取得失敗・不正形は null。 */
export function fetchLatestChampion(key: number, locale: CDragonLocale = "default"): Promise<CDragonChampion | null> {
  return fetchChampionFor("latest", key, locale);
}

/**
 * 一度に個別取得するチャンピオン数の上限（負荷配慮。全チャンピオン約170〜230体を毎回無条件fetchしない
 * ための安全弁、F-PBE2-1）。
 */
export const MAX_CHAMPIONS_PER_FETCH = 40;

/** 個別チャンピオンfetch間の小待機（ms）。CDragonへの短時間バーストを避けるレート制御（F-PBE2-1）。 */
export const CHAMPION_FETCH_INTERVAL_MS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 候補キー配列（`resolveCandidateChampionKeys`推奨）から順次・小待機付きで個別チャンピオンを取得する。
 * `MAX_CHAMPIONS_PER_FETCH`を超える分は切り捨てる。取得失敗（null）は結果から除外し本体を止めない。
 */
async function fetchChampionsSequential(
  channel: "pbe" | "latest",
  keys: number[],
  locale: CDragonLocale,
  intervalMs: number,
): Promise<CDragonChampion[]> {
  const limited = keys.slice(0, MAX_CHAMPIONS_PER_FETCH);
  const result: CDragonChampion[] = [];
  for (let i = 0; i < limited.length; i++) {
    const champ = await fetchChampionFor(channel, limited[i], locale);
    if (champ) result.push(champ);
    if (intervalMs > 0 && i < limited.length - 1) await sleep(intervalMs);
  }
  return result;
}

/** PBEチャンネルの複数チャンピオンを効率配慮つきで取得する（F-PBE2-1）。 */
export function fetchPbeChampions(
  keys: number[],
  locale: CDragonLocale = "default",
  intervalMs: number = CHAMPION_FETCH_INTERVAL_MS,
): Promise<CDragonChampion[]> {
  return fetchChampionsSequential("pbe", keys, locale, intervalMs);
}

/** latest（現行live）チャンネルの複数チャンピオンを効率配慮つきで取得する。 */
export function fetchLatestChampions(
  keys: number[],
  locale: CDragonLocale = "default",
  intervalMs: number = CHAMPION_FETCH_INTERVAL_MS,
): Promise<CDragonChampion[]> {
  return fetchChampionsSequential("latest", keys, locale, intervalMs);
}

/**
 * チャンピオンのアイコン相対パス（`squarePortraitPath`）から配信URLを組み立てる
 * （`buildCDragonItemIconUrl`と同じ規則を適用。既存関数はそのまま流用できるため薄いエイリアス）。
 */
export function buildCDragonChampionIconUrl(squarePortraitPath: string | undefined): string | undefined {
  return buildCDragonItemIconUrl(squarePortraitPath);
}

/** チャンピオンのja_jp名・スキル名（passive/Q/W/E/R）。 */
export type JaChampionName = {
  name: string;
  abilityNames: Partial<Record<"passive" | "Q" | "W" | "E" | "R", string>>;
};

const ABILITY_ORDER: ("Q" | "W" | "E" | "R")[] = ["Q", "W", "E", "R"];

/**
 * id→日本語名（チャンピオン名・パッシブ名・スキル名）のマップを組み立てる
 * （`fetchPbeChampions(keys, "ja_jp")`等で取得したチャンピオン配列をそのまま渡す想定、`buildJaNameMap`と対）。
 */
export function buildJaChampionNameMap(jaChampions: CDragonChampion[]): Record<number, JaChampionName> {
  const map: Record<number, JaChampionName> = {};
  for (const champ of jaChampions) {
    const abilityNames: JaChampionName["abilityNames"] = {};
    if (champ.passive?.name) abilityNames.passive = champ.passive.name;
    champ.spells?.forEach((spell, index) => {
      const key = ABILITY_ORDER[index];
      if (key && spell.name) abilityNames[key] = spell.name;
    });
    map[champ.id] = { name: champ.name, abilityNames };
  }
  return map;
}
