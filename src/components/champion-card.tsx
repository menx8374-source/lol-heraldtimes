import Link from "next/link";
import type { ChampionEntry } from "@/lib/lol-data/champions";
import { DIFFICULTY_LABELS } from "@/lib/lol-data/champions";
import { ROLE_LABELS } from "@/lib/lol-data/types";
import { TierBadge } from "@/components/tier-badge";

/** チャンピオン一覧の1カード。 */
export function ChampionCard({ champion }: { champion: ChampionEntry }) {
  return (
    <Link
      href={`/champions/${champion.slug}`}
      className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm hover:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-sky-500"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{champion.name}</span>
        <TierBadge tier={champion.tier} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="rounded-full border border-neutral-300 px-2 py-0.5 dark:border-neutral-600">
          {ROLE_LABELS[champion.role]}
        </span>
        <span>難易度: {DIFFICULTY_LABELS[champion.difficulty]}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-300">
        {champion.summary}
      </p>
    </Link>
  );
}
