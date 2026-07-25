import { getBlogRankingHtml } from "@/lib/blog-ranking";

/**
 * ブログランキング/外部集客枠（拡張E4）。にほんブログ村等の外部ランキングバナー・リンクを
 * 差し込める枠。実際のバナーHTML/リンクは env(BLOG_RANKING_HTML) で運営者が設定した
 * 信頼済みの値のみを扱う（広告枠 AdSlot と同じ方式。閲覧者由来のデータは混ぜない）。
 * 未設定時はプレースホルダーを表示する。
 */
export function BlogRankingSlot() {
  const html = getBlogRankingHtml();

  return (
    <div
      className="mt-4 rounded border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-center dark:border-neutral-700 dark:bg-neutral-900"
      data-blog-ranking-slot=""
    >
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        応援クリックお願いします
      </p>
      {html ? (
        // html は運営者が env に設定したランキングバナーのタグ文字列のみ（getBlogRankingHtml 参照）。
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="py-2 text-xs text-neutral-400 dark:text-neutral-500">ブログランキング（未設定）</p>
      )}
    </div>
  );
}
