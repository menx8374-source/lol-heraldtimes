import { getAdSlotCode, type AdSlotPosition } from "@/lib/ads/config";

export const POSITION_LABELS: Record<AdSlotPosition, string> = {
  "article-top": "記事上部広告",
  "article-in-body": "記事中広告",
  "article-bottom": "記事下広告",
  sidebar: "サイドバー広告",
  listing: "インフィード広告",
  "sidebar-sticky": "追従サイドバー広告",
  anchor: "アンカー広告",
  "matched-content": "関連コンテンツ",
};

/**
 * 広告枠（F12）。本文・ナビゲーションと誤認されないよう、常に「広告」ラベルと
 * 枠線・背景色による区切りを付けて表示する。
 *
 * 広告コード未設定時（拡張E11）は枠・ラベル・プレースホルダーを一切描画せず `null` を返す。
 * 本接続前（未設定）の画面には広告枠自体が見えず、運営者が広告コードを設定した時点で
 * 初めて枠が現れる（未設定プレースホルダーの表示は実運用で不格好なため廃止）。
 *
 * セキュリティ注意: dangerouslySetInnerHTML に渡すのは `getAdSlotCode`（環境変数＝
 * 運営者が設定した信頼済みの値）のみ。記事本文・タイトル・検索語等、閲覧者由来のデータを
 * この経路に混ぜてはならない。
 */
export function AdSlot({ position }: { position: AdSlotPosition }) {
  const code = getAdSlotCode(position);

  if (!code) {
    return null;
  }

  return (
    <div
      className="my-4 rounded border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-center dark:border-neutral-700 dark:bg-neutral-900"
      data-ad-slot={position}
      aria-label={POSITION_LABELS[position]}
    >
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        広告 / PR
      </p>
      {/* code は運営者が env に設定した広告タグ文字列のみ（getAdSlotCode 参照）。 */}
      <div dangerouslySetInnerHTML={{ __html: code }} />
    </div>
  );
}
