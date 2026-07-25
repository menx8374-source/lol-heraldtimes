"use client";

import { useState } from "react";
import {
  DEFAULT_COMMENT_NAME,
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_NAME_MAX_LENGTH,
  commentBodyToLines,
  type CommentBase,
  type CommentView,
  type CommentReplyView,
} from "@/lib/comments";
import { ResHeader, ResLines } from "@/components/article-body-view";
import { CommentVoteButtons } from "@/components/comment-vote-buttons";
import { formatRelativeTime, formatPublishedAt } from "@/lib/format";

/** サーバーが返すコメント（createdAt はJSON化で文字列になる点だけ CommentBase と異なる）。 */
type PostedComment = Omit<CommentBase, "createdAt"> & { createdAt: string };

type PostResponse =
  | { status: "published"; comment: PostedComment; parentNumber?: number }
  | { status: "held" | "rejected"; message: string };

const COMMS_ERROR_MESSAGE = "通信エラーが発生しました。時間をおいて再度お試しください。";

function toCommentReplyView(comment: PostedComment): CommentReplyView {
  return { ...comment, createdAt: new Date(comment.createdAt) };
}

/** コメント/返信の投稿POSTを送り、サーバー判定を返す。通信失敗時は null（＝通信エラー扱い）。 */
async function postComment(slug: string, payload: Record<string, unknown>): Promise<PostResponse | null> {
  try {
    const res = await fetch(`/api/articles/${encodeURIComponent(slug)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as PostResponse;
  } catch {
    return null;
  }
}

type ReplyFormState = {
  name: string;
  body: string;
  website: string;
  pending: boolean;
  feedback: { type: "success" | "error"; message: string } | null;
};

/** 返信投稿フォーム（拡張E8）。CommentSection内で定義すると入力のたびにコンポーネント関数が
 * 再生成されフォームが再マウント(＝入力中にフォーカスが飛ぶ)してしまうため、モジュール直下の
 * コンポーネントとして定義し、状態は親からprops(value/onChange)で受け取る。 */
function ReplyForm({
  targetNumber,
  state,
  onNameChange,
  onBodyChange,
  onWebsiteChange,
  onSubmit,
}: {
  targetNumber: number;
  state: ReplyFormState;
  onNameChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onWebsiteChange: (value: string) => void;
  onSubmit: (e: React.FormEvent, targetNumber: number) => void;
}) {
  return (
    <form
      onSubmit={(e) => onSubmit(e, targetNumber)}
      className="mt-2 flex flex-col gap-2 rounded border border-neutral-300 p-2 dark:border-neutral-700"
    >
      {/* ハニーポット隠しフィールド */}
      <input
        type="text"
        name="website"
        value={state.website}
        onChange={(e) => onWebsiteChange(e.target.value)}
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />
      <label className="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
        名前（任意・未入力は「{DEFAULT_COMMENT_NAME}」）
        <input
          type="text"
          value={state.name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={COMMENT_NAME_MAX_LENGTH}
          placeholder={DEFAULT_COMMENT_NAME}
          className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
        返信
        <textarea
          value={state.body}
          onChange={(e) => onBodyChange(e.target.value)}
          maxLength={COMMENT_BODY_MAX_LENGTH}
          required
          rows={2}
          placeholder="返信を入力"
          className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        />
      </label>
      {state.feedback && (
        <p
          className={
            state.feedback.type === "success"
              ? "text-xs text-green-700 dark:text-green-400"
              : "text-xs text-red-600 dark:text-red-400"
          }
        >
          {state.feedback.message}
        </p>
      )}
      <button
        type="submit"
        disabled={state.pending}
        className="self-start rounded border border-neutral-300 bg-neutral-100 px-3 py-1 text-xs hover:bg-neutral-200 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      >
        {state.pending ? "投稿中…" : "返信を投稿"}
      </button>
    </form>
  );
}

/** コメント・返信1件分の共通表示（拡張E8: 賛否ボタン＋返信ボタン付き）。 */
function CommentRow({
  slug,
  comment,
  isReplyOpen,
  onToggleReply,
  children,
}: {
  slug: string;
  comment: CommentReplyView;
  isReplyOpen: boolean;
  onToggleReply: () => void;
  children?: React.ReactNode;
}) {
  return (
    <li className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm sm:text-base dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <ResHeader number={comment.number} name={comment.name} />
        <time
          dateTime={comment.createdAt.toISOString()}
          title={formatPublishedAt(comment.createdAt)}
          className="text-xs text-neutral-400 dark:text-neutral-500"
        >
          {formatRelativeTime(comment.createdAt, new Date())}
        </time>
      </div>
      <ResLines lines={commentBodyToLines(comment.body)} />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <CommentVoteButtons
          slug={slug}
          number={comment.number}
          initialGoodCount={comment.goodCount}
          initialBadCount={comment.badCount}
        />
        <button
          type="button"
          onClick={onToggleReply}
          className="text-xs text-sky-700 hover:underline dark:text-sky-400"
        >
          {isReplyOpen ? "返信をやめる" : "返信"}
        </button>
      </div>
      {children}
    </li>
  );
}

/** 個別記事のコメント欄（拡張E2）。まとめ速報のレス形式（番号:名前緑＋">>N"アンカー橙）に
 * 表示を揃える。投稿はRoute Handler（/api/articles/[slug]/comments）に送り、公開判定を受けて
 * 楽観的にではなく「サーバーの判定結果を受けてから」一覧に追加する（NGワード等は保留されるため
 * 楽観的更新はできない）。拡張E8: 各コメント・返信に👍/👎ボタンと「返信」ボタンを持ち、
 * 返信は親コメントの直下に1階層でネスト表示する。 */
export function CommentSection({ slug, initialComments }: { slug: string; initialComments: CommentView[] }) {
  const [comments, setComments] = useState(initialComments);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  // ハニーポット: 人間の利用者には見えない隠しフィールド。bot がここに値を入れたら投稿を拒否する。
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // 返信フォーム（拡張E8）。同時に1件だけ開く。返信先はトップレベル・返信のどちらの番号でもよく、
  // 「返信への返信」は投稿後にサーバーが返す実際の親番号(parentNumber)を見て挿入先を決める。
  const [openReplyTarget, setOpenReplyTarget] = useState<number | null>(null);
  const [replyName, setReplyName] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyWebsite, setReplyWebsite] = useState("");
  const [replyPending, setReplyPending] = useState(false);
  const [replyFeedback, setReplyFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const totalCount = comments.reduce((sum, c) => sum + 1 + c.replies.length, 0);

  function toggleReply(targetNumber: number) {
    setOpenReplyTarget((prev) => (prev === targetNumber ? null : targetNumber));
    setReplyName("");
    setReplyBody("");
    setReplyWebsite("");
    setReplyFeedback(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setFeedback(null);
    const data = await postComment(slug, { name, body, website });
    if (!data) {
      setFeedback({ type: "error", message: COMMS_ERROR_MESSAGE });
    } else if (data.status === "published") {
      setComments((prev) => [...prev, { ...toCommentReplyView(data.comment), replies: [] }]);
      setBody("");
      setFeedback({ type: "success", message: "コメントを投稿しました。" });
    } else {
      setFeedback({ type: "error", message: data.message });
    }
    setPending(false);
  }

  async function handleReplySubmit(e: React.FormEvent, targetNumber: number) {
    e.preventDefault();
    if (replyPending) return;
    setReplyPending(true);
    setReplyFeedback(null);
    const data = await postComment(slug, {
      name: replyName,
      body: replyBody,
      website: replyWebsite,
      parentNumber: targetNumber,
    });
    if (!data) {
      setReplyFeedback({ type: "error", message: COMMS_ERROR_MESSAGE });
    } else if (data.status === "published") {
      const parentNumber = data.parentNumber ?? targetNumber;
      setComments((prev) =>
        prev.map((c) =>
          c.number === parentNumber ? { ...c, replies: [...c.replies, toCommentReplyView(data.comment)] } : c,
        ),
      );
      setOpenReplyTarget(null);
      setReplyBody("");
    } else {
      setReplyFeedback({ type: "error", message: data.message });
    }
    setReplyPending(false);
  }

  const replyFormState: ReplyFormState = {
    name: replyName,
    body: replyBody,
    website: replyWebsite,
    pending: replyPending,
    feedback: replyFeedback,
  };

  return (
    <section className="mt-8 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <h2 className="mb-3 text-sm font-bold text-neutral-600 dark:text-neutral-300">
        コメント ({totalCount})
      </h2>

      {comments.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">まだコメントはありません</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <CommentRow
              key={c.number}
              slug={slug}
              comment={c}
              isReplyOpen={openReplyTarget === c.number}
              onToggleReply={() => toggleReply(c.number)}
            >
              {openReplyTarget === c.number && (
                <ReplyForm
                  targetNumber={c.number}
                  state={replyFormState}
                  onNameChange={setReplyName}
                  onBodyChange={setReplyBody}
                  onWebsiteChange={setReplyWebsite}
                  onSubmit={handleReplySubmit}
                />
              )}
              {c.replies.length > 0 && (
                <ul className="mt-2 ml-3 flex flex-col gap-2 border-l-2 border-neutral-200 pl-3 dark:border-neutral-700 sm:ml-6">
                  {c.replies.map((r) => (
                    <CommentRow
                      key={r.number}
                      slug={slug}
                      comment={r}
                      isReplyOpen={openReplyTarget === r.number}
                      onToggleReply={() => toggleReply(r.number)}
                    >
                      {openReplyTarget === r.number && (
                        <ReplyForm
                          targetNumber={r.number}
                          state={replyFormState}
                          onNameChange={setReplyName}
                          onBodyChange={setReplyBody}
                          onWebsiteChange={setReplyWebsite}
                          onSubmit={handleReplySubmit}
                        />
                      )}
                    </CommentRow>
                  ))}
                </ul>
              )}
            </CommentRow>
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
