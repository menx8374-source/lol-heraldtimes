import type { Metadata } from "next";
import "./globals.css";
import { SiteChrome } from "@/components/site-chrome";

export const metadata: Metadata = {
  title: {
    default: "LoLまとめ速報",
    template: "%s | LoLまとめ速報",
  },
  description:
    "League of Legends（LoL）の海外・5chの反応やパッチノート・大会結果をまとめる速報サイト。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-100 text-neutral-900">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
