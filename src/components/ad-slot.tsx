import { getAdSlotCode, type AdSlotPosition } from "@/lib/ads/config";

const POSITION_LABELS: Record<AdSlotPosition, string> = {
  "article-top": "記事上部広告",
  "article-in-body": "記事中広告",
  "article-bottom": "記事下広告",
  sidebar: "サイドバー広告",
  listing: "一覧広告",
};

/**
 * 広告枠（F12）。本文・ナビゲーションと誤認されないよう、常に「広告」ラベルと
 * 枠線・背景色による区切りを付けて表示する。広告コード未設定時はプレースホルダーを表示する。
 *
 * セキュリティ注意: dangerouslySetInnerHTML に渡すのは `getAdSlotCode`（環境変数＝
 * 運営者が設定した信頼済みの値）のみ。記事本文・タイトル・検索語等、閲覧者由来のデータを
 * この経路に混ぜてはならない。
 */
export function AdSlot({ position }: { position: AdSlotPosition }) {
  const code = getAdSlotCode(position);

  return (
    <div
      className="my-4 rounded border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-center"
      data-ad-slot={position}
      aria-label={POSITION_LABELS[position]}
    >
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">
        広告 / PR
      </p>
      {code ? (
        // code は運営者が env に設定した広告タグ文字列のみ（getAdSlotCode 参照）。
        <div dangerouslySetInnerHTML={{ __html: code }} />
      ) : (
        <p className="py-4 text-xs text-neutral-400">広告枠（未設定）</p>
      )}
    </div>
  );
}
