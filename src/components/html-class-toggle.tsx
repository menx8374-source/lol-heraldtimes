"use client";

import { useSyncExternalStore } from "react";

export type ClassToggleOption = { value: string; label: string };

/**
 * `<html>` のクラス有無で2状態を切り替えるセグメント式トグルの共通コンポーネント（拡張E14）。
 * テーマ（ライト/ダーク＝`dark`クラス）・デザイン（標準/ニュース記事風＝`design-news`クラス）で共用する。
 *
 * - `options[0]` = クラス無し（既定）、`options[1]` = クラス有り。
 * - 現在状態は `<html>` のクラス（描画前に layout.tsx のフラッシュ防止スクリプトが localStorage を
 *   読んで付与済み）を単一の真実として `useSyncExternalStore` で購読する。`getServerSnapshot` は常に
 *   クラス無し（=options[0]）を返して SSR/初回クライアント描画のDOMを一致させ、hydration 後に実際の
 *   状態へ再レンダーするため、リロード後も「いまどちらのモードか」のハイライトが確実に表示される
 *   （useState 遅延初期化＋suppressHydrationWarning ではハイライトが復元されないため不採用）。
 */
const listenersByClass = new Map<string, Set<() => void>>();

function subscribeToClass(htmlClass: string, onStoreChange: () => void): () => void {
  let listeners = listenersByClass.get(htmlClass);
  if (!listeners) {
    listeners = new Set();
    listenersByClass.set(htmlClass, listeners);
  }
  listeners.add(onStoreChange);
  return () => {
    listeners?.delete(onStoreChange);
  };
}

export function HtmlClassToggle({
  label,
  ariaLabel,
  htmlClass,
  storageKey,
  options,
}: {
  /** セグメントの左に添える見出し（例: 「テーマ」「デザイン」）。切替対象が何かを示す。 */
  label: string;
  /** グループの aria-label（例: 「サイトのテーマを切り替え」）。 */
  ariaLabel: string;
  /** options[1] を選んだときに `<html>` に付与するクラス（例: 「dark」「design-news」）。 */
  htmlClass: string;
  /** 選択値を保存する localStorage キー。 */
  storageKey: string;
  /** [クラス無し(既定), クラス有り] の2択。 */
  options: [ClassToggleOption, ClassToggleOption];
}) {
  const [offOption, onOption] = options;

  const current = useSyncExternalStore(
    (onStoreChange) => subscribeToClass(htmlClass, onStoreChange),
    () => (document.documentElement.classList.contains(htmlClass) ? onOption.value : offOption.value),
    () => offOption.value,
  );

  function select(option: ClassToggleOption): void {
    document.documentElement.classList.toggle(htmlClass, option.value === onOption.value);
    try {
      window.localStorage.setItem(storageKey, option.value);
    } catch {
      // 保存できなくても表示上の切替自体はそのまま成立させる。
    }
    listenersByClass.get(htmlClass)?.forEach((listener) => listener());
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-300"
    >
      <span aria-hidden="true">{label}</span>
      <div className="inline-flex rounded-full border border-neutral-600 p-0.5">
        {options.map((option) => {
          const active = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => select(option)}
              aria-pressed={active}
              title={`${option.label}に切り替え`}
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
