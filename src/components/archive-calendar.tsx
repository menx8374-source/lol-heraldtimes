import Link from "next/link";
import type { CalendarCell } from "@/lib/archive";
import { dateLabel, monthLabel } from "@/lib/archive";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 月カレンダー（日付グリッド）表示（拡張E10）。記事のある日を強調バッジで示し、
 * クリックするとその日の記事一覧（/archive/[date]）に遷移する。前月/翌月ナビゲーションも持つ。
 */
export function ArchiveCalendar({
  monthKey,
  cells,
  prevMonthKey,
  nextMonthKey,
}: {
  monthKey: string;
  cells: CalendarCell[];
  prevMonthKey: string;
  nextMonthKey: string;
}) {
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return (
    <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-3 flex items-center justify-between">
        <Link
          href={`/archive/${prevMonthKey}`}
          className="rounded border border-neutral-300 px-2 py-1 text-sm text-sky-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-sky-400 dark:hover:bg-neutral-800"
          aria-label="前月"
        >
          &laquo; 前月
        </Link>
        <h2 className="text-sm font-bold text-neutral-700 dark:text-neutral-200">
          {monthLabel(monthKey)}
        </h2>
        <Link
          href={`/archive/${nextMonthKey}`}
          className="rounded border border-neutral-300 px-2 py-1 text-sm text-sky-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-sky-400 dark:hover:bg-neutral-800"
          aria-label="翌月"
        >
          翌月 &raquo;
        </Link>
      </div>
      <table className="w-full table-fixed border-collapse text-center text-xs">
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((label) => (
              <th key={label} className="pb-1 font-normal text-neutral-500 dark:text-neutral-400">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((cell, j) => (
                <td key={j} className="p-0.5 align-top">
                  {cell.date ? (
                    <Link
                      href={`/archive/${cell.date}`}
                      aria-label={dateLabel(cell.date)}
                      className={`flex h-12 flex-col items-center justify-center rounded ${
                        cell.count > 0
                          ? "bg-sky-100 font-bold text-sky-800 hover:bg-sky-200 dark:bg-sky-900 dark:text-sky-200 dark:hover:bg-sky-800"
                          : "text-neutral-400 hover:bg-neutral-100 dark:text-neutral-600 dark:hover:bg-neutral-800"
                      }`}
                    >
                      <span>{cell.day}</span>
                      {cell.count > 0 && (
                        <span className="text-[10px] leading-none">{cell.count}件</span>
                      )}
                    </Link>
                  ) : (
                    <div className="h-12" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
