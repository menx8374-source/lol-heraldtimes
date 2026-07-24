import type { Metadata } from "next";
import {
  listRunHistory,
  countPublishedArticles,
  getPopularArticlesForDashboard,
  getHeldArticlesForDashboard,
  listFailureLog,
} from "@/lib/dashboard";
import { formatPublishedAt } from "@/lib/format";

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
  const [runHistory, publishedTotal, popularArticles, heldArticles, failureLog] = await Promise.all([
    listRunHistory(),
    countPublishedArticles(),
    getPopularArticlesForDashboard(),
    getHeldArticlesForDashboard(),
    listFailureLog(),
  ]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">運営監視ダッシュボード</h1>
        <p className="mt-1 text-sm text-neutral-400">
          自動運営パイプラインの稼働状況を確認する管理用ページです（非公開・一般閲覧者には非表示）。
        </p>

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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">保留キュー（保留理由付き）</h2>
          {heldArticles.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400">保留中の記事はありません。</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {heldArticles.map((article) => (
                <li
                  key={article.slug}
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
