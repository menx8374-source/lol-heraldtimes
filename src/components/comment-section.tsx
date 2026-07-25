"use client";

import { useState } from "react";
import {
  DEFAULT_COMMENT_NAME,
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_NAME_MAX_LENGTH,
  commentBodyToLines,
  type CommentView,
} from "@/lib/comments";
import { ResHeader, ResLines } from "@/components/article-body-view";
import { formatRelativeTime, formatPublishedAt } from "@/lib/format";

type PostResponse =
  | { status: "published"; comment: { number: number; name: string; body: string; createdAt: string; anchors: number[] } }
  | { status: "held" | "rejected"; message: string };

/** 個別記事のコメント欄（拡張E2）。まとめ速報のレス形式（番号:名前緑＋">>N"アンカー橙）に
 * 表示を揃える。投稿はRoute Handler（/api/articles/[slug]/comments）に送り、公開判定を受けて
 * 楽観的にではなく「サーバーの判定結果を受けてから」一覧に追加する（NGワード等は保留されるため
 * 楽観的更新はできない）。 */
export function CommentSection({ slug, initialComments }: { slug: string; initialComments: CommentView[] }) {
  const [comments, setComments] = useState(initialComments);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  // ハニーポット: 人間の利用者には見えない隠しフィールド。bot がここに値を入れたら投稿を拒否する。
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(slug)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, body, website }),
      });
      const data = (await res.json()) as PostResponse;
      if (data.status === "published") {
        setComments((prev) => [
          ...prev,
          { ...data.comment, createdAt: new Date(data.comment.createdAt) },
        ]);
        setBody("");
        setFeedback({ type: "success", message: "コメントを投稿しました。" });
      } else {
        setFeedback({ type: "error", message: data.message });
      }
    } catch {
      setFeedback({ type: "error", message: "通信エラーが発生しました。時間をおいて再度お試しください。" });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-8 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <h2 className="mb-3 text-sm font-bold text-neutral-600 dark:text-neutral-300">
        コメント ({comments.length})
      </h2>

      {comments.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">まだコメントはありません</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <li
              key={c.number}
              className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm sm:text-base dark:border-neutral-700 dark:bg-neutral-900"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <ResHeader number={c.number} name={c.name} />
                <time
                  dateTime={new Date(c.createdAt).toISOString()}
                  title={formatPublishedAt(new Date(c.createdAt))}
                  className="text-xs text-neutral-400 dark:text-neutral-500"
                >
                  {formatRelativeTime(new Date(c.createdAt), new Date())}
                </time>
              </div>
              <ResLines lines={commentBodyToLines(c.body)} />
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2 rounded border border-neutral-300 p-3 dark:border-neutral-700">
        {/* ハニーポット隠しフィールド: 画面表示・スクリーンリーダー双方から隠し、人間には入力させない。 */}
        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          aria-hidden="true"
          tabIndex={-1}
          autoComplete="off"
          className="absolute -left-[9999px] h-0 w-0 opacity-0"
        />
        <label className="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          名前（任意・未入力は「{DEFAULT_COMMENT_NAME}」）
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={COMMENT_NAME_MAX_LENGTH}
            placeholder={DEFAULT_COMMENT_NAME}
            className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          コメント
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={COMMENT_BODY_MAX_LENGTH}
            required
            rows={3}
            placeholder="コメントを入力（&gt;&gt;1 のように番号を書くと該当コメントへの返信になります）"
            className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
        </label>
        {feedback && (
          <p
            className={
              feedback.type === "success"
                ? "text-xs text-green-700 dark:text-green-400"
                : "text-xs text-red-600 dark:text-red-400"
            }
          >
            {feedback.message}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded border border-neutral-300 bg-neutral-100 px-3 py-1 text-sm hover:bg-neutral-200 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          {pending ? "投稿中…" : "コメントを投稿"}
        </button>
      </form>
    </section>
  );
}
