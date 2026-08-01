import type { Metadata } from "next";
import { listAllTagsWithCounts } from "@/lib/tags";
import { TagListing } from "@/components/tag-listing";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";

// 一覧の自動更新（revalidate-S1 F-RV1-1）: A=短いISR（保険、既定300秒）。Bのオンデマンド再検証が主。
// Next.jsの静的AST解析の制約でインポート変数を参照できないため数値リテラルを直書きする
// （src/lib/revalidate-config.ts の LISTING_REVALIDATE_SECONDS と同値を維持すること）。
export const revalidate = 300;

export const metadata: Metadata = { title: "タグ一覧" };

/**
 * タグ一覧ページ（`/tags`, 拡張E10）。公開記事が1件以上付いている全タグを記事数の多い順に列挙し、
 * 各タグから `/tags/[tag]`（該当記事一覧）へ遷移できる。タグ名での絞り込み欄も持つ。
 */
export default async function TagsIndexPage() {
  const tags = await listAllTagsWithCounts();

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: "タグ一覧", path: "/tags" },
        ]}
      />
      <h1 className="mb-4 text-lg font-bold">タグ一覧</h1>
      <TagListing tags={tags} />
    </PageWithSidebar>
  );
}
