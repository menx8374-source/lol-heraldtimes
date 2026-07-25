/**
 * アンカー広告（拡張E5）の閉じる状態の判定。画面下部固定・閉じるボタン付きの広告枠は、
 * 一度閉じたら再表示を抑止する（localStorageにフラグを保存）。ここではDOM/localStorageに
 * 触れず、読み取った生の値から表示可否を判定する純関数のみを扱う（テスト容易性のため）。
 */

export const ANCHOR_AD_DISMISS_STORAGE_KEY = "lol-matome:anchor-ad-dismissed";

/** localStorageから読んだ生値がアンカー広告「閉じた」状態を表すかどうか。 */
export function isAnchorAdDismissed(rawValue: string | null | undefined): boolean {
  return rawValue === "1";
}

/** アンカー広告を表示してよいか（=まだ閉じられていない場合のみ）。 */
export function shouldShowAnchorAd(rawValue: string | null | undefined): boolean {
  return !isAnchorAdDismissed(rawValue);
}
