/**
 * 5ch（掲示板）から取得する live アダプタ（拡張E18 F-E18-1）。5chには公式APIが無く
 * subject.txt/dat のスクレイピングになる。**ベストエフォート・ガードレール前提**（ext-e18-brief.md）:
 * - 対象板は env `FIVECH_BOARDS` で限定（既定を持つが運営者が差し替え可能）。低頻度アクセス
 *   （config のレート制限＋実行間隔）は呼び出し側 pipeline が担う。
 * - 5chは空User-Agent等を弾くため `FIVECH_USER_AGENT`（既定は説明的UA）を必ず付与する。
 * - robots/転載規約の尊重は運営者責務。削除依頼（`CONTACT_EMAIL`）への即応が唯一の実質的な安全弁。
 * - HTML/dat の仕様変更で壊れやすい前提のため、取得失敗（403/ネット断/解析不能）・板無効は
 *   すべて例外を投げず握り潰して空配列＋スキップログにする（他ソース・全体を止めない。
 *   riot/reddit/clip live アダプタと同方針）。
 *
 * 5chの返す生テキストは信頼できないユーザー生成コンテンツとして扱い、整形済みの
 * スレッドダンプ文字列を content に入れるのみでHTMLとして解釈させる経路には入れない
 * （安全フィルタ・XSSエスケープ・出典必須は既存の生成/表示層が担保）。
 *
 * 注記（既知の限界）: 5chの一部の古い板はShift_JISで応答することがあるが、追加依存
 * （iconv-lite等）を避けるため `fetchTextSafe`（標準 `Response#text()`、UTF-8前提）で
 * そのまま読む。文字化けする板がある場合は運営者側でUTF-8配信の板/ミラーに切り替える。
 */
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { getDefaultSourceConfigs } from "@/lib/collection/config";
import { fetchTextSafe, dedupeBySourceUrl } from "@/lib/collection/adapters/http";

/** 板未設定時の既定（LoLスレが立つことがあるネトゲ実況板の一例。運営者が env で差し替え可能）。 */
const DEFAULT_BOARDS_RAW = "egg.5ch.net/livegame";
/** 5chは空/既定UAを弾くことがあるため説明的な既定UAを用意する（env `FIVECH_USER_AGENT` で上書き可）。 */
const DEFAULT_USER_AGENT = "lol-matome-sokuhou-collector/1.0 (bot; +contact via operator CONTACT_EMAIL)";
/** 1板あたり対象にするスレ数の上限（有界化。最終的な件数上限は呼び出し側pipelineのconfigも適用）。 */
const MAX_THREADS_PER_BOARD = 5;
/** 1スレあたり取り込むレス数の上限（有界化。転載範囲を絞る意味もある）。 */
const MAX_RESES_PER_THREAD = 30;

export type FiveChBoard = { server: string; board: string };

/** `"server/board"` をカンマ区切りにした env 文字列を board 定義配列にパースする。不正な要素は無視。 */
export function parseBoards(raw: string): FiveChBoard[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s): FiveChBoard | null => {
      const idx = s.indexOf("/");
      if (idx <= 0 || idx >= s.length - 1) return null;
      return { server: s.slice(0, idx), board: s.slice(idx + 1) };
    })
    .filter((b): b is FiveChBoard => b !== null);
}

export function buildSubjectUrl(server: string, board: string): string {
  return `https://${server}/${board}/subject.txt`;
}

export function buildDatUrl(server: string, board: string, threadId: string): string {
  return `https://${server}/${board}/dat/${threadId}.dat`;
}

/** スレッドごとに一意・安定な read.cgi URL（sourceUrl/dedupeキーに使う）。 */
export function buildReadCgiUrl(server: string, board: string, threadId: string): string {
  return `https://${server}/test/read.cgi/${board}/${threadId}/`;
}

export type SubjectEntry = { threadId: string; title: string; resCount: number };

/** subject.txt の1行 `"<threadId>.dat<>スレタイ (レス数)"` にマッチする正規表現。 */
const SUBJECT_LINE = /^(\d+)\.dat<>(.*)\s+\((\d+)\)\s*$/;

/** subject.txt のテキストをスレ一覧（id/タイトル/レス数）にパースする。形式不一致の行は無視する。 */
export function parseSubjectText(text: string): SubjectEntry[] {
  const entries: SubjectEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(SUBJECT_LINE);
    if (!m) continue;
    entries.push({ threadId: m[1], title: m[2].trim(), resCount: Number(m[3]) });
  }
  return entries;
}

/** タイトルがLoL関連キーワードに一致するスレのみを残し、上位N件に絞る。 */
export function filterRelevantThreads(entries: SubjectEntry[], keywords: string[], limit: number): SubjectEntry[] {
  const lowerKeywords = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 0);
  const matched = entries.filter((e) => {
    const lowerTitle = e.title.toLowerCase();
    return lowerKeywords.some((k) => lowerTitle.includes(k));
  });
  return matched.slice(0, Math.max(0, limit));
}

/** HTMLエンティティ（`&gt;`/`&lt;`/`&quot;`/`&#39;`/`&#\d+;`/`&amp;`）をデコードする（`&amp;`は最後）。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&gt;/gi, ">")
    .replace(/&lt;/gi, "<")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/gi, "&");
}

/**
 * dat 1レス分の生本文（`<br>`区切り・HTMLタグ混入あり）を、レス本文の行配列にデコードする。
 * `<br>`（自己終了含む）→改行、他のタグは除去（`<a ...>>>1</a>` 等は中身の `>>1` を残す）、
 * HTMLエンティティをデコードし、空行を除いた行配列を返す。
 */
export function decodeDatBody(rawBody: string): string[] {
  const withNewlines = rawBody.replace(/<br\s*\/?>/gi, "\n");
  const noTags = withNewlines.replace(/<[^>]+>/g, "");
  const decoded = decodeEntities(noTags);
  return decoded
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * dat の1行から本文フィールド（4番目、`name<>mail<>日付ID<>本文<>(1行目のみスレタイ)`）を取り出す。
 * 本文自体に区切り文字 `<>` が含まれる稀なケースは非対応（簡略化）。
 */
function extractDatBodyField(line: string): string {
  const parts = line.split("<>");
  return parts[3] ?? "";
}

/**
 * dat 全体のテキストを、`parseThreadReses` が解釈できる「スレッドダンプ」形式の content 文字列に
 * 組み立てる（`"1: 本文\n\n2: >>1\n本文\n\n…"`）。レス番号＝行番号(1始まり)。取り込むレス数は
 * `maxReses` で上限を設ける。本文が空になったレスは省く。有効なレスが1件も無ければ null。
 */
export function buildThreadDumpFromDat(datText: string, maxReses: number): string | null {
  const lines = datText.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  const blocks: string[] = [];
  lines.slice(0, Math.max(0, maxReses)).forEach((line, idx) => {
    const resNumber = idx + 1;
    const bodyLines = decodeDatBody(extractDatBodyField(line));
    if (bodyLines.length === 0) return;
    blocks.push(`${resNumber}: ${bodyLines.join("\n")}`);
  });

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

export type FiveChAdapterOptions = {
  /** テスト・注入用。既定は env `FIVECH_BOARDS`（未設定/無効時は既定板）。 */
  boards?: FiveChBoard[];
  /** テスト・注入用。既定は env `FIVECH_USER_AGENT`。 */
  userAgent?: string;
  /** 現在時刻の注入点（テスト用）。既定は実時刻。 */
  now?: () => Date;
  /** LoL関連判定キーワード。既定は config の5ch relevance keywords。 */
  keywords?: string[];
  /** 1板あたりの対象スレ数上限。 */
  maxThreadsPerBoard?: number;
  /** 1スレあたりの取り込みレス数上限。 */
  maxResesPerThread?: number;
};

/**
 * 5ch の subject.txt→対象スレ絞り込み→dat取得→スレッドダンプ整形、を行う live アダプタ。
 * 板が実質未設定（既定にも解決できない）・取得失敗はすべて例外を投げず空配列＋スキップログにする。
 */
export class FiveChAdapter implements SourceAdapter {
  readonly sourceType = "5ch" as const;
  private readonly boards: FiveChBoard[];
  private readonly userAgent: string;
  private readonly now: () => Date;
  private readonly keywords: string[];
  private readonly maxThreadsPerBoard: number;
  private readonly maxResesPerThread: number;

  constructor(options: FiveChAdapterOptions = {}) {
    const boardsRaw = process.env.FIVECH_BOARDS;
    this.boards = options.boards ?? parseBoards(boardsRaw && boardsRaw.trim().length > 0 ? boardsRaw : DEFAULT_BOARDS_RAW);
    this.userAgent = options.userAgent ?? process.env.FIVECH_USER_AGENT ?? DEFAULT_USER_AGENT;
    this.now = options.now ?? (() => new Date());
    this.keywords = options.keywords ?? getDefaultSourceConfigs()["5ch"].relevance.keywords;
    this.maxThreadsPerBoard = options.maxThreadsPerBoard ?? MAX_THREADS_PER_BOARD;
    this.maxResesPerThread = options.maxResesPerThread ?? MAX_RESES_PER_THREAD;
  }

  private async fetchBoardItems(boardConf: FiveChBoard): Promise<RawCollectionItem[]> {
    const now = this.now();
    const boardLabel = `${boardConf.server}/${boardConf.board}`;
    const subjectText = await fetchTextSafe(
      buildSubjectUrl(boardConf.server, boardConf.board),
      { headers: { "User-Agent": this.userAgent } },
      { logLabel: "5ch", context: `${boardLabel} subject.txt` },
    );
    if (!subjectText) return [];

    const entries = parseSubjectText(subjectText);
    const relevant = filterRelevantThreads(entries, this.keywords, this.maxThreadsPerBoard);

    const items: RawCollectionItem[] = [];
    for (const entry of relevant) {
      const datText = await fetchTextSafe(
        buildDatUrl(boardConf.server, boardConf.board, entry.threadId),
        { headers: { "User-Agent": this.userAgent } },
        { logLabel: "5ch", context: `${boardLabel}/${entry.threadId}.dat` },
      );
      if (!datText) continue;
      const content = buildThreadDumpFromDat(datText, this.maxResesPerThread);
      if (!content) continue;
      items.push({
        sourceUrl: buildReadCgiUrl(boardConf.server, boardConf.board, entry.threadId),
        title: entry.title,
        content,
        fetchedAt: now,
      });
    }
    return items;
  }

  async fetchItems(): Promise<RawCollectionItem[]> {
    if (this.boards.length === 0) {
      console.log("[5ch] FIVECH_BOARDS が無効なため5ch収集をスキップします");
      return [];
    }
    const results = await Promise.all(this.boards.map((b) => this.fetchBoardItems(b)));
    return dedupeBySourceUrl(results.flat());
  }
}
