"use client";

import { useState } from "react";

const STORAGE_KEY = "lol-matome:theme";
type Theme = "light" | "dark";

/**
 * 初期テーマを決定する。localStorage の保存値 > prefers-color-scheme の順で判定する。
 * SSR時（window未定義）は "light" にフォールバックする（実際の初期表示クラスは
 * layout.tsx のフラッシュ防止スクリプトが描画前に同期的に付与済みなので、ここは
 * トグルボタンのラベル表示用の初期値決定にすぎない）。
 */
function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage 不可時は prefers-color-scheme のみで判定する。
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * ダークモード切替トグル（拡張E1）。`<html>` に `dark` クラスを付け外しし、
 * Tailwind の `dark:` バリアント（globals.css の `@custom-variant dark`）で切り替える。
 * 状態更新はクリック時のイベントハンドラでのみ行う（初期テーマの決定は useState の
 * 遅延初期化関数で行い、useEffect でのマウント後setStateは使わない）。
 *
 * SSR時の初期ラベルと、クライアントでの実際のテーマ（localStorage/prefers-color-scheme依存）が
 * 食い違いうるため、ボタンのテキストのみ suppressHydrationWarning でハイドレーション不整合警告を抑止する
 * （実際のクラス付与は layout.tsx のフラッシュ防止スクリプトが担うため、表示上のズレは発生しない）。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  function handleToggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 保存できなくても表示上の切替自体はそのまま成立させる。
    }
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label="ダークモード切替"
      suppressHydrationWarning
      className="shrink-0 rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
    >
      {theme === "dark" ? "☀️ ライト" : "🌙 ダーク"}
    </button>
  );
}
