"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { NoticeBar } from "@/components/notice-bar";
import { BottomOverlayStack } from "@/components/bottom-overlay-stack";

/**
 * 公開サイトのヘッダー／フッターを表示するかどうかを経路で切り替える(F14, Sprint 9)。
 * 運営監視ダッシュボード(/admin配下)は閲覧者向け公開サイトとは分離された管理画面のため、
 * 公開サイトのナビゲーション(検索フォーム・カテゴリリンク等)・お知らせバー(拡張E1)・
 * Cookie同意バナー/GA4計測タグ・アンカー広告(拡張E5)を表示しない。
 *
 * `notice`・`anchorAdCode` は env の値をサーバー側(layout.tsx)で読んで渡す
 * （クライアントコンポーネントから直接 process.env を読んでも非公開env変数はバンドルに含まれないため）。
 */
export function SiteChrome({
  children,
  notice,
  anchorAdCode,
}: {
  children: React.ReactNode;
  notice?: string;
  anchorAdCode?: string;
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
      <BottomOverlayStack anchorAdCode={anchorAdCode} />
    </>
  );
}
