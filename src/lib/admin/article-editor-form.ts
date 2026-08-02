/**
 * 構造化エディタ（admincms-S3 F7/F8、admincms-S4 F9でパッチ系を追加）の中核となる純関数群。
 *
 * - `ArticleBodyBlock`（DB検証済みの本文ブロック）と、フォームで編集しやすい文字列主体の
 *   `BlockDraft`（エディタの入力状態。シリアライズしてクライアント⇔サーバー間をJSONで往復する）
 *   を相互変換する。
 * - 汎用の配列操作（並べ替え/削除/挿入位置指定）を提供し、ブロック一覧・レス本文行一覧・
 *   パッチ変更のgroups/changesの両方で再利用する。
 * - `parseArticleBody` 単体では担保できない全体整合チェック（reactionのanchorsが同一記事内に
 *   存在する番号か・tocのanchorが同一記事内のheading anchorに存在するか）を提供する。
 *
 * 全10ブロック型（reaction/redditSource/heading/paragraph/quote/embed/image/linkButton/toc/
 * patchChange）を編集可能にする（admincms-S4でpatchChange/toc/linkButtonを追加）。
 */
import {
  parseArticleBody,
  InvalidArticleBodyError,
  PATCH_ABILITY_KEY_VALUES,
  PATCH_TARGET_KIND_VALUES,
  PATCH_DIRECTION_VALUES,
  type ArticleBodyBlock,
  type ArticleBodyEmphasisColor,
  type ArticleBodyPatchChangeGroup,
} from "@/lib/article-body";

/** エディタで実際に編集できるブロック種別（admincms-S3の反応系＋共通、S4でパッチ系を追加）。 */
export const EDITABLE_BLOCK_TYPES = [
  "reaction",
  "redditSource",
  "heading",
  "paragraph",
  "quote",
  "embed",
  "image",
  "linkButton",
  "toc",
  "patchChange",
] as const;
export type EditableBlockType = (typeof EDITABLE_BLOCK_TYPES)[number];

/** ブロック種別の表示ラベル（カード見出し・追加メニューで共用）。 */
export const BLOCK_TYPE_LABELS: Record<EditableBlockType, string> = {
  reaction: "レス",
  redditSource: "Redditソース",
  heading: "見出し",
  paragraph: "段落",
  quote: "引用",
  embed: "埋め込み",
  image: "画像",
  linkButton: "リンクボタン",
  toc: "目次",
  patchChange: "パッチ変更",
};

/** patchChangeの対象種別のUI選択ラベル（`PATCH_TARGET_KIND_VALUES`が単一のsource of truth）。 */
export const PATCH_TARGET_KIND_LABELS: Record<(typeof PATCH_TARGET_KIND_VALUES)[number], string> = {
  champion: "チャンピオン",
  item: "アイテム",
  rune: "ルーン",
  system: "システム",
  bugfix: "バグ修正",
  arena: "アリーナ",
  augment: "オーグメント",
  other: "その他",
};

/** patchChangeの方向のUI選択ラベル。 */
export const PATCH_DIRECTION_LABELS: Record<(typeof PATCH_DIRECTION_VALUES)[number], string> = {
  buff: "バフ",
  nerf: "ナーフ",
  adjust: "調整",
};

/** patchChangeグループのabilityKeyのUI選択ラベル。 */
export const PATCH_ABILITY_KEY_LABELS: Record<(typeof PATCH_ABILITY_KEY_VALUES)[number], string> = {
  passive: "パッシブ",
  Q: "Q",
  W: "W",
  E: "E",
  R: "R",
  base: "基礎ステータス",
};

export type ReactionLineDraft = { text: string; emphasis: "" | "red" | "orange"; original: string };

/** patchChangeの1変更行。`kind`でUIの数値変更/記述式変更フォームを切り替える（値はkind切替をまたいで保持）。
 * 数値変更=stat/before/after全て非空、記述式変更=text非空・statは任意ラベル（article-body.tsの
 * `parsePatchChangeGroupChanges`と同じ判別規約）。 */
export type PatchChangeDraft = { kind: "numeric" | "descriptive"; stat: string; before: string; after: string; text: string };

export type PatchChangeGroupDraft = {
  abilityKey: "" | (typeof PATCH_ABILITY_KEY_VALUES)[number];
  abilityName: string;
  abilityIconUrl: string;
  changes: PatchChangeDraft[];
};

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
  | { type: "linkButton"; url: string; label: string }
  | { type: "toc"; items: { label: string; anchor: string }[] }
  | {
      type: "patchChange";
      targetName: string;
      targetIconUrl: string;
      targetKind: (typeof PATCH_TARGET_KIND_VALUES)[number];
      direction: (typeof PATCH_DIRECTION_VALUES)[number];
      intent: string;
      groups: PatchChangeGroupDraft[];
    };

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
    case "linkButton":
      return { type: "linkButton", url: "", label: "" };
    case "toc":
      return { type: "toc", items: [{ label: "", anchor: "" }] };
    case "patchChange":
      return {
        type: "patchChange",
        targetName: "",
        targetIconUrl: "",
        targetKind: "champion",
        direction: "buff",
        intent: "",
        groups: [],
      };
  }
}

/** patchChangeのgroups[].changes[]（DB検証済み）を1変更行分のdraftへ変換する。
 * `before !== undefined` は数値変更（`parsePatchChangeGroupChanges`の判別規約と一致）を意味する。 */
function patchChangeToDraft(c: ArticleBodyPatchChangeGroup["changes"][number]): PatchChangeDraft {
  if (c.before !== undefined) {
    return { kind: "numeric", stat: c.stat ?? "", before: c.before, after: c.after ?? "", text: "" };
  }
  return { kind: "descriptive", stat: c.stat ?? "", before: "", after: "", text: c.text ?? "" };
}

/** patchChangeのgroups[]（DB検証済み）を1グループ分のdraftへ変換する。 */
function patchGroupToDraft(g: ArticleBodyPatchChangeGroup): PatchChangeGroupDraft {
  return {
    abilityKey: g.abilityKey ?? "",
    abilityName: g.abilityName ?? "",
    abilityIconUrl: g.abilityIconUrl ?? "",
    changes: g.changes.map(patchChangeToDraft),
  };
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
    case "linkButton":
      return { type: "linkButton", url: block.url, label: block.label };
    case "toc":
      return { type: "toc", items: block.items.map((i) => ({ label: i.label, anchor: i.anchor })) };
    case "patchChange":
      return {
        type: "patchChange",
        targetName: block.targetName,
        targetIconUrl: block.targetIconUrl ?? "",
        targetKind: block.targetKind,
        direction: block.direction,
        intent: block.intent ?? "",
        groups: block.groups.map(patchGroupToDraft),
      };
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
    case "linkButton":
      return { type: "linkButton", url: draft.url, label: draft.label };
    case "toc":
      return { type: "toc", items: draft.items.map((i) => ({ label: i.label, anchor: i.anchor })) };
    case "patchChange":
      return {
        type: "patchChange",
        targetName: draft.targetName,
        ...(draft.targetIconUrl.trim() ? { targetIconUrl: draft.targetIconUrl } : {}),
        targetKind: draft.targetKind,
        direction: draft.direction,
        ...(draft.intent.trim() ? { intent: draft.intent } : {}),
        groups: draft.groups.map(patchGroupDraftToRaw),
      };
  }
}

/** patchChangeの1変更行draftを、`parseArticleBody`に通す前の素の値に変換する
 * （数値変更=stat/before/after、記述式変更=text＋任意stat。kind切替で入力していない側の値は出力しない）。 */
function patchChangeDraftToRaw(c: PatchChangeDraft): { stat?: string; before?: string; after?: string; text?: string } {
  if (c.kind === "numeric") {
    return { stat: c.stat, before: c.before, after: c.after };
  }
  return { ...(c.stat.trim() ? { stat: c.stat } : {}), text: c.text };
}

/** patchChangeの1グループdraftを素の値に変換する。 */
function patchGroupDraftToRaw(g: PatchChangeGroupDraft): unknown {
  return {
    ...(g.abilityKey ? { abilityKey: g.abilityKey } : {}),
    ...(g.abilityName.trim() ? { abilityName: g.abilityName } : {}),
    ...(g.abilityIconUrl.trim() ? { abilityIconUrl: g.abilityIconUrl } : {}),
    changes: g.changes.map(patchChangeDraftToRaw),
  };
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
 * toc↔heading アンカー整合チェック（admincms-S4）。toc.items[].anchor は同一記事内に存在する
 * heading.anchor と対応していなければならない（`validateReactionAnchors`と同型の全体整合チェック）。
 * `parseArticleBody`はブロック単位の検証のためこの整合性は担保しない。不正なら
 * `InvalidArticleBodyError`（どのブロック・どのアンカーが存在しないかを含む）を投げる。
 */
export function validateTocAnchors(blocks: ArticleBodyBlock[]): void {
  const existingAnchors = new Set(
    blocks
      .filter((b): b is Extract<ArticleBodyBlock, { type: "heading" }> => b.type === "heading" && b.anchor !== undefined)
      .map((b) => b.anchor as string),
  );
  blocks.forEach((block, index) => {
    if (block.type === "toc") {
      const missing = block.items.map((item) => item.anchor).filter((anchor) => !existingAnchors.has(anchor));
      if (missing.length > 0) {
        throw new InvalidArticleBodyError(
          `本文ブロック[${index}]のtoc itemsに存在しないアンカーがあります: ${missing.join(", ")}`,
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
  validateTocAnchors(blocks);
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
