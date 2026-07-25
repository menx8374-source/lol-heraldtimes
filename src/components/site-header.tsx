import Link from "next/link";
import { CATEGORY_LABELS, categorySlugFor } from "@/lib/categories";
import { SearchForm } from "@/components/search-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { DesignToggle } from "@/components/design-toggle";

export function SiteHeader() {
  return (
    <header data-site-header className="w-full bg-neutral-900 text-white">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex flex-col">
            <span className="text-xl font-bold tracking-tight">LoLまとめ速報</span>
            <span className="text-xs text-neutral-400">
              海外・5chの反応 / パッチ情報 / eスポーツをまとめて速報
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <SearchForm />
            <ThemeToggle />
            <DesignToggle />
          </div>
        </div>
        <nav
          aria-label="カテゴリ"
          data-nav-primary
          className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm"
        >
          {/* 「トップ」= ロゴ（LoLまとめ速報）と同じく全記事一覧のトップページ（/）へ遷移する。 */}
          <Link href="/" className="text-neutral-300 hover:text-white hover:underline">
            トップ
          </Link>
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
        {/* 攻略・データ固定ページ（拡張E6）への導線。カテゴリnavとは分けて表示する。 */}
        <nav
          aria-label="攻略・データ"
          data-nav-secondary
          className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-800 pt-2 text-xs"
        >
          <Link href="/champions" className="text-neutral-400 hover:text-white hover:underline">
            チャンピオン一覧
          </Link>
          <Link href="/tier" className="text-neutral-400 hover:text-white hover:underline">
            Tier表
          </Link>
          <Link href="/patches" className="text-neutral-400 hover:text-white hover:underline">
            パッチノート
          </Link>
          <Link href="/glossary" className="text-neutral-400 hover:text-white hover:underline">
            用語集
          </Link>
          <Link href="/tags" className="text-neutral-400 hover:text-white hover:underline">
            タグ一覧
          </Link>
          <Link href="/archive" className="text-neutral-400 hover:text-white hover:underline">
            アーカイブ
          </Link>
        </nav>
      </div>
    </header>
  );
}
