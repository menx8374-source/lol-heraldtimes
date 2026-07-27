/**
 * チャンピオン検出→公式スプラッシュ画像URL（拡張E31 F-E31-1）。
 * 記事本文（原題+本文）にチャンピオンの表示名が含まれていれば、そのチャンピオンの公式スプラッシュ
 * 画像（Riot Data Dragon、キー不要の公開CDN）をサムネイルに使う。
 *
 * 信頼境界（外部API）: Data Dragon の champion.json 取得は失敗（HTTPエラー・不正JSON・
 * ネットワーク断・タイムアウト）しても例外を投げず、ハードコードのフォールバック表にフォールバックする
 * （本体（記事生成）を止めない）。ネットワーク取得は呼び出し側（generation/pipeline.ts）が
 * run開始時に1回だけ行う想定で、この関数自体は毎回呼ばれても問題ないよう作るが、
 * 実際の呼び出し頻度の抑制は呼び出し側の責務とする。
 */
import { fetchJsonSafe } from "@/lib/collection/adapters/http";
import {
  buildChampionSplashUrl,
  pickDeterministicChampionSplashUrl,
  JP_NAME_TO_CHAMPION_ID,
} from "@/lib/generation/champion-splash";

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const CHAMPION_JSON_LOCALE = "ja_JP";

type DDragonChampionEntry = { id: string; name: string };
type DDragonChampionJson = { data: Record<string, DDragonChampionEntry> };

/** 表示名（日本語/英語）→ championId の対応表。 */
export type ChampionNameToIdMap = ReadonlyMap<string, string>;

// buildChampionSplashUrl・pickDeterministicChampionSplashUrl は拡張E38 F-E38-1で
// http非依存の純粋モジュール @/lib/generation/champion-splash に切り出した。
// 既存の import 元（generate-article.ts 等）がパス変更不要なようここで re-export する。
export { buildChampionSplashUrl, pickDeterministicChampionSplashUrl };

/**
 * ID不規則なチャンピオンを中心とした、表示名(日本語) → championId のフォールバック表。
 * Data Dragon 取得に失敗した場合や、取得結果に含まれない名称の保険として使う。
 * 各エントリについて championId 自身も検出対象に含める（英語表記の本文にも対応）。
 * 拡張E53 F-E53-2: 実体は http非依存の `champion-splash.ts`（`JP_NAME_TO_CHAMPION_ID`）に切り出した
 * （compose.ts のdetailedパッチ本文組み立てからもhttp依存を持ち込まず参照できるようにするため）。
 * ここではそれをそのまま re-export し、既存挙動・既存exportパスは不変にする。
 */
const FALLBACK_JP_NAME_TO_ID: Record<string, string> = JP_NAME_TO_CHAMPION_ID;

/** フォールバック表を Map に変換する（各エントリの championId 自身も検出対象に含める）。 */
function buildFallbackMap(): ChampionNameToIdMap {
  const map = new Map<string, string>();
  for (const [jpName, id] of Object.entries(FALLBACK_JP_NAME_TO_ID)) {
    map.set(jpName, id);
    map.set(id, id);
  }
  return map;
}

/** テスト・フォールバック用に公開する固定表（実データと同じ形の Map）。 */
export function fallbackChampionNameToIdMap(): ChampionNameToIdMap {
  return buildFallbackMap();
}

/**
 * Data Dragon の champion.json（locale=ja_JP、versionsの最新）から「表示名→championId」の
 * Map を取得する。取得失敗/不正時（バージョン取得失敗・HTTPエラー・不正JSON・ネットワーク断）は
 * 例外を投げず、ハードコードのフォールバック表を返す（記事生成パイプラインを止めない）。
 */
export async function fetchChampionNameToIdMap(): Promise<ChampionNameToIdMap> {
  const versions = await fetchJsonSafe<string[]>(
    VERSIONS_URL,
    {},
    { logLabel: "champion-thumbnail", context: VERSIONS_URL },
  );
  const latestVersion = versions?.[0];
  if (!latestVersion) return buildFallbackMap();

  const championUrl = `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/${CHAMPION_JSON_LOCALE}/champion.json`;
  const json = await fetchJsonSafe<DDragonChampionJson>(
    championUrl,
    {},
    { logLabel: "champion-thumbnail", context: championUrl },
  );
  if (!json?.data || Object.keys(json.data).length === 0) return buildFallbackMap();

  const map = new Map<string, string>();
  for (const champ of Object.values(json.data)) {
    if (!champ?.id) continue;
    if (champ.name) map.set(champ.name, champ.id);
    map.set(champ.id, champ.id); // 英語表記(id)そのものの本文でも検出できるようにする
  }
  return map;
}

/**
 * text（記事の原題+本文）中にチャンピオンの表示名が含まれていれば、そのチャンピオンの
 * 公式スプラッシュ画像URLを返す。含まれていなければ null。
 * 最長一致優先で判定する（例:「ジンクスは〜」を「ジン」の部分一致として誤検出しない）。
 */
export function detectChampionSplashUrl(text: string, nameToIdMap: ChampionNameToIdMap): string | null {
  if (!text || nameToIdMap.size === 0) return null;

  const namesByLengthDesc = Array.from(nameToIdMap.keys())
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);

  for (const name of namesByLengthDesc) {
    if (text.includes(name)) {
      const id = nameToIdMap.get(name);
      if (id) return buildChampionSplashUrl(id);
    }
  }
  return null;
}
