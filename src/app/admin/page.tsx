import type { Metadata } from "next";
import Link from "next/link";
import {
  listRunHistory,
  countPublishedArticles,
  getPopularArticlesForDashboard,
  getHeldArticlesForDashboard,
  listFailureLog,
} from "@/lib/dashboard";
import { formatPublishedAt } from "@/lib/format";
import { listHeldCommentsForAdmin } from "@/lib/admin/comments-admin";
import { listArticlesForAdmin, listReviewQueue } from "@/lib/admin/articles-admin";
import { getCategoryPoliciesForDisplay } from "@/lib/admin/category-policy";
import {
  approveArticleAction,
  rejectArticleAction,
  pinArticleAction,
  scheduleArticleAction,
  cancelScheduleAction,
  approveCommentAction,
  rejectCommentAction,
  approveReviewArticleAction,
  rejectReviewArticleAction,
  setCategoryPolicyAction,
} from "@/app/admin/actions";
import { ManualArticlePanel } from "@/app/admin/ManualArticlePanel";

const STATUS_LABELS: Record<string, string> = {
  published: "公開中",
  held: "保留中",
  rejected: "却下済み",
  scheduled: "予約公開待ち",
  review: "要レビュー",
};

// パイプライン実行直後の最新状態を必ず反映するため、キャッシュせず毎回DBから取得する。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "運営監視ダッシュボード",
  // 公開サイトの検索インデックスには含めない(robots.tsのDisallowが主対策、ここは念のための二重対策)。
  robots: { index: false, follow: false },
};

const STAGE_LABELS: Record<string, string> = {
  collection: "収集",
  generation: "生成",
  pipeline: "パイプライン全体",
};

export default async function AdminDashboardPage() {
  const [
    runHistory,
    publishedTotal,
    popularArticles,
    heldArticles,
    failureLog,
    heldComments,
    adminArticles,
    reviewQueue,
    categoryPolicies,
  ] = await Promise.all([
    listRunHistory(),
    countPublishedArticles(),
    getPopularArticlesForDashboard(),
    getHeldArticlesForDashboard(),
    listFailureLog(),
    listHeldCommentsForAdmin(),
    listArticlesForAdmin(),
    listReviewQueue(),
    getCategoryPoliciesForDisplay(),
  ]);
  // バッジ件数は全件取得済みの reviewQueue から導出する（listReviewQueue はtake未指定で全件返すため
  // 別COUNTクエリは不要）。
  const reviewQueueCount = reviewQueue.length;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">運営監視ダッシュボード</h1>
          <span
            data-review-queue-badge
            className={
              reviewQueueCount > 0
                ? "rounded-full bg-amber-600 px-3 py-1 text-sm font-bold text-white"
                : "rounded-full bg-neutral-800 px-3 py-1 text-sm font-bold text-neutral-300"
            }
          >
            未レビュー {reviewQueueCount}件
          </span>
        </div>
        <p className="mt-1 text-sm text-neutral-400">
          自動運営パイプラインの稼働状況を確認する管理用ページです（非公開・一般閲覧者には非表示）。
        </p>

        <ManualArticlePanel />

        <section className="mt-8">
          <h2 className="text-lg font-bold">公開ポリシー</h2>
          <p className="mt-1 text-xs text-neutral-400">
            カテゴリごとに「自動公開」か「要レビュー」かを設定する。未設定のカテゴリは既定で「要レビュー」。
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {categoryPolicies.map((policy) => (
              <li
                key={policy.category}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
              >
                <span className="min-w-[8rem] font-bold">{policy.category}</span>
                <span
                  data-policy-status
                  className={
                    policy.autoPublish
                      ? "rounded bg-emerald-900 px-2 py-0.5 text-xs text-emerald-300"
                      : "rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
                  }
                >
                  {policy.autoPublish ? "自動公開" : "要レビュー"}
                </span>
                <form action={setCategoryPolicyAction} className="ml-auto">
                  <input type="hidden" name="category" value={policy.category} />
                  <input type="hidden" name="autoPublish" value={policy.autoPublish ? "false" : "true"} />
                  <button
                    type="submit"
                    className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                  >
                    {policy.autoPublish ? "要レビューに切替" : "自動公開に切替"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">レビューキュー（要レビュー）</h2>
          {reviewQueue.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400">要レビューの記事はありません。</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {reviewQueue.map((article) => (
                <li
                  key={article.id}
                  className="rounded-lg border border-sky-900 bg-sky-950/30 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
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
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">直近の実行結果</h2>
          {runHistory.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400">実行履歴がありません。`npm run pipeline` を実行してください。</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-800">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-3 py-2 text-left">実行日時</th>
                    <th className="px-3 py-2 text-left">結果</th>
                    <th className="px-3 py-2 text-right">収集件数</th>
                    <th className="px-3 py-2 text-right">生成成功</th>
                    <th className="px-3 py-2 text-right">生成失敗</th>
                    <th className="px-3 py-2 text-right">公開件数</th>
                    <th className="px-3 py-2 text-right">保留件数</th>
                    <th className="px-3 py-2 text-right">要レビュー件数</th>
                  </tr>
                </thead>
                <tbody>
                  {runHistory.map((run) => (
                    <tr key={run.startedAt.toISOString()} className="border-t border-neutral-800">
                      <td className="px-3 py-2">{formatPublishedAt(run.startedAt)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            run.status === "success"
                              ? "rounded bg-emerald-900 px-2 py-0.5 text-emerald-300"
                              : "rounded bg-red-900 px-2 py-0.5 text-red-300"
                          }
                        >
                          {run.status === "success" ? "正常終了" : "異常終了"}
                        </span>
                        {run.errorMessage ? (
                          <span className="ml-2 text-xs text-neutral-500">{run.errorMessage}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">{run.collectedCount}</td>
                      <td className="px-3 py-2 text-right">{run.generationSucceeded}</td>
                      <td className="px-3 py-2 text-right">{run.generationFailed}</td>
                      <td className="px-3 py-2 text-right">{run.publishedCount}</td>
                      <td className="px-3 py-2 text-right">{run.heldCount}</td>
                      <td className="px-3 py-2 text-right">{run.reviewCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">保留キュー（承認/却下・予約公開）</h2>
          {heldArticles.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400">保留中の記事はありません。</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {heldArticles.map((article) => (
                <li
                  key={article.id}
                  className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-bold">{article.title}</span>
                    <span className="text-xs text-neutral-500">{formatPublishedAt(article.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-amber-300">
                    理由: {article.heldReason ?? "不明"}
                    {article.heldDetail ? ` — ${article.heldDetail}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <form action={approveArticleAction}>
                      <input type="hidden" name="articleId" value={article.id} />
                      <button
                        type="submit"
                        className="rounded bg-emerald-700 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-600"
                      >
                        承認して公開
                      </button>
                    </form>
                    <form action={rejectArticleAction}>
                      <input type="hidden" name="articleId" value={article.id} />
                      <button
                        type="submit"
                        className="rounded bg-red-800 px-3 py-1 text-xs font-bold text-white hover:bg-red-700"
                      >
                        却下
                      </button>
                    </form>
                    <form action={scheduleArticleAction} className="flex items-center gap-1">
                      <input type="hidden" name="articleId" value={article.id} />
                      <input
                        type="datetime-local"
                        name="scheduledAt"
                        required
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                      />
                      <button
                        type="submit"
                        className="rounded bg-sky-800 px-3 py-1 text-xs font-bold text-white hover:bg-sky-700"
                      >
                        予約公開に設定
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">保留コメント（承認/削除）</h2>
          {heldComments.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400">保留中のコメントはありません。</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {heldComments.map((comment) => (
                <li
                  key={comment.id}
                  className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-bold">
                      #{comment.number} {comment.name}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {comment.articleTitle}（{formatPublishedAt(comment.createdAt)}）
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-neutral-200">{comment.body}</p>
                  <p className="mt-1 text-amber-300">理由: {comment.heldReason ?? "不明"}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <form action={approveCommentAction}>
                      <input type="hidden" name="commentId" value={comment.id} />
                      <button
                        type="submit"
                        className="rounded bg-emerald-700 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-600"
                      >
                        承認して公開
                      </button>
                    </form>
                    <form action={rejectCommentAction}>
                      <input type="hidden" name="commentId" value={comment.id} />
                      <button
                        type="submit"
                        className="rounded bg-red-800 px-3 py-1 text-xs font-bold text-white hover:bg-red-700"
                      >
                        削除
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">記事管理（編集・ピン留め・予約公開）</h2>
          {adminArticles.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400">記事がありません。</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {adminArticles.map((article) => (
                <li
                  key={article.id}
                  className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    {article.pinned && (
                      <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        📌 注目
                      </span>
                    )}
                    <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                      {STATUS_LABELS[article.status] ?? article.status}
                    </span>
                    <span className="font-bold">{article.title}</span>
                    {article.status === "scheduled" && article.scheduledAt && (
                      <span className="text-xs text-sky-400">
                        予約: {formatPublishedAt(article.scheduledAt)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/articles/${article.id}/edit`}
                      className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                    >
                      編集
                    </Link>
                    <form action={pinArticleAction}>
                      <input type="hidden" name="articleId" value={article.id} />
                      <input type="hidden" name="pinned" value={article.pinned ? "false" : "true"} />
                      <button
                        type="submit"
                        className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                      >
                        {article.pinned ? "ピン留め解除" : "ピン留めする"}
                      </button>
                    </form>
                    {article.status === "scheduled" && (
                      <form action={cancelScheduleAction}>
                        <input type="hidden" name="articleId" value={article.id} />
                        <button
                          type="submit"
                          className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                        >
                          予約解除
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <h2 className="text-lg font-bold">公開記事の総数</h2>
            <p className="mt-2 text-3xl font-bold">{publishedTotal}</p>
          </div>
          <div>
            <h2 className="text-lg font-bold">人気記事ランキング</h2>
            {popularArticles.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-400">公開記事がありません。</p>
            ) : (
              <ol className="mt-2 flex flex-col gap-1 text-sm">
                {popularArticles.map((article, index) => (
                  <li key={article.slug} className="flex gap-2">
                    <span className="text-neutral-500">{index + 1}.</span>
                    <span className="min-w-0 break-words">{article.title}</span>
                    <span className="ml-auto shrink-0 text-neutral-500">{article.viewCount} views</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">エラー／失敗ログ</h2>
          {failureLog.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400">失敗ログはありません。</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {failureLog.map((entry, index) => (
                <li
                  key={`${entry.stage}-${entry.occurredAt.toISOString()}-${index}`}
                  className="rounded-lg border border-red-900 bg-red-950/30 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300">
                      {STAGE_LABELS[entry.stage] ?? entry.stage}
                    </span>
                    <span className="font-bold">{entry.subject}</span>
                    <span className="text-xs text-neutral-500">{formatPublishedAt(entry.occurredAt)}</span>
                  </div>
                  <p className="mt-1 text-neutral-300">{entry.message}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
