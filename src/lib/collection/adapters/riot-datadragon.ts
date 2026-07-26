/**
 * Riot Data Dragon（公式の静的データCDN、キー不要）から取得する live アダプタ（拡張E15 F-E15-1）。
 * Data Dragon が提供するのは静的データ（バージョン一覧等）のみでパッチノート本文・eスポーツ記事の
 * プローズは含まないため、ここで生成するのは「新パッチ検知の事実速報」のみ
 * （architecture.md方針: 事実フォーマット記事）。
 *
 * 拡張E20 F-E20-2: チャンピオン紹介記事は「話題性が無く煽り速報タイトルと相性が悪い」という
 * 運用方針により廃止した。パッチ検知のみを返す。
 *
 * 拡張E34 F-E34-1: 新パッチ検知に加えて、公式パッチノートページ（buildPatchNoteUrl）から本文テキストを
 * 取得する fetchPatchNotesText を追加した。取得できた場合は buildPatchItem の content に実本文を
 * 格納し、compose.ts側でLLM要約（まとめ記事）の材料にする。JSレンダリング等で本文が取得できない
 * 場合は null を返し（例外は投げない）、呼び出し側は従来の汎用content（事実速報）にフォールバックする。
 *
 * 信頼境界（外部API）: fetch はタイムアウト付き、HTTPエラー・不正JSON・ネットワーク断は
 * 例外を投げず握り潰して空配列/nullを返す（1ソースの失敗が収集パイプライン全体を止めない方針）。
 */
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { fetchJsonSafe, fetchTextSafe } from "@/lib/collection/adapters/http";

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";

/**
 * パッチノート本文とみなす下限文字数（拡張E34）。HTML→テキスト抽出結果がこれ未満なら
 * JSレンダリング等で本文が取得できていないとみなし null を返す。compose.ts側でも
 * 「content が実パッチノート本文か（＝汎用の短いcontentではないか）」の判定に同じ値を使い、
 * 閾値の重複・ズレを防ぐ。
 */
export const PATCH_NOTES_MIN_LENGTH = 300;

/** トークン節約のため、抽出したパッチノート本文テキストはこの文字数で切り詰める（拡張E34）。 */
export const PATCH_NOTES_MAX_LENGTH = 15000;

/** Data Dragon の JSON を取得する。HTTPエラー・パース失敗・ネットワーク断はnullを返す（例外を投げない）。 */
function fetchJson<T>(url: string): Promise<T | null> {
  return fetchJsonSafe<T>(url, {}, { logLabel: "riot-datadragon", context: url });
}

/** 主要なHTMLエンティティ（数値参照含む）を復号する（新規npm依存を避けるための簡易実装）。 */
function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
  };
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (m) => named[m] ?? m);
}

/**
 * HTMLからタグ・script/styleを除去し、エンティティを復号したプレーンテキストを取り出す
 * （新規npm依存なし・正規表現ベース。拡張E34 F-E34-1）。空行は詰めて読みやすくする。
 */
function stripHtmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, "\n");
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

/**
 * 最新パッチの公式パッチノートページ本文テキストを取得する（拡張E34 F-E34-1）。
 * 取得失敗（HTTPエラー・ネット断・タイムアウト）・本文が短すぎる（JSレンダリング等で本文が
 * 取れていない、PATCH_NOTES_MIN_LENGTH未満）場合は null を返す（例外は投げない）。
 * トークン節約のため PATCH_NOTES_MAX_LENGTH で切り詰める。
 */
export async function fetchPatchNotesText(version: string): Promise<string | null> {
  const url = buildPatchNoteUrl(version);
  const html = await fetchTextSafe(url, {}, { logLabel: "riot-patchnotes", context: url });
  if (!html) return null;
  const text = stripHtmlToText(html);
  if (text.length < PATCH_NOTES_MIN_LENGTH) return null;
  return text.length > PATCH_NOTES_MAX_LENGTH ? text.slice(0, PATCH_NOTES_MAX_LENGTH) : text;
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

/**
 * 新パッチ検知アイテムを組み立てる（事実タイトル＋事実content）。
 * `patchNotesText` に PATCH_NOTES_MIN_LENGTH 以上の本文が渡された場合（拡張E34 F-E34-1）は、
 * それを content にそのまま格納し、タイトルも「まとめ」と分かる形にする（compose.ts側のLLM要約の
 * 材料になる）。未指定/短すぎる場合は従来どおりの汎用事実速報になる（バランス数値等は含めない）。
 */
export function buildPatchItem(version: string, now: Date, patchNotesText?: string | null): RawCollectionItem {
  const [major, minor] = version.split(".");
  const patchLabel = `${major ?? version}.${minor ?? "0"}`;
  const hasPatchNotes = typeof patchNotesText === "string" && patchNotesText.length >= PATCH_NOTES_MIN_LENGTH;
  return {
    sourceUrl: buildPatchNoteUrl(version),
    title: hasPatchNotes
      ? `【パッチ】${patchLabel} の主な変更点まとめ`
      : `【パッチ】${patchLabel} のゲームデータが公開`,
    content: hasPatchNotes
      ? (patchNotesText as string)
      : `Riot Games の Data Dragon にて、パッチ ${patchLabel}（内部バージョン ${version}）のゲームデータが公開された。最新バージョンのチャンピオン・アイテム等のデータが利用可能になっている。`,
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

    // 公式パッチノート本文を取得できれば content に格納する（拡張E34 F-E34-1）。
    // 取得失敗・本文が短すぎる場合は null が返り、buildPatchItem が従来の汎用contentにフォールバックする。
    const patchNotesText = await fetchPatchNotesText(latestVersion);

    return [buildPatchItem(latestVersion, now, patchNotesText)];
  }
}
