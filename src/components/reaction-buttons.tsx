"use client";

import { useState, useSyncExternalStore } from "react";
import { REACTION_EMOJIS, isValidReactionEmoji, type ReactionCounts, type ReactionEmoji } from "@/lib/reactions";
import { computeToggle } from "@/lib/toggle-selection";
import { readLocalSelection, writeLocalSelection, subscribeLocalSelection } from "@/lib/local-selection";

/** localStorageに保存済みの選択中絵文字を読み出す（useSyncExternalStoreのgetSnapshot用）。 */
function readSelectionSnapshot(storageKey: string): ReactionEmoji | null {
  const saved = readLocalSelection(storageKey);
  return saved !== null && isValidReactionEmoji(saved) ? saved : null;
}

/** SSR/初回クライアント描画時のスナップショット。常にnull（未選択）を返しDOMをサーバーと一致させる。 */
function getServerSelectionSnapshot(): null {
  return null;
}

/**
 * 個別記事の絵文字リアクションボタン（拡張E1、拡張E13で1記事1回制限に対応）。
 * 同時に選択できる絵文字は1つだけ: 未選択→押す(add)／選択中を再度押す→取消(remove、トグル)／
 * 別の絵文字を押す→前を取消・新を選択(switch)。選択状態はlocalStorageに保存しリロード後も保持する
 * （localStorage非対応環境でもエラーにせず、その場限りの状態で動作を継続する）。
 *
 * 拡張E13再実装（試行2）: 選択状態は`useSyncExternalStore`でlocalStorageを直接購読する。
 * `getServerSnapshot`は常にnullを返しSSR/初回クライアント描画のDOMを「未選択」で一致させ、
 * hydration完了直後にReactが自動でクライアントの実際の値（localStorage）を読み直して再レンダーする
 * ため、リロード後の選択ハイライトが確実にDOM（aria-pressed/背景色）へ反映される
 * （`suppressHydrationWarning`で不一致の警告を黙らせるだけの旧方式は、DOMを更新しないため不採用）。
 */
export function ReactionButtons({
  slug,
  initialCounts,
}: {
  slug: string;
  initialCounts: ReactionCounts;
}) {
  const [counts, setCounts] = useState(initialCounts);
  const storageKey = `reaction:${slug}`;
  const selection = useSyncExternalStore(
    (onStoreChange) => subscribeLocalSelection(storageKey, onStoreChange),
    () => readSelectionSnapshot(storageKey),
    getServerSelectionSnapshot,
  );
  const [pending, setPending] = useState(false);

  async function handleClick(emoji: ReactionEmoji) {
    if (pending) return;
    const { selection: nextSelection, requests } = computeToggle(selection, emoji);

    setPending(true);
    // localStorageへの書き込みがuseSyncExternalStoreの購読者へ通知され、selectionが再レンダーされる。
    writeLocalSelection(storageKey, nextSelection);
    setCounts((prev) => {
      const next = { ...prev };
      for (const req of requests) {
        next[req.value] = req.op === "add" ? next[req.value] + 1 : Math.max(0, next[req.value] - 1);
      }
      return next;
    });

    try {
      let finalCounts: ReactionCounts | null = null;
      for (const req of requests) {
        const res = await fetch(`/api/articles/${encodeURIComponent(slug)}/reactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji: req.value, op: req.op }),
        });
        if (res.ok) {
          const data = (await res.json()) as { counts: ReactionCounts };
          finalCounts = data.counts;
        }
      }
      if (finalCounts) setCounts(finalCounts);
      // 失敗時は楽観的更新のままにする（表示上の1件ズレは許容し、UIをブロックしない）。
    } catch {
      // ネットワークエラー時も同様に楽観的更新のままにする。
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {REACTION_EMOJIS.map((emoji) => {
        const active = selection === emoji;
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => handleClick(emoji)}
            disabled={pending}
            aria-pressed={active}
            className={`flex items-center gap-1 rounded-full border px-3 py-1 text-sm disabled:opacity-60 ${
              active
                ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950"
                : "border-neutral-300 bg-white hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
            }`}
          >
            <span aria-hidden="true">{emoji}</span>
            <span className="text-neutral-500 dark:text-neutral-400">{counts[emoji]}</span>
          </button>
        );
      })}
    </div>
  );
}
