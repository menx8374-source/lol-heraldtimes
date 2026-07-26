/**
 * 記事本文の構成組み立て（F7）。LLMClient経由でリライト文を取得しつつ、
 * ソース種別による構成分岐を適用する。
 * - 掲示板/Reddit（5ch/reddit）: AI要約段落を持たず、「反応まとめ」見出し＋収集したスレッドの
 *   レス群を番号付きレスとして逐語のまま並べるだけの「レス羅列中心」構成（2026-07-25 ユーザー決定の
 *   記事フォーマット改修。同日の追加改修でAI導入/まとめ段落を除去しさらにシンプル化）。
 * - Riot公式（riot）: 「事実の速報＋要点整理」構成（従来どおり、引用ブロックは主従関係を保つ）。
 */
import type {
  ArticleBodyBlock,
  ArticleBodyEmbedBlock,
  ArticleBodyEmphasisColor,
  ArticleBodyReactionBlock,
} from "@/lib/article-body";
import type { SourceType } from "@/lib/collection/types";
import type { LLMClient, GenerationTask } from "@/lib/generation/llm-client";
import { splitIntoSentences, excerptForQuote } from "@/lib/generation/text-utils";
import { parseThreadReses, extractAnchors, computeLineEmphasis, type ThreadRes } from "@/lib/generation/thread-format";
import { isAllowedEmbedUrl, embedProviderForUrl } from "@/lib/embed";
import { findNgWord } from "@/lib/moderation/ng-words";
import { PATCH_NOTES_MIN_LENGTH } from "@/lib/collection/adapters/riot-datadragon";
import { CHAMPIONS } from "@/lib/generation/title";
import { isSafeImageUrl } from "@/lib/image-url";

export type GenerationCandidateInput = {
  sourceType: SourceType;
  title: string;
  content: string;
  /** riot由来の公式パッチノートリンクにのみ使う出典URL（それ以外のソース種別では未使用）。 */
  sourceUrl?: string;
  /** riot由来（拡張E42）: 公式パッチノートのメイン画像URL（og:image）。安全なhttps URLのみ本文冒頭の画像ブロックに使う。 */
  imageUrl?: string | null;
};

/** レス投稿者の匿名化ハンドル（実名・個人特定情報は出さない）。ソース種別ごとに固定。 */
const REACTION_HANDLE: Record<"5ch" | "reddit", string> = {
  "5ch": "国内プレイヤーさん",
  reddit: "海外プレイヤーさん",
};

/** 1記事あたりの反応レス抜粋の上限件数（拡張E25 F-E25-1、超過分は先頭優先で切る）。 */
const MAX_EXCERPT_RESES = 12;

/**
 * LLMによるレス抜粋・強調選定の正規化結果（拡張E28で行抽出、拡張E32で強調色に対応）。
 * keepLines: 採用したレスindex → 残す行indexの配列（元順・昇順）。null は「そのレス全行を採用」。
 * emphasize: 強調するレスindex → 色（"red"|"blue"|"purple"|"orange"、拡張E36で緑を廃止し紫を追加）
 * または null（色無しの従来強調）。
 */
type ReactionSelection = {
  keepLines: Map<number, number[] | null>;
  emphasize: Map<number, ArticleBodyEmphasisColor | null>;
};

/**
 * LLMが返した `{keep, emphasize}` 生JSON値を防御的に検証・正規化する純関数（拡張E25 F-E25-1）。
 * 範囲外・非整数・重複を除去し、上限件数(MAX_EXCERPT_RESES)超過分は先頭優先で切る。
 * emphasize は必ず keep の部分集合に丸める。keep が1件も残らない場合は null（＝呼び出し側で
 * 「全レス・強調なし」にフォールバックさせる）を返す。
 */
/**
 * LLMの生出力から最初のJSONオブジェクト（`{ ... }`）部分だけを取り出す（拡張E26）。
 * ```json ... ``` のコードフェンスや前後の説明文が付いていてもparseできるようにする。
 * `{`が無い/`}`が先行するなど不正な場合は null。
 */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + 1);
}

/**
 * keep の1要素（number または {index, lines?}）から、レスindexと生の lines 指定を取り出す。
 * どちらの形にも一致しなければ null（呼び出し側で無視する）。
 */
function parseKeepEntry(entry: unknown): { index: unknown; rawLines: unknown } | null {
  if (typeof entry === "number") return { index: entry, rawLines: undefined };
  if (typeof entry === "object" && entry !== null) {
    const e = entry as Record<string, unknown>;
    return { index: e.index, rawLines: e.lines };
  }
  return null;
}

/** 強調色として許可する値の集合（拡張E32、おばにゅー流。拡張E36で緑を廃止し紫を追加）。 */
const ALLOWED_EMPHASIS_COLORS = new Set<ArticleBodyEmphasisColor>(["red", "blue", "purple", "orange"]);

/**
 * emphasize の1要素（number または {index, color?}）から、レスindexと生の color 指定を取り出す。
 * どちらの形にも一致しなければ null（呼び出し側で無視する）。number（従来形式）は色無しとして扱う。
 */
function parseEmphasizeEntry(entry: unknown): { index: unknown; rawColor: unknown } | null {
  if (typeof entry === "number") return { index: entry, rawColor: undefined };
  if (typeof entry === "object" && entry !== null) {
    const e = entry as Record<string, unknown>;
    return { index: e.index, rawColor: e.color };
  }
  return null;
}

function normalizeReactionSelection(raw: unknown, reses: ThreadRes[]): ReactionSelection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.keep)) return null;

  const resCount = reses.length;
  const isValidIndex = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 && n < resCount;

  const keepLines = new Map<number, number[] | null>();
  for (const rawEntry of obj.keep) {
    const parsed = parseKeepEntry(rawEntry);
    if (!parsed || !isValidIndex(parsed.index) || keepLines.has(parsed.index)) continue;
    if (keepLines.size >= MAX_EXCERPT_RESES) continue;

    const lineCount = reses[parsed.index].lines.length;
    const isValidLine = (n: unknown): n is number =>
      typeof n === "number" && Number.isInteger(n) && n >= 0 && n < lineCount;

    let normalizedLines: number[] | null = null;
    if (Array.isArray(parsed.rawLines)) {
      const dedupedLines: number[] = [];
      const seenLines = new Set<number>();
      for (const ln of parsed.rawLines) {
        if (!isValidLine(ln) || seenLines.has(ln)) continue;
        seenLines.add(ln);
        dedupedLines.push(ln);
      }
      dedupedLines.sort((a, b) => a - b); // 元の行順を維持
      // 空/全て不正な行指定は「そのレスは全行採用」に丸める。
      normalizedLines = dedupedLines.length > 0 ? dedupedLines : null;
    }
    keepLines.set(parsed.index, normalizedLines);
  }
  if (keepLines.size === 0) return null;

  const rawEmphasize = Array.isArray(obj.emphasize) ? obj.emphasize : [];
  const emphasize = new Map<number, ArticleBodyEmphasisColor | null>();
  for (const rawEntry of rawEmphasize) {
    const parsed = parseEmphasizeEntry(rawEntry);
    if (!parsed || !isValidIndex(parsed.index) || !keepLines.has(parsed.index)) continue;
    const color =
      typeof parsed.rawColor === "string" && ALLOWED_EMPHASIS_COLORS.has(parsed.rawColor as ArticleBodyEmphasisColor)
        ? (parsed.rawColor as ArticleBodyEmphasisColor)
        : null;
    emphasize.set(parsed.index, color);
  }

  return { keepLines, emphasize };
}

/**
 * LLMに「話題に関係する重要なレスの抜粋」と「そのうち特に強調すべきレス」を選ばせる（拡張E25 F-E25-1）。
 * レス本文は書き換えさせず、選定インデックスのみをJSONで返させる。APIエラー・JSON parse失敗・
 * 検証不通過など、うまく選定できない場合は例外を投げずに null を返す（呼び出し側が全レス・強調なしに
 * フォールバックする）。
 */
async function selectReactionReses(
  llmClient: LLMClient,
  title: string,
  reses: ThreadRes[],
): Promise<ReactionSelection | null> {
  if (reses.length === 0) return null;
  try {
    const task: GenerationTask = {
      kind: "reaction-select",
      title,
      reses: reses.map((r, index) => ({ index, number: r.number, lines: r.lines })),
    };
    const raw = await llmClient.generate([
      {
        role: "system",
        content:
          "あなたはLoLまとめサイトの編集者です。渡されたスレッドのレス一覧(title=記事の話題, " +
          "reses=各レスのindex/number/lines[行配列])から、記事としてまとめるレスを厳選してください。" +
          "5chスレは複数の話題に脱線しがちです。まずスレ全体で最も反応・議論が集まっている1つの" +
          "中心的な話題を見極め、それに沿ったレスだけを選んでください（話題を1つに絞ること）。" +
          "次のようなレスは中心話題に無関係なので必ず除外してください: 別の話題への脱線、" +
          "別チャンピオンや別のゲームシステムについての雑談、独立した別の質問(例:「〜のおすすめは？」" +
          "「〜って誰かいる？」)、スレのルール文・テンプレ(「!extend」「次スレは>>950」" +
          "「配信者やプロの話題禁止」等の定型・運営文)。" +
          "互いに>>Nで参照し合い会話としてつながっているレスは、中心話題の議論である可能性が高いため" +
          "優先して選んでください。無理に多く選ぶ必要はありません。少数でも話題が一貫している方を" +
          "優先してください。" +
          "レス本文・行は書き換えず、渡された中からindexを選ぶだけです。長いレスは、記事の話題に沿った行だけを" +
          "残すために対象レスの lines のうち残す行indexを指定できます（指定しなければそのレスの全行を採用）。" +
          '出力はJSONのみとし、{"keep": [index または {"index": N, "lines": [行index,...]}, ...], ' +
          '"emphasize": [index または {"index": N, "color": "red"|"blue"|"purple"|"orange"}, ...]} の形式に' +
          "してください（説明文・前置き・コードブロックは付けない）。" +
          "keepは厳選した重要レスのindex（全行採用ならindexの数値のまま、行を絞る場合はオブジェクト形式）、" +
          "emphasizeはkeepの中でも特に注目・重要なレスのindexです。おばにゅー流に色(red=最重要/否定的な反応、" +
          "blue=注目/肯定的な反応、purple=補足的な反応、orange=ネタ・ユーモラスな反応 等)を割り当ててよい" +
          "（色は任意、無くても構わない）。",
      },
      { role: "user", content: JSON.stringify(task) },
    ]);
    if (!raw || raw.trim().length === 0) return null;
    // Haiku等が ```json ... ``` のコードフェンスや前置きを付けることがあるため、
    // 最初の { から最後の } までを取り出してからparseする（拡張E26で頑健化）。
    const jsonStr = extractJsonObject(raw);
    if (!jsonStr) return null;
    const parsed: unknown = JSON.parse(jsonStr);
    return normalizeReactionSelection(parsed, reses);
  } catch {
    return null;
  }
}

/** レス翻訳（reaction-translate、拡張E47 F-E47-1）の system 指示。捏造禁止・行数厳密一致をここで固定する。 */
const REACTION_TRANSLATE_SYSTEM_PROMPT =
  "あなたはLoLまとめサイトの翻訳担当です。渡された各レスの行（英語）を自然な日本語に訳してください。" +
  "行数・順序は入力と厳密に一致させてください（1行に1行で対応）。LoL用語（チャンピオン名・レーン・" +
  "BAN/ピック等）は一般的な日本語表記にしてください。意味を変えない・要約しない・増やさないでください。" +
  '出力はJSONのみとし、{"translations": [{"index": N, "lines": ["日本語行", ...]}, ...]} の形式に' +
  "してください（説明文・前置き・コードブロックは付けない）。";

/**
 * LLMが返した `{translations:[{index,lines}]}` 生JSON値を検証・正規化する純関数（拡張E47 F-E47-1、
 * 拡張E49 F-E49-2で行数厳密一致の要件を緩和）。index が入力に実在し、lines が非空文字列の配列
 * （各要素が空でない文字列）であれば採用する。行数が原文と一致するかどうかはここでは問わない
 * （一致判定・不一致時の1行への束ね組み立ては呼び出し側の `buildReactionBlocks` が行う）。
 * 上位の `translateReactionLines` が最終的に null を返すかどうかを判断できるよう、ここでは
 * （空も含め）Map を返す。
 */
function normalizeTranslations(
  raw: unknown,
  reses: { index: number; lines: string[] }[],
): Map<number, string[]> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.translations)) return null;

  const validIndices = new Set(reses.map((r) => r.index));
  const result = new Map<number, string[]>();
  for (const rawEntry of obj.translations) {
    if (typeof rawEntry !== "object" || rawEntry === null) continue;
    const e = rawEntry as Record<string, unknown>;
    const index = e.index;
    if (typeof index !== "number" || !Number.isInteger(index) || !validIndices.has(index)) continue;
    if (result.has(index)) continue;
    if (!Array.isArray(e.lines) || e.lines.length === 0) continue;
    if (!e.lines.every((l): l is string => typeof l === "string" && l.trim().length > 0)) continue;
    result.set(index, e.lines as string[]);
  }
  return result;
}

/**
 * 1回のLLM呼び出しに渡すレスのバッチサイズ（既定件数、拡張E49 F-E49-1）。env
 * `REDDIT_TRANSLATE_BATCH_SIZE` で上書き可能（不正値・未設定は既定値）。
 */
const DEFAULT_REDDIT_TRANSLATE_BATCH_SIZE = 6;
function redditTranslateBatchSize(): number {
  const raw = Number(process.env.REDDIT_TRANSLATE_BATCH_SIZE);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_REDDIT_TRANSLATE_BATCH_SIZE;
}

/** 1バッチあたりの合計文字数の安全上限（拡張E49 F-E49-1、件数上限とは別に長文レスが混ざる場合の保険）。 */
const REDDIT_TRANSLATE_BATCH_CHAR_LIMIT = 3000;

/**
 * 表示対象レスを、件数（`redditTranslateBatchSize()`件ごと）と合計文字数（`REDDIT_TRANSLATE_BATCH_CHAR_LIMIT`）
 * の両方の安全上限でバッチに分割する（拡張E49 F-E49-1）。1記事分の全レスを1回のLLM呼び出しでまとめて
 * 送ると出力JSONが大きくなり途中で切れてparse不能になりやすいため、バッチ単位に分けることで
 * 「あるバッチの失敗が記事全体を英語にする」事態を避ける。1件だけでバッチサイズ・文字数上限を
 * 超える場合でもそのレス単独のバッチにする（無限ループ・空バッチにはしない）。
 */
function splitIntoTranslateBatches(
  reses: { index: number; lines: string[] }[],
): { index: number; lines: string[] }[][] {
  const batchSize = redditTranslateBatchSize();
  const batches: { index: number; lines: string[] }[][] = [];
  let current: { index: number; lines: string[] }[] = [];
  let currentChars = 0;

  for (const res of reses) {
    const resChars = res.lines.reduce((sum, l) => sum + l.length, 0);
    if (
      current.length > 0 &&
      (current.length >= batchSize || currentChars + resChars > REDDIT_TRANSLATE_BATCH_CHAR_LIMIT)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(res);
    currentChars += resChars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * 1バッチ分のレス行をLLMに翻訳させる（拡張E49 F-E49-1、旧 translateReactionLines の単発実装を
 * バッチ単位に切り出したもの）。失敗（APIエラー・空応答・parse不能・不正形式）時は例外を投げず
 * null を返す（呼び出し側がそのバッチのレスだけ英語原文フォールバックする）。
 */
async function translateReactionBatch(
  llmClient: LLMClient,
  batch: { index: number; lines: string[] }[],
): Promise<Map<number, string[]> | null> {
  try {
    const task: GenerationTask = { kind: "reaction-translate", reses: batch };
    const raw = await llmClient.generate([
      { role: "system", content: REACTION_TRANSLATE_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(task) },
    ]);
    if (!raw || raw.trim().length === 0) return null;
    const jsonStr = extractJsonObject(raw);
    if (!jsonStr) return null;
    const parsed: unknown = JSON.parse(jsonStr);
    return normalizeTranslations(parsed, batch);
  } catch {
    return null;
  }
}

/**
 * reddit反応記事の表示対象レス行（英語）をLLMで日本語訳する（拡張E47 F-E47-1、拡張E49 F-E49-1で
 * バッチ分割に変更）。全レスを1回でまとめて送らず、`splitIntoTranslateBatches` で分割したバッチ
 * ごとに個別translateし、結果のMapをマージして返す。あるバッチが失敗（null）しても他バッチの
 * 訳はそのまま活かす（そのバッチのレスだけ呼び出し側で英語原文フォールバックになる＝記事まるごと
 * 英語にしない）。全レスが空配列の場合のみ null を返す。
 */
async function translateReactionLines(
  llmClient: LLMClient,
  reses: { index: number; lines: string[] }[],
): Promise<Map<number, string[]> | null> {
  if (reses.length === 0) return null;
  const batches = splitIntoTranslateBatches(reses);
  const merged = new Map<number, string[]>();
  for (const batch of batches) {
    const result = await translateReactionBatch(llmClient, batch);
    if (!result) continue; // このバッチのレスだけ訳が欠け、呼び出し側が英語フォールバックする
    for (const [index, lines] of result) merged.set(index, lines);
  }
  return merged;
}

/**
 * LLMの話題関連レス選定（selectReactionReses）が null を返したときのフォールバックとして使う純関数
 * （拡張E43 F-E43-2）。スレは複数の話題に脱線しがちなため、収集した全レスをそのまま出すと中心話題と
 * 無関係な独立レス（別質問・別話題の脱線）が混入する。代わりに `>>N` アンカーで双方向連結した
 * 「会話クラスタ（連結成分）」を求め、最も会話が集まっている最大クラスタのレスindexだけを返す。
 * - 各レスの `>>N`（reses に実在する番号のみ、自己参照は無視）を双方向の辺とみなし連結成分を作る
 *   （union-find）。
 * - 最大サイズの連結成分を採用。同サイズは「クラスタ内の被参照延べ回数が多い→クラスタ内最小レス番号が
 *   小さい」の順で決定論的に選ぶ。
 * - スレ内に有効な `>>N` アンカーが1つも無い（＝全レスが連結成分サイズ1）場合のみ、最後の保険として
 *   全レスを採用する。
 * - 採用レスは元スレ順（レス番号ではなく元の配列index昇順、＝reses自体が元スレ順）で並べ、
 *   `MAX_EXCERPT_RESES` を超える分は先頭優先で切る。
 */
export function selectMajorConversationCluster(reses: ThreadRes[]): number[] {
  const n = reses.length;
  if (n === 0) return [];
  const numberToIndex = new Map(reses.map((r, i) => [r.number, i]));

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // 各レスindexが、他のレスから >>N で参照された延べ回数（同サイズクラスタのタイブレークに使う）。
  const referencedCount = new Array<number>(n).fill(0);
  let hasAnchoredPair = false;
  reses.forEach((res, i) => {
    for (const anchorNumber of extractAnchors(res.lines)) {
      const anchorIndex = numberToIndex.get(anchorNumber);
      if (anchorIndex === undefined || anchorIndex === i) continue;
      hasAnchoredPair = true;
      union(i, anchorIndex);
      referencedCount[anchorIndex]++;
    }
  });

  if (!hasAnchoredPair) {
    // アンカーが全く無いスレ（会話クラスタが作れない）は、最後の保険として全レスを採用する。
    return reses.map((_, i) => i).slice(0, MAX_EXCERPT_RESES);
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(i);
    else clusters.set(root, [i]);
  }

  let best: number[] = [];
  let bestReferenced = -1;
  let bestMinNumber = Infinity;
  for (const members of clusters.values()) {
    const totalReferenced = members.reduce((sum, idx) => sum + referencedCount[idx], 0);
    const minNumber = Math.min(...members.map((idx) => reses[idx].number));
    const isBetter =
      members.length > best.length ||
      (members.length === best.length && totalReferenced > bestReferenced) ||
      (members.length === best.length && totalReferenced === bestReferenced && minNumber < bestMinNumber);
    if (isBetter) {
      best = members;
      bestReferenced = totalReferenced;
      bestMinNumber = minNumber;
    }
  }

  return best
    .slice()
    .sort((a, b) => a - b)
    .slice(0, MAX_EXCERPT_RESES);
}

/** 拡張E33 F-E33-1: 色付き強調の最低保証で使う色の割り当て順（red→blue→purple→orange、拡張E36で緑を廃止）。 */
const MIN_COLOR_FALLBACK_COLORS: ArticleBodyEmphasisColor[] = ["red", "blue", "purple", "orange"];

/** レス1件分の表示本文の総文字数（行テキストの合計）。長いレス優先の判定に使う。 */
function reactionBlockCharCount(block: ArticleBodyReactionBlock): number {
  return block.lines.reduce((sum, l) => sum + l.text.length, 0);
}

/**
 * 反応ブロックが2件以上あるのにLLM/mockがどのレスにも強調を付けなかった場合、決定論的に
 * 一部を色付き強調にする最低保証（拡張E33 F-E33-1）。1件でも既にemphasis/emphasisColorが
 * 付いている記事はLLMの編集判断を尊重しそのまま返す。本文・行・レス選定・逐語テキストは
 * 一切変更せず、表示上の強調フラグ・色のみを付加する。
 */
function applyMinColorFallback(blocks: ArticleBodyReactionBlock[]): ArticleBodyReactionBlock[] {
  if (blocks.length < 2) return blocks;
  if (blocks.some((b) => b.emphasis || b.emphasisColor)) return blocks;

  const minColored = Math.max(1, Math.round(blocks.length / 4));
  const ranked = blocks
    .map((b, index) => ({ index, charCount: reactionBlockCharCount(b) }))
    .sort((a, b) => b.charCount - a.charCount || a.index - b.index)
    .slice(0, minColored);

  const colorByIndex = new Map<number, ArticleBodyEmphasisColor>();
  ranked.forEach((r, i) => colorByIndex.set(r.index, MIN_COLOR_FALLBACK_COLORS[i % MIN_COLOR_FALLBACK_COLORS.length]));

  return blocks.map((b, index) => {
    const color = colorByIndex.get(index);
    return color ? { ...b, emphasis: true, emphasisColor: color } : b;
  });
}

/**
 * 行テキストのうち、NGワード（findNgWord）を含む文（splitIntoSentencesで分割した1文単位）だけを
 * 削除し、残りの文をそのまま結合して返す（拡張E36 F-E36-3、伏字(*)化からの置き換え）。
 * NGワードを含まない文は一切書き換えない（逐語維持）。全ての文がNGで削除された場合は空文字列を
 * 返す（呼び出し側でその行を落とす判断に使う）。
 */
function removeNgSentences(text: string): string {
  return splitIntoSentences(text)
    .filter((sentence) => findNgWord(sentence) === null)
    .join("");
}

/**
 * レス1件分の表示行（ArticleBodyReactionLine[]）を、抽出行（英語/日本語の逐語）と翻訳結果（reddit時のみ、
 * 無ければnull）から組み立てる（拡張E47 F-E47-1、拡張E49 F-E49-2で行数不一致時の束ね組み立てに対応）。
 * - 訳があり行数が原文(extractedLines)と一致 → 従来どおり行単位。text=日本語訳、original=英語原文。
 * - 訳があるが行数が不一致 → 訳を捨てず、そのレスを1行に束ねる。text=日本語訳を改行結合、
 *   original=英語原文を改行結合（逐語併記は維持）。
 * - 訳が全く無い（5ch・reddit翻訳失敗） → 抽出行そのまま（originalなし、英語原文フォールバック）。
 * いずれの場合もNGワードを含む文はremoveNgSentencesで削除し、削除後に空になった行は落とす
 * （束ねた行がNGで空になれば、そのレスは戻り値が空配列になり呼び出し側で不掲載になる）。
 * 強調(computeLineEmphasis)は表示テキスト（訳があれば日本語）に対して判定する。
 */
function buildReactionDisplayLines(
  extractedLines: string[],
  translatedLines: string[] | null,
): ArticleBodyReactionBlock["lines"] {
  if (translatedLines && translatedLines.length === extractedLines.length) {
    const emphasis = computeLineEmphasis(translatedLines);
    const lines: ArticleBodyReactionBlock["lines"] = [];
    translatedLines.forEach((jaText, li) => {
      const cleanedText = removeNgSentences(jaText);
      if (cleanedText.length === 0) return;
      lines.push({
        text: cleanedText,
        ...(emphasis[li] ? { emphasis: emphasis[li] } : {}),
        original: extractedLines[li],
      });
    });
    return lines;
  }

  if (translatedLines && translatedLines.length > 0) {
    // 行数不一致: 訳を捨てず1つのまとまった行に束ねる（訳文・原文をそれぞれ改行結合）。NG文削除は
    // 束ねる前の各行に対して行う（removeNgSentencesは文を"."で連結し直すため、先に改行結合してしまうと
    // 行の区切りが失われる）。全行がNGで消えた場合のみこのレス自体を落とす（従来どおり）。
    const cleanedJaLines = translatedLines.map((l) => removeNgSentences(l)).filter((l) => l.length > 0);
    if (cleanedJaLines.length === 0) return [];
    const bundledJa = cleanedJaLines.join("\n");
    const bundledEn = extractedLines.join("\n");
    const emphasis = computeLineEmphasis(cleanedJaLines);
    const emphasisValue = emphasis.find((e) => e !== undefined);
    return [{ text: bundledJa, ...(emphasisValue ? { emphasis: emphasisValue } : {}), original: bundledEn }];
  }

  // 訳が全く無い（5ch・reddit翻訳失敗）: 抽出行そのまま（originalなし、英語原文フォールバック）。
  const emphasis = computeLineEmphasis(extractedLines);
  const lines: ArticleBodyReactionBlock["lines"] = [];
  extractedLines.forEach((rawText, li) => {
    const cleanedText = removeNgSentences(rawText);
    if (cleanedText.length === 0) return;
    lines.push({ text: cleanedText, ...(emphasis[li] ? { emphasis: emphasis[li] } : {}) });
  });
  return lines;
}

/**
 * スレッドの content（逐語）を、まとめ速報のレス（reaction）ブロック配列に組み立てる。
 * レス番号・本文行は逐語のまま保持し、重要行の強調・アンカーの妥当性(既出番号のみ)だけを付加する。
 * 拡張E25 F-E25-1: LLMに話題関連レスの抜粋・重要レスの強調選定を委ね、選定できた場合は
 * keepインデックスのレスだけを元スレ順で組み、emphasizeインデックスのレスにブロック単位の
 * 強調フラグを立てる。選定できない場合（mockモード・APIエラー・parse失敗・keep空等）は
 * 全レスではなく、`>>N`アンカーで連結した会話クラスタのうち最大のものだけを採用する
 * （selectMajorConversationCluster、拡張E43 F-E43-2。アンカーが全く無いスレのみ全レス・強調なしで
 * 組む。本体を止めない）。
 * 拡張E32: emphasizeに色(red/blue/purple/orange、拡張E36で緑を廃止し紫を追加)が指定されていれば
 * emphasisColor も付与する（任意・後方互換）。
 * 拡張E36 F-E36-3: 本文行にNGワードが含まれる場合、伏字化（拡張E27）ではなく該当する文（1文単位）
 * だけを removeNgSentences で削除する。削除後に空になった行は落とし、レスの全行が空になった
 * （＝NG文を除くと何も残らない＝意味が通らない）場合は、そのレス自体を反応ブロックに含めない
 * （moderateArticleContent の ng_word 保留を避けて公開する意図は維持しつつ、逐語＋伏字なしにする）。
 * 拡張E33: 反応ブロックが2件以上あるのにどのレスにも強調が付かない場合は、決定論フォールバック
 * （applyMinColorFallback）で最低限の色付き強調を補い、全黒字の記事が出ないようにする。
 * 拡張E41 F-E41-1: 選ばれた表示レスが実際に表示する行（keepLines指定があればその行、なければ全行）に
 * `>>N` アンカーを含み、参照先Nが reses に存在し未選択なら、文脈としてそのレスも表示に追加する
 * （全行・強調なし。追加した文脈レスがさらに参照する先は辿らない＝1階層のみ）。追加後は元スレ順
 * （index昇順）に整列してから組む。
 * 拡張E49 F-E49-2: reddit翻訳の行数がレス原文と不一致でも訳を捨てず、そのレスを1行に束ねて採用する
 * （buildReactionDisplayLines参照）。訳が全く無いレスのみ英語原文フォールバックにする。
 */
async function buildReactionBlocks(
  candidate: GenerationCandidateInput,
  sourceType: "5ch" | "reddit",
  llmClient: LLMClient,
): Promise<ArticleBodyReactionBlock[]> {
  const reses = parseThreadReses(candidate.content);
  const name = REACTION_HANDLE[sourceType];
  const knownNumbers = new Set(reses.map((r) => r.number));
  const numberToIndex = new Map(reses.map((r, i) => [r.number, i]));

  const selection = await selectReactionReses(llmClient, candidate.title, reses);
  // LLM選定が失敗した場合（null）、拡張E43以前は「全レス無制限」にフォールバックしており、
  // 話題バラバラの無関係レスが全部出てしまっていた。拡張E43 F-E43-2で、代わりに>>Nアンカーで
  // 連結した会話クラスタのうち最大のもの（＝そのスレで最も会話が集まっている中心的な議論）だけを
  // 採用するようにする（selectMajorConversationCluster）。
  const baseIndices = selection
    ? reses.map((_, i) => i).filter((i) => selection.keepLines.has(i))
    : selectMajorConversationCluster(reses);

  // 表示レスが実際に表示する行から>>Nアンカーを集め、参照先Nが存在し未選択なら文脈として追加する
  // （1階層のみ＝baseIndicesの行だけを見る。追加した文脈レス自体の参照先は辿らない）。
  const baseIndexSet = new Set(baseIndices);
  const contextIndices = new Set<number>();
  for (const i of baseIndices) {
    const res = reses[i];
    const lineIndices = selection?.keepLines.get(i) ?? null;
    const displayedLines = lineIndices ? lineIndices.map((li) => res.lines[li]) : res.lines;
    for (const anchorNumber of extractAnchors(displayedLines)) {
      const anchorIndex = numberToIndex.get(anchorNumber);
      if (anchorIndex === undefined || baseIndexSet.has(anchorIndex)) continue;
      contextIndices.add(anchorIndex);
    }
  }
  const selectedIndices = [...baseIndices, ...contextIndices].sort((a, b) => a - b);

  // 表示対象レスの実表示行（keepLines適用後、英語のまま）を先に確定しておく（翻訳バッチ・強調判定・
  // NG削除のいずれもこの行配列を起点にする）。
  const extractedLinesByIndex = new Map<number, string[]>(
    selectedIndices.map((i) => {
      const lineIndices = selection?.keepLines.get(i) ?? null;
      return [i, lineIndices ? lineIndices.map((li) => reses[i].lines[li]) : reses[i].lines];
    }),
  );

  // 拡張E47 F-E47-1/F-E47-2、拡張E49 F-E49-1: reddit のときだけ、表示対象レスの行（英語）を
  // バッチ分割して日本語訳する（1記事分をまとめて1回で送ると出力JSONが途中で切れやすいため）。
  // 5ch では呼ばない（追加LLM呼び出しゼロ・逐語不変）。あるバッチの翻訳が失敗した場合、そのバッチの
  // レスだけ英語原文フォールバックになる（他バッチの訳は活かす。本体を止めない）。
  let translations: Map<number, string[]> | null = null;
  if (sourceType === "reddit" && selectedIndices.length > 0) {
    const toTranslate = selectedIndices.map((i) => ({ index: i, lines: extractedLinesByIndex.get(i)! }));
    translations = await translateReactionLines(llmClient, toTranslate);
  }

  const blocks = selectedIndices
    .map((i): ArticleBodyReactionBlock | null => {
      const res = reses[i];
      // 行indexの指定があれば元 res.lines からその行だけを逐語のまま抽出する（拡張E28 F-E28-2）。
      // 指定なし（null＝全行採用、または選定自体が無いフォールバック）はres.linesをそのまま使う。
      const extractedLines = extractedLinesByIndex.get(i)!;
      const translatedLines = translations?.get(i) ?? null;
      const anchors = extractAnchors(extractedLines).filter((n) => n !== res.number && knownNumbers.has(n));
      const isEmphasized = selection ? selection.emphasize.has(i) : false;
      const emphasisColor = isEmphasized ? (selection!.emphasize.get(i) ?? null) : null;

      // 拡張E49 F-E49-2: 訳の行数が原文と一致すれば行単位、不一致なら1行に束ねて採用する（訳を捨てない）。
      // 訳が全く無いレスのみ抽出行そのまま（英語原文フォールバック）。NG削除・強調は表示テキスト
      // （訳があれば日本語）に適用する（buildReactionDisplayLines内）。
      const cleanedLines = buildReactionDisplayLines(extractedLines, translatedLines);
      if (cleanedLines.length === 0) return null;

      return {
        type: "reaction",
        number: res.number,
        name,
        lines: cleanedLines,
        ...(anchors.length > 0 ? { anchors } : {}),
        ...(isEmphasized ? { emphasis: true } : {}),
        ...(emphasisColor ? { emphasisColor } : {}),
      };
    })
    .filter((b): b is ArticleBodyReactionBlock => b !== null);

  return applyMinColorFallback(blocks);
}

/** 1記事あたりの検出クリップembedの上限（過剰な埋め込みを防ぐ、拡張E22）。 */
const MAX_DETECTED_EMBEDS = 3;

/** 本文テキスト中のURLらしき部分を検出する簡易正規表現（空白・全角句読点・閉じ括弧類までを1URLとみなす）。 */
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'）】」』、。！？]+/g;

/** 文末に紛れ込みがちな半角句読点を取り除く（例: "https://youtu.be/ID." → "https://youtu.be/ID"）。 */
function stripTrailingPunctuation(url: string): string {
  return url.replace(/[.,!?;:]+$/, "");
}

/**
 * 反応記事（5ch/reddit）の本文テキストから、埋め込み許可URL（YouTube/Twitchクリップ）を検出し
 * embedブロックを組み立てる（F-E22-1）。provider判定・許可URL検証は embedProviderForUrl +
 * isAllowedEmbedUrl を必ず経由する（新たにホスト判定は書かない）。twitter(X)は本スプリントの
 * 実iframe対象外のため検出しない。重複排除・最大 MAX_DETECTED_EMBEDS 件まで。0件なら空配列。
 */
function detectClipEmbedBlocks(content: string): ArticleBodyEmbedBlock[] {
  const found = content.match(URL_IN_TEXT_RE) ?? [];
  const seen = new Set<string>();
  const blocks: ArticleBodyEmbedBlock[] = [];
  for (const raw of found) {
    if (blocks.length >= MAX_DETECTED_EMBEDS) break;
    const url = stripTrailingPunctuation(raw);
    if (seen.has(url)) continue;
    const provider = embedProviderForUrl(url);
    if (provider !== "youtube" && provider !== "clip") continue;
    if (!isAllowedEmbedUrl(provider, url)) continue;
    seen.add(url);
    blocks.push({ type: "embed", provider, url });
  }
  return blocks;
}

/** 引用ブロックの出典ラベル（ArticleSourceのlabelとは別に、本文中の引用元表記に使う）。 */
const QUOTE_SOURCE_LABEL: Record<SourceType, string> = {
  "5ch": "5chの反応",
  reddit: "Redditの反応",
  riot: "Riot公式",
};

async function askLLM(llmClient: LLMClient, task: GenerationTask): Promise<string> {
  const text = await llmClient.generate([
    {
      role: "system",
      content: "あなたはLoLまとめサイトのリライト担当です。出力は日本語の1〜2文のみにしてください。",
    },
    { role: "user", content: JSON.stringify(task) },
  ]);
  return text.trim();
}

/**
 * LLMに要約させる「公式パッチノートまとめ」の正規化結果（拡張E34 F-E34-2）。
 * buffed: 主な強化チャンピオン、nerfed: 主な弱体チャンピオン、other: アイテム・その他の変更。
 * 各要素は本文に実在する変更点の要約文字列（捏造禁止はsystemプロンプトで担保する）。
 */
type PatchSummary = { buffed: string[]; nerfed: string[]; other: string[] };

/**
 * パッチノート要約LLMへのsystem指示。捏造禁止・出力形式(JSON)をここで固定する。
 * 拡張E35 F-E35-2: 渡す本文がページ全体のダンプ（ナビ・日付・eスポーツ告知・関連記事・Wiki導線等の
 * ノイズを多く含む）であることを明示し、それらを無視してチャンピオン/アイテムの数値変更だけを
 * 拾わせることでノイズ断片の誤要約・破綻を防ぐ。
 */
const PATCH_SUMMARY_SYSTEM_PROMPT =
  "あなたはLoLまとめサイトの編集者です。次に渡す本文は公式パッチノートページ全体のテキストダンプで、" +
  "ナビゲーションメニュー・見出しメタ情報・日付やタイムスタンプ・eスポーツ大会の告知・関連記事へのリンク・" +
  "Wikiへの導線など、パッチの変更内容とは無関係なノイズを多く含みます。それらのノイズは無視し、" +
  "チャンピオン名や能力・ステータスの数値変更（強化・弱体化・アイテム調整）だけを本文中から拾って" +
  "日本語で簡潔に要約してください。本文に記載の無い数値・調整・チャンピオン名を作ってはいけません" +
  "(捏造禁止)。可能な場合は「チャンピオン名: 変更前 ⇒ 変更後」のように簡潔にまとめてください。" +
  "出力はJSONのみとし、" +
  '{"buffed": ["強化されたチャンピオンの要約", ...], "nerfed": ["弱体化されたチャンピオンの要約", ...], ' +
  '"other": ["アイテムやその他の変更の要約", ...]} の形式にしてください。' +
  "変更内容が明確に読み取れないカテゴリは無理に埋めず空配列にしてください" +
  "（ノイズの断片を変更点として拾わないこと。捏造禁止）。" +
  "説明文・前置き・コードブロックは付けないでください。";

/** LLMが返した配列値を検証済みの文字列配列に正規化する（空文字・非文字列は除く）。 */
function normalizePatchSummaryItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
}

/** LLMの生出力（JSON、コードフェンス付きの可能性あり）をPatchSummaryに検証・正規化する。 */
function parsePatchSummary(raw: string): PatchSummary | null {
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const summary: PatchSummary = {
      buffed: normalizePatchSummaryItems(parsed.buffed),
      nerfed: normalizePatchSummaryItems(parsed.nerfed),
      other: normalizePatchSummaryItems(parsed.other),
    };
    if (summary.buffed.length === 0 && summary.nerfed.length === 0 && summary.other.length === 0) {
      return null;
    }
    return summary;
  } catch {
    return null;
  }
}

/**
 * riot由来のcontentが実パッチノート本文（PATCH_NOTES_MIN_LENGTH以上）のとき、LLMに要約させて
 * 「主な強化/弱体チャンピオン」「アイテム・その他の変更」の見出し＋要約段落からなる本文ブロックを
 * 組み立てる（拡張E34 F-E34-2）。LLMが使えない（mock・APIエラー・空応答）・JSON解析失敗・
 * 全カテゴリ空（＝要約できなかった）場合は例外を投げず null を返し、呼び出し側が従来の
 * 汎用パッチ記事（composeFactBody）にフォールバックする（本体を止めない）。
 */
async function composePatchSummaryBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[] | null> {
  try {
    const raw = await llmClient.generate([
      { role: "system", content: PATCH_SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ title: candidate.title, content: candidate.content }) },
    ]);
    if (typeof raw !== "string" || raw.trim().length === 0) return null;
    const summary = parsePatchSummary(raw);
    if (!summary) return null;

    const blocks: ArticleBodyBlock[] = [];
    if (summary.buffed.length > 0) {
      blocks.push({ type: "heading", text: "主な強化チャンピオン" });
      for (const item of summary.buffed) blocks.push({ type: "paragraph", text: item });
    }
    if (summary.nerfed.length > 0) {
      blocks.push({ type: "heading", text: "主な弱体チャンピオン" });
      for (const item of summary.nerfed) blocks.push({ type: "paragraph", text: item });
    }
    if (summary.other.length > 0) {
      blocks.push({ type: "heading", text: "アイテム・その他の変更" });
      for (const item of summary.other) blocks.push({ type: "paragraph", text: item });
    }
    return blocks;
  } catch {
    return null;
  }
}

/**
 * candidate の title / sourceUrl から表示用のパッチ番号（例 "26.14"）らしき文字列を抽出する
 * （拡張E35 F-E35-3）。buildPatchItem のタイトルは「【パッチ】26.14 の主な変更点まとめ」のように
 * 常に "数字.数字" 形式の番号を含むためそれを優先し、見つからなければ出典URL（buildPatchNoteUrl形式:
 * .../league-of-legends-patch-26-14-notes）からも抽出を試みる。どちらからも取れない場合は null
 * （呼び出し側が汎用ラベルにフォールバックする）。
 */
function extractPatchNumberLabel(candidate: GenerationCandidateInput): string | null {
  const fromTitle = candidate.title.match(/\d+\.\d+/);
  if (fromTitle) return fromTitle[0];
  const fromUrl = candidate.sourceUrl?.match(/patch-(\d+)-(\d+)-notes/);
  if (fromUrl) return `${fromUrl[1]}.${fromUrl[2]}`;
  return null;
}

/** 出典URLがボタンリンクに使える安全なhttps URLか（javascript:等の危険スキームを弾く）。 */
function isHttpsUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/**
 * riot（パッチ）記事を「事実速報」として組み立てる（拡張E41 F-E41-2、既定モード）。
 * LLMを使わず（factモードはLLM非依存・呼び出し増なし）、次の構成にする（拡張E42 F-E42-4）:
 * 1. `candidate.imageUrl` が安全なhttps画像URLなら先頭に公式パッチノートのメイン画像ブロック
 *    （出典クレジット併記＝hotlink表示、ローカル保存はしない）。
 * 2. 見出し「パッチ<番号>が公開」。
 * 3. 一般的な事実段落（具体的な数値・チャンピオン名は書かない＝捏造禁止）。
 * 4. 出典URLが安全なhttpsなら大きく目立つ公式リンクボタン（linkButton）。
 * 謝罪文言（「自動要約では抽出できなかった」等）は入れない。
 */
function composePatchFactFlashBody(candidate: GenerationCandidateInput): ArticleBodyBlock[] {
  const patchNumber = extractPatchNumberLabel(candidate);
  const label = patchNumber ? `パッチ${patchNumber}` : "新しいパッチ";
  const sourceUrl = candidate.sourceUrl?.trim();
  const blocks: ArticleBodyBlock[] = [];

  if (isSafeImageUrl(candidate.imageUrl)) {
    blocks.push({
      type: "image",
      url: candidate.imageUrl,
      alt: `${label} 公式パッチノートのメイン画像`,
      credit: "画像: Riot Games 公式パッチノートより",
    });
  }

  blocks.push({ type: "heading", text: `${label}が公開` });
  blocks.push({
    type: "paragraph",
    text:
      `リーグ・オブ・レジェンドの${label}が公開されました。チャンピオンやアイテムのバランス調整が` +
      "行われています。詳しい変更内容は公式パッチノートをご確認ください。",
  });
  blocks.push({
    type: "paragraph",
    text:
      "パッチノートでは、チャンピオンやアイテムの数値調整のほか、必要に応じてバグ修正や新機能・" +
      "イベントの告知が行われることもあります。対戦に影響のある変更を見逃さないよう、プレイ前に" +
      "公式サイトの発表内容へ一度目を通しておくとよいでしょう。",
  });
  blocks.push({
    type: "paragraph",
    text:
      "パッチの適用によって環境（メタ）が変化することもあるため、ランク戦などの対戦に挑む前に、" +
      "今回のアップデート内容を把握しておくことをおすすめします。",
  });

  if (sourceUrl && isHttpsUrl(sourceUrl)) {
    blocks.push({ type: "linkButton", url: sourceUrl, label: `▶ ${label} 公式パッチノートを読む` });
  } else {
    blocks.push({
      type: "paragraph",
      text: "出典: Riot Games 公式サイトのパッチノートページをご確認ください。",
    });
  }

  return blocks;
}

/**
 * composePatchSummaryBody が要約できなかった（LLM要約失敗）ときの、ノイズ断片・逐文リライトを
 * 含まないクリーンな簡易パッチ記事（拡張E35 F-E35-3）。パッチノート本文（ページ全体ダンプでノイズ込み）
 * を composeFactBody に渡すと "14 Notes" 等のページ内ノイズ断片や「情報が不足…」等のLLM破綻文が
 * 引用として並んでしまうため、composeFactBodyへは一切フォールバックせず、見出し＋定型段落＋出典URLの
 * みで構成する（本文に無い具体的な変更点は書かない＝捏造禁止）。
 */
function composeCleanPatchFallbackBody(candidate: GenerationCandidateInput): ArticleBodyBlock[] {
  const patchNumber = extractPatchNumberLabel(candidate);
  const label = patchNumber ? `パッチ${patchNumber}` : "今回のパッチ";
  const sourceUrl = candidate.sourceUrl?.trim();
  return [
    { type: "heading", text: `${label}の変更点` },
    {
      type: "paragraph",
      text:
        `${label}が公開されました。今回のアップデートでは、複数のチャンピオンやアイテムの` +
        "バランス調整が行われています。強化・弱体化された具体的なチャンピオン名や数値の変更内容は、" +
        "自動要約では正確に抽出できなかったため、詳細は下記の公式パッチノートで直接ご確認ください。",
    },
    {
      type: "paragraph",
      text:
        "パッチノートには対戦バランスに関わるチャンピオンの能力値やコストの調整に加え、必要に応じて" +
        "バグ修正や新機能・イベントの告知が含まれることもあります。プレイに影響する変更を見逃さないよう、" +
        "対戦前に公式サイトの発表内容へ一度目を通しておくことをおすすめします。",
    },
    {
      type: "paragraph",
      text: sourceUrl
        ? `出典: ${sourceUrl}`
        : "出典: Riot Games 公式サイトのパッチノートページをご確認ください。",
    },
  ];
}

/**
 * 決定的（逐語）抽出したチャンピオン別の変更点（拡張E40 F-E40-2）。
 * `changes` は本文の部分文字列そのもの（新規に文字列を組み立てない＝捏造しない）。
 */
export type PatchChampionChanges = { champion: string; changes: string[] };

/** チャンピオン節・変更行の有界化（読みやすさ・トークン節約）。 */
const MAX_PATCH_CHAMPIONS = 12;
const MAX_CHANGES_PER_CHAMPION = 5;

/**
 * 変更後の値が次行に割れた場合に連結してよい最大行数（拡張E40b）。
 * 実データの `stripHtmlToText` 出力では「：2 ⇒」で行が終わり、変更後の値（例「2.5」）が
 * 次の1行に単独で来るケースが多い。稀に値がさらに割れる場合に備えて2行まで許容する。
 */
const MAX_VALUE_CONTINUATION_LINES = 2;

/** 行が「⇒」を含み、かつ矢印の直後（行末まで）が空白のみ＝変更後の値がその行に無いか判定する。 */
function arrowTrailingIsEmpty(line: string): boolean {
  const idx = line.lastIndexOf("⇒");
  if (idx === -1) return false;
  return line.slice(idx + 1).trim().length === 0;
}

/**
 * 「⇒」で終わった行の続き（変更後の値）とみなせる行か判定する。実データでは変更後の値は
 * 数値・スラッシュ区切りの複数値・小数点・%等の短い断片であることが多く、新しいチャンピオン名や
 * 項目ラベル（漢字・カタカナ主体の文）とは区別できる。行内に「⇒」を含む（＝別の新しい変更行）場合は
 * 続きとみなさない。
 */
const VALUE_CONTINUATION_RE = /^[0-9][0-9./%\-+\s]*$/;
function looksLikeValueContinuation(line: string): boolean {
  return line.length <= 20 && VALUE_CONTINUATION_RE.test(line);
}

/**
 * 公式パッチノート本文（テキストダンプ）から、チャンピオン別の変更点をLLMを使わず決定的・逐語で
 * 抽出する純関数（拡張E40 F-E40-2、拡張E40bで値分割の復元に対応）。単独行がチャンピオン名
 * （`title.ts` の `CHAMPIONS`）と完全一致する行を節の開始とみなし、節内で「⇒」を含む行（値変更
 * マーカー）をその章の変更点として集める。直前の非空行（スキル名/項目名。それ自体が「⇒」を含む
 * 変更行やチャンピオン名でない場合のみ）を文脈として前置する。
 * 拡張E40b: 実データの `stripHtmlToText` 出力では「レベルアップごとの攻撃力\n：2 ⇒\n2.5」のように
 * 変更後の値が次行以降に割れることがある。矢印の直後（行末まで）が空の場合は、後続の非空行のうち
 * 「値の続きらしい短い行」を最大 `MAX_VALUE_CONTINUATION_LINES` 行まで連結して復元する（次の
 * チャンピオン節・次の項目ラベルに達したらそこで止める）。連結後も値が空のまま（＝本当に値が
 * 無い異常系）の場合は、矢印だけの不完全な行を残さずその変更点自体を捨てる。
 * チャンピオン最大 `MAX_PATCH_CHAMPIONS` 体・1体あたり変更行最大 `MAX_CHANGES_PER_CHAMPION` 行に
 * 有界化する。変更点が1件も取れなければ null を返す。連結はすべて本文の行をそのまま繋ぐだけで、
 * 新しい数値・文言を作らない（逐語維持・捏造禁止）。「⇒」を含まないノイズ行（intro/クレジット/
 * TFT導線等）は変更点として拾わない。
 */
export function extractPatchChangesDeterministic(text: string): PatchChampionChanges[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const champions: PatchChampionChanges[] = [];
  let current: PatchChampionChanges | null = null;
  let prevLine = "";

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if ((CHAMPIONS as readonly string[]).includes(line)) {
      current = champions.length < MAX_PATCH_CHAMPIONS ? { champion: line, changes: [] } : null;
      if (current) champions.push(current);
      prevLine = line;
      i++;
      continue;
    }

    if (current && line.includes("⇒") && current.changes.length < MAX_CHANGES_PER_CHAMPION) {
      // 矢印の直後(行末まで)が空なら、後続の非空行から変更後の値を連結して復元する（拡張E40b）。
      let combined = line;
      let consumed = 0;
      while (arrowTrailingIsEmpty(combined) && consumed < MAX_VALUE_CONTINUATION_LINES) {
        const nextLine = lines[i + 1 + consumed];
        if (nextLine === undefined) break;
        if ((CHAMPIONS as readonly string[]).includes(nextLine)) break; // 次のチャンピオン節に到達
        if (!looksLikeValueContinuation(nextLine)) break; // 次の項目ラベル等が来たらそこで止める
        combined = `${combined} ${nextLine}`;
        consumed++;
      }

      // 連結後も値が空のまま（本当に値が無い異常系）なら、矢印だけの不完全な行を残さず捨てる。
      if (!arrowTrailingIsEmpty(combined)) {
        const hasUsableContext =
          prevLine.length > 0 && prevLine !== current.champion && !prevLine.includes("⇒");
        current.changes.push(hasUsableContext ? `${prevLine} ${combined}` : combined);
      }

      prevLine = lines[i + consumed];
      i += 1 + consumed;
      continue;
    }

    prevLine = line;
    i++;
  }

  const withChanges = champions.filter((c) => c.changes.length > 0);
  return withChanges.length > 0 ? withChanges : null;
}

/**
 * extractPatchChangesDeterministic の抽出結果から本文ブロックを組み立てる（拡張E40 F-E40-2）。
 * 見出し「主な変更点（公式パッチノートより）」＋チャンピオンごとの見出し＋変更点段落（逐語）。
 */
function composeDeterministicPatchChangesBody(
  changes: PatchChampionChanges[],
): ArticleBodyBlock[] {
  const blocks: ArticleBodyBlock[] = [{ type: "heading", text: "主な変更点（公式パッチノートより）" }];
  for (const c of changes) {
    blocks.push({ type: "heading", text: c.champion });
    for (const change of c.changes) {
      blocks.push({ type: "paragraph", text: change });
    }
  }
  return blocks;
}

/** Riot公式（riot）由来: 「速報＋要点整理」構成（従来どおり）。 */
const FACT_PROFILE = {
  introHeading: "速報",
  itemsHeading: "要点整理",
  summaryTask: (sentence: string, index: number): GenerationTask => ({ kind: "fact-summary", sentence, index }),
};

/** Riot公式向けの共通骨格（導入→要点整理ループ→context→まとめ）で本文ブロックを組み立てる。 */
async function composeFactBody(
  candidate: GenerationCandidateInput,
  sentences: string[],
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  const { sourceType, title } = candidate;
  const blocks: ArticleBodyBlock[] = [];
  const citationLabel = QUOTE_SOURCE_LABEL[sourceType];

  blocks.push({ type: "heading", text: FACT_PROFILE.introHeading });
  blocks.push({ type: "paragraph", text: await askLLM(llmClient, { kind: "intro", sourceType, title }) });

  blocks.push({ type: "heading", text: FACT_PROFILE.itemsHeading });
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    blocks.push({ type: "paragraph", text: await askLLM(llmClient, FACT_PROFILE.summaryTask(sentence, i)) });
    blocks.push({ type: "quote", text: excerptForQuote(sentence), source: citationLabel });
  }

  blocks.push({ type: "paragraph", text: await askLLM(llmClient, { kind: "context", sourceType, title }) });

  blocks.push({ type: "heading", text: "まとめ" });
  blocks.push({ type: "paragraph", text: await askLLM(llmClient, { kind: "closing", sourceType, title }) });

  return blocks;
}

/**
 * 掲示板/Reddit（5ch/reddit）由来: 「まとめ速報レス形式」で本文ブロックを組み立てる。
 * AI要約段落は付けず、「反応まとめ」見出し＋スレッドのレス群を逐語のまま並べた reaction ブロックのみで
 * 構成する（2026-07-25 ユーザー決定: レスの羅列中心のシンプルなまとめ構成への改修）。
 * さらにレス本文中に埋め込み許可URL（YouTube/Twitchクリップ）があれば、逐語テキストはそのまま保持しつつ
 * embedブロックを加算する（拡張E22 F-E22-1。0件なら従来どおり何も足さない）。
 */
async function composeReactionBody(
  candidate: GenerationCandidateInput,
  sourceType: "5ch" | "reddit",
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  const blocks: ArticleBodyBlock[] = [];

  blocks.push({ type: "heading", text: "反応まとめ" });
  blocks.push(...(await buildReactionBlocks(candidate, sourceType, llmClient)));
  blocks.push(...detectClipEmbedBlocks(candidate.content));

  return blocks;
}

/**
 * env `PATCH_ARTICLE_MODE` によるriot（パッチ）記事の構成モード切替（拡張E41 F-E41-2）。
 * "summary" のみ従来のE40 3段（LLM要約→決定的抽出→クリーン定型）を使い、それ以外（未設定含む）は
 * 既定の "fact"（事実速報、LLM不使用）にする。後でLLMまとめに戻す可能性があるため、summaryモードの
 * コード・テストは削除せず残す。
 */
function patchArticleMode(): "fact" | "summary" {
  return process.env.PATCH_ARTICLE_MODE === "summary" ? "summary" : "fact";
}

/**
 * 記事化候補から構造化された本文ブロック配列を組み立てる（F7）。
 * sourceType が "riot" なら、既定(env `PATCH_ARTICLE_MODE`未設定/"fact")では本文の長短に関わらず
 * 事実速報（拡張E41 F-E41-2）。"summary" なら従来のE40の3段（LLM要約のまとめ記事→決定的抽出→
 * クリーン定型フォールバック、contentが短い汎用文なら速報＋要点整理）。それ以外（5ch/reddit）なら
 * まとめ速報レス形式にする。
 */
export async function composeArticleBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  if (candidate.sourceType === "riot") {
    if (patchArticleMode() === "fact") {
      return composePatchFactFlashBody(candidate);
    }
    // "summary"モード: 従来どおり、content が実パッチノート本文（汎用の短いcontentではない）と
    // みなせるときのみLLM要約を試みる。
    if (candidate.content.length >= PATCH_NOTES_MIN_LENGTH) {
      const patchSummaryBody = await composePatchSummaryBody(candidate, llmClient);
      if (patchSummaryBody) return patchSummaryBody;
      // 要約失敗（mock・APIエラー・解析失敗・全カテゴリ空等）時は、まずLLM非依存の決定的（逐語）抽出
      // （拡張E40 F-E40-2）を試みる。「⇒」を含む変更行がチャンピオン節から取れれば、ノイズ断片・
      // 破綻文を含まない「主な変更点」本文をそのまま採用する（捏造無しの実用的な本文になる）。
      const deterministicChanges = extractPatchChangesDeterministic(candidate.content);
      console.log(`[patch] deterministic changes champions=${deterministicChanges?.length ?? 0}`);
      if (deterministicChanges) return composeDeterministicPatchChangesBody(deterministicChanges);
      // 決定的抽出も空（本文が取れていない可能性）の場合のみ、パッチノート本文
      // （ページ全体ダンプでノイズ込み）を composeFactBody（逐文リライト）には渡さず、
      // ノイズ断片・破綻文を含まないクリーンな簡易パッチ記事にする（拡張E35 F-E35-3）。
      return composeCleanPatchFallbackBody(candidate);
    }
    // 本文が無い（短い汎用content）の場合は従来どおり速報＋要点整理（composeFactBody）でよい。
    const sentences = splitIntoSentences(candidate.content);
    return composeFactBody(candidate, sentences, llmClient);
  }
  return composeReactionBody(candidate, candidate.sourceType, llmClient);
}
