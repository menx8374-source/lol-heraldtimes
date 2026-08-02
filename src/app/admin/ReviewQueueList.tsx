"use client";

/**
 * 運営CMS v2（admincms-S5 F11）: レビューキューの一覧表示＋一括承認。
 *
 * 個別の「承認して公開」「却下」は、記事ごとの独立した`<form action={...}>`＋
 * `<input type="hidden" name="articleId">`で送る（S1で実績のある方式。`page.tsx`の保留キュー・
 * プレビュー画面と同じ）。**`formAction`でボタンごとに別アクションへ切り替えつつ`name="articleId"`を
 * ボタン自身に持たせる方式は使わない**——React DOMはServer Actionを持つsubmitterボタンの`name`
 * 属性をアクションID伝達用に上書きするため、送信される実際のFormDataでは`articleId`ではなく
 * `$ACTION_ID_...`という名前になり、サーバー側`formData.get("articleId")`が常にnullになる
 * （実クリックでのみ再現し、`fd.set("articleId", id)`済みFormDataを直接actionへ渡すテストでは
 * 検知できない既知の落とし穴。admincms-S5の実機検証で発覚し撤去した）。
 *
 * 一括承認のチェックボックス（`name="selectedIds"`）と個別承認/却下の`<form>`は兄弟として並べ、
 * HTMLの`<form>`入れ子禁止を回避する。チェックボックス・末尾の「まとめて承認」ボタンは、
 * `form="bulk-approve-form"`属性で（物理的に子孫でなくても）一括用の`<form id="bulk-approve-form">`
 * に紐付ける（HTML5のform-associated要素の標準機能）。
 */
import { useActionState } from "react";
import Link from "next/link";
import { formatPublishedAt } from "@/lib/format";
import {
  approveReviewArticleAction,
  rejectReviewArticleAction,
  bulkApproveReviewArticlesAction,
  type BulkApproveActionState,
} from "@/app/admin/actions";
import type { ReviewQueueArticleSummary } from "@/lib/admin/articles-admin";

// "use server"ファイル(actions.ts)は非同期関数以外の値をexportできないため、初期値はここで
// 定義する（型(`BulkApproveActionState`)のみ actions.ts からtype-only importする）。
const INITIAL_BULK_STATE: BulkApproveActionState = { status: "idle" };

const BULK_FORM_ID = "review-queue-bulk-approve-form";

export function ReviewQueueList({ articles }: { articles: ReviewQueueArticleSummary[] }) {
  const [bulkState, bulkFormAction, isBulkPending] = useActionState(
    bulkApproveReviewArticlesAction,
    INITIAL_BULK_STATE,
  );

  return (
    <div>
      {/* 一括承認用のform本体（可視要素は持たない。チェックボックスと送信ボタンはform属性経由で
          このformに紐付く。articles.length===0で全承認済みになっても、この要素とuseActionStateの
          状態は同じコンポーネントインスタンス内に留まり続けるため、結果表示が消えない）。 */}
      <form id={BULK_FORM_ID} action={bulkFormAction} />

      {bulkState.status === "no_selection" && (
        <p data-bulk-no-selection className="mb-2 text-sm text-amber-300">
          記事が選択されていません。
        </p>
      )}
      {bulkState.status === "done" && (
        <div data-bulk-result className="mb-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
          <p>
            まとめて承認: 成功 {bulkState.succeededCount}件 / 失敗 {bulkState.failed.length}件
          </p>
          {bulkState.failed.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-red-300">
              {bulkState.failed.map((f) => (
                <li key={f.id}>{f.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {articles.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-400">要レビューの記事はありません。</p>
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-2">
            {articles.map((article) => (
              <li key={article.id} className="rounded-lg border border-sky-900 bg-sky-950/30 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <input
                    type="checkbox"
                    name="selectedIds"
                    value={article.id}
                    form={BULK_FORM_ID}
                    aria-label={`${article.title}を選択`}
                    data-review-select
                    className="h-4 w-4"
                  />
                  <span className="rounded bg-sky-900 px-2 py-0.5 text-xs text-sky-300">{article.category}</span>
                  <span className="font-bold">{article.title}</span>
                  <span className="text-xs text-neutral-500">{formatPublishedAt(article.createdAt)}</span>
                </div>
                {article.sourceUrl && (
                  <p className="mt-1 truncate text-xs text-neutral-500">
                    出典:{" "}
                    <a
                      href={article.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-sky-400 hover:underline"
                    >
                      {article.sourceUrl}
                    </a>
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/articles/${article.id}/preview`}
                    className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                  >
                    プレビュー
                  </Link>
                  <Link
                    href={`/admin/articles/${article.id}/edit`}
                    className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                  >
                    編集
                  </Link>
                  <form action={approveReviewArticleAction}>
                    <input type="hidden" name="articleId" value={article.id} />
                    <button
                      type="submit"
                      className="rounded bg-emerald-700 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-600"
                    >
                      承認して公開
                    </button>
                  </form>
                  <form action={rejectReviewArticleAction}>
                    <input type="hidden" name="articleId" value={article.id} />
                    <button
                      type="submit"
                      className="rounded bg-red-800 px-3 py-1 text-xs font-bold text-white hover:bg-red-700"
                    >
                      却下
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>

          <button
            type="submit"
            form={BULK_FORM_ID}
            disabled={isBulkPending}
            data-bulk-approve-submit
            className="mt-3 rounded bg-emerald-800 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBulkPending ? "承認中..." : "選択した記事をまとめて承認"}
          </button>
        </>
      )}
    </div>
  );
}
