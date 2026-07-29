/**
 * CDragon PBE のアイテムdiff（純関数・DB非依存、PBE-S1 F-PBE1-2）。
 *
 * `latest`（現行live）と`pbe`（本番の1つ先）の `items.json` をid一致で比較し、変更のあったアイテムだけを
 * `PbeItemChange` として返す。比較対象は `docs/pbe-research.md` §3.4 の結論に従い**ラベル明瞭な
 * フィールドのみ**（`priceTotal`/`description`内の`<stats>`/`from`/`to`/`inStore`）。
 * **スキル効果量（effectAmounts/coefficients）はこのモジュールが扱う対象に含まれておらず、
 * 一切参照しない**（誤情報リスク回避、アイテムには元々該当フィールドが存在しない）。
 *
 * 全てのbefore/afterは元データの文字列そのまま（HTMLタグのみ除去。数値・文言の捏造はしない）。
 * 変化が無いアイテムは結果に含めない（0件なら空配列）。AI不使用。
 */
import { decodeHtmlEntities } from "@/lib/collection/adapters/riot-datadragon";
import type { CDragonItem } from "@/lib/collection/adapters/cdragon-pbe";
import { buildCDragonItemIconUrl } from "@/lib/collection/adapters/cdragon-pbe";
import type { ArticleBodyPatchChangeBlock } from "@/lib/article-body";

/** 1アイテムの数値/文字列変更（`stat`は「合計コスト」等の日本語ラベル、before/afterは逐語）。 */
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

/** `description` 内の `<stats>...</stats>` ブロック（増加ステータス表記）だけを抜き出す。無ければ空文字。 */
function extractStatsText(description: string): string {
  const matches = [...description.matchAll(/<stats>([\s\S]*?)<\/stats>/gi)];
  return matches
    .map((m) => stripTags(m[1]))
    .filter((text) => text.length > 0)
    .join("; ");
}

/** `<stats>` ブロックを除いた残りの description テキスト（アクティブ効果の説明文等）。無ければ空文字。 */
function extractRestDescription(description: string): string {
  return stripTags(description.replace(/<stats>[\s\S]*?<\/stats>/gi, " "));
}

/** 2つのID配列が要素の集合として同一かどうか（順序は無視）。 */
function sameIdSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((v, i) => v === sortedB[i]);
}

/** ID配列を人間可読な名前の一覧に変換する（解決できないIDは `#<id>` のまま。捏造しない）。 */
function formatIdList(ids: number[], nameById: Map<number, string>): string {
  if (ids.length === 0) return "なし";
  return ids.map((id) => nameById.get(id) ?? `#${id}`).join("、");
}

/**
 * `pbeItems`（本番の1つ先）と `latestItems`（現行live）をid一致で比較し、変更アイテムだけを返す。
 * `before` は latestItems（現行）側、`after` は pbeItems（次パッチ候補）側の値。
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
  const nameById = new Map<number, string>();
  for (const item of latestItems) nameById.set(item.id, item.name);
  for (const item of pbeItems) if (!nameById.has(item.id)) nameById.set(item.id, item.name);

  const result: PbeItemChange[] = [];

  for (const pbeItem of pbeItems) {
    const latestItem = latestById.get(pbeItem.id);
    if (!latestItem) continue;

    const changes: { stat: string; before: string; after: string }[] = [];

    if (pbeItem.priceTotal !== latestItem.priceTotal) {
      changes.push({
        stat: "合計コスト",
        before: String(latestItem.priceTotal),
        after: String(pbeItem.priceTotal),
      });
    }

    const beforeStats = extractStatsText(latestItem.description);
    const afterStats = extractStatsText(pbeItem.description);
    if (beforeStats !== afterStats && (beforeStats.length > 0 || afterStats.length > 0)) {
      changes.push({ stat: "ステータス", before: beforeStats || "なし", after: afterStats || "なし" });
    }

    const beforeRest = extractRestDescription(latestItem.description);
    const afterRest = extractRestDescription(pbeItem.description);
    if (beforeRest !== afterRest && (beforeRest.length > 0 || afterRest.length > 0)) {
      changes.push({ stat: "説明", before: beforeRest || "なし", after: afterRest || "なし" });
    }

    if (!sameIdSet(pbeItem.from, latestItem.from)) {
      changes.push({
        stat: "素材",
        before: formatIdList(latestItem.from, nameById),
        after: formatIdList(pbeItem.from, nameById),
      });
    }

    if (!sameIdSet(pbeItem.to, latestItem.to)) {
      changes.push({
        stat: "合成先",
        before: formatIdList(latestItem.to, nameById),
        after: formatIdList(pbeItem.to, nameById),
      });
    }

    if (pbeItem.inStore !== latestItem.inStore) {
      changes.push({
        stat: "店舗掲載",
        before: latestItem.inStore ? "あり" : "なし",
        after: pbeItem.inStore ? "あり" : "なし",
      });
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
 * 実際の記事化・PBE記事枠への組み込みはP4以降。本関数はcompose/pipeline/表示のいずれからも
 * 呼び出されておらず、既存挙動には一切影響しない。
 * `direction` は数値のみからbuff/nerfを機械判定するとPBE早期段階では誤判定リスクがあるため、
 * 既存原則（曖昧はadjust）に従い固定で `"adjust"` にする（P2以降で必要になれば見直す）。
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
