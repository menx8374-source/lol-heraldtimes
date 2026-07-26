/**
 * Riot Data Dragon（公式の静的データCDN、キー不要）から取得する live アダプタ（拡張E15 F-E15-1）。
 * Data Dragon が提供するのは静的データ（バージョン一覧等）のみでパッチノート本文・eスポーツ記事の
 * プローズは含まないため、ここで生成するのは「新パッチ検知の事実速報」のみ
 * （architecture.md方針: 事実フォーマット記事）。
 *
 * 拡張E20 F-E20-2: チャンピオン紹介記事は「話題性が無く煽り速報タイトルと相性が悪い」という
 * 運用方針により廃止した。パッチ検知のみを返す。
 *
 * 信頼境界（外部API）: fetch はタイムアウト付き、HTTPエラー・不正JSON・ネットワーク断は
 * 例外を投げず握り潰して空配列/nullを返す（1ソースの失敗が収集パイプライン全体を止めない方針）。
 */
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { fetchJsonSafe } from "@/lib/collection/adapters/http";

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";

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

export type RiotDataDragonAdapterOptions = {
  /** 現在時刻の注入点（テスト用）。既定は実時刻。 */
  now?: () => Date;
};

/**
 * Riot Data Dragon（キー不要の公開CDN）から新パッチ検知を収集する live アダプタ。
 */
export class RiotDataDragonAdapter implements SourceAdapter {
  readonly sourceType = "riot" as const;
  private readonly now: () => Date;

  constructor(options: RiotDataDragonAdapterOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async fetchItems(): Promise<RawCollectionItem[]> {
    const now = this.now();
    const versions = await fetchJson<string[]>(VERSIONS_URL);
    if (!versions || versions.length === 0) return [];
    const latestVersion = versions[0];

    return [buildPatchItem(latestVersion, now)];
  }
}
