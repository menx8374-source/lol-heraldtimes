import type { Metadata } from "next";
import "./globals.css";
import { SiteChrome } from "@/components/site-chrome";
import { getSiteNotice } from "@/lib/notice";
import { getAdSlotCode } from "@/lib/ads/config";
import { NO_FLASH_DESIGN_SCRIPT } from "@/lib/no-flash-scripts";

export const metadata: Metadata = {
  title: {
    default: "LoLまとめ速報",
    template: "%s | LoLまとめ速報",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const notice = getSiteNotice();
  // アンカー広告（拡張E5）のタグは非公開env(AD_SLOT_ANCHOR)のためサーバー側で読み、
  // クライアントコンポーネント(SiteChrome→AnchorAdBar)へpropsで渡す(NoticeBarと同じ方式)。
  const anchorAdCode = getAdSlotCode("anchor");

  return (
    <html lang="ja" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_DESIGN_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <SiteChrome notice={notice} anchorAdCode={anchorAdCode}>
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
