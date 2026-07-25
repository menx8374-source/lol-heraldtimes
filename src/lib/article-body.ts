/**
 * 記事本文を「見出し＋段落＋引用＋レス（まとめ速報形式）」のブロック配列として構造化するための
 * 型と検証ロジック。DB には JSON として保存し（prisma/schema.prisma の Article.body）、
 * 表示前に必ずここでパース・検証してから使う（LLM 非依存の純関数）。
 *
 * ⚠ 記事フォーマット改修（2026-07-25・ユーザー決定）: 掲示板/SNS由来（5ch/reddit）の記事は、
 * 「AI要約段落＋短い引用」から「番号付きレスを逐語のまま羅列する、まとめ速報レス形式」に変更した。
 * その中核ブロックが `reaction` 型。旧来の heading/paragraph/quote 型は Riot公式由来の
 * 「速報＋要点整理」構成で引き続き使うため、両方を許容する（後方互換）。
 */

/** レス本文の1行。重要・面白い行は決定論ヒューリスティックで赤/オレンジに強調する（compose.ts参照）。 */
export type ArticleBodyReactionLine = { text: string; emphasis?: "red" | "orange" };

/** 掲示板/SNSの1書き込み（レス）をまとめ速報形式で表すブロック。逐語表示が前提。 */
export type ArticleBodyReactionBlock = {
  type: "reaction";
  /** レス番号（例: 1）。表示は「1: 名前」の形式にする。 */
  number: number;
  /** 匿名化ハンドル名（例: 国内プレイヤーさん／海外プレイヤーさん）。実名は使わない。 */
  name: string;
  lines: ArticleBodyReactionLine[];
  /** `>>N` 形式で他レスに返信している場合の参照先番号（同一記事内に存在する番号のみ）。 */
  anchors?: number[];
};

export type ArticleBodyBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string; source?: string }
  | ArticleBodyReactionBlock;

export class InvalidArticleBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArticleBodyError";
  }
}

const TEXT_TYPES = new Set(["heading", "paragraph", "quote"]);

function parseReactionBlock(b: Record<string, unknown>, index: number): ArticleBodyReactionBlock {
  if (typeof b.number !== "number" || !Number.isInteger(b.number) || b.number <= 0) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の number が不正です: ${String(b.number)}`);
  }
  if (typeof b.name !== "string" || b.name.trim().length === 0) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の name が空です`);
  }
  if (!Array.isArray(b.lines) || b.lines.length === 0) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の lines が空です`);
  }
  const lines: ArticleBodyReactionLine[] = b.lines.map((line, lineIndex) => {
    if (typeof line !== "object" || line === null) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のlines[${lineIndex}]がオブジェクトではありません`);
    }
    const l = line as Record<string, unknown>;
    if (typeof l.text !== "string" || l.text.trim().length === 0) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のlines[${lineIndex}]のtextが空です`);
    }
    if (l.emphasis !== undefined && l.emphasis !== "red" && l.emphasis !== "orange") {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のlines[${lineIndex}]のemphasisが不正です`);
    }
    return { text: l.text, ...(l.emphasis ? { emphasis: l.emphasis } : {}) };
  });
  let anchors: number[] | undefined;
  if (b.anchors !== undefined) {
    if (!Array.isArray(b.anchors) || b.anchors.some((n) => typeof n !== "number" || !Number.isInteger(n) || n <= 0)) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のanchorsが不正です`);
    }
    anchors = b.anchors as number[];
  }
  return { type: "reaction", number: b.number, name: b.name, lines, ...(anchors ? { anchors } : {}) };
}

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
    if (b.type === "reaction") {
      return parseReactionBlock(b, index);
    }
    if (typeof b.type !== "string" || !TEXT_TYPES.has(b.type)) {
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

/**
 * ブロック1件分のテキストを取り出す（検索・文字数計算・安全フィルタの対象抽出で共通利用）。
 * heading/paragraph/quote は `text` を、reaction は「名前＋各レス行」を連結して返す
 * （レス本文も安全フィルタ・検索の対象に含めるため）。
 */
export function blockText(block: ArticleBodyBlock): string {
  if (block.type === "reaction") {
    return [block.name, ...block.lines.map((l) => l.text)].join("\n");
  }
  return block.text;
}
