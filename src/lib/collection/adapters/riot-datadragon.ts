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

/**
 * トークン節約のため、抽出したパッチノート本文テキストはこの文字数で切り詰める（拡張E34）。
 * 拡張E35 F-E35-1: 15000字では実際の変更内容（本体）が途中で切れてしまうことがあったため、
 * 60000字まで拡大した。Haikuは200k文脈でありパッチノート本文取得は新パッチ検知時のみ（月2回程度）と
 * 呼び出し頻度が低いため、コスト増は許容範囲。
 */
export const PATCH_NOTES_MAX_LENGTH = 60000;

/** Data Dragon の JSON を取得する。HTTPエラー・パース失敗・ネットワーク断はnullを返す（例外を投げない）。 */
function fetchJson<T>(url: string): Promise<T | null> {
  return fetchJsonSafe<T>(url, {}, { logLabel: "riot-datadragon", context: url });
}

/**
 * 主要なHTMLエンティティ（数値参照含む）を復号する（新規npm依存を避けるための簡易実装）。
 * リファクタリングS7b: `riot-news.ts`（og:title抽出）でも再利用するためexportする。
 */
export function decodeHtmlEntities(text: string): string {
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
 * 3件以上連続する「極端に短い(2文字以下)行」の並びをまとめて間引く（拡張E35 F-E35-1、best-effort）。
 * ナビメニューのアイコンラベルや区切り記号の連続等のボイラープレートを想定した簡易ヒューリスティックで、
 * 単発で現れる短い行（能力キー "Q" 等）は本文の可能性があるため残す。
 */
function dropShortFragmentRuns(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].length <= 2) {
      let j = i;
      while (j < lines.length && lines[j].length <= 2) j++;
      if (j - i >= 3) {
        i = j; // 3件以上連続する短い断片はまとめて捨てる
        continue;
      }
    }
    result.push(lines[i]);
    i++;
  }
  return result;
}

/** 直前の行と完全一致する行を間引く（ナビメニュー等で同じラベルが繰り返されるボイラープレート対策）。 */
function dedupeConsecutiveLines(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (result.length > 0 && result[result.length - 1] === line) continue;
    result.push(line);
  }
  return result;
}

/**
 * HTMLからタグ・script/styleを除去し、エンティティを復号したプレーンテキストを取り出す
 * （新規npm依存なし・正規表現ベース。拡張E34 F-E34-1）。空行は詰めて読みやすくする。
 * 拡張E35 F-E35-1: ナビ・ヘッダー・フッター・サイドバー（<nav>/<header>/<footer>/<aside>）は
 * タグ除去前に要素ごと丸ごと落とし、本文に無関係なボイラープレートテキストの混入を減らす
 * （best-effort。完全な本文抽出は狙わず、後段のLLMプロンプト強化と合わせてノイズを許容する方針）。
 * リファクタリングS7b: `riot-news.ts`（ニュース記事本文抽出）でも再利用するためexportする。
 */
export function stripHtmlToText(html: string): string {
  const withoutBoilerplateBlocks = html.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const withoutScripts = withoutBoilerplateBlocks
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, "\n");
  const decoded = decodeHtmlEntities(withoutTags);
  const lines = decoded
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return dedupeConsecutiveLines(dropShortFragmentRuns(lines)).join("\n").trim();
}

/**
 * HTMLの `<meta property="og:image" content="...">` からメイン画像URLを抽出する純関数（拡張E42 F-E42-1）。
 * `content` 値は既存 `decodeHtmlEntities` で `&amp;` 等を復号する（公式ページのog:imageは署名クエリに
 * `&amp;` を含むことが確認済み）。https のもののみ採用し、それ以外（http/未検出/不正な値）は null を返す
 * （例外は投げない）。
 */
export function extractOgImageUrl(html: string): string | null {
  const match = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i);
  if (!match) return null;
  const contentMatch = match[0].match(/content=["']([^"']+)["']/i);
  if (!contentMatch) return null;
  const url = decodeHtmlEntities(contentMatch[1]).trim();
  if (!/^https:\/\//i.test(url)) return null;
  return url;
}

/**
 * 最新パッチの公式パッチノートページから本文テキストと og:image（メイン画像URL）の両方を、
 * 二重fetchを避けて1回のfetchで取得する（拡張E42 F-E42-1）。取得失敗（HTTPエラー・ネット断・
 * タイムアウト）・本文が短すぎる（JSレンダリング等で本文が取れていない、PATCH_NOTES_MIN_LENGTH未満）
 * 場合は null を返す（例外は投げない）。本文はトークン節約のため PATCH_NOTES_MAX_LENGTH で切り詰める。
 * 画像は本文とは独立に判定し（本文が閾値未満でも og:image 自体は取得できることがあるが、本文が
 * 無ければ呼び出し側は従来どおりフォールバックするため、本文が短すぎる場合は imageUrl も含めて null にする）。
 *
 * パッチ記事刷新S1 F-S1-1: 平テキスト化前の生HTML（`html`）も併せて返す。DOM構造パーサ
 * （`patch-notes-parser.ts`）が対象・スキルキー・変更前後を誤帰属ゼロで抽出するにはタグ構造が
 * 必要なため、既存の平テキスト経路（`text`, フォールバック用に温存）とは別に、記事化(candidate)側が
 * 使える「生HTMLを保持する経路」を追加する（S2でDOM抽出を配線するまではこの`html`は未使用のまま
 * 後方互換）。本文と異なり切り詰めない（タグ構造の途中で切ると`parsePatchNotesHtml`の抽出が
 * 部分的に失敗しうるため。パーサ自体は失敗ブロックを読み飛ばすbest-effortで本体を止めない）。
 *
 * 取得の堅牢性（research 未確認事項2）: 公式ノートURLは末尾スラッシュ有無で307リダイレクトするが、
 * `fetch`（Node標準/undici）は既定でリダイレクトを追う（`redirect: "follow"`が既定値）ため、
 * `fetchTextSafe` は追加対応なしでリダイレクト後のHTMLを取得できる（実URLで確認済み）。
 */
export async function fetchPatchNotesData(
  version: string,
): Promise<{ text: string; imageUrl: string | null; html: string } | null> {
  const url = buildPatchNoteUrl(version);
  // 公式サイトが空/既定UAのbotアクセスを弾くことがあるため、ブラウザ相当のUAを付ける（拡張E34c）。
  const html = await fetchTextSafe(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "ja,en;q=0.8",
      },
    },
    { logLabel: "riot-patchnotes", context: url },
  );
  if (!html) return null;
  const text = stripHtmlToText(html);
  if (text.length < PATCH_NOTES_MIN_LENGTH) return null;
  const truncated = text.length > PATCH_NOTES_MAX_LENGTH ? text.slice(0, PATCH_NOTES_MAX_LENGTH) : text;
  return { text: truncated, imageUrl: extractOgImageUrl(html), html };
}

/**
 * 最新パッチの公式パッチノートページ本文テキストを取得する（拡張E34 F-E34-1）。
 * 取得失敗・本文が短すぎる場合は null を返す（例外は投げない）。内部では `fetchPatchNotesData` の
 * 薄いラッパ（拡張E42 F-E42-1）。
 */
export async function fetchPatchNotesText(version: string): Promise<string | null> {
  const data = await fetchPatchNotesData(version);
  return data ? data.text : null;
}

/** バージョン文字列（例 "14.6.1"）から「major.minor」部分を取り出す（パッチ単位の一意性に使う）。 */
export function patchSlug(version: string): string {
  const [major, minor] = version.split(".");
  return `${major ?? version}-${minor ?? "0"}`;
}

/**
 * 公式パッチノートページURLを構築する（パッチごとに一意・安定。revision部分は含めない）。
 * ⚠ Data Dragon の major（2026=16）と公式パッチノートの年ベース番号（2026=26）は、2025年の
 * 呼称変更以降 +10 ずれる（DDragon 15→公式25, 16→26）。現行の公式スラッグは
 * `league-of-legends-patch-<公式major>-<minor>-notes`（末尾スラッシュなし）。拡張E34cで実URLに合わせて修正。
 */
/**
 * Data Dragon の version（例 "16.14.1"）を、ユーザーが認識する公式の年ベース番号（例 "26.14"）に変換する。
 * 2025年の呼称変更以降、公式番号 = DDragon major + 10（major≥15）。それ未満は据え置き。タイトル表示・URL両方で使う。
 */
export function publicPatchNumber(version: string): string {
  const [major, minor] = version.split(".");
  const majorNum = Number(major);
  const publicMajor = Number.isFinite(majorNum) && majorNum >= 15 ? majorNum + 10 : majorNum;
  return `${publicMajor}.${minor ?? "0"}`;
}

export function buildPatchNoteUrl(version: string): string {
  return `https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-${publicPatchNumber(version).replace(".", "-")}-notes`;
}

/**
 * 未適用パッチの先行速報（パッチ記事刷新S5 F-S5-1）が有効かどうか。env `PATCH_PREVIEW_MODE`
 * （既定 `off`）が `"on"` のときのみ true。off/未設定では本モジュールの収集・記事化は
 * 現状と完全同一（このフラグを参照するコードパス自体が実行されない、回帰ゼロ）。
 */
export function isPatchPreviewModeEnabled(): boolean {
  return process.env.PATCH_PREVIEW_MODE === "on";
}

/**
 * Data Dragon の version（例 "16.14.1"）から「次パッチ」の version 文字列を組み立てる
 * （パッチ記事刷新S5 F-S5-1）。minor を +1 し revision は "1" に固定する（例 "16.14.1" → "16.15.1"）。
 * パース不能な形式（想定外の入力）は変更せずそのまま返す（例外を投げないフォールバック）。
 */
export function nextDdragonVersion(version: string): string {
  const [major, minor] = version.split(".");
  const majorNum = Number(major);
  const minorNum = Number(minor);
  if (!Number.isFinite(majorNum) || !Number.isFinite(minorNum)) return version;
  return `${majorNum}.${minorNum + 1}.1`;
}

/**
 * 新パッチ検知アイテムを組み立てる（事実タイトル＋事実content）。
 * `patchNotesText` に PATCH_NOTES_MIN_LENGTH 以上の本文が渡された場合（拡張E34 F-E34-1）は、
 * それを content にそのまま格納し、タイトルも「まとめ」と分かる形にする（compose.ts側のLLM要約の
 * 材料になる）。未指定/短すぎる場合は従来どおりの汎用事実速報になる（バランス数値等は含めない）。
 * `imageUrl`（拡張E42 F-E42-1）が渡された場合は `RawCollectionItem.imageUrl` に格納する
 * （記事本文冒頭の公式バナー画像・カードサムネの材料になる。未指定なら従来どおり未設定）。
 * `html`（パッチ記事刷新S2 F-S2-2）が渡された場合は `RawCollectionItem.html` に格納する
 * （DOM構造パーサ`parsePatchNotesHtml`が誤帰属ゼロで対象・スキルキー・変更前後を抽出するための
 * 生HTML。本文が短すぎてhasPatchNotesがfalseのときは併せて未設定にする＝汎用速報のみ）。
 * `isPreview`（パッチ記事刷新S5 F-S5-1・opt-in、既定false）が true の場合、未適用（本番未反映）の
 * 次パッチを表す先行速報アイテムとして、タイトルに「【速報】」接頭辞を付け
 * `RawCollectionItem.patchPreview` を true にする（後段のcompose.tsが速報バッジを本文に追加する
 * 材料になる）。未指定/false（既定）ではタイトル・contentとも従来と完全同一（回帰ゼロ）。
 */
export function buildPatchItem(
  version: string,
  now: Date,
  patchNotesText?: string | null,
  imageUrl?: string | null,
  html?: string | null,
  isPreview?: boolean,
): RawCollectionItem {
  // タイトル表示はユーザーが認識する公式番号（例 26.14）を使う（DDragonの16.14ではなく。拡張E34c）。
  const patchLabel = publicPatchNumber(version);
  const hasPatchNotes = typeof patchNotesText === "string" && patchNotesText.length >= PATCH_NOTES_MIN_LENGTH;
  const previewPrefix = isPreview ? "【速報】" : "";
  return {
    sourceUrl: buildPatchNoteUrl(version),
    title: hasPatchNotes
      ? `${previewPrefix}【パッチ】${patchLabel} の主な変更点まとめ`
      : `${previewPrefix}【パッチ】${patchLabel} のゲームデータが公開`,
    content: hasPatchNotes
      ? (patchNotesText as string)
      : `Riot Games の Data Dragon にて、パッチ ${patchLabel}（内部バージョン ${version}）のゲームデータが公開された。最新バージョンのチャンピオン・アイテム等のデータが利用可能になっている。`,
    fetchedAt: now,
    ...(imageUrl ? { imageUrl } : {}),
    ...(hasPatchNotes && html ? { html } : {}),
    // リファクタリングS2（F-S2-1）: Post永続化用の外部ID(パッチ識別子)。score/commentCountは
    // Riotに概念が無いため未設定のまま(persist側で0扱い)。
    externalId: patchLabel,
    ...(isPreview ? { patchPreview: true } : {}),
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

    // 公式パッチノート本文＋公式バナー画像URLを取得できれば content/imageUrl に格納する
    // （拡張E34 F-E34-1、拡張E42 F-E42-1）。取得失敗・本文が短すぎる場合は null が返り、
    // buildPatchItem が従来の汎用contentにフォールバックする（画像も未設定になる）。
    const patchNotesData = await fetchPatchNotesData(latestVersion);

    const items: RawCollectionItem[] = [
      buildPatchItem(latestVersion, now, patchNotesData?.text, patchNotesData?.imageUrl, patchNotesData?.html),
    ];

    // パッチ記事刷新S5 F-S5-1（opt-in・既定off）: 未適用（本番未反映）の次パッチの公式ノートが
    // 既に公開されていれば、先行速報アイテムを追加する。envが無効（既定）ならこのブロック自体を
    // 実行しないため、収集は現状と完全同一（回帰ゼロ）。取得失敗（404/未公開等）は
    // fetchPatchNotesData が例外を投げずnullを返すため、そのまま現状（確定パッチのみ）にフォールバックする。
    if (isPatchPreviewModeEnabled()) {
      const nextVersion = nextDdragonVersion(latestVersion);
      if (nextVersion !== latestVersion) {
        const previewData = await fetchPatchNotesData(nextVersion);
        if (previewData) {
          items.push(
            buildPatchItem(nextVersion, now, previewData.text, previewData.imageUrl, previewData.html, true),
          );
        }
      }
    }

    return items;
  }
}
