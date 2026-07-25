import type { Tier } from "@/lib/lol-data/types";

/** Tierランクごとの配色（S/A/B/C）。チャンピオン一覧・詳細・Tier表で共通に使う。 */
const TIER_COLORS: Record<Tier, string> = {
  S: "bg-rose-600 text-white",
  A: "bg-amber-500 text-white",
  B: "bg-emerald-600 text-white",
  C: "bg-neutral-500 text-white",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold ${TIER_COLORS[tier]}`}
      aria-label={`Tier ${tier}`}
    >
      {tier}
    </span>
  );
}
