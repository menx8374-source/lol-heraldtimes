import type { Metadata } from "next";
import "./globals.css";
import { SiteChrome } from "@/components/site-chrome";
import { getSiteNotice } from "@/lib/notice";
import { getAdSlotCode } from "@/lib/ads/config";
import { NO_FLASH_DESIGN_SCRIPT } from "@/lib/no-flash-scripts";
import { SITE_NAME } from "@/lib/site";
import { listVisibleCategoryLabels } from "@/lib/category-visibility";

export const metadata: Metadata = {
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "League of Legends（LoL）の海外・5chの反応やパッチノート・大会結果をまとめる速報サイト。",
  // RSSフィード（拡張E4）。<head>に <link rel="alternate" type="application/rss+xml"> を出力する。
  alternates: {
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
};

// ダークモード（拡張E1）の初期テーマを描画前に決定し、<html>にクラスを付与するスクリプト。
// React水和後に効かせると一瞬ライトテーマがちらつく（FOUC）ため、<head>で同期的に実行する。
// 埋め込む値はユーザー入力を含まない固定の静的スクリプトのみ（DBデータ等は混ぜない）。
const NO_FLASH_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('lol-matome:theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`;

// デザイン軸（classic/news、拡張E14）の初期状態を描画前に決定するスクリプト。実体は
// lib/no-flash-scripts.ts（DesignToggle とキー名/クラス名を共有し、テストで検証済み）。

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const notice = getSiteNotice();
  // アンカー広告（拡張E5）のタグは非公開env(AD_SLOT_ANCHOR)のためサーバー側で読み、
  // クライアントコンポーネント(SiteChrome→AnchorAdBar)へpropsで渡す(NoticeBarと同じ方式)。
  const anchorAdCode = getAdSlotCode("anchor");
  // ヘッダーナビに出すカテゴリ（リファクタリングS7a F-S7a-2）: 公開記事があるカテゴリのみに絞る。
  const categories = await listVisibleCategoryLabels();

  return (
    <html lang="ja" className="h-full antialiased" suppressHydrationWarning>
      {/* suppressHydrationWarning: <head>のNO_FLASH_THEME/DESIGN_SCRIPTが水和前に<html>へ
          dark/design-newsクラスを付与するため、SSR(クラス無し)とクライアント(クラス有り)で
          <html>の属性が意図的に食い違う。この1階層のみ警告を抑制する(子孫の本物の不一致は検知される)。 */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_DESIGN_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <SiteChrome notice={notice} anchorAdCode={anchorAdCode} categories={categories}>
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
