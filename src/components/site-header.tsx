import Link from "next/link";
import { CATEGORY_LABELS, categorySlugFor } from "@/lib/categories";
import { SearchForm } from "@/components/search-form";

export function SiteHeader() {
  return (
    <header className="w-full bg-neutral-900 text-white">
      <div className="mx-auto max-w-5xl px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex flex-col">
            <span className="text-xl font-bold tracking-tight">LoLまとめ速報</span>
            <span className="text-xs text-neutral-400">
              海外・5chの反応 / パッチ情報 / eスポーツをまとめて速報
            </span>
          </Link>
          <SearchForm />
        </div>
        <nav
          aria-label="カテゴリ"
          className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm"
        >
          {CATEGORY_LABELS.map((label) => {
            const slug = categorySlugFor(label);
            if (!slug) return null;
            return (
              <Link
                key={label}
                href={`/category/${slug}`}
                className="text-neutral-300 hover:text-white hover:underline"
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
