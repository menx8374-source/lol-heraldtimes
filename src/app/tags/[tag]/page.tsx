import type { Metadata } from "next";
import Link from "next/link";
import { listArticlesByTag } from "@/lib/articles";
import { decodeTagParam } from "@/lib/tags";
import { parsePageParam } from "@/lib/pagination";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Pagination } from "@/components/pagination";

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
      <nav className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        <Link href="/" className="hover:underline">
          トップ
        </Link>
      </nav>
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
