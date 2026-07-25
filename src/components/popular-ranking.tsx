"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { RankingPeriod } from "@/lib/ranking";

/** サイドバー人気ランキングウィジェットが扱う最小限の記事情報。 */
export type PopularRankingItem = { slug: string; title: string };

type RankingTab = "all" | RankingPeriod;

const TABS: { key: RankingTab; label: string }[] = [
  { key: "all", label: "累計" },
  { key: "day", label: "日間" },
  { key: "week", label: "週間" },
  { key: "month", label: "月間" },
];

/**
 * サイドバー（PC）／記事下（スマホ）の人気記事ランキングウィジェット（F3 + 拡張E4）。
 * 累計（初期表示・サーバー側で取得済み）に加え、日間/週間/月間の期間別ランキングへ
 * クライアント側でタブ切替できる。切替時は `/api/ranking` から取得する
 * （ページ全体のリロードを避け、ページ側の他のクエリパラメータ（?page=等）と競合しないようにする）。
 */
export function PopularRanking({ initialArticles }: { initialArticles: PopularRankingItem[] }) {
  const [tab, setTab] = useState<RankingTab>("all");
  const [articles, setArticles] = useState<PopularRankingItem[]>(initialArticles);
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function handleTabChange(next: RankingTab) {
    setTab(next);
    setFailed(false);
    if (next === "all") {
      setArticles(initialArticles);
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/ranking?period=${next}`);
        if (!res.ok) throw new Error("request_failed");
        const data = (await res.json()) as { articles: PopularRankingItem[] };
        setArticles(data.articles ?? []);
      } catch {
        // ランキング取得の失敗は表示上「記事がありません」相当のメッセージに留め、
        // ウィジェット全体やページ本体の表示を止めない。
        setArticles([]);
        setFailed(true);
      }
    });
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-bold text-neutral-700 dark:text-neutral-200">人気記事ランキング</h2>
      <div className="mb-3 flex flex-wrap gap-1 text-xs" role="tablist" aria-label="ランキング期間">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => handleTabChange(t.key)}
            className={`rounded px-2 py-1 font-bold ${
              tab === t.key
                ? "bg-sky-700 text-white dark:bg-sky-600"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isPending ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">読み込み中...</p>
      ) : articles.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {failed ? "ランキングの取得に失敗しました" : "記事がありません"}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {articles.map((article, index) => (
            <li key={article.slug} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-lg font-bold text-sky-700 dark:text-sky-400">
                {index + 1}
              </span>
              <Link
                href={`/articles/${article.slug}`}
                className="min-w-0 text-sm leading-snug break-words hover:underline"
              >
                {article.title}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
