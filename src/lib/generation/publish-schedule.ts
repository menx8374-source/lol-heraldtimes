/**
 * 投稿スケジュール分散（成長G6 F-G6-1）。日本時間(JST=UTC+9)の公開時刻テーブルに基づき、
 * ある基準時刻(now)以降で直近のスロットからcount個の公開時刻を1スロット1件・昇順で返す純関数。
 *
 * TZ非依存: プロセスのローカルTZ(process.env.TZ)に一切依存せず、UTC基準の計算のみで
 * JSTの時刻を判定する（`Date#getHours`等のローカルTZ依存メソッドは使わない）。
 * JSTはDSTが無いため、UTC+9固定のオフセット計算だけで正しく扱える。
 */

/** JSTとUTCの固定オフセット（ミリ秒）。JSTはDST無しのため年間を通じて一定。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 1日のミリ秒数（JSTはDST無しのため、UTC上でも常に24時間として扱える）。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 公開スロット（JST、分単位）: 07:15 / 12:15 / 15:15 / 18:15 / 21:15。
 * 定数テーブルとして持ち、必要であれば将来ここだけを差し替えられるようにする。
 */
export const PUBLISH_SLOT_MINUTES_OF_DAY: readonly number[] = [
  7 * 60 + 15, // 07:15
  12 * 60 + 15, // 12:15
  15 * 60 + 15, // 15:15
  18 * 60 + 15, // 18:15
  21 * 60 + 15, // 21:15
];

/**
 * `now` を含むJST暦日の「JST 00:00」に対応する実時刻(UTCミリ秒)を返す。
 * `now`をUTC+9時間シフトした上でUTC getterを使うことで、ローカルTZに一切依存せずJSTの暦日を求める。
 */
function jstDayStartUtcMs(now: Date): number {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  // 「JSTのY/M/D 00:00」を表すUTC時刻 = そのY/M/D 00:00(UTC扱い) - 9時間
  return Date.UTC(y, m, d, 0, 0, 0, 0) - JST_OFFSET_MS;
}

/**
 * `now` 以降で最も近い公開スロットから `count` 個の公開時刻(UTCのDate、昇順)を返す。
 * 1スロットにつき1件のみ割り当てるため、同日のスロットが尽きれば翌日の先頭スロットへ繰り越す。
 * 決定論・DB非依存・純関数（単体テスト可能）。count<=0のときは空配列を返す。
 */
export function nextPublishSlots(now: Date, count: number): Date[] {
  if (!Number.isFinite(count) || count <= 0) return [];

  const slots: Date[] = [];
  const nowMs = now.getTime();
  let dayStart = jstDayStartUtcMs(now);

  // スロットは1日あたり最大5個なので、count個集めるのに必要な日数は高々 count 日程度。
  // 安全のため十分大きい上限(count分の日数+2日)でループを打ち切る（無限ループ防止の安全網）。
  const maxDaysToScan = Math.ceil(count / PUBLISH_SLOT_MINUTES_OF_DAY.length) + 2;

  for (let dayOffset = 0; dayOffset < maxDaysToScan && slots.length < count; dayOffset++) {
    for (const minuteOfDay of PUBLISH_SLOT_MINUTES_OF_DAY) {
      const slotMs = dayStart + minuteOfDay * 60_000;
      if (slotMs >= nowMs) {
        slots.push(new Date(slotMs));
        if (slots.length >= count) break;
      }
    }
    dayStart += DAY_MS;
  }

  return slots;
}
