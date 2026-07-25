import Link from "next/link";
import { buildBreadcrumbJsonLd, toSafeJsonLd, type BreadcrumbItem } from "@/lib/seo";
import { getSiteUrl } from "@/lib/site";

/**
 * パンくずリスト（拡張E4）。可視のナビゲーション表示に加え、BreadcrumbList の JSON-LD を
 * 併せて出力する。最後の項目は現在ページとしてリンクにしない。
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const siteUrl = getSiteUrl();
  const jsonLd = buildBreadcrumbJsonLd(items, siteUrl);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toSafeJsonLd(jsonLd) }}
      />
      <nav
        data-breadcrumbs
        className="mb-3 text-xs text-neutral-500 dark:text-neutral-400"
        aria-label="パンくずリスト"
      >
        {items.map((item, index) => (
          <span key={item.path}>
            {index > 0 && <span className="mx-1">/</span>}
            {index === items.length - 1 ? (
              <span>{item.name}</span>
            ) : (
              <Link href={item.path} className="hover:underline">
                {item.name}
              </Link>
            )}
          </span>
        ))}
      </nav>
    </>
  );
}
