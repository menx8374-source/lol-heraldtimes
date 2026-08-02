/**
 * admincms-S5 evaluatorフィードバック対応（致命的バグ修正）: レビューキューの個別「承認して公開」
 * 「却下」ボタンが、submitterボタンの`name`上書き問題（React DOMはServer Actionを持つ
 * submitterボタンの`name`属性をアクションID伝達用に上書きするため、`formAction`＋
 * `name="articleId"`のパターンでは実クリック時のFormDataに`articleId`が含まれず、
 * サーバー側`formData.get("articleId")`が常にnullになり500エラーになる）で壊れないことを、
 * 実際にレンダーされたHTMLマークアップ構造から検証する。
 *
 * `fd.set("articleId", id)`済みのFormDataを直接actionへ渡すテスト（update-article-action.test.ts等）
 * だけでは、ブラウザが実クリック時に実際に組み立てるFormDataの中身の違いを検知できない
 * （この盲点を塞ぐための構造テスト）。jsdom/React Testing Libraryを新規追加せず、
 * `react-dom/server`の静的レンダリング（既存依存のみ）で検証する。
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { ReviewQueueList } from "@/app/admin/ReviewQueueList";
import type { ReviewQueueArticleSummary } from "@/lib/admin/articles-admin";

const ARTICLES: ReviewQueueArticleSummary[] = [
  {
    id: "article-1",
    slug: "slug-1",
    title: "テスト記事1",
    category: "パッチ/メタ",
    createdAt: new Date("2026-07-20T00:00:00+09:00"),
    sourceUrl: null,
  },
];

describe("ReviewQueueList のマークアップ構造（個別承認/却下がsubmitterのname上書きで壊れないことの担保）", () => {
  // 検証の経緯（重要）: 壊れたパターン（<button formAction={...} name="articleId" value={...}>）を
  // 実際にこのコンポーネントへ再現させてrenderToStaticMarkupした結果、Reactは`formAction`が関数
  // （Server Action）のときSSR出力からボタンの`name`属性そのものを省略する（実行時にhydration用の
  // 別名へ差し替えるため）。つまり壊れたパターンでは「hidden inputでarticleIdを送る」という
  // 下記アサーションが必ず失敗する一方、`name="articleId"`の有無を直接正規表現で見る検査は
  // 壊れたパターンでも文字列上ヒットしないため無意味（実際に検証して確認済み）。
  // そのため「hidden inputとして専用formの中で送られている」という構造の存在を確認する
  // ポジティブな検査だけを行う（このほうが壊れたパターンを確実に検知できる）。
  it("個別のarticleIdは hidden input(name=articleId) として専用formの中で送られる（S1の実績パターン、formAction+nameのボタンには依存しない）", () => {
    const html = renderToStaticMarkup(<ReviewQueueList articles={ARTICLES} />);

    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="articleId"[^>]*value="article-1"/);
  });

  it("一括承認のチェックボックスは selectedIds という別名前空間を使い、articleIdと衝突しない", () => {
    const html = renderToStaticMarkup(<ReviewQueueList articles={ARTICLES} />);

    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="selectedIds"[^>]*value="article-1"/);
  });

  it("0件でもエラーなくレンダーされ、「要レビューの記事はありません」を表示する", () => {
    const html = renderToStaticMarkup(<ReviewQueueList articles={[]} />);

    expect(html).toContain("要レビューの記事はありません");
  });
});
