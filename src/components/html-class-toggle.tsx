"use client";

import { useSyncExternalStore } from "react";

/**
 * セグメントの1択。`htmlClass` を持つ選択肢を選ぶとそのクラスを `<html>` に付け、
 * 同じグループ（同一トグル）の他クラスは外す（相互排他）。`htmlClass` 省略の選択肢が
 * 「クラス無し＝既定」（例: テーマのライト、デザインのclassic）。各グループにちょうど1つ置く。
 */
export type ClassToggleOption = { value: string; label: string; htmlClass?: string };

/**
 * `<html>` のクラスで表示状態を切り替えるセグメント式トグルの共通コンポーネント
 * （拡張E14、拡張E45でN択の相互排他クラス群に一般化）。
 * テーマ（ライト/ダーク＝`dark`クラスの有無）と、デザイン（標準/ニュース記事風/Hextech＝
 * `design-news`/`design-hextech`の相互排他）で共用する。
 *
 * - グループの「排他クラス群」= options のうち htmlClass を持つものの集合。選択で1つだけ付く。
 * - 現在状態は `<html>` のクラス（描画前に layout.tsx/no-flashスクリプトが localStorage を
 *   読んで付与済み）を単一の真実として `useSyncExternalStore` で購読する。`getServerSnapshot` は
 *   常に既定（クラス無しの選択肢）を返して SSR/初回クライアント描画のDOMを一致させ、hydration 後に
 *   実際の状態へ再レンダーするため、リロード後も「いまどのモードか」のハイライトが確実に表示される。
 */
const listenersByGroup = new Map<string, Set<() => void>>();

function groupKey(classes: string[]): string {
  return classes.join("|");
}

function subscribeToGroup(key: string, onStoreChange: () => void): () => void {
  let listeners = listenersByGroup.get(key);
  if (!listeners) {
    listeners = new Set();
    listenersByGroup.set(key, listeners);
  }
  listeners.add(onStoreChange);
  return () => {
    listeners?.delete(onStoreChange);
  };
}

export function HtmlClassToggle({
  label,
  ariaLabel,
  storageKey,
  options,
}: {
  /** セグメントの左に添える見出し（例: 「テーマ」「デザイン」）。切替対象が何かを示す。 */
  label: string;
  /** グループの aria-label（例: 「サイトのテーマを切り替え」）。 */
  ariaLabel: string;
  /** 選択値を保存する localStorage キー。 */
  storageKey: string;
  /** N択（既定=htmlClass無しをちょうど1つ含む）。選ぶとその htmlClass だけが `<html>` に付く。 */
  options: ClassToggleOption[];
}) {
  const groupClasses = options
    .map((o) => o.htmlClass)
    .filter((c): c is string => Boolean(c));
  const key = groupKey(groupClasses);
  const defaultOption = options.find((o) => !o.htmlClass) ?? options[0];

  const current = useSyncExternalStore(
    (onStoreChange) => subscribeToGroup(key, onStoreChange),
    () => {
      const active = options.find(
        (o) => o.htmlClass && document.documentElement.classList.contains(o.htmlClass),
      );
      return (active ?? defaultOption).value;
    },
    () => defaultOption.value,
  );

  function select(option: ClassToggleOption): void {
    for (const cls of groupClasses) {
      document.documentElement.classList.toggle(cls, cls === option.htmlClass);
    }
    try {
      window.localStorage.setItem(storageKey, option.value);
    } catch {
      // 保存できなくても表示上の切替自体はそのまま成立させる。
    }
    listenersByGroup.get(key)?.forEach((listener) => listener());
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
