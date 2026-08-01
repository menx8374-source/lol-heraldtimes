import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DIFFICULTY_LABELS, getChampionBySlug, listChampions } from "@/lib/lol-data/champions";
import { ROLE_LABELS } from "@/lib/lol-data/types";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ChampionCard } from "@/components/champion-card";
import { TierBadge } from "@/components/tier-badge";

// 一覧の自動更新（revalidate-S1 F-RV1-1）: A=短いISR（保険、既定300秒）。Bのオンデマンド再検証が主。
// Next.jsの静的AST解析の制約でインポート変数を参照できないため数値リテラルを直書きする
// （src/lib/revalidate-config.ts の LISTING_REVALIDATE_SECONDS と同値を維持すること）。
export const revalidate = 300;

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const champion = getChampionBySlug(slug);
  if (!champion) {
    return { title: "チャンピオンが見つかりません" };
  }
  return {
    title: `${champion.name}の役割・Tier・難易度`,
    description: `${champion.name}（${ROLE_LABELS[champion.role]}）の解説。${champion.summary}`,
  };
}

/** チャンピオン個別ページ（拡張E6）。解説はすべて当サイト独自の創作モックデータ。 */
export default async function ChampionDetailPage({ params }: Props) {
  const { slug } = await params;
  const champion = getChampionBySlug(slug);

  if (!champion) {
    notFound();
  }

  const others = listChampions(champion.role)
    .filter((c) => c.slug !== champion.slug)
    .slice(0, 3);

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: "チャンピオン一覧", path: "/champions" },
          { name: champion.name, path: `/champions/${champion.slug}` },
        ]}
      />

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{champion.name}</h1>
        <TierBadge tier={champion.tier} />
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="rounded-full border border-neutral-300 px-2 py-0.5 dark:border-neutral-600">
          {ROLE_LABELS[champion.role]}
        </span>
        <span>難易度: {DIFFICULTY_LABELS[champion.difficulty]}</span>
        <Link href={`/tier#role-${champion.role}`} className="text-sky-700 hover:underline dark:text-sky-400">
          {ROLE_LABELS[champion.role]}のTier表を見る
        </Link>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-neutral-700 dark:text-neutral-200">
        {champion.summary}
      </p>

      <p className="mt-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        本ページの役割・Tier・解説は当サイト独自の見解によるオリジナルの創作コンテンツです。
      </p>

      {others.length > 0 && (
        <section className="mt-8 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <h2 className="mb-3 text-sm font-bold text-neutral-600 dark:text-neutral-300">
            同じロールの他のチャンピオン
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((c) => (
              <ChampionCard key={c.slug} champion={c} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-6">
        <Link href="/champions" className="text-sm text-sky-700 hover:underline dark:text-sky-400">
          &larr; チャンピオン一覧へ戻る
        </Link>
      </div>
    </PageWithSidebar>
  );
}
