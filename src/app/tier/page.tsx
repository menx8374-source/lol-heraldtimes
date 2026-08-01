import type { Metadata } from "next";
import Link from "next/link";
import { buildAllTierTables } from "@/lib/lol-data/tier";
import { listPatches } from "@/lib/lol-data/patches";
import { ROLE_LABELS } from "@/lib/lol-data/types";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { TierBadge } from "@/components/tier-badge";

// 一覧の自動更新（revalidate-S1 F-RV1-1）: A=短いISR（保険、既定300秒）。Bのオンデマンド再検証が主。
// Next.jsの静的AST解析の制約でインポート変数を参照できないため数値リテラルを直書きする
// （src/lib/revalidate-config.ts の LISTING_REVALIDATE_SECONDS と同値を維持すること）。
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Tier表（ロール別）",
  description:
    "League of Legends（LoL）のロール別(TOP/JG/MID/ADC/SUP) Tier表。S/A/B/Cでチャンピオンを分類した当サイト独自の見解です。",
};

/** Tier表ページ（拡張E6）。ロール別にS/A/B/Cでチャンピオンを分類する当サイト独自の創作コンテンツ。 */
export default function TierPage() {
  const tables = buildAllTierTables();
  const [latestPatch] = listPatches();

  return (
    <PageWithSidebar>
      <Breadcrumbs items={[{ name: "トップ", path: "/" }, { name: "Tier表", path: "/tier" }]} />
      <h1 className="mb-2 text-lg font-bold">Tier表（ロール別）</h1>

      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        本Tier表は当サイト独自の見解によるものであり、公式の評価や他サイトのランキングとは異なります。
        {latestPatch && ` （基準パッチ: v${latestPatch.version} 時点）`}
      </p>

      <nav aria-label="ロールへジャンプ" className="mt-4 flex flex-wrap gap-2 text-sm">
        {tables.map(({ role }) => (
          <a
            key={role}
            href={`#role-${role}`}
            className="rounded-full border border-neutral-300 px-3 py-1 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {ROLE_LABELS[role]}
          </a>
        ))}
      </nav>

      <div className="mt-6 flex flex-col gap-8">
        {tables.map(({ role, rows }) => (
          <section key={role} id={`role-${role}`} className="scroll-mt-20">
            <h2 className="mb-3 text-base font-bold">{ROLE_LABELS[role]}</h2>
            <div className="flex flex-col gap-2">
              {rows.map((row) => (
                <div
                  key={row.tier}
                  className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm sm:flex-row sm:items-start dark:border-neutral-700 dark:bg-neutral-900"
                >
                  <div className="flex shrink-0 items-center gap-2 sm:w-16">
                    <TierBadge tier={row.tier} />
                    <span className="text-xs text-neutral-500 dark:text-neutral-400 sm:hidden">Tier</span>
                  </div>
                  {row.champions.length === 0 ? (
                    <p className="text-xs text-neutral-400 dark:text-neutral-500">該当なし</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {row.champions.map((c) => (
                        <Link
                          key={c.slug}
                          href={`/champions/${c.slug}`}
                          className="rounded-full border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
                        >
                          {c.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageWithSidebar>
  );
}
