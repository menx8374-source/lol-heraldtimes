/**
 * CDragon PBE のアイテムdiff（純関数・DB非依存、PBE-S1 F-PBE1-2、PBE-S6 F-PBE6-1で品質改善）。
 *
 * `latest`（現行live）と`pbe`（本番の1つ先）の `items.json` をid一致で比較し、変更のあったアイテムだけを
 * `PbeItemChange` として返す。
 *
 * PBE-S6での見直し（実データ=PBE 16.16で判明した3つの品質問題への対応）:
 * 1. **実在の店売りアイテムのみに絞る**（`inStore && displayInItemSets` の両方が真のアイテムだけ、
 *    pbe/latest双方の値で判定）。実データ確認の結果、`inStore:true`だけでは削除済み/専用モード限定の
 *    アイテム（例 Deathfire Grasp・Eleisa's Miracle。実測でも`inStore:true`のまま残置）を除外できず、
 *    `displayInItemSets:false`の組み合わせで初めて実際のSR通常ショップの集合と一致することを
 *    `raw.communitydragon.org/.../items.json`のcurl確認で突き止めた（誤ったアイテム名混入の解消）。
 * 2. **英語の自由記述description prose（大文字小文字・言い回し）の差分は一切出さない**（ノイズ源解消）。
 * 3. **価格（数値・言語非依存）とステータス数値（英語→日本語の対訳glossaryで日本語化できるものだけ）**
 *    に絞り、対訳の無い語は捏造せず読み飛ばす（誤訳・誤情報回避）。price/statsいずれにも意味のある
 *    差分が無いアイテムは除外する（0件を出さない）。
 *
 * **スキル効果量（effectAmounts/coefficients）はこのモジュールが扱う対象に含まれておらず、
 * 一切参照しない**（誤情報リスク回避、アイテムには元々該当フィールドが存在しない）。
 * 全てのbefore/afterは元データの数値そのまま（捏造しない）。変化が無いアイテムは結果に含めない
 * （0件なら空配列）。AI不使用。
 */
import { decodeHtmlEntities } from "@/lib/collection/adapters/riot-datadragon";
import type { CDragonItem } from "@/lib/collection/adapters/cdragon-pbe";
import { buildCDragonItemIconUrl } from "@/lib/collection/adapters/cdragon-pbe";
import type { ArticleBodyPatchChangeBlock } from "@/lib/article-body";

/** 1アイテムの数値変更（`stat`は「価格」または既知ステータスの日本語ラベル、before/afterは逐語）。 */
export type PbeItemChange = {
  id: number;
  name: string;
  iconPath?: string;
  changes: { stat: string; before: string; after: string }[];
};

/** タグを除去しエンティティを復号したプレーンテキストを返す（内部の連続空白は1つに畳む）。 */
function stripTags(fragment: string): string {
  return decodeHtmlEntities(fragment.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 英語ステータス名 → 日本語ラベルの対訳glossary（PBE-S6 F-PBE6-1）。
 * `raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/default/v1/items.json` の
 * 実店売りアイテム（`inStore && displayInItemSets`）の`<stats>`ブロックに実際に現れる語彙をcurlで
 * 確認した上で収録（実測名と完全一致した場合のみ翻訳、大文字小文字も含め逐語一致を要求する＝
 * 曖昧な部分一致による誤訳を避ける）。ここに無い語は捏造せず出力自体を諦める。
 */
const STAT_NAME_JA: Record<string, string> = {
  "Ability Power": "魔力",
  "Attack Damage": "攻撃力",
  "Health": "体力",
  "Mana": "マナ",
  "Armor": "物理防御",
  "Magic Resist": "魔法防御",
  "Attack Speed": "攻撃速度",
  "Move Speed": "移動速度",
  "Critical Strike Chance": "クリティカル率",
  "Critical Strike Damage": "クリティカルダメージ",
  "Life Steal": "ライフスティール",
  "Omnivamp": "オムニヴァンプ",
  "Ability Haste": "スキルヘイスト",
  "Cooldown Reduction": "クールダウン短縮",
  "Lethality": "レサリティ",
  "Magic Penetration": "魔法貫通",
  "Armor Penetration": "物理防御貫通",
  "Heal and Shield Power": "回復/シールド効果",
  "Tenacity": "妨害耐性",
  "Base Health Regen": "体力自動回復",
  "Base Mana Regen": "マナ自動回復",
  "Health Regen": "体力自動回復",
  "Mana Regen": "マナ自動回復",
  "Gold Per 10 Seconds": "10秒ごとのゴールド",
};

type StatEntry = { label: string; value: string };

/**
 * `description` 内の `<stats>...</stats>` ブロックを`<br>`区切りの行に分け、各行を
 * 「数値[%] + 半角スペース + 英語ステータス名」（実測の並び順、例 " 65% Attack Speed"）としてパースする。
 * 対訳glossary（`STAT_NAME_JA`）に完全一致する名前だけを日本語ラベル化して返し、対訳の無い名前・
 * パターンに一致しない行は読み飛ばす（捏造しない＝誤訳・ノイズ回避、PBE-S6 F-PBE6-1の核心）。
 */
function extractKnownStats(description: string): StatEntry[] {
  const blockMatches = [...description.matchAll(/<stats>([\s\S]*?)<\/stats>/gi)];
  const entries: StatEntry[] = [];
  for (const block of blockMatches) {
    const lines = block[1].split(/<br\s*\/?>/i);
    for (const line of lines) {
      const plain = stripTags(line);
      if (!plain) continue;
      const match = plain.match(/^(\d+(?:\.\d+)?)(%?)\s+(.+)$/);
      if (!match) continue;
      const [, num, percent, rawName] = match;
      const label = STAT_NAME_JA[rawName.trim()];
      if (!label) continue;
      entries.push({ label, value: `${num}${percent}` });
    }
  }
  return entries;
}

/** `extractKnownStats`の結果を日本語ラベル→値のMapにする（同名が複数あれば最後の値を採用）。 */
function toStatMap(description: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const { label, value } of extractKnownStats(description)) {
    map.set(label, value);
  }
  return map;
}

/**
 * 実在の店売りアイテムか（PBE-S6 F-PBE6-1、実データ確認済みの判定条件）。`inStore`だけでは
 * 削除済み/専用モード限定アイテムを除外できないため、`displayInItemSets`も併せて要求する。
 */
function isRealStoreItem(item: CDragonItem): boolean {
  return item.inStore === true && item.displayInItemSets === true;
}

/**
 * `pbeItems`（本番の1つ先）と `latestItems`（現行live）をid一致で比較し、変更アイテムだけを返す。
 * `before` は latestItems（現行）側、`after` は pbeItems（次パッチ候補）側の値。
 * 対象は`isRealStoreItem`（pbe/latest双方）を満たすアイテムのみ（削除済み/非店売り/内部アイテムは
 * 除外、PBE-S6 F-PBE6-1）。`priceTotal`（価格）と、対訳glossaryで日本語化できるステータス数値のみを
 * 比較し、意味のある差分が無いアイテムは結果から除外する（0件を出さない）。
 * `jaNames`（`buildJaNameMap(ja_jpのitems.json)`）があれば日本語名、無ければ items 自体の name
 * （通常は英名）にフォールバックする。
 * 対応する latestItems 側の要素が無い（PBEのみに存在する完全新規アイテム）場合は、比較対象の
 * 本番側データが無く安全な逐語diffが作れないため対象外にする（捏造しない）。
 */
export function diffItems(
  pbeItems: CDragonItem[],
  latestItems: CDragonItem[],
  jaNames?: Record<number, string>,
): PbeItemChange[] {
  const latestById = new Map(latestItems.map((item) => [item.id, item] as const));

  const result: PbeItemChange[] = [];

  for (const pbeItem of pbeItems) {
    const latestItem = latestById.get(pbeItem.id);
    if (!latestItem) continue;
    if (!isRealStoreItem(pbeItem) || !isRealStoreItem(latestItem)) continue;

    const changes: { stat: string; before: string; after: string }[] = [];

    if (pbeItem.priceTotal !== latestItem.priceTotal) {
      changes.push({
        stat: "価格",
        before: `${latestItem.priceTotal}ゴールド`,
        after: `${pbeItem.priceTotal}ゴールド`,
      });
    }

    const latestStats = toStatMap(latestItem.description);
    const pbeStats = toStatMap(pbeItem.description);
    const labels = new Set<string>([...latestStats.keys(), ...pbeStats.keys()]);
    for (const label of labels) {
      const before = latestStats.get(label);
      const after = pbeStats.get(label);
      if (before === after) continue;
      changes.push({ stat: label, before: before ?? "なし", after: after ?? "なし" });
    }

    if (changes.length === 0) continue;

    result.push({
      id: pbeItem.id,
      name: jaNames?.[pbeItem.id] ?? pbeItem.name,
      iconPath: pbeItem.iconPath,
      changes,
    });
  }

  return result;
}

/**
 * `PbeItemChange` を既存 `ArticleBodyPatchChangeBlock`（kind:"item"）へ変換する（PBE-S1 F-PBE1-3、型のみ）。
 * `direction` は数値のみからbuff/nerfを機械判定するとPBE早期段階では誤判定リスクがあるため、
 * 既存原則（曖昧はadjust）に従い固定で `"adjust"` にする。
 */
export function toArticleBodyPatchChangeBlock(change: PbeItemChange): ArticleBodyPatchChangeBlock {
  return {
    type: "patchChange",
    targetName: change.name,
    targetIconUrl: buildCDragonItemIconUrl(change.iconPath),
    targetKind: "item",
    direction: "adjust",
    groups: [
      {
        changes: change.changes.map((c) => ({ stat: c.stat, before: c.before, after: c.after })),
      },
    ],
  };
}
