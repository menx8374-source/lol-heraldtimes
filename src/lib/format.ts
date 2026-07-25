/** 投稿日時を「YYYY/MM/DD HH:MM」形式（日本語圏で見慣れた表記）に整形する純関数。 */
export function formatPublishedAt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} ${hh}:${mm}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_TIME_LIMIT_MS = 30 * DAY_MS;

/**
 * 投稿日時を現在時刻（サーバー時刻。呼び出し側から渡す）との差から
 * 「たった今」「N分前」「N時間前」「N日前」の相対表示にする純関数（拡張E1）。
 * 30日以上前は相対表示を続けず `formatPublishedAt` の絶対日時表記にフォールバックする。
 * 未来日時（クロックスキュー等）は負の差にせず「たった今」に丸める。
 */
export function formatRelativeTime(date: Date, now: Date): string {
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  if (diffMs < MINUTE_MS) return "たった今";
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}分前`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}時間前`;
  if (diffMs < RELATIVE_TIME_LIMIT_MS) return `${Math.floor(diffMs / DAY_MS)}日前`;
  return formatPublishedAt(date);
}
