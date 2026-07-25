"use client";

import { useSyncExternalStore } from "react";
import { DESIGN_CLASS, DESIGN_STORAGE_KEY, decideInitialDesign, type DesignMode } from "@/lib/design-mode";

/** セグメントの選択肢（左=既定の標準、右=ニュース記事風）。 */
const DESIGN_OPTIONS: { value: DesignMode; label: string }[] = [
  { value: "classic", label: "標準" },
  { value: "news", label: "ニュース記事風" },
];

/**
 * 現在のデザインは localStorage（描画前に layout.tsx のフラッシュ防止スクリプトが同じ値で
 * `<html>` に `design-news` クラスを付与済み）を単一の真実とし、useSyncExternalStore で購読する。
 * getServerSnapshot は常に既定 classic を返して SSR/初回クライアント描画のDOMを一致させ、
 * hydration 後に実際の保存値へ再レンダーする（＝リロード後も現在モードのハイライトが確実に出る。
 * useState 遅延初期化＋suppressHydrationWarning ではハイライトが復元されないため不採用）。
 */
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getDesignSnapshot(): DesignMode {
  try {
    return decideInitialDesign(window.localStorage.getItem(DESIGN_STORAGE_KEY));
  } catch {
    return "classic";
  }
}

function getServerDesignSnapshot(): DesignMode {
  return "classic";
}

/** 指定デザインに切り替える: `<html>` クラス付け替え → localStorage保存 → 購読者へ通知（再レンダー）。 */
function selectDesign(next: DesignMode): void {
  document.documentElement.classList.toggle(DESIGN_CLASS, next === "news");
  try {
    window.localStorage.setItem(DESIGN_STORAGE_KEY, next);
  } catch {
    // 保存できなくても表示上の切替自体はそのまま成立させる。
  }
  listeners.forEach((listener) => listener());
}

/**
 * サイトの表示デザイン切替（拡張E14 / 分かりやすさ改善）。
 * 「デザイン: 標準｜ニュース記事風」のセグメント式にして、(1) サイトの見た目を切り替える機能であること、
 * (2) いま標準・ニュース記事風のどちらのモードかを、選択中セグメントのハイライトで一目で分かるようにする。
 * テーマ（ライト/ダーク、ThemeToggle）とは独立した軸。
 */
export function DesignToggle() {
  const design = useSyncExternalStore(subscribe, getDesignSnapshot, getServerDesignSnapshot);

  return (
    <div
      role="group"
      aria-label="サイトの表示デザインを切り替え"
      className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-300"
    >
      <span aria-hidden="true">デザイン</span>
      <div className="inline-flex rounded-full border border-neutral-600 p-0.5">
        {DESIGN_OPTIONS.map((option) => {
          const active = design === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => selectDesign(option.value)}
              aria-pressed={active}
              title={`${option.label}デザインに切り替え`}
              className={
                "rounded-full px-2.5 py-1 font-semibold transition-colors " +
                (active
                  ? "bg-white text-neutral-900"
                  : "text-neutral-300 hover:bg-neutral-800 hover:text-white")
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
