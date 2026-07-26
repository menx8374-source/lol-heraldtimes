import Link from "next/link";
import { CATEGORY_LABELS, categorySlugFor } from "@/lib/categories";
import { SearchForm } from "@/components/search-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { DesignToggle } from "@/components/design-toggle";
import { SITE_NAME } from "@/lib/site";

export function SiteHeader() {
  return (
    <header data-site-header className="w-full bg-neutral-900 text-white">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-3">
            {/* マスコット題字ロゴ（拡張E21）。イラスト背景と同じ生成り色(#fdf5f0)の角丸チップに
                載せることで、常時ダークなヘッダー帯（design-news含む全デザイン共通）でも切り抜き
                不要で自然に溶け込む。画像はテキスト題字を持つリンク内の装飾のため alt は空。 */}
            <span className="shrink-0 rounded-lg bg-[#fdf5f0] p-0.5 shadow-sm">
              <img
                src="/mascot-header.webp"
                alt=""
                width={512}
                height={341}
                className="block h-11 w-auto rounded-md sm:h-14"
              />
            </span>
            <span className="flex flex-col">
              <span className="text-lg font-bold tracking-tight sm:text-xl">{SITE_NAME}</span>
              <span className="text-xs text-neutral-400">
                海外・5chの反応 / パッチ情報 / eスポーツをまとめて速報
              </span>
            </span>
          </Link>
          {/* 右側コントロール列。狭幅では横溢れ（検索が潰れ・トグルが画面外）を防ぐため、
              モバイルは全幅の別行に落として内部で折り返し、sm以上は従来どおり1行右寄せ（拡張E21）。 */}
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap sm:justify-end">
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
          {/* 「トップ」= ロゴ（へらるど速報@lolまとめ）と同じく全記事一覧のトップページ（/）へ遷移する。 */}
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
