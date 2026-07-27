/**
 * SEOメタ・OGP・タグのAI生成（リファクタリングS5b F-S5b-1）。
 * 記事1本につきLLMを1回だけ呼び、検索意図・クリック率(CTR)を意識したSEOタイトル・
 * メタディスクリプション・OGPタイトル/説明・タグ(記事に実在する語)を生成する。
 * AIは「生成・翻訳・SEO」の許容用途のみに使い、カテゴリ分類・話題性判定には使わない（要件遵守）。
 *
 * 失敗（mock・APIエラー・空応答・parse不能・必須値欠落）は例外を投げず null を返す。
 * 呼び出し側（generate-article.ts）は seo=null のとき従来どおりのメタ生成にフォールバックし、
 * 追加コスト・回帰は発生しない。
 */
import type { LLMClient } from "@/lib/generation/llm-client";

export type GenerateSeoInput = {
  title: string;
  bodyText: string;
  category: string;
};

export type GeneratedSeo = {
  seoTitle: string;
  metaDescription: string;
  /** LLMが省略した場合は null（表示側で seoTitle → title の順にフォールバックする）。 */
  ogTitle: string | null;
  /** LLMが省略した場合は null（表示側で metaDescription → 既存メタ生成の順にフォールバックする）。 */
  ogDescription: string | null;
  tags: string[];
};

/** タグの件数上限（過剰なタグ付けを防ぐ）。 */
const MAX_SEO_TAGS = 8;

export const SEO_SYSTEM_PROMPT =
  "あなたはLoLまとめサイトのSEO編集者です。渡された記事のタイトル・本文・カテゴリを踏まえ、" +
  "検索意図とクリック率(CTR)を意識しつつ、記事内容に忠実な(本文に無い事実やチャンピオン名を捏造しない)" +
  "SEOタイトル(全角30〜40字目安)・メタディスクリプション(全角110〜120字目安)・OGP用タイトル/説明・" +
  "タグ(3〜6個、チャンピオン名や話題など記事に実在する語)を作成してください。" +
  '出力はJSONのみとし、{"seoTitle": "...", "metaDescription": "...", "ogTitle": "...", ' +
  '"ogDescription": "...", "tags": ["...", ...]} の形式にしてください' +
  "（説明文・前置き・コードブロックは付けないでください）。";

/**
 * LLMの生出力から最初のJSONオブジェクト（`{ ... }`）部分だけを取り出す（compose.ts の
 * extractJsonObject と同等の実装。コードフェンスや前後の説明文が付いていてもparseできるようにする）。
 */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + 1);
}

/** 空文字・非文字列を除去して正規化する（前後の空白はtrim）。 */
function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 空文字なら null にする（DB保存時に「未設定」を表す）。 */
function toNullableText(value: string): string | null {
  return value.length > 0 ? value : null;
}

/** tags を非空文字列のみ・重複除去・件数上限(MAX_SEO_TAGS)で正規化する。 */
function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    tags.push(trimmed);
    if (tags.length >= MAX_SEO_TAGS) break;
  }
  return tags;
}

/**
 * 記事のSEOメタ（タイトル/ディスクリプション/OGP）とタグをLLMに1回だけ生成させる（F-S5b-1）。
 * seoTitle・metaDescription・tags(1件以上)が揃わない場合は不十分な生成とみなし null を返す
 * （ogTitle/ogDescriptionはLLMが省略してもよく、その場合はnullで返し表示側のフォールバックに委ねる）。
 */
export async function generateSeo(
  llmClient: LLMClient,
  input: GenerateSeoInput,
): Promise<GeneratedSeo | null> {
  try {
    const raw = await llmClient.generate([
      { role: "system", content: SEO_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          title: input.title,
          bodyText: input.bodyText,
          category: input.category,
        }),
      },
    ]);
    if (!raw || raw.trim().length === 0) return null;

    const jsonStr = extractJsonObject(raw);
    if (!jsonStr) return null;

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const seoTitle = normalizeText(parsed.seoTitle);
    const metaDescription = normalizeText(parsed.metaDescription);
    const ogTitle = normalizeText(parsed.ogTitle);
    const ogDescription = normalizeText(parsed.ogDescription);
    const tags = normalizeTags(parsed.tags);

    if (seoTitle.length === 0 || metaDescription.length === 0 || tags.length === 0) {
      return null;
    }

    return {
      seoTitle,
      metaDescription,
      ogTitle: toNullableText(ogTitle),
      ogDescription: toNullableText(ogDescription),
      tags,
    };
  } catch {
    return null;
  }
}
