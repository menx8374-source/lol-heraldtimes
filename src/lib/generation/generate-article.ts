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
import type { XReplyItem } from "@/lib/collection/adapters/x";

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
  /**
   * パッチ記事刷新S2（F-S2-2）: riot由来の平テキスト化前の生HTML。DOM構造パーサ
   * （`parsePatchNotesHtml`）で誤帰属ゼロの本文組み立てに使う。他ソース・未取得時は未設定。
   */
  html?: string | null;
  /**
   * リファクタリングS7a（F-S7a-3）: 取得元ルールで明示されたカテゴリ（Post.category由来）。
   * 未設定の場合は従来どおりソース既定（CATEGORY_BY_SOURCE）にフォールバックする。
   */
  category?: CategoryLabel;
  /**
   * 成長G1（F-G1-4）: HotnessEvaluatorが判定した論争フラグ（賛否が割れている）。
   * 反応記事（5ch/reddit）のタイトル生成（generateHookTitleLLM/generateHookTitle）に渡し、
   * 議論寄りのタイトルを優先させる。未指定時はfalse扱い。
   */
  isControversial?: boolean;
  /**
   * 成長G7（F-G7-4）: 投稿者（Post.author由来）。X（旧Twitter）由来の記事で、引用フォールバック時の
   * 出典表記（tweet URL・作者名）に使う。他ソースは既存どおり匿名化ハンドルを使うため未使用。
   */
  author?: string | null;
  /**
   * パッチ記事刷新S5（F-S5-2, opt-in）: 未適用パッチの先行速報アイテムか（Post.mediaの
   * patchPreviewフラグ由来）。compose.ts が本文先頭に速報バッジを付与するかの判定に使う。
   * 未設定/false（既定）では従来と完全同一（回帰ゼロ）。
   */
  isPatchPreview?: boolean;
  /**
   * X-reply-S2（F-XR2-3）: hot確定してAI記事化するx由来Postの親ポストに紐づくリプライ/引用
   * （Post.media.xReplies由来）。**S2ではcomposeXBody等の本文組み立ては本フィールドを使わない**
   * （表示刷新はS3。candidateに載るだけで記事の見た目は不変＝回帰ゼロ）。
   */
  xReplies?: XReplyItem[];
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
  // リファクタリングS7b: Riot公式ニュースの既定カテゴリ（未指定時の保険）。実際は取得元ルールで
  // 明示された candidate.category（item.category）を優先する。
  "riot-news": "Riot公式",
  // 成長G7: X（旧Twitter）由来の記事の既定カテゴリ（未指定時の保険。実際はXAdapterが明示するcategoryを使う）。
  x: "Xの反応",
};

const ARTICLE_SOURCE_LABEL: Record<SourceType, string> = {
  "5ch": "5ch",
  reddit: "Reddit",
  riot: "Riot公式",
  "riot-news": "Riot公式",
  x: "X（旧Twitter）",
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
  // リファクタリングS7b: riot-news(image→見出し→短い要約→公式リンクの定型構成)も、原文の忠実な
  // 短い要約が主体でAI要約段落の逐語コピーを問題にする形式ではないため、300字下限・逐語一致率・
  // 引用主従比率のチェックは対象外にし、見出しが1件以上あることだけを最低条件にする。
  const isRiotNewsFormat = candidate.sourceType === "riot-news";
  // 成長G7（F-G7-4）: x(独自の見出し・導入・要約が主、tweet埋め込み/短い引用＋出典が従の構成、
  // composeXBody)もriot-newsと同様に、逐語一致率・引用主従比率(元々1tweetの短文が対象で無意味)・
  // 300字下限のチェックは対象外にし、見出しが1件以上あることだけを最低条件にする。
  const isXFormat = candidate.sourceType === "x";

  if (isReactionFormat) {
    const reactionCount = body.filter((b) => b.type === "reaction").length;
    if (reactionCount === 0) {
      throw new GenerationError("反応まとめ記事にレス(reactionブロック)が1件もありません");
    }
  } else if (isRiotNewsFormat || isXFormat) {
    if (!body.some((b) => b.type === "heading")) {
      throw new GenerationError(`${isXFormat ? "X" : "ニュース"}記事に見出し(heading)がありません`);
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

  // タイトル決定（拡張E40 F-E40-1、リファクタリングS7b でriot-newsにも適用）: riot（パッチ/公式データ）・
  // riot-news（公式ニュース）は事実性が最優先のため、煽り速報タイトルLLM（generateHookTitleLLM）を使わず、
  // 収集アダプタが既に組み立てた事実タイトル（candidate.title。riotなら「【パッチ】26.14 の主な変更点
  // まとめ」、riot-newsなら公式ページのog:title）をそのまま採用する。拡張E26で「本文由来の具体要素を含む」
  // チェックを撤廃したため、煽りLLMに通すとラベル＋文字数さえ満たせば本文に無い主張（捏造）でも
  // 通ってしまう問題があった。反応記事（5ch/reddit）は従来どおり惹きつけタイトルLLMを使う。
  // タイトルのソースはレス番号「N: 」やアンカー行を除いた本文にする（タイトルへの「1: 」混入を防ぐ）。
  const title =
    candidate.sourceType === "riot" || candidate.sourceType === "riot-news"
      ? candidate.title
      : await generateHookTitleLLM(
          llmClient,
          {
            title: candidate.title,
            content: threadBodyText(candidate.content),
          },
          candidate.isControversial ?? false,
        );

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

  // カテゴリ決定（リファクタリングS7a F-S7a-3）: 取得元ルールで明示されたcandidate.categoryを
  // 優先し、未指定ならソース既定（CATEGORY_BY_SOURCE、従来どおり）にフォールバックする。
  const category = candidate.category ?? CATEGORY_BY_SOURCE[candidate.sourceType];
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
