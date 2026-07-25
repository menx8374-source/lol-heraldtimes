import Link from "next/link";
import type { ArchiveMonth } from "@/lib/archive";

/** サイドバー「月別アーカイブ」ウィジェット（拡張E4）。直近の月を件数付きで表示する。 */
export function ArchiveWidget({ months }: { months: ArchiveMonth[] }) {
  return (
    <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-bold text-neutral-700 dark:text-neutral-200">月別アーカイブ</h2>
      {months.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">記事がありません</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {months.map((m) => (
            <li key={m.key}>
              <Link href={`/archive/${m.key}`} className="text-sm hover:underline">
                {m.label}（{m.count}）
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/archive"
        className="mt-2 inline-block text-xs text-sky-700 hover:underline dark:text-sky-400"
      >
        すべて見る &rarr;
      </Link>
    </section>
  );
}
