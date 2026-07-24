/**
 * 記事本文の構成組み立て（F7）。LLMClient経由でリライト文を取得しつつ、
 * 「導入→反応/情報の要約・再構成→まとめ」という共通骨格に、ソース種別による構成分岐を適用する。
 * - 掲示板/Reddit（5ch/reddit）: 「複数の反応（コメント）を要約して並べる」構成
 * - Riot公式（riot）: 「事実の速報＋要点整理」構成
 * 引用(quote)ブロックは元文の一部のみ(text-utils.excerptForQuote)を使い、主従関係を保つ。
 */
import type { ArticleBodyBlock } from "@/lib/article-body";
import type { SourceType } from "@/lib/collection/types";
import type { LLMClient, GenerationTask } from "@/lib/generation/llm-client";
import { splitIntoSentences, excerptForQuote } from "@/lib/generation/text-utils";

export type GenerationCandidateInput = {
  sourceType: SourceType;
  title: string;
  content: string;
};

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
 * 構成分岐のプロファイル。共通骨格（導入→要約ループ→context→まとめ）は composeBody に一本化し、
 * ソース種別による差分（先頭見出し・要約セクション見出し・要約タスク種別）だけをここに持つ。
 * summaryTask は判別ユニオン GenerationTask の各メンバーを直接返すことで型安全に切り替える。
 */
type ComposeProfile = {
  introHeading: string;
  itemsHeading: string;
  summaryTask: (sentence: string, index: number) => GenerationTask;
};

const COMPOSE_PROFILES = {
  // 掲示板/Reddit（5ch/reddit）: 「複数の反応を要約して並べる」構成
  reaction: {
    introHeading: "話題",
    itemsHeading: "寄せられた反応",
    summaryTask: (sentence, index) => ({ kind: "reaction-summary", sentence, index }),
  },
  // Riot公式（riot）: 「事実の速報＋要点整理」構成
  fact: {
    introHeading: "速報",
    itemsHeading: "要点整理",
    summaryTask: (sentence, index) => ({ kind: "fact-summary", sentence, index }),
  },
} satisfies Record<"reaction" | "fact", ComposeProfile>;

/** 共通骨格に構成プロファイルを適用して本文ブロックを組み立てる。 */
async function composeBody(
  candidate: GenerationCandidateInput,
  sentences: string[],
  llmClient: LLMClient,
  profile: ComposeProfile,
): Promise<ArticleBodyBlock[]> {
  const { sourceType, title } = candidate;
  const blocks: ArticleBodyBlock[] = [];
  const citationLabel = QUOTE_SOURCE_LABEL[sourceType];

  blocks.push({ type: "heading", text: profile.introHeading });
  blocks.push({ type: "paragraph", text: await askLLM(llmClient, { kind: "intro", sourceType, title }) });

  blocks.push({ type: "heading", text: profile.itemsHeading });
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    blocks.push({ type: "paragraph", text: await askLLM(llmClient, profile.summaryTask(sentence, i)) });
    blocks.push({ type: "quote", text: excerptForQuote(sentence), source: citationLabel });
  }

  blocks.push({ type: "paragraph", text: await askLLM(llmClient, { kind: "context", sourceType, title }) });

  blocks.push({ type: "heading", text: "まとめ" });
  blocks.push({ type: "paragraph", text: await askLLM(llmClient, { kind: "closing", sourceType, title }) });

  return blocks;
}

/**
 * 記事化候補から構造化された本文ブロック配列を組み立てる（F7）。
 * sourceType が "riot" なら速報＋要点整理、それ以外（5ch/reddit）なら反応まとめ構成にする。
 */
export async function composeArticleBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  const sentences = splitIntoSentences(candidate.content);
  const profile = candidate.sourceType === "riot" ? COMPOSE_PROFILES.fact : COMPOSE_PROFILES.reaction;
  return composeBody(candidate, sentences, llmClient, profile);
}
