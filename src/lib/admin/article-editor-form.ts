/**
 * 構造化エディタ（admincms-S3 F7/F8）の中核となる純関数群。
 *
 * - `ArticleBodyBlock`（DB検証済みの本文ブロック）と、フォームで編集しやすい文字列主体の
 *   `BlockDraft`（エディタの入力状態。シリアライズしてクライアント⇔サーバー間をJSONで往復する）
 *   を相互変換する。
 * - 汎用の配列操作（並べ替え/削除/挿入位置指定）を提供し、ブロック一覧・レス本文行一覧の
 *   両方で再利用する。
 * - `parseArticleBody` 単体では担保できない「reactionのanchorsが同一記事内に存在する番号か」の
 *   全体整合チェックを提供する（S4のtoc anchor↔heading anchorも同型のため、ここに土台を置く）。
 *
 * この対象ブロック型は本スプリント(admincms-S3)の反応系＋共通ブロックのみ。
 * patchChange/toc/linkButton は編集UI未対応のため `type: "raw"` として値をそのまま素通しする
 * （基盤自体は汎用なので、S4で対応ブロックを増やす際もこのファイルを拡張すればよい）。
 */
import {
  parseArticleBody,
  InvalidArticleBodyError,
  type ArticleBodyBlock,
  type ArticleBodyEmphasisColor,
} from "@/lib/article-body";

/** エディタで実際に編集できるブロック種別（反応系＋共通、admincms-S3）。 */
export const EDITABLE_BLOCK_TYPES = [
  "reaction",
  "redditSource",
  "heading",
  "paragraph",
  "quote",
  "embed",
  "image",
] as const;
export type EditableBlockType = (typeof EDITABLE_BLOCK_TYPES)[number];

/** ブロック種別の表示ラベル（カード見出し・追加メニューで共用）。 */
export const BLOCK_TYPE_LABELS: Record<EditableBlockType | "raw", string> = {
  reaction: "レス",
  redditSource: "Redditソース",
  heading: "見出し",
  paragraph: "段落",
  quote: "引用",
  embed: "埋め込み",
  image: "画像",
  raw: "その他（未対応の種類）",
};

export type ReactionLineDraft = { text: string; emphasis: "" | "red" | "orange"; original: string };

export type BlockDraft =
  | {
      type: "reaction";
      number: string;
      name: string;
      lines: ReactionLineDraft[];
      /** カンマ区切りのレス番号（例: "1,3"）。空文字は anchors 未指定を表す。 */
      anchors: string;
      emphasis: boolean;
      emphasisColor: "" | ArticleBodyEmphasisColor;
    }
  | { type: "redditSource"; title: string; author: string; subreddit: string; url: string }
  | { type: "heading"; text: string; anchor: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string; source: string }
  | { type: "embed"; provider: string; url: string; caption: string }
  | { type: "image"; url: string; alt: string; credit: string }
  /** S4未対応ブロック(patchChange/toc/linkButton)のパススルー。元の値をそのまま保持し、
   * 保存時も無編集で書き戻す（往復同一性を壊さないため）。 */
  | { type: "raw"; rawType: string; original: unknown };

/** 新規追加ブロックの空初期値。 */
export function createDraftBlock(type: EditableBlockType): BlockDraft {
  switch (type) {
    case "reaction":
      return {
        type: "reaction",
        number: "",
        name: "",
        lines: [{ text: "", emphasis: "", original: "" }],
        anchors: "",
        emphasis: false,
        emphasisColor: "",
      };
    case "redditSource":
      return { type: "redditSource", title: "", author: "", subreddit: "", url: "" };
    case "heading":
      return { type: "heading", text: "", anchor: "" };
    case "paragraph":
      return { type: "paragraph", text: "" };
    case "quote":
      return { type: "quote", text: "", source: "" };
    case "embed":
      return { type: "embed", provider: "twitter", url: "", caption: "" };
    case "image":
      return { type: "image", url: "", alt: "", credit: "" };
  }
}

/** 既存ブロック(DB検証済み)からフォームの初期入力値(draft)を組み立てる。 */
export function blockToDraft(block: ArticleBodyBlock): BlockDraft {
  switch (block.type) {
    case "reaction":
      return {
        type: "reaction",
        number: String(block.number),
        name: block.name,
        lines: block.lines.map((l) => ({ text: l.text, emphasis: l.emphasis ?? "", original: l.original ?? "" })),
        anchors: block.anchors ? block.anchors.join(",") : "",
        emphasis: block.emphasis ?? false,
        emphasisColor: block.emphasisColor ?? "",
      };
    case "redditSource":
      return {
        type: "redditSource",
        title: block.title,
        author: block.author ?? "",
        subreddit: block.subreddit ?? "",
        url: block.url,
      };
    case "heading":
      return { type: "heading", text: block.text, anchor: block.anchor ?? "" };
    case "paragraph":
      return { type: "paragraph", text: block.text };
    case "quote":
      return { type: "quote", text: block.text, source: block.source ?? "" };
    case "embed":
      return { type: "embed", provider: block.provider, url: block.url, caption: block.caption ?? "" };
    case "image":
      return { type: "image", url: block.url, alt: block.alt, credit: block.credit ?? "" };
    default:
      // patchChange/toc/linkButton（S4対応）: 編集UIを持たないため値をそのまま保持する。
      return { type: "raw", rawType: block.type, original: block };
  }
}

/** カンマ区切りのアンカー入力を数値配列に変換する（空文字・空白トークンは無視）。 */
function parseAnchorsInput(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
}

/**
 * フォームのdraftを、`parseArticleBody`に通す前の「素の値」に変換する（型検証はしない。
 * 不正値はそのまま素通しし、`parseArticleBody`側の検証でまとめて弾く＝検証ロジックの重複を避ける）。
 */
export function draftToRawBlock(draft: BlockDraft): unknown {
  switch (draft.type) {
    case "reaction": {
      const trimmedNumber = draft.number.trim();
      const anchors = parseAnchorsInput(draft.anchors);
      return {
        type: "reaction",
        number: trimmedNumber === "" ? NaN : Number(trimmedNumber),
        name: draft.name,
        lines: draft.lines.map((l) => ({
          text: l.text,
          ...(l.emphasis ? { emphasis: l.emphasis } : {}),
          ...(l.original.trim() ? { original: l.original } : {}),
        })),
        ...(anchors.length > 0 ? { anchors } : {}),
        ...(draft.emphasis ? { emphasis: true } : {}),
        // emphasisColorはemphasis:trueのときのみ意味を持つ（article-body.tsの型規約）。
        // 「強調オン→色選択→強調オフ」で色が孤児化し、描画側(article-body-view)がemphasisを見ず
        // emphasisColorだけで大きな色付き太字を出す不具合を防ぐため、emphasisが立つときのみ出力する。
        ...(draft.emphasis && draft.emphasisColor ? { emphasisColor: draft.emphasisColor } : {}),
      };
    }
    case "redditSource":
      return {
        type: "redditSource",
        title: draft.title,
        ...(draft.author.trim() ? { author: draft.author } : {}),
        ...(draft.subreddit.trim() ? { subreddit: draft.subreddit } : {}),
        url: draft.url,
      };
    case "heading":
      return { type: "heading", text: draft.text, ...(draft.anchor.trim() ? { anchor: draft.anchor } : {}) };
    case "paragraph":
      return { type: "paragraph", text: draft.text };
    case "quote":
      return { type: "quote", text: draft.text, ...(draft.source.trim() ? { source: draft.source } : {}) };
    case "embed":
      return {
        type: "embed",
        provider: draft.provider,
        url: draft.url,
        ...(draft.caption.trim() ? { caption: draft.caption } : {}),
      };
    case "image":
      return {
        type: "image",
        url: draft.url,
        alt: draft.alt,
        ...(draft.credit.trim() ? { credit: draft.credit } : {}),
      };
    case "raw":
      return draft.original;
  }
}

/** draft配列をまとめて素の値配列に変換する（保存アクションが `updateArticleContent` へ渡す形）。 */
export function draftsToRawBlocks(drafts: BlockDraft[]): unknown[] {
  return drafts.map(draftToRawBlock);
}

/**
 * 記事全体を見たアンカー整合チェック（reactionの`anchors`は同一記事内に存在するreaction番号のみ許可）。
 * `parseArticleBody`はブロック単位の検証のためこの整合性は担保しない。不正なら
 * `InvalidArticleBodyError`（どのブロック・どの番号が存在しないかを含む）を投げる。
 */
export function validateReactionAnchors(blocks: ArticleBodyBlock[]): void {
  const existingNumbers = new Set(
    blocks.filter((b): b is Extract<ArticleBodyBlock, { type: "reaction" }> => b.type === "reaction").map((b) => b.number),
  );
  blocks.forEach((block, index) => {
    if (block.type === "reaction" && block.anchors) {
      const missing = block.anchors.filter((n) => !existingNumbers.has(n));
      if (missing.length > 0) {
        throw new InvalidArticleBodyError(
          `本文ブロック[${index}]のanchorsに存在しないレス番号があります: ${missing.join(", ")}`,
        );
      }
    }
  });
}

/**
 * draft配列を検証済みの`ArticleBodyBlock[]`に変換する（`parseArticleBody`＋アンカー整合の両方を通す）。
 * 不正な入力は`InvalidArticleBodyError`を投げ、そのメッセージ(`本文ブロック[i]の…`)をそのままUIに出せる。
 */
export function draftsToArticleBody(drafts: BlockDraft[]): ArticleBodyBlock[] {
  const blocks = parseArticleBody(draftsToRawBlocks(drafts));
  validateReactionAnchors(blocks);
  return blocks;
}

/** 汎用の配列操作（ブロック一覧・レス本文行一覧の両方で使う）。 */

/** 指定indexの要素を1つ隣（direction: -1=上へ, 1=下へ）と入れ替える。範囲外は変化なしのコピーを返す。 */
export function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  const copy = [...items];
  if (target < 0 || target >= items.length) return copy;
  const tmp = copy[index];
  copy[index] = copy[target];
  copy[target] = tmp;
  return copy;
}

/** 指定indexの要素を取り除いた新しい配列を返す。 */
export function removeItemAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

/** `afterIndex`（nullなら末尾）の直後に要素を挿入した新しい配列を返す。 */
export function insertItemAfter<T>(items: readonly T[], afterIndex: number | null, item: T): T[] {
  const copy = [...items];
  const insertAt = afterIndex === null ? copy.length : afterIndex + 1;
  copy.splice(insertAt, 0, item);
  return copy;
}
