import type { Metadata } from "next";
import Link from "next/link";
import { DIFFICULTY_LABELS, listChampions } from "@/lib/lol-data/champions";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/lol-data/types";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { EmptyState } from "@/components/empty-state";
import { ChampionCard } from "@/components/champion-card";

// 一覧の自動更新（revalidate-S1 F-RV1-1）: A=短いISR（保険、既定300秒）。Bのオンデマンド再検証が主。
// Next.jsの静的AST解析の制約でインポート変数を参照できないため数値リテラルを直書きする
// （src/lib/revalidate-config.ts の LISTING_REVALIDATE_SECONDS と同値を維持すること）。
export const revalidate = 300;

type Props = {
  searchParams: Promise<{ role?: string }>;
};

function isRole(value: string | undefined): value is Role {
  return !!value && (ROLES as readonly string[]).includes(value);
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { role } = await searchParams;
  const label = isRole(role) ? ROLE_LABELS[role] : null;
  return {
    title: label ? `${label}のチャンピオン一覧` : "チャンピオン一覧",
    description: label
      ? `${label}ロールのLoLチャンピオンをオリジナル解説付きで一覧できます。役割・難易度・Tierも確認できます。`
      : "League of Legends（LoL）のチャンピオンをロール別に一覧できる攻略データページ。役割・難易度・簡単な解説を掲載しています。",
  };
}

/**
 * チャンピオン一覧ページ（拡張E6）。ロールで絞り込みできる一覧。
 * データは `src/lib/lol-data/champions.ts` のオリジナル創作モック（将来の実データ差し替え前提）。
 */
export default async function ChampionsPage({ searchParams }: Props) {
  const { role: roleParam } = await searchParams;
  const role = isRole(roleParam) ? roleParam : undefined;
  const champions = listChampions(role);

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: "チャンピオン一覧", path: "/champions" },
        ]}
      />
      <h1 className="mb-2 text-lg font-bold">チャンピオン一覧</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        役割・難易度・簡単な解説は当サイト独自の書き起こしによるものです。
      </p>

      <nav aria-label="ロールで絞り込み" className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link
          href="/champions"
          className={`rounded-full border px-3 py-1 ${
            !role
              ? "border-sky-600 bg-sky-600 text-white"
              : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
        >
          すべて
        </Link>
        {ROLES.map((r) => (
          <Link
            key={r}
            href={`/champions?role=${r}`}
            className={`rounded-full border px-3 py-1 ${
              role === r
                ? "border-sky-600 bg-sky-600 text-white"
                : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {ROLE_LABELS[r]}
          </Link>
        ))}
      </nav>

      {champions.length === 0 ? (
        <EmptyState message="該当するチャンピオンがいません" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {champions.map((c) => (
            <ChampionCard key={c.slug} champion={c} />
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] text-neutral-400 dark:text-neutral-500">
        難易度目安: {Object.entries(DIFFICULTY_LABELS).map(([k, v]) => `★${k}=${v}`).join(" / ")}
      </p>
    </PageWithSidebar>
  );
}
