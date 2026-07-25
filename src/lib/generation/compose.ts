/**
 * 記事本文の構成組み立て（F7）。LLMClient経由でリライト文を取得しつつ、
 * ソース種別による構成分岐を適用する。
 * - 掲示板/Reddit（5ch/reddit）: AI要約段落を持たず、「反応まとめ」見出し＋収集したスレッドの
 *   レス群を番号付きレスとして逐語のまま並べるだけの「レス羅列中心」構成（2026-07-25 ユーザー決定の
 *   記事フォーマット改修。同日の追加改修でAI導入/まとめ段落を除去しさらにシンプル化）。
 * - Riot公式（riot）: 「事実の速報＋要点整理」構成（従来どおり、引用ブロックは主従関係を保つ）。
 */
import type { ArticleBodyBlock, ArticleBodyReactionBlock } from "@/lib/article-body";
import type { SourceType } from "@/lib/collection/types";
import type { LLMClient, GenerationTask } from "@/lib/generation/llm-client";
import { splitIntoSentences, excerptForQuote } from "@/lib/generation/text-utils";
import { parseThreadReses, extractAnchors, computeLineEmphasis } from "@/lib/generation/thread-format";

export type GenerationCandidateInput = {
  sourceType: SourceType;
  title: string;
  content: string;
};

/** レス投稿者の匿名化ハンドル（実名・個人特定情報は出さない）。ソース種別ごとに固定。 */
const REACTION_HANDLE: Record<"5ch" | "reddit", string> = {
  "5ch": "国内プレイヤーさん",
  reddit: "海外プレイヤーさん",
};

/**
 * スレッドの content（逐語）を、まとめ速報のレス（reaction）ブロック配列に組み立てる。
 * レス番号・本文行は逐語のまま保持し、重要行の強調・アンカーの妥当性(既出番号のみ)だけを付加する。
 */
function buildReactionBlocks(
  candidate: GenerationCandidateInput,
  sourceType: "5ch" | "reddit",
): ArticleBodyReactionBlock[] {
  const reses = parseThreadReses(candidate.content);
  const name = REACTION_HANDLE[sourceType];
  const knownNumbers = new Set(reses.map((r) => r.number));

  return reses.map((res) => {
    const emphasis = computeLineEmphasis(res.lines);
    const anchors = extractAnchors(res.lines).filter((n) => n !== res.number && knownNumbers.has(n));
    return {
      type: "reaction",
      number: res.number,
      name,
      lines: res.lines.map((text, i) => (emphasis[i] ? { text, emphasis: emphasis[i] } : { text })),
      ...(anchors.length > 0 ? { anchors } : {}),
    };
  });
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
 */
function composeReactionBody(
  candidate: GenerationCandidateInput,
  sourceType: "5ch" | "reddit",
): ArticleBodyBlock[] {
  const blocks: ArticleBodyBlock[] = [];

  blocks.push({ type: "heading", text: "反応まとめ" });
  blocks.push(...buildReactionBlocks(candidate, sourceType));

  return blocks;
}

/**
 * 記事化候補から構造化された本文ブロック配列を組み立てる（F7）。
 * sourceType が "riot" なら速報＋要点整理、それ以外（5ch/reddit）ならまとめ速報レス形式にする。
 */
export async function composeArticleBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  if (candidate.sourceType === "riot") {
    const sentences = splitIntoSentences(candidate.content);
    return composeFactBody(candidate, sentences, llmClient);
  }
  return composeReactionBody(candidate, candidate.sourceType);
}
