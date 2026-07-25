"use client";

import { useState } from "react";
import { REACTION_EMOJIS, type ReactionCounts } from "@/lib/reactions";

/**
 * 個別記事の絵文字リアクションボタン（拡張E1）。押下でサーバーへ加算リクエストを送り、
 * 楽観的更新でUIに即時反映する。連打は「直前のリクエストが終わるまで次を無視する」簡易対策のみ
 * （ログイン無し方針のため、ユーザー単位の厳密な多重投稿防止はスコープ外）。
 */
export function ReactionButtons({
  slug,
  initialCounts,
}: {
  slug: string;
  initialCounts: ReactionCounts;
}) {
  const [counts, setCounts] = useState(initialCounts);
  const [pending, setPending] = useState(false);

  async function handleClick(emoji: (typeof REACTION_EMOJIS)[number]) {
    if (pending) return;
    setPending(true);
    setCounts((prev) => ({ ...prev, [emoji]: prev[emoji] + 1 }));
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(slug)}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) {
        const data = (await res.json()) as { counts: ReactionCounts };
        setCounts(data.counts);
      }
      // 失敗時は楽観的更新のままにする（表示上の1件ズレは許容し、UIをブロックしない）。
    } catch {
      // ネットワークエラー時も同様に楽観的更新のままにする。
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => handleClick(emoji)}
          disabled={pending}
          className="flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          <span aria-hidden="true">{emoji}</span>
          <span className="text-neutral-500 dark:text-neutral-400">{counts[emoji]}</span>
        </button>
      ))}
    </div>
  );
}
