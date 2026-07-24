/**
 * 未確定・噂レベルの情報検出（F9）。該当する記事は保留にはせず、「未確認」ラベルを付けたうえで
 * 公開する（brief: 「未確定・噂レベルと判定された情報には『未確認』ラベルが付与された上で公開される」）。
 */
export const RUMOR_MARKERS = ["噂", "未確定", "真偽不明", "リーク情報", "噂レベル"] as const;

/** text（タイトル+本文）に未確定・噂レベルを示すマーカー語が含まれるか。 */
export function containsRumorMarker(text: string): boolean {
  return RUMOR_MARKERS.some((marker) => text.includes(marker));
}
