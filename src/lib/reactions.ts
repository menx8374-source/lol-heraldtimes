/**
 * 絵文字リアクション（拡張E1、拡張E13で1ユーザー1回に制限）の純関数群。ログイン無し方針の
 * ため、ユーザー識別はブラウザのlocalStorageで行う緩い制限とする（サーバー側の完全な
 * 本人性保証はしない）。
 */
import { isValidToggleOp, type ToggleOp } from "@/lib/toggle-selection";

export const REACTION_EMOJIS = ["😂", "😮", "😡", "👍"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export type ReactionCounts = Record<ReactionEmoji, number>;

/** 値が既定のリアクション絵文字のいずれかであるかを判定する型ガード。 */
export function isValidReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(value);
}

/** リアクションAPIの操作種別（拡張E13: 加算/減算）。共通の ToggleOp を単一ソースとして用いる。 */
export type ReactionOp = ToggleOp;

/** 値がリアクション操作種別("add"/"remove")のいずれかであるかを判定する型ガード（ToggleOp 共用）。 */
export const isValidReactionOp = isValidToggleOp;

/**
 * DB から取得した `{emoji, count}` 行の配列を、既定の絵文字すべてを持つ
 * `ReactionCounts` にマージする。未登録（まだ1度も押されていない）絵文字は0件で補い、
 * 既定外の絵文字（過去データ・不正値）は無視する。
 */
export function mergeReactionCounts(rows: { emoji: string; count: number }[]): ReactionCounts {
  const base = Object.fromEntries(REACTION_EMOJIS.map((emoji) => [emoji, 0])) as ReactionCounts;
  for (const row of rows) {
    if (isValidReactionEmoji(row.emoji)) {
      base[row.emoji] = row.count;
    }
  }
  return base;
}
