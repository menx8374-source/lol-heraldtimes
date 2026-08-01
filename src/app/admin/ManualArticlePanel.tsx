"use client";

/**
 * 運営CMS v2（admincms-S2 F5/F6）: 「指定URLから記事化」パネル。
 * `useActionState` でサーバーアクション(`manualArticleAction`)の実行状態を管理する。
 * 実行中はボタン・入力欄を無効化し（連打での二重作成防止）、完了後は成功/失敗メッセージと
 * 成功時のプレビュー/編集リンクを表示する。
 */
import { useActionState } from "react";
import { manualArticleAction } from "@/app/admin/actions";
import type { ManualArticleResult } from "@/lib/admin/manual-article";

const INITIAL_STATE: ManualArticleResult | null = null;

export function ManualArticlePanel() {
  const [state, formAction, isPending] = useActionState(manualArticleAction, INITIAL_STATE);

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">指定URLから記事化</h2>
      <p className="mt-1 text-xs text-neutral-400">
        対応URL形式: X 投稿 URL（例: https://x.com/ユーザー名/status/12345）／ Reddit スレッド URL（例:
        https://www.reddit.com/r/leagueoflegends/comments/abc123/タイトル/）。5ch は対象外です。
        盛り上がり判定（Hotness）を無視して、要レビューの下書き記事を作成します。
      </p>
      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          name="url"
          placeholder="https://..."
          disabled={isPending}
          data-manual-url-input
          className="min-w-[20rem] flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isPending}
          data-manual-submit
          className="rounded bg-sky-700 px-4 py-2 text-sm font-bold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "実行中..." : "記事化する"}
        </button>
      </form>
      {isPending && (
        <p data-manual-pending className="mt-2 text-sm text-sky-400">
          実行中です…
        </p>
      )}
      {!isPending && state && (
        <div
          data-manual-result
          className={
            state.success
              ? "mt-3 rounded-lg border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200"
              : "mt-3 rounded-lg border border-red-900 bg-red-950/30 px-3 py-2 text-sm text-red-200"
          }
        >
          <p>{state.message}</p>
          {state.success && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a
                href={`/admin/articles/${state.articleId}/preview`}
                className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                プレビュー
              </a>
              <a
                href={`/admin/articles/${state.articleId}/edit`}
                className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                編集
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
