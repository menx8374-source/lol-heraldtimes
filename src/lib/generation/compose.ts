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
import { splitIntoSentences, excerptForQuote, gistOf } from "@/lib/generation/text-utils";
import { parseThreadReses, extractAnchors, computeLineEmphasis, type ThreadRes } from "@/lib/generation/thread-format";
import { isAllowedEmbedUrl, embedProviderForUrl } from "@/lib/embed";
import { maskNgWords } from "@/lib/moderation/ng-words";
import { PATCH_NOTES_MIN_LENGTH } from "@/lib/collection/adapters/riot-datadragon";

export type GenerationCandidateInput = {
  sourceType: SourceType;
  title: string;
  content: string;
  /** clip由来の埋め込みブロック構築にのみ使う出典URL（それ以外のソース種別では未使用）。 */
  sourceUrl?: string;
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
 * emphasize: 強調するレスindex → 色（"red"|"blue"|"green"）または null（色無しの従来強調）。
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

/** 強調色として許可する値の集合（拡張E32、おばにゅー流の赤/青/緑）。 */
const ALLOWED_EMPHASIS_COLORS = new Set<ArticleBodyEmphasisColor>(["red", "blue", "green"]);

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
          "reses=各レスのindex/number/lines[行配列])の中から、記事の話題に関係する重要なレスだけを厳選してください。" +
          "スレのルール文・テンプレ(「!extend」「次スレは>>950」「配信者やプロの話題禁止」等の定型・運営文)、" +
          "単なる雑談、記事の話題に無関係なレスは除外し、話題の中心となる反応・意見・議論・感想があるレスだけを" +
          "選んでください（無理に多く選ぶ必要はありません）。" +
          "レス本文・行は書き換えず、渡された中からindexを選ぶだけです。長いレスは、記事の話題に沿った行だけを" +
          "残すために対象レスの lines のうち残す行indexを指定できます（指定しなければそのレスの全行を採用）。" +
          '出力はJSONのみとし、{"keep": [index または {"index": N, "lines": [行index,...]}, ...], ' +
          '"emphasize": [index または {"index": N, "color": "red"|"blue"|"green"}, ...]} の形式にしてください' +
          "（説明文・前置き・コードブロックは付けない）。" +
          "keepは厳選した重要レスのindex（全行採用ならindexの数値のまま、行を絞る場合はオブジェクト形式）、" +
          "emphasizeはkeepの中でも特に注目・重要なレスのindexです。おばにゅー流に色(red=最重要/否定的な反応、" +
          "blue=注目/肯定的な反応、green=補足的な反応 等)を割り当ててよい（色は任意、無くても構わない）。",
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

/** 拡張E33 F-E33-1: 色付き強調の最低保証で使う色の割り当て順（red→blue→green）。 */
const MIN_COLOR_FALLBACK_COLORS: ArticleBodyEmphasisColor[] = ["red", "blue", "green"];

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
 * スレッドの content（逐語）を、まとめ速報のレス（reaction）ブロック配列に組み立てる。
 * レス番号・本文行は逐語のまま保持し、重要行の強調・アンカーの妥当性(既出番号のみ)だけを付加する。
 * 拡張E25 F-E25-1: LLMに話題関連レスの抜粋・重要レスの強調選定を委ね、選定できた場合は
 * keepインデックスのレスだけを元スレ順で組み、emphasizeインデックスのレスにブロック単位の
 * 強調フラグを立てる。選定できない場合（mockモード・APIエラー・parse失敗・keep空等）は
 * 従来どおり全レス・強調なしで組む（本体を止めない）。
 * 拡張E32: emphasizeに色(red/blue/green)が指定されていれば emphasisColor も付与する（任意・後方互換）。
 * 拡張E27: 本文行にNGワードが含まれる場合は maskNgWords で同数のアスタリスクに伏字化する
 * （逐語は保つがNG語だけ伏字にし、moderateArticleContent の ng_word 保留を避けて公開する）。
 * 拡張E33: 反応ブロックが2件以上あるのにどのレスにも強調が付かない場合は、決定論フォールバック
 * （applyMinColorFallback）で最低限の色付き強調を補い、全黒字の記事が出ないようにする。
 */
async function buildReactionBlocks(
  candidate: GenerationCandidateInput,
  sourceType: "5ch" | "reddit",
  llmClient: LLMClient,
): Promise<ArticleBodyReactionBlock[]> {
  const reses = parseThreadReses(candidate.content);
  const name = REACTION_HANDLE[sourceType];
  const knownNumbers = new Set(reses.map((r) => r.number));

  const selection = await selectReactionReses(llmClient, candidate.title, reses);
  const selectedIndices = selection
    ? reses.map((_, i) => i).filter((i) => selection.keepLines.has(i))
    : reses.map((_, i) => i);

  const blocks = selectedIndices.map((i) => {
    const res = reses[i];
    // 行indexの指定があれば元 res.lines からその行だけを逐語のまま抽出する（拡張E28 F-E28-2）。
    // 指定なし（null＝全行採用、または選定自体が無いフォールバック）はres.linesをそのまま使う。
    const lineIndices = selection?.keepLines.get(i) ?? null;
    const extractedLines = lineIndices ? lineIndices.map((li) => res.lines[li]) : res.lines;
    const emphasis = computeLineEmphasis(extractedLines);
    const anchors = extractAnchors(extractedLines).filter((n) => n !== res.number && knownNumbers.has(n));
    const isEmphasized = selection ? selection.emphasize.has(i) : false;
    const emphasisColor = isEmphasized ? (selection!.emphasize.get(i) ?? null) : null;
    return {
      type: "reaction",
      number: res.number,
      name,
      lines: extractedLines.map((rawText, li) => {
        // 逐語転載を保ちつつNGワードのみ伏字化する（拡張E27）。他の文字列は一切書き換えない。
        const text = maskNgWords(rawText);
        return emphasis[li] ? { text, emphasis: emphasis[li] } : { text };
      }),
      ...(anchors.length > 0 ? { anchors } : {}),
      ...(isEmphasized ? { emphasis: true } : {}),
      ...(emphasisColor ? { emphasisColor } : {}),
    } satisfies ArticleBodyReactionBlock;
  });

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
  clip: "クリップ紹介",
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

/** パッチノート要約LLMへのsystem指示。捏造禁止・出力形式(JSON)をここで固定する。 */
const PATCH_SUMMARY_SYSTEM_PROMPT =
  "あなたはLoLまとめサイトの編集者です。次に渡す公式パッチノート本文(全文)から、実際に本文に" +
  "書かれている変更点だけを日本語で簡潔に要約してください。本文に記載の無い数値・調整・チャンピオン名を" +
  "作ってはいけません(捏造禁止)。可能な場合は「チャンピオン名: 変更前 ⇒ 変更後」のように簡潔にまとめて" +
  "ください。出力はJSONのみとし、" +
  '{"buffed": ["強化されたチャンピオンの要約", ...], "nerfed": ["弱体化されたチャンピオンの要約", ...], ' +
  '"other": ["アイテムやその他の変更の要約", ...]} の形式にしてください。' +
  "該当する変更が本文に無いカテゴリは空配列にしてください（無理に埋めない）。" +
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
 * clip由来（拡張E17）: 「埋め込み紹介」形式。見出し＋短い紹介文（askLLM）＋embedブロックのみで構成する
 * （逐語転載ではなく紹介＋埋め込みなので、他ソースのような300字下限・逐語一致率・引用比率は課さない。
 * 代わりに generate-article.ts 側で「embedブロックが必ず1件あること」を最低条件にする）。
 */
async function composeClipBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  const blocks: ArticleBodyBlock[] = [];
  blocks.push({ type: "heading", text: "注目クリップ" });
  blocks.push({
    type: "paragraph",
    text: await askLLM(llmClient, {
      kind: "clip-intro",
      title: candidate.title,
      hint: gistOf(candidate.content, 60),
    }),
  });

  const sourceUrl = candidate.sourceUrl ?? "";
  const provider = sourceUrl ? embedProviderForUrl(sourceUrl) : null;
  if (provider && isAllowedEmbedUrl(provider, sourceUrl)) {
    blocks.push({ type: "embed", provider, url: sourceUrl });
  }

  return blocks;
}

/**
 * 記事化候補から構造化された本文ブロック配列を組み立てる（F7）。
 * sourceType が "riot" なら速報＋要点整理（contentが実パッチノート本文ならLLM要約のまとめ記事、
 * 拡張E34 F-E34-2）、"clip" なら埋め込み紹介形式、それ以外（5ch/reddit）ならまとめ速報レス形式にする。
 */
export async function composeArticleBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  if (candidate.sourceType === "riot") {
    // content が実パッチノート本文（汎用の短いcontentではない）とみなせるときのみLLM要約を試み、
    // 失敗（mock・APIエラー・解析失敗等）した場合は従来の速報＋要点整理にフォールバックする。
    if (candidate.content.length >= PATCH_NOTES_MIN_LENGTH) {
      const patchSummaryBody = await composePatchSummaryBody(candidate, llmClient);
      if (patchSummaryBody) return patchSummaryBody;
    }
    const sentences = splitIntoSentences(candidate.content);
    return composeFactBody(candidate, sentences, llmClient);
  }
  if (candidate.sourceType === "clip") {
    return composeClipBody(candidate, llmClient);
  }
  return composeReactionBody(candidate, candidate.sourceType, llmClient);
}
