/**
 * Riot Data Dragon（公式の静的データCDN、キー不要）から取得する live アダプタ（拡張E15 F-E15-1）。
 * Data Dragon が提供するのは静的データ（バージョン一覧・チャンピオン等）のみでパッチノート本文・
 * eスポーツ記事のプローズは含まないため、ここで生成するのは「新パッチ検知の事実速報」と
 * 「チャンピオンの公式データに基づく事実紹介」の2種（architecture.md方針: 事実フォーマット記事）。
 *
 * 信頼境界（外部API）: fetch はタイムアウト付き、HTTPエラー・不正JSON・ネットワーク断は
 * 例外を投げず握り潰して空配列/nullを返す（1ソースの失敗が収集パイプライン全体を止めない方針）。
 */
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { fetchJsonSafe } from "@/lib/collection/adapters/http";

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const DEFAULT_LOCALE = "ja_JP";
/** 1回の収集で候補として返すチャンピオン件数（常識的な範囲。最終的な上限はpipeline側config）。 */
const DEFAULT_CHAMPION_WINDOW_SIZE = 15;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function championListUrl(version: string, locale: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${locale}/champion.json`;
}

/** Data Dragon の JSON を取得する。HTTPエラー・パース失敗・ネットワーク断はnullを返す（例外を投げない）。 */
function fetchJson<T>(url: string): Promise<T | null> {
  return fetchJsonSafe<T>(url, {}, { logLabel: "riot-datadragon", context: url });
}

/** バージョン文字列（例 "14.6.1"）から「major.minor」部分を取り出す（パッチ単位の一意性に使う）。 */
export function patchSlug(version: string): string {
  const [major, minor] = version.split(".");
  return `${major ?? version}-${minor ?? "0"}`;
}

/** 公式パッチノートページURLを構築する（パッチごとに一意・安定。revision部分は含めない）。 */
export function buildPatchNoteUrl(version: string): string {
  return `https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-${patchSlug(version)}-notes/`;
}

/** 新パッチ検知アイテムを組み立てる（事実タイトル＋事実content。バランス数値等は含めない）。 */
export function buildPatchItem(version: string, now: Date): RawCollectionItem {
  const [major, minor] = version.split(".");
  const patchLabel = `${major ?? version}.${minor ?? "0"}`;
  return {
    sourceUrl: buildPatchNoteUrl(version),
    title: `【パッチ】${patchLabel} のゲームデータが公開`,
    content: `Riot Games の Data Dragon にて、パッチ ${patchLabel}（内部バージョン ${version}）のゲームデータが公開された。最新バージョンのチャンピオン・アイテム等のデータが利用可能になっている。`,
    fetchedAt: now,
  };
}

export type ChampionSummary = {
  id: string;
  name: string;
  title: string;
  blurb: string;
  tags?: string[];
};

/** 公式チャンピオンページURLを構築する（チャンピオンごとに一意・安定。パッチに依存しない）。 */
export function buildChampionPageUrl(championId: string): string {
  return `https://www.leagueoflegends.com/ja-jp/champions/${championId.toLowerCase()}/`;
}

/** チャンピオン事実紹介アイテムを組み立てる（公式 name/title/blurb/tags ベースの事実content）。 */
export function buildChampionItem(champion: ChampionSummary, now: Date): RawCollectionItem {
  const roleLabel = champion.tags && champion.tags.length > 0 ? `${champion.tags.join("・")}タイプの` : "";
  return {
    sourceUrl: buildChampionPageUrl(champion.id),
    title: `【チャンピオン紹介】${champion.name}（${champion.title}）`,
    content: `${champion.name}は${roleLabel}チャンピオン。${champion.blurb}`,
    fetchedAt: now,
  };
}

/**
 * チャンピオンID一覧から、実行日ベースでローテーションする「窓」を選び出す。
 * 毎回同じ順で全件返すと2回目以降は既存URLと重複しdedupで新規0件になってしまうため、
 * 日付ごとに開始位置をずらした固定幅の窓を返し、日を跨いで全チャンピオンを順次網羅する。
 */
export function selectRotatedChampionIds(allIds: string[], now: Date, windowSize: number): string[] {
  const total = allIds.length;
  if (total === 0 || windowSize <= 0) return [];
  const sorted = [...allIds].sort();
  const dayIndex = Math.floor(now.getTime() / ONE_DAY_MS);
  const offset = ((dayIndex % total) + total) % total;
  const size = Math.min(windowSize, total);
  const result: string[] = [];
  for (let i = 0; i < size; i++) {
    result.push(sorted[(offset + i) % total]);
  }
  return result;
}

type ChampionListResponse = {
  data?: Record<string, ChampionSummary>;
};

export type RiotDataDragonAdapterOptions = {
  /** Data Dragon の locale。既定 "ja_JP"（env `RIOT_DDRAGON_LOCALE` で上書き可能）。 */
  locale?: string;
  /** 現在時刻の注入点（テスト用）。既定は実時刻。 */
  now?: () => Date;
  /** 1回の収集で返すチャンピオン件数（ローテーション窓の幅）。 */
  championWindowSize?: number;
};

/**
 * Riot Data Dragon（キー不要の公開CDN）から新パッチ検知＋チャンピオン事実紹介を収集する live アダプタ。
 */
export class RiotDataDragonAdapter implements SourceAdapter {
  readonly sourceType = "riot" as const;
  private readonly locale: string;
  private readonly now: () => Date;
  private readonly championWindowSize: number;

  constructor(options: RiotDataDragonAdapterOptions = {}) {
    this.locale = options.locale ?? process.env.RIOT_DDRAGON_LOCALE ?? DEFAULT_LOCALE;
    this.now = options.now ?? (() => new Date());
    this.championWindowSize = options.championWindowSize ?? DEFAULT_CHAMPION_WINDOW_SIZE;
  }

  async fetchItems(): Promise<RawCollectionItem[]> {
    const now = this.now();
    const versions = await fetchJson<string[]>(VERSIONS_URL);
    if (!versions || versions.length === 0) return [];
    const latestVersion = versions[0];

    const items: RawCollectionItem[] = [buildPatchItem(latestVersion, now)];

    const championRes = await fetchJson<ChampionListResponse>(championListUrl(latestVersion, this.locale));
    const championData = championRes?.data;
    if (championData) {
      const rotatedIds = selectRotatedChampionIds(Object.keys(championData), now, this.championWindowSize);
      for (const id of rotatedIds) {
        const champion = championData[id];
        if (champion) items.push(buildChampionItem(champion, now));
      }
    }

    return items;
  }
}
