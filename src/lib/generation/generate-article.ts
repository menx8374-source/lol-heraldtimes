/**
 * 記事化候補1件分の生成ロジック（F7）。compose.ts で本文を組み立てたあと、
 * このスプリントの受け入れ基準（最低文字数・逐語一致率・引用の主従関係・出典付与）を
 * 満たすかを検証し、満たさない場合は GenerationError を投げる（DB連携側 pipeline.ts が
 * これを捕捉して「生成失敗」として記録し、他候補の生成を継続する）。
 */
import type { ArticleBodyBlock } from "@/lib/article-body";
import type { CategoryLabel } from "@/lib/categories";
import type { SourceType } from "@/lib/collection/types";
import type { LLMClient } from "@/lib/generation/llm-client";
import { composeArticleBody } from "@/lib/generation/compose";
import { computeVerbatimMatchRatio, DEFAULT_VERBATIM_THRESHOLD } from "@/lib/generation/verbatim";
import { hasAcceptableQuoteRatio } from "@/lib/generation/quote-ratio";

/** 1記事あたりの本文最低文字数（見出し・段落・引用の合計、F7受け入れ基準）。 */
export const MIN_BODY_LENGTH = 300;

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

export type GenerationCandidate = {
  id: string;
  sourceType: SourceType;
  sourceUrl: string;
  title: string;
  content: string;
};

export type GeneratedArticle = {
  /** 仮タイトル（本格的なタイトル生成はSprint 5のF8で実装する）。 */
  title: string;
  category: CategoryLabel;
  body: ArticleBodyBlock[];
  sources: { label: string; url: string }[];
};

const CATEGORY_BY_SOURCE: Record<SourceType, CategoryLabel> = {
  "5ch": "5chの反応",
  reddit: "海外の反応",
  riot: "公式ニュース",
};

const ARTICLE_SOURCE_LABEL: Record<SourceType, string> = {
  "5ch": "5ch",
  reddit: "Reddit",
  riot: "Riot公式",
};

/**
 * 記事化候補から記事を生成する。生成本文が受け入れ基準（最低文字数・逐語一致率・引用比率・出典）を
 * 満たさない場合は GenerationError を投げる。
 */
export async function generateArticleForCandidate(
  candidate: GenerationCandidate,
  llmClient: LLMClient,
): Promise<GeneratedArticle> {
  if (!candidate.sourceUrl || candidate.sourceUrl.trim().length === 0) {
    throw new GenerationError("出典URLが無いため記事を生成できません");
  }

  const body = await composeArticleBody(candidate, llmClient);

  const totalLength = body.reduce((sum, b) => sum + b.text.length, 0);
  if (totalLength < MIN_BODY_LENGTH) {
    throw new GenerationError(
      `生成本文が最低文字数(${MIN_BODY_LENGTH}字)に満たません(実際:${totalLength}字)`,
    );
  }

  const generatedText = body.map((b) => b.text).join("");
  const verbatimRatio = computeVerbatimMatchRatio(generatedText, candidate.content);
  if (verbatimRatio > DEFAULT_VERBATIM_THRESHOLD) {
    throw new GenerationError(
      `元ソースとの逐語一致率が高すぎます(${Math.round(verbatimRatio * 100)}% > しきい値${Math.round(
        DEFAULT_VERBATIM_THRESHOLD * 100,
      )}%)`,
    );
  }

  if (!hasAcceptableQuoteRatio(body)) {
    throw new GenerationError("引用が記事全体に占める割合が過大です（主従関係を満たしません）");
  }

  return {
    title: candidate.title,
    category: CATEGORY_BY_SOURCE[candidate.sourceType],
    body,
    sources: [{ label: ARTICLE_SOURCE_LABEL[candidate.sourceType], url: candidate.sourceUrl }],
  };
}
