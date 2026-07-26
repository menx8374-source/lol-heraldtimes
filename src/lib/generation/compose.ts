/**
 * 記事本文の構成組み立て（F7）。LLMClient経由でリライト文を取得しつつ、
 * ソース種別による構成分岐を適用する。
 * - 掲示板/Reddit（5ch/reddit）: AI要約段落を持たず、「反応まとめ」見出し＋収集したスレッドの
 *   レス群を番号付きレスとして逐語のまま並べるだけの「レス羅列中心」構成（2026-07-25 ユーザー決定の
 *   記事フォーマット改修。同日の追加改修でAI導入/まとめ段落を除去しさらにシンプル化）。
 * - Riot公式（riot）: 「事実の速報＋要点整理」構成（従来どおり、引用ブロックは主従関係を保つ）。
 */
import type { ArticleBodyBlock, ArticleBodyEmbedBlock, ArticleBodyReactionBlock } from "@/lib/article-body";
import type { SourceType } from "@/lib/collection/types";
import type { LLMClient, GenerationTask } from "@/lib/generation/llm-client";
import { splitIntoSentences, excerptForQuote, gistOf } from "@/lib/generation/text-utils";
import { parseThreadReses, extractAnchors, computeLineEmphasis, type ThreadRes } from "@/lib/generation/thread-format";
import { isAllowedEmbedUrl, embedProviderForUrl } from "@/lib/embed";

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

/** LLMによるレス抜粋・強調選定の正規化結果（0始まりindexの集合）。 */
type ReactionSelection = { keepIndices: Set<number>; emphasizeIndices: Set<number> };

/**
 * LLMが返した `{keep, emphasize}` 生JSON値を防御的に検証・正規化する純関数（拡張E25 F-E25-1）。
 * 範囲外・非整数・重複を除去し、上限件数(MAX_EXCERPT_RESES)超過分は先頭優先で切る。
 * emphasize は必ず keep の部分集合に丸める。keep が1件も残らない場合は null（＝呼び出し側で
 * 「全レス・強調なし」にフォールバックさせる）を返す。
 */
function normalizeReactionSelection(raw: unknown, resCount: number): ReactionSelection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.keep)) return null;

  const isValidIndex = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 && n < resCount;

  const dedupedKeep: number[] = [];
  const seenKeep = new Set<number>();
  for (const n of obj.keep) {
    if (!isValidIndex(n) || seenKeep.has(n)) continue;
    seenKeep.add(n);
    dedupedKeep.push(n);
  }
  if (dedupedKeep.length === 0) return null;

  const keepIndices = new Set(dedupedKeep.slice(0, MAX_EXCERPT_RESES));

  const rawEmphasize = Array.isArray(obj.emphasize) ? obj.emphasize : [];
  const emphasizeIndices = new Set<number>();
  for (const n of rawEmphasize) {
    if (isValidIndex(n) && keepIndices.has(n)) emphasizeIndices.add(n);
  }

  return { keepIndices, emphasizeIndices };
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
      reses: reses.map((r, index) => ({ index, number: r.number, text: r.lines.join(" ") })),
    };
    const raw = await llmClient.generate([
      {
        role: "system",
        content:
          "あなたはLoLまとめサイトの編集者です。渡されたスレッドのレス一覧(title=記事の話題, " +
          "reses=各レスのindex/number/text)の中から、記事の話題に関係する重要なレスだけを選んでください。" +
          "レス本文は書き換えず、渡された中から選ぶだけです。" +
          '出力はJSONのみとし、{"keep": [index,...], "emphasize": [index,...]} の形式にしてください' +
          "（説明文・前置き・コードブロックは付けない）。keepは話題に関係する重要なレスのindex、" +
          "emphasizeはkeepの中でも特に重要なレスのindexです。",
      },
      { role: "user", content: JSON.stringify(task) },
    ]);
    if (!raw || raw.trim().length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return normalizeReactionSelection(parsed, reses.length);
  } catch {
    return null;
  }
}

/**
 * スレッドの content（逐語）を、まとめ速報のレス（reaction）ブロック配列に組み立てる。
 * レス番号・本文行は逐語のまま保持し、重要行の強調・アンカーの妥当性(既出番号のみ)だけを付加する。
 * 拡張E25 F-E25-1: LLMに話題関連レスの抜粋・重要レスの強調選定を委ね、選定できた場合は
 * keepインデックスのレスだけを元スレ順で組み、emphasizeインデックスのレスにブロック単位の
 * 強調フラグを立てる。選定できない場合（mockモード・APIエラー・parse失敗・keep空等）は
 * 従来どおり全レス・強調なしで組む（本体を止めない）。
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
    ? reses.map((_, i) => i).filter((i) => selection.keepIndices.has(i))
    : reses.map((_, i) => i);

  return selectedIndices.map((i) => {
    const res = reses[i];
    const emphasis = computeLineEmphasis(res.lines);
    const anchors = extractAnchors(res.lines).filter((n) => n !== res.number && knownNumbers.has(n));
    const isEmphasized = selection ? selection.emphasizeIndices.has(i) : false;
    return {
      type: "reaction",
      number: res.number,
      name,
      lines: res.lines.map((text, li) => (emphasis[li] ? { text, emphasis: emphasis[li] } : { text })),
      ...(anchors.length > 0 ? { anchors } : {}),
      ...(isEmphasized ? { emphasis: true } : {}),
    };
  });
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
 * sourceType が "riot" なら速報＋要点整理、"clip" なら埋め込み紹介形式、
 * それ以外（5ch/reddit）ならまとめ速報レス形式にする。
 */
export async function composeArticleBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  if (candidate.sourceType === "riot") {
    const sentences = splitIntoSentences(candidate.content);
    return composeFactBody(candidate, sentences, llmClient);
  }
  if (candidate.sourceType === "clip") {
    return composeClipBody(candidate, llmClient);
  }
  return composeReactionBody(candidate, candidate.sourceType, llmClient);
}
