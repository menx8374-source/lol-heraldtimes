"use client";

import { HtmlClassToggle } from "@/components/html-class-toggle";

/** テーマ（ライト/ダーク）の localStorage キー。layout.tsx のフラッシュ防止スクリプトと一致させる。 */
const THEME_STORAGE_KEY = "lol-matome:theme";

/**
 * テーマ切替（拡張E1、拡張E14でセグメント式に統一）。「テーマ: ライト｜ダーク」のセグメントで、
 * いまどちらのモードかを選択中セグメントのハイライトで示す。`<html>` の `dark` クラスを付け外しし、
 * Tailwind の `dark:` バリアント（globals.css の `@custom-variant dark`）で切り替える。
 * デザイン軸（DesignToggle）と同じ HtmlClassToggle に載せる（独立2軸）。
 */
export function ThemeToggle() {
  return (
    <HtmlClassToggle
      label="テーマ"
      ariaLabel="サイトのテーマ（ライト/ダーク）を切り替え"
      storageKey={THEME_STORAGE_KEY}
      options={[
        { value: "light", label: "ライト" },
        { value: "dark", label: "ダーク", htmlClass: "dark" },
      ]}
    />
  );
}
