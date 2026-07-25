"use client";

import { useState } from "react";
import type { CommentVoteType } from "@/lib/comments";

/**
 * コメント・返信への賛否リアクション(👍Good/👎Bad)ボタン（拡張E8）。押下でサーバーへ
 * 加算リクエストを送り、楽観的更新でUIに即時反映する。連打は「直前のリクエストが終わるまで
 * 次を無視する」簡易対策のみ（ログイン無し方針のため、ユーザー単位の厳密な多重投票防止はスコープ外。
 * 記事の絵文字リアクション `reaction-buttons.tsx` と同じ思想）。
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
  const [pending, setPending] = useState(false);

  async function handleVote(type: CommentVoteType) {
    if (pending) return;
    setPending(true);
    if (type === "good") {
      setGoodCount((prev) => prev + 1);
    } else {
      setBadCount((prev) => prev + 1);
    }
    try {
      const res = await fetch(
        `/api/articles/${encodeURIComponent(slug)}/comments/${number}/vote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as { goodCount: number; badCount: number };
        setGoodCount(data.goodCount);
        setBadCount(data.badCount);
      }
      // 失敗時は楽観的更新のままにする（表示上の1件ズレは許容し、UIをブロックしない）。
    } catch {
      // ネットワークエラー時も同様に楽観的更新のままにする。
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => handleVote("good")}
        disabled={pending}
        aria-label="Good"
        className="flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <span aria-hidden="true">👍</span>
        <span className="text-neutral-500 dark:text-neutral-400">{goodCount}</span>
      </button>
      <button
        type="button"
        onClick={() => handleVote("bad")}
        disabled={pending}
        aria-label="Bad"
        className="flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <span aria-hidden="true">👎</span>
        <span className="text-neutral-500 dark:text-neutral-400">{badCount}</span>
      </button>
    </div>
  );
}
