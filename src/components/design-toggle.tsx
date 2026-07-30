"use client";

import { DESIGN_HEXTECH_CLASS, DESIGN_NEWS_CLASS, DESIGN_STORAGE_KEY } from "@/lib/design-mode";
import { HtmlClassToggle } from "@/components/html-class-toggle";

/**
 * サイトの表示デザイン切替（拡張E14、拡張E45でHextechを追加し3択に）。
 * 「デザイン: 標準｜ニュース記事風｜Hextech」のセグメント式で、サイトの見た目を切り替える機能で
 * あること・いまどのモードかを一目で示す。テーマ（ライト/ダーク、ThemeToggle）とは独立した軸。
 * 共通の HtmlClassToggle（相互排他クラス群）に載せる。
 */
export function DesignToggle() {
  return (
    <HtmlClassToggle
      label="デザイン"
      ariaLabel="サイトの表示デザインを切り替え"
      storageKey={DESIGN_STORAGE_KEY}
      options={[
        { value: "classic", label: "標準" },
        { value: "news", label: "ニュース記事風", htmlClass: DESIGN_NEWS_CLASS },
        { value: "hextech", label: "Hextech", htmlClass: DESIGN_HEXTECH_CLASS },
      ]}
    />
  );
}
