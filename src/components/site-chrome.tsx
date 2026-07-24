"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

/**
 * 公開サイトのヘッダー／フッターを表示するかどうかを経路で切り替える(F14, Sprint 9)。
 * 運営監視ダッシュボード(/admin配下)は閲覧者向け公開サイトとは分離された管理画面のため、
 * 公開サイトのナビゲーション(検索フォーム・カテゴリリンク等)を表示しない。
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin") ?? false;

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      <SiteHeader />
      <main className="flex-1 w-full">{children}</main>
      <SiteFooter />
    </>
  );
}
