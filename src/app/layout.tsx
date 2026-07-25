import type { Metadata } from "next";
import "./globals.css";
import { SiteChrome } from "@/components/site-chrome";
import { getSiteNotice } from "@/lib/notice";

export const metadata: Metadata = {
  title: {
    default: "LoLまとめ速報",
    template: "%s | LoLまとめ速報",
  },
  description:
    "League of Legends（LoL）の海外・5chの反応やパッチノート・大会結果をまとめる速報サイト。",
};

// ダークモード（拡張E1）の初期テーマを描画前に決定し、<html>にクラスを付与するスクリプト。
// React水和後に効かせると一瞬ライトテーマがちらつく（FOUC）ため、<head>で同期的に実行する。
// 埋め込む値はユーザー入力を含まない固定の静的スクリプトのみ（DBデータ等は混ぜない）。
const NO_FLASH_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('lol-matome:theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const notice = getSiteNotice();

  return (
    <html lang="ja" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <SiteChrome notice={notice}>{children}</SiteChrome>
      </body>
    </html>
  );
}
