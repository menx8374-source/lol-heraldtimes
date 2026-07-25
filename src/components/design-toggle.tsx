"use client";

import { DESIGN_CLASS, DESIGN_STORAGE_KEY } from "@/lib/design-mode";
import { HtmlClassToggle } from "@/components/html-class-toggle";

/**
 * サイトの表示デザイン切替（拡張E14）。「デザイン: 標準｜ニュース記事風」のセグメント式で、
 * サイトの見た目を切り替える機能であること・いまどちらのモードかを一目で示す。
 * テーマ（ライト/ダーク、ThemeToggle）とは独立した軸。共通の HtmlClassToggle に載せる。
 */
export function DesignToggle() {
  return (
    <HtmlClassToggle
      label="デザイン"
      ariaLabel="サイトの表示デザインを切り替え"
      htmlClass={DESIGN_CLASS}
      storageKey={DESIGN_STORAGE_KEY}
      options={[
        { value: "classic", label: "標準" },
        { value: "news", label: "ニュース記事風" },
      ]}
    />
  );
}
