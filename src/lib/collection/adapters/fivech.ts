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
 * 注記（拡張E23で修正）: 5chの subject.txt/dat は多くがShift_JIS（Windows-31J/CP932）で
 * 配信されるため、`fetchShiftJisTextSafe`（`res.arrayBuffer()` を Node標準 `TextDecoder("shift_jis")`
 * でデコード。フルICUで利用可能・追加依存なし）で明示的にデコードして取得する
 * （以前はUTF-8前提の `fetchTextSafe` で読んでいたため日本語が文字化けしていた）。
 */
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { getDefaultSourceConfigs } from "@/lib/collection/config";
import { fetchShiftJisTextSafe, dedupeBySourceUrl } from "@/lib/collection/adapters/http";
import { extractAnchors } from "@/lib/generation/thread-format";

/** 板未設定時の既定（LoLスレが立つことがあるネトゲ実況板の一例。運営者が env で差し替え可能）。 */
const DEFAULT_BOARDS_RAW = "egg.5ch.net/livegame";
/** 5chは空/既定UAを弾くことがあるため説明的な既定UAを用意する（env `FIVECH_USER_AGENT` で上書き可）。 */
const DEFAULT_USER_AGENT = "lol-matome-sokuhou-collector/1.0 (bot; +contact via operator CONTACT_EMAIL)";
/** 1板あたり対象にするスレ数の上限（有界化。最終的な件数上限は呼び出し側pipelineのconfigも適用）。 */
const MAX_THREADS_PER_BOARD = 5;
/** 1スレあたり取り込むレス数の上限（有界化。転載範囲を絞る意味もある）。 */
const MAX_RESES_PER_THREAD = 30;
/** スレ選別の下限レス数（拡張E39 A2）。これ未満の過疎スレは除外する（env `FIVECH_MIN_RES_COUNT` で上書き可）。 */
const DEFAULT_MIN_RES_COUNT = 20;
/** subject/dat連続取得の間に入れるディレイ（拡張E39 B1）。同一サーバへの高頻度連続アクセスを避ける
 * （env `FIVECH_REQUEST_DELAY_MS` で上書き可）。 */
const DEFAULT_REQUEST_DELAY_MS = 1500;

/** 非負整数のenv値をパースする（不正・未設定はfallback）。 */
function envIntLocal(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

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

/**
 * Post永続化用の externalId（`"server/board/threadId"`）を板/スレIDに復元する
 * （リファクタリングS4 F-S4-1）。形式不一致は null。
 */
export function parseFiveChExternalId(externalId: string): { server: string; board: string; threadId: string } | null {
  const parts = externalId.split("/");
  if (parts.length !== 3) return null;
  const [server, board, threadId] = parts;
  if (!server || !board || !threadId) return null;
  return { server, board, threadId };
}

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

/** タイトルがLoL関連キーワードに一致するスレのみを残す（レス数・件数の絞り込みは行わない）。 */
export function matchKeywordThreads(entries: SubjectEntry[], keywords: string[]): SubjectEntry[] {
  const lowerKeywords = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 0);
  return entries.filter((e) => {
    const lowerTitle = e.title.toLowerCase();
    return lowerKeywords.some((k) => lowerTitle.includes(k));
  });
}

/**
 * タイトルがLoL関連キーワードに一致し、かつレス数が `minResCount` 以上のスレを残し（過疎スレ排除。
 * 拡張E39 A2）、レス数（勢い）降順にソートしたうえで上位 `limit` 件に絞る（subject順のsliceはしない）。
 * 満了（1000到達）スレも内容が豊富なので上限では除外しない。
 */
export function filterRelevantThreads(
  entries: SubjectEntry[],
  keywords: string[],
  limit: number,
  minResCount: number,
): SubjectEntry[] {
  const qualified = matchKeywordThreads(entries, keywords).filter((e) => e.resCount >= minResCount);
  const sorted = [...qualified].sort((a, b) => b.resCount - a.resCount);
  return sorted.slice(0, Math.max(0, limit));
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

export type DatRes = { number: number; bodyLines: string[] };

/** dat全体のテキストを全レス `{ number, bodyLines }` にパースする（number＝dat行番号＝レス番号、1始まり）。 */
export function parseDatReses(datText: string): DatRes[] {
  const lines = datText.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.map((line, idx) => ({
    number: idx + 1,
    bodyLines: decodeDatBody(extractDatBodyField(line)),
  }));
}

/**
 * 被参照（アンカー）の多いレスを優先して `maxReses` 件以内に選ぶ純関数（拡張E39 A1）。
 * - 本文が空のレスは候補から除外する。
 * - レス1（スレ主題/OP）は文脈として常に含める。
 * - 残り枠は被参照カウント（他レス本文の `>>number` から参照された回数）降順、同数はレス番号昇順で埋める。
 * - 拡張E41 F-E41-1: 選抜したレスが `>>N` で直接参照する先Nが `valid` に存在すれば、まだ選ばれて
 *   いなくても `maxReses` 内でbest-effortに含める（収集ダンプ自体に返信先が無いとcompose側でも
 *   復元できないため）。上限に達している場合は、被参照カウントが最も低い非OP・非アンカー先のレスを
 *   1つ落として枠を空ける（決定論的）。落とせる枠が無ければその参照先は諦める（上限厳守）。
 * - 返り値は元のレス番号のまま**昇順**に整列する（`parseThreadReses` の下流互換のため元番号を維持）。
 * 逐語は不変（選定のみ・本文は書き換えない）。範囲外/欠番アンカーを含んでいても壊れない。
 */
export function selectHighlightReses(reses: DatRes[], maxReses: number): DatRes[] {
  const valid = reses.filter((r) => r.bodyLines.length > 0);
  if (valid.length === 0) return [];
  const byNumber = new Map(valid.map((r) => [r.number, r] as const));

  const anchorCounts = new Map<number, number>();
  for (const r of valid) {
    for (const anchor of extractAnchors(r.bodyLines)) {
      anchorCounts.set(anchor, (anchorCounts.get(anchor) ?? 0) + 1);
    }
  }

  const op = valid.find((r) => r.number === 1);
  const rest = valid
    .filter((r) => r.number !== 1)
    .sort((a, b) => {
      const diff = (anchorCounts.get(b.number) ?? 0) - (anchorCounts.get(a.number) ?? 0);
      return diff !== 0 ? diff : a.number - b.number;
    });

  const limit = Math.max(0, maxReses);
  const selected: DatRes[] = [];
  if (op) selected.push(op);
  for (const r of rest) {
    if (selected.length >= limit) break;
    selected.push(r);
  }

  // 選抜レスが直接参照する先(>>N)も、まだ選ばれていなければ含める(拡張E41 F-E41-1)。
  const selectedNumbers = new Set(selected.map((r) => r.number));
  const anchorTargets = [...new Set(selected.flatMap((r) => extractAnchors(r.bodyLines)))].filter(
    (n) => byNumber.has(n) && !selectedNumbers.has(n),
  );

  for (const target of anchorTargets) {
    if (selected.length < limit) {
      selected.push(byNumber.get(target)!);
      selectedNumbers.add(target);
      continue;
    }
    // 上限到達時は、被参照カウントが最も低い非OP・非アンカー先のレスを1つ落として枠を空ける。
    const evictable = selected
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => r.number !== 1 && !anchorTargets.includes(r.number))
      .sort((a, b) => {
        const diff = (anchorCounts.get(a.r.number) ?? 0) - (anchorCounts.get(b.r.number) ?? 0);
        return diff !== 0 ? diff : b.r.number - a.r.number;
      });
    const toEvict = evictable[0];
    if (!toEvict) continue; // 落とせる枠が無ければこの参照先は諦める(上限厳守)
    selectedNumbers.delete(toEvict.r.number);
    selected.splice(toEvict.idx, 1, byNumber.get(target)!);
    selectedNumbers.add(target);
  }

  return selected.slice(0, limit).sort((a, b) => a.number - b.number);
}

/**
 * dat 全体のテキストを、`parseThreadReses` が解釈できる「スレッドダンプ」形式の content 文字列に
 * 組み立てる（`"1: 本文\n\n2: >>1\n本文\n\n…"`）。先頭N固定ではなく `selectHighlightReses` で
 * 被参照の多いレスを優先抽出する（拡張E39 A1）。取り込むレス数は `maxReses` で上限を設ける。
 * 選んだレスは元のレス番号のまま昇順で出力する。有効なレスが1件も無ければ null。
 */
export function buildThreadDumpFromDat(datText: string, maxReses: number): string | null {
  const allReses = parseDatReses(datText);
  if (allReses.length === 0) return null;
  const selected = selectHighlightReses(allReses, maxReses);
  if (selected.length === 0) return null;
  return selected.map((r) => `${r.number}: ${r.bodyLines.join("\n")}`).join("\n\n");
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
  /** スレ選別のレス数下限（拡張E39 A2）。既定は env `FIVECH_MIN_RES_COUNT`（既定20）。 */
  minResCount?: number;
  /** subject/dat連続取得の間のディレイ(ms)（拡張E39 B1）。既定は env `FIVECH_REQUEST_DELAY_MS`（既定1500）。 */
  delayMs?: number;
  /** ディレイの実処理の注入点（テスト用）。既定は実 setTimeout ベースの sleep。 */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * 5ch の subject.txt→対象スレ絞り込み→dat取得→スレッドダンプ整形、を行う live アダプタ。
 * 板が実質未設定（既定にも解決できない）・取得失敗はすべて例外を投げず空配列＋スキップログにする。
 * 拡張E39: dat/subjectの連続取得はディレイ付き・直列（板もスレも）で行い、板ごとの取得件数を
 * console.log でログする（可観測性）。
 */
export class FiveChAdapter implements SourceAdapter {
  readonly sourceType = "5ch" as const;
  private readonly boards: FiveChBoard[];
  private readonly userAgent: string;
  private readonly now: () => Date;
  private readonly keywords: string[];
  private readonly maxThreadsPerBoard: number;
  private readonly maxResesPerThread: number;
  private readonly minResCount: number;
  private readonly delayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** 実行全体で最初のfetchかどうか（最初のfetch前はディレイ不要のため）。 */
  private firstFetchDone = false;
  /**
   * リファクタリングS4（F-S4-1）: fetchMetrics用のsubject.txtキャッシュ（同板の複数スレを
   * 1取得で賄うため、アダプタインスタンス生存中は板ごとに1回だけ取得する）。
   */
  private readonly subjectCache = new Map<string, SubjectEntry[]>();

  constructor(options: FiveChAdapterOptions = {}) {
    const boardsRaw = process.env.FIVECH_BOARDS;
    this.boards = options.boards ?? parseBoards(boardsRaw && boardsRaw.trim().length > 0 ? boardsRaw : DEFAULT_BOARDS_RAW);
    this.userAgent = options.userAgent ?? process.env.FIVECH_USER_AGENT ?? DEFAULT_USER_AGENT;
    this.now = options.now ?? (() => new Date());
    this.keywords = options.keywords ?? getDefaultSourceConfigs()["5ch"].relevance.keywords;
    this.maxThreadsPerBoard = options.maxThreadsPerBoard ?? MAX_THREADS_PER_BOARD;
    this.maxResesPerThread = options.maxResesPerThread ?? MAX_RESES_PER_THREAD;
    this.minResCount = options.minResCount ?? envIntLocal("FIVECH_MIN_RES_COUNT", DEFAULT_MIN_RES_COUNT);
    this.delayMs = options.delayMs ?? envIntLocal("FIVECH_REQUEST_DELAY_MS", DEFAULT_REQUEST_DELAY_MS);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** 取得(fetch)の直前に呼ぶ。実行全体で最初の1回だけディレイを省く（他はdelayMs待ってから進める）。 */
  private async waitBeforeFetch(): Promise<void> {
    if (this.firstFetchDone) {
      await this.sleep(this.delayMs);
    } else {
      this.firstFetchDone = true;
    }
  }

  private async fetchBoardItems(boardConf: FiveChBoard): Promise<RawCollectionItem[]> {
    const now = this.now();
    const boardLabel = `${boardConf.server}/${boardConf.board}`;
    await this.waitBeforeFetch();
    const subjectText = await fetchShiftJisTextSafe(
      buildSubjectUrl(boardConf.server, boardConf.board),
      { headers: { "User-Agent": this.userAgent } },
      { logLabel: "5ch", context: `${boardLabel} subject.txt` },
    );
    if (!subjectText) {
      console.log(`[5ch] board=${boardLabel} skip: subject取得失敗`);
      return [];
    }

    const entries = parseSubjectText(subjectText);
    const qualifiedCount = matchKeywordThreads(entries, this.keywords).filter(
      (e) => e.resCount >= this.minResCount,
    ).length;
    const relevant = filterRelevantThreads(entries, this.keywords, this.maxThreadsPerBoard, this.minResCount);

    const items: RawCollectionItem[] = [];
    for (const entry of relevant) {
      await this.waitBeforeFetch();
      const datText = await fetchShiftJisTextSafe(
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
        // リファクタリングS2（F-S2-1）: Post永続化用メタ。5chはupvote概念が無いためscore=0固定、
        // 勢いはコメント数(resCount)の時系列で見る。
        externalId: `${boardConf.server}/${boardConf.board}/${entry.threadId}`,
        commentCount: entry.resCount,
        score: 0,
      });
    }
    console.log(
      `[5ch] board=${boardLabel} subject=${entries.length} relevant=${qualifiedCount} selected=${relevant.length} collected=${items.length}`,
    );
    return items;
  }

  async fetchItems(): Promise<RawCollectionItem[]> {
    if (this.boards.length === 0) {
      console.log("[5ch] FIVECH_BOARDS が無効なため5ch収集をスキップします");
      return [];
    }
    // 板取得は完全並列(Promise.all)ではなく直列にする（同一サーバへの同時多重接続を避ける。拡張E39 B1）。
    const perBoardResults: RawCollectionItem[][] = [];
    for (const board of this.boards) {
      perBoardResults.push(await this.fetchBoardItems(board));
    }
    const collected = dedupeBySourceUrl(perBoardResults.flat());
    console.log(`[5ch] 収集完了 collected=${collected.length}`);
    return collected;
  }

  /** subject.txtを取得しパースする（板ごとに1回だけ・キャッシュ）。取得失敗は null。 */
  private async getSubjectEntriesForMetrics(server: string, board: string): Promise<SubjectEntry[] | null> {
    const key = `${server}/${board}`;
    const cached = this.subjectCache.get(key);
    if (cached) return cached;
    const subjectText = await fetchShiftJisTextSafe(
      buildSubjectUrl(server, board),
      { headers: { "User-Agent": this.userAgent } },
      { logLabel: "5ch", context: `${key} subject.txt(metrics)` },
    );
    if (!subjectText) return null;
    const entries = parseSubjectText(subjectText);
    this.subjectCache.set(key, entries);
    return entries;
  }

  /**
   * リファクタリングS4（F-S4-1）: 対象板のsubject.txtからスレのレス数を再取得する
   * （score:0固定、commentCount:resCount）。板が復元できない/取得失敗/スレ無しは null。
   */
  async fetchMetrics(externalId: string): Promise<{ score: number; commentCount: number } | null> {
    const parsed = parseFiveChExternalId(externalId);
    if (!parsed) return null;
    const entries = await this.getSubjectEntriesForMetrics(parsed.server, parsed.board);
    if (!entries) return null;
    const entry = entries.find((e) => e.threadId === parsed.threadId);
    if (!entry) return null;
    return { score: 0, commentCount: entry.resCount };
  }
}
