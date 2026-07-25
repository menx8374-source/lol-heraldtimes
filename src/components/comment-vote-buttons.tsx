"use client";

import { useState, useSyncExternalStore } from "react";
import { isValidCommentVoteType, type CommentVoteType } from "@/lib/comments";
import { computeToggle } from "@/lib/toggle-selection";
import { readLocalSelection, writeLocalSelection, subscribeLocalSelection } from "@/lib/local-selection";

/** localStorageに保存済みの投票種別を読み出す（useSyncExternalStoreのgetSnapshot用）。 */
function readSelectionSnapshot(storageKey: string): CommentVoteType | null {
  const saved = readLocalSelection(storageKey);
  return saved !== null && isValidCommentVoteType(saved) ? saved : null;
}

/** SSR/初回クライアント描画時のスナップショット。常にnull（未投票）を返しDOMをサーバーと一致させる。 */
function getServerSelectionSnapshot(): null {
  return null;
}

/**
 * コメント・返信への賛否リアクション(👍Good/👎Bad)ボタン（拡張E8、拡張E13で1コメント1回制限に
 * 対応）。同時に選択できるのは👍か👎のどちらか1つだけ: 未投票→押す(add)／同じ票を再度押す→
 * 取消(remove、トグル)／もう片方を押す→前を取消・新を選択(switch)。選択状態はlocalStorageに
 * 保存しリロード後も保持する（localStorage非対応環境でもエラーにせず、その場限りの状態で
 * 動作を継続する。記事の絵文字リアクション`reaction-buttons.tsx`と同じ思想・共通の純関数を利用）。
 *
 * 拡張E13再実装（試行2）: 選択状態は`useSyncExternalStore`でlocalStorageを直接購読する。
 * `getServerSnapshot`は常にnullを返しSSR/初回クライアント描画のDOMを「未投票」で一致させ、
 * hydration完了直後にReactが自動でクライアントの実際の値（localStorage）を読み直して再レンダーする
 * ため、リロード後の選択ハイライトが確実にDOM（aria-pressed/背景色）へ反映される
 * （`suppressHydrationWarning`で不一致の警告を黙らせるだけの旧方式は、DOMを更新しないため不採用）。
 */
export function CommentVoteButtons({
  slug,
  number,
  initialGoodCount,
  initialBadCount,
}: {
  slug: string;
  number: number;
  initialGoodCount: number;
  initialBadCount: number;
}) {
  const [goodCount, setGoodCount] = useState(initialGoodCount);
  const [badCount, setBadCount] = useState(initialBadCount);
  const storageKey = `vote:${slug}:${number}`;
  const selection = useSyncExternalStore(
    (onStoreChange) => subscribeLocalSelection(storageKey, onStoreChange),
    () => readSelectionSnapshot(storageKey),
    getServerSelectionSnapshot,
  );
  const [pending, setPending] = useState(false);

  function applyCountDelta(type: CommentVoteType, op: "add" | "remove") {
    const delta = op === "add" ? 1 : -1;
    if (type === "good") {
      setGoodCount((prev) => Math.max(0, prev + delta));
    } else {
      setBadCount((prev) => Math.max(0, prev + delta));
    }
  }

  async function handleVote(type: CommentVoteType) {
    if (pending) return;
    const { selection: nextSelection, requests } = computeToggle(selection, type);

    setPending(true);
    // localStorageへの書き込みがuseSyncExternalStoreの購読者へ通知され、selectionが再レンダーされる。
    writeLocalSelection(storageKey, nextSelection);
    for (const req of requests) {
      applyCountDelta(req.value, req.op);
    }

    try {
      let finalCounts: { goodCount: number; badCount: number } | null = null;
      for (const req of requests) {
        const res = await fetch(
          `/api/articles/${encodeURIComponent(slug)}/comments/${number}/vote`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: req.value, op: req.op }),
          },
        );
        if (res.ok) {
          finalCounts = (await res.json()) as { goodCount: number; badCount: number };
        }
      }
      if (finalCounts) {
        setGoodCount(finalCounts.goodCount);
        setBadCount(finalCounts.badCount);
      }
      // 失敗時は楽観的更新のままにする（表示上の1件ズレは許容し、UIをブロックしない）。
    } catch {
      // ネットワークエラー時も同様に楽観的更新のままにする。
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-comment-vote-buttons className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => handleVote("good")}
        disabled={pending}
        aria-label="Good"
        aria-pressed={selection === "good"}
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs disabled:opacity-60 ${
          selection === "good"
            ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950"
            : "border-neutral-300 bg-white hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        }`}
      >
        <span aria-hidden="true">👍</span>
        <span className="text-neutral-500 dark:text-neutral-400">{goodCount}</span>
      </button>
      <button
        type="button"
        onClick={() => handleVote("bad")}
        disabled={pending}
        aria-label="Bad"
        aria-pressed={selection === "bad"}
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs disabled:opacity-60 ${
          selection === "bad"
            ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950"
            : "border-neutral-300 bg-white hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        }`}
      >
        <span aria-hidden="true">👎</span>
        <span className="text-neutral-500 dark:text-neutral-400">{badCount}</span>
      </button>
    </div>
  );
}
