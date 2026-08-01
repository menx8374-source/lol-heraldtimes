import type { Metadata } from "next";
import { listArticlesByTag } from "@/lib/articles";
import { decodeTagParam } from "@/lib/tags";
import { parsePageParam } from "@/lib/pagination";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Pagination } from "@/components/pagination";
import { Breadcrumbs } from "@/components/breadcrumbs";

// 一覧の自動更新（revalidate-S1 F-RV1-1）: A=短いISR（保険、既定300秒）。Bのオンデマンド再検証が主。
// Next.jsの静的AST解析の制約でインポート変数を参照できないため数値リテラルを直書きする
// （src/lib/revalidate-config.ts の LISTING_REVALIDATE_SECONDS と同値を維持すること）。
export const revalidate = 300;

type Props = {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { tag } = await params;
  return { title: `#${decodeTagParam(tag)} の記事一覧` };
}

export default async function TagPage({ params, searchParams }: Props) {
  const { tag } = await params;
  const tagName = decodeTagParam(tag);
  const { page: pageParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);
  const result = await listArticlesByTag(tagName, requestedPage);

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: `#${tagName}`, path: `/tags/${tag}` },
        ]}
      />
      <h1 className="mb-4 text-lg font-bold">#{tagName}</h1>
      <ArticleList articles={result.items} emptyMessage="記事がありません" />
      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) => `/tags/${tag}?page=${p}`}
      />
    </PageWithSidebar>
  );
}
