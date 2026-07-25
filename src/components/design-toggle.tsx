"use client";

import { useState } from "react";
import { DESIGN_CLASS, DESIGN_STORAGE_KEY, decideInitialDesign, type DesignMode } from "@/lib/design-mode";

/**
 * 初期デザインを決定する（ブラウザ側）。localStorage の保存値を読み、判定自体は
 * design-mode.ts の純関数 decideInitialDesign に委ねる（未保存・不正値は既定の classic）。
 * SSR時（window未定義）は "classic" を返す（実際の初期表示クラスは layout.tsx の
 * フラッシュ防止スクリプトが描画前に同期的に付与済みなので、ここはトグルボタンの
 * ラベル表示用の初期値決定にすぎない。theme-toggle.tsx の readInitialTheme と同方式）。
 */
function readInitialDesignFromBrowser(): DesignMode {
  if (typeof window === "undefined") return "classic";
  try {
    return decideInitialDesign(window.localStorage.getItem(DESIGN_STORAGE_KEY));
  } catch {
    return "classic";
  }
}

/**
 * デザイン切替トグル（拡張E14）。`<html>` に `design-news` クラスを付け外しし、
 * globals.css の `.design-news` スコープCSSで見た目を切り替える。テーマ（light/dark、
 * ThemeToggle）とは独立した軸で、状態更新はクリック時のイベントハンドラでのみ行う
 * （初期デザインの決定は useState の遅延初期化関数で行い、useEffect でのマウント後setStateは使わない。
 * theme-toggle.tsx と同方式）。
 *
 * SSR時の初期ラベルと、クライアントでの実際のデザイン（localStorage依存）が食い違いうるため、
 * ボタンのテキストのみ suppressHydrationWarning でハイドレーション不整合警告を抑止する
 * （実際のクラス付与は layout.tsx のフラッシュ防止スクリプトが担うため、表示上のズレは発生しない）。
 */
export function DesignToggle() {
  const [design, setDesign] = useState<DesignMode>(readInitialDesignFromBrowser);

  function handleToggle() {
    const next: DesignMode = design === "news" ? "classic" : "news";
    setDesign(next);
    document.documentElement.classList.toggle(DESIGN_CLASS, next === "news");
    try {
      window.localStorage.setItem(DESIGN_STORAGE_KEY, next);
    } catch {
      // 保存できなくても表示上の切替自体はそのまま成立させる。
    }
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label="デザイン切替"
      suppressHydrationWarning
      className="shrink-0 rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
    >
      {design === "news" ? "◇ 現行" : "📰 ニュース"}
    </button>
  );
}
