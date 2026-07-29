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
