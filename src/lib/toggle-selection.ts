/**
 * 「1記事につき1リアクション」「1コメントにつき1票」のような、常に同時に1つだけ選択可能な
 * UIの次アクションを決める純関数（拡張E13）。DB・localStorageに依存しないため、
 * 記事の絵文字リアクション・コメントの賛否投票の両方で共通利用する。
 *
 * - 未選択 → 対象を押す: 新規選択（addのみ）
 * - 選択中の対象を再度押す: 選択解除（removeのみ、トグル）
 * - 選択中と異なる対象を押す: 切替（旧をremove・新をadd）
 */

export type ToggleOp = "add" | "remove";

/** 値がトグル操作種別("add"/"remove")のいずれかであるかを判定する型ガード（API境界の検証で共用）。 */
export function isValidToggleOp(value: string): value is ToggleOp {
  return value === "add" || value === "remove";
}

export type ToggleRequest<T> = { value: T; op: ToggleOp };

export type ToggleResult<T> = { selection: T | null; requests: ToggleRequest<T>[] };

export function computeToggle<T>(current: T | null, clicked: T): ToggleResult<T> {
  if (current === clicked) {
    return { selection: null, requests: [{ value: clicked, op: "remove" }] };
  }
  if (current === null) {
    return { selection: clicked, requests: [{ value: clicked, op: "add" }] };
  }
  return {
    selection: clicked,
    requests: [
      { value: current, op: "remove" },
      { value: clicked, op: "add" },
    ],
  };
}
