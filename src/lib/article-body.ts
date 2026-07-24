/**
 * 記事本文を「見出し＋段落＋引用」のブロック配列として構造化するための型と検証ロジック。
 * DB には JSON として保存し（prisma/schema.prisma の Article.body）、
 * 表示前に必ずここでパース・検証してから使う（LLM 非依存の純関数）。
 */

export type ArticleBodyBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string; source?: string };

export class InvalidArticleBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArticleBodyError";
  }
}

const VALID_TYPES = new Set(["heading", "paragraph", "quote"]);

/**
 * DB から読み出した未知の値（Prisma の Json 型）を検証済みのブロック配列に変換する。
 * 不正な形式（配列でない・空・text 欠落・未知の type 等）は例外を投げる。
 */
export function parseArticleBody(value: unknown): ArticleBodyBlock[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidArticleBodyError(
      "記事本文はブロックの配列（1件以上）である必要があります",
    );
  }

  return value.map((block, index) => {
    if (typeof block !== "object" || block === null) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]がオブジェクトではありません`);
    }
    const b = block as Record<string, unknown>;
    if (typeof b.type !== "string" || !VALID_TYPES.has(b.type)) {
      throw new InvalidArticleBodyError(
        `本文ブロック[${index}]の type が不正です: ${String(b.type)}`,
      );
    }
    if (typeof b.text !== "string" || b.text.trim().length === 0) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]の text が空です`);
    }
    if (b.type === "quote") {
      return {
        type: "quote",
        text: b.text,
        source: typeof b.source === "string" ? b.source : undefined,
      } satisfies ArticleBodyBlock;
    }
    return { type: b.type, text: b.text } as ArticleBodyBlock;
  });
}

/** 本文ブロック配列に見出しが1つ以上含まれるか（「長文ベタ書き」になっていないかの簡易チェック） */
export function hasStructuredHeadings(blocks: ArticleBodyBlock[]): boolean {
  return blocks.some((b) => b.type === "heading");
}
