/**
 * 記事化候補1件分の生成ロジック（F7）。compose.ts で本文を組み立てたあと、
 * このスプリントの受け入れ基準（最低文字数・逐語一致率・引用の主従関係・出典付与）を
 * 満たすかを検証し、満たさない場合は GenerationError を投げる（DB連携側 pipeline.ts が
 * これを捕捉して「生成失敗」として記録し、他候補の生成を継続する）。
 *
 * ⚠ 記事フォーマット改修（2026-07-25・ユーザー決定、同日追加改修でAI要約段落も除去）: 掲示板/SNS由来
 * （5ch/reddit）は「まとめ速報レス形式」（AI要約段落なし・レス本文を逐語表示のみ）に変更したため、
 * 逐語一致率チェック・引用主従比率チェック・最低文字数(300字)チェックは reaction 形式の記事
 * （5ch/reddit）には適用せず、代わりに「reactionブロックが1件以上あること」を最低条件にする。
 * Riot公式（riot）は従来どおり300字・逐語一致率・引用主従比率チェックを適用する。
 * 安全フィルタ（F9: NGワード・個人中傷・出典欠落・重複）は形式によらず必ず適用する（pipeline.ts の
 * moderateArticleContent）。
 */
import { blockText, type ArticleBodyBlock } from "@/lib/article-body";
import type { CategoryLabel } from "@/lib/categories";
import type { SourceType } from "@/lib/collection/types";
import type { LLMClient } from "@/lib/generation/llm-client";
import { composeArticleBody } from "@/lib/generation/compose";
import { computeVerbatimMatchRatio, DEFAULT_VERBATIM_THRESHOLD } from "@/lib/generation/verbatim";
import { hasAcceptableQuoteRatio } from "@/lib/generation/quote-ratio";
import { generateHookTitleLLM } from "@/lib/generation/title";
import { threadBodyText } from "@/lib/generation/thread-format";
import { generateSeo, type GeneratedSeo } from "@/lib/generation/seo";
import { isSafeImageUrl } from "@/lib/image-url";
import {
  detectChampionSplashUrl,
  pickDeterministicChampionSplashUrl,
  type ChampionNameToIdMap,
} from "@/lib/generation/champion-thumbnail";

/** 1記事あたりの本文最低文字数（見出し・段落・引用の合計、F7受け入れ基準）。riot(fact形式)のみに適用。 */
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
  /** 収集時に取得したサムネイル画像URL（拡張E19）。未設定/nullは記事のサムネイルも未設定になる。 */
  imageUrl?: string | null;
};

export type GeneratedArticle = {
  /** 煽り速報タイトル（F8）。generateHookTitleLLM（LLM生成、失敗時はgenerateHookTitleにフォールバック）により候補の原題+本文から生成する。 */
  title: string;
  category: CategoryLabel;
  body: ArticleBodyBlock[];
  sources: { label: string; url: string }[];
  /**
   * 記事サムネイル画像URL。優先順（拡張E31 F-E31-2、拡張E37 F-E37-2で③を追加）:
   * 1. candidate.imageUrl が https の妥当なURLならそれ。
   * 2. なければ、渡された championMap でタイトル+本文からチャンピオンを検出できればその公式スプラッシュ。
   * 3. 反応形式（5ch/reddit）のみ、①②が無ければ candidate.id から決定論的に選んだチャンピオンの
   *    公式スプラッシュ（pickDeterministicChampionSplashUrl）。
   * 4. reaction以外（riot）で①②が無ければ null（表示側 article-thumbnail.tsx がカテゴリ別/
   *    汎用の既定画像にフォールバックする）。
   */
  thumbnailUrl: string | null;
  /**
   * SEOメタ・OGP・タグ（リファクタリングS5b F-S5b-1）。本文・タイトル確定後にAIへ1回だけ生成を
   * 依頼した結果。mock・APIエラー・空応答・parse不能・必須値欠落の場合は null になり、呼び出し側
   * （pipeline.ts / post-pipeline.ts）は SEO列を未設定のままにする（表示は従来メタにフォールバック）。
   */
  seo: GeneratedSeo | null;
};

const CATEGORY_BY_SOURCE: Record<SourceType, CategoryLabel> = {
  "5ch": "5chの反応",
  reddit: "海外の反応",
  // Riot Data Dragon はパッチ/チャンピオンの公式データそのものなので「パッチ/メタ」に分類する（拡張E19 F-E19-1）。
  riot: "パッチ/メタ",
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
  /**
   * チャンピオン検出（拡張E31 F-E31-1）用の「表示名→championId」Map。
   * 未指定/nullの場合はチャンピオン検出を行わない（candidate.imageUrlのみ判定、従来どおり）。
   * ネットワーク取得はこの関数の呼び出し側（generation/pipeline.ts）がrun開始時に1回だけ行う想定で、
   * この関数自体はフェッチしない（テスト容易性のため）。
   */
  championMap?: ChampionNameToIdMap | null,
): Promise<GeneratedArticle> {
  if (!candidate.sourceUrl || candidate.sourceUrl.trim().length === 0) {
    throw new GenerationError("出典URLが無いため記事を生成できません");
  }

  const body = await composeArticleBody(candidate, llmClient);
  // reaction形式(まとめ速報のレス羅列、5ch/reddit由来)はAI要約段落を持たずレス本文が逐語表示のため、
  // 最低文字数(300字)・逐語一致率・引用主従比率のチェックは対象外にし、代わりに「reactionブロック
  // (レス)が1件以上あること」だけを最低条件にする(F9のNGワード等の安全フィルタは形式によらず
  // pipeline.tsで必ず適用する)。riot(fact形式)のみ従来どおり300字・逐語・引用比率を適用する。
  const isReactionFormat = candidate.sourceType === "5ch" || candidate.sourceType === "reddit";

  if (isReactionFormat) {
    const reactionCount = body.filter((b) => b.type === "reaction").length;
    if (reactionCount === 0) {
      throw new GenerationError("反応まとめ記事にレス(reactionブロック)が1件もありません");
    }
  } else {
    const totalLength = body.reduce((sum, b) => sum + blockText(b).length, 0);
    if (totalLength < MIN_BODY_LENGTH) {
      throw new GenerationError(
        `生成本文が最低文字数(${MIN_BODY_LENGTH}字)に満たません(実際:${totalLength}字)`,
      );
    }

    const generatedText = body.map(blockText).join("");
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
  }

  // タイトル決定（拡張E40 F-E40-1）: riot（パッチ/公式データ）は事実性が最優先のため、煽り速報タイトル
  // LLM（generateHookTitleLLM）を使わず、収集アダプタが既に組み立てた事実タイトル（candidate.title。
  // 例「【パッチ】26.14 の主な変更点まとめ」）をそのまま採用する。拡張E26で「本文由来の具体要素を含む」
  // チェックを撤廃したため、煽りLLMに通すとラベル＋文字数さえ満たせば本文に無い主張（捏造）でも
  // 通ってしまう問題があった。反応記事（5ch/reddit）は従来どおり惹きつけタイトルLLMを使う。
  // タイトルのソースはレス番号「N: 」やアンカー行を除いた本文にする（タイトルへの「1: 」混入を防ぐ）。
  const title =
    candidate.sourceType === "riot"
      ? candidate.title
      : await generateHookTitleLLM(llmClient, {
          title: candidate.title,
          content: threadBodyText(candidate.content),
        });

  let thumbnailUrl: string | null = isSafeImageUrl(candidate.imageUrl) ? candidate.imageUrl : null;
  if (!thumbnailUrl && championMap) {
    thumbnailUrl = detectChampionSplashUrl(`${candidate.title}\n${candidate.content}`, championMap);
  }
  // 拡張E37 F-E37-2: 反応記事（5ch/reddit）でimageUrlも本文チャンピオン検出も無い場合のみ、
  // candidate.idから決定論的に選んだチャンピオンの公式スプラッシュにフォールバックする
  // （記事ごとに絵が固定され、パッチ記事の挙動は変えない）。
  if (!thumbnailUrl && isReactionFormat) {
    thumbnailUrl = pickDeterministicChampionSplashUrl(candidate.id);
  }

  const category = CATEGORY_BY_SOURCE[candidate.sourceType];
  // SEO生成（F-S5b-1）: 本文・タイトルが確定した後に1回だけ呼ぶ。mock/失敗時はnull(追加コストなし)で、
  // 呼び出し側が従来のメタ生成にフォールバックする。判定・分類ではなく生成用途のみ(要件遵守)。
  const seo = await generateSeo(llmClient, {
    title,
    bodyText: body.map(blockText).join(" "),
    category,
  });

  return {
    title,
    category,
    body,
    sources: [{ label: ARTICLE_SOURCE_LABEL[candidate.sourceType], url: candidate.sourceUrl }],
    thumbnailUrl,
    seo,
  };
}
