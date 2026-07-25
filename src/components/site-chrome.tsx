"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { NoticeBar } from "@/components/notice-bar";

/**
 * 公開サイトのヘッダー／フッターを表示するかどうかを経路で切り替える(F14, Sprint 9)。
 * 運営監視ダッシュボード(/admin配下)は閲覧者向け公開サイトとは分離された管理画面のため、
 * 公開サイトのナビゲーション(検索フォーム・カテゴリリンク等)・お知らせバー(拡張E1)を表示しない。
 *
 * `notice` は env(SITE_NOTICE) の値をサーバー側(layout.tsx)で読んで渡す
 * （クライアントコンポーネントから直接 process.env を読んでも非公開env変数はバンドルに含まれないため）。
 */
export function SiteChrome({
  children,
  notice,
}: {
  children: React.ReactNode;
  notice?: string;
}) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin") ?? false;

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      {notice && <NoticeBar message={notice} />}
      <SiteHeader />
      <main className="flex-1 w-full">{children}</main>
      <SiteFooter />
    </>
  );
}
