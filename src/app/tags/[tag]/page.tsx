import type { Metadata } from "next";
import Link from "next/link";
import { listArticlesByTag } from "@/lib/articles";
import { decodeTagParam } from "@/lib/tags";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";

type Props = {
  params: Promise<{ tag: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  return { title: `#${decodeTagParam(tag)} の記事一覧` };
}

export default async function TagPage({ params }: Props) {
  const { tag } = await params;
  const tagName = decodeTagParam(tag);
  const articles = await listArticlesByTag(tagName);

  return (
    <PageWithSidebar>
      <nav className="mb-3 text-xs text-neutral-500">
        <Link href="/" className="hover:underline">
          トップ
        </Link>
      </nav>
      <h1 className="mb-4 text-lg font-bold">#{tagName}</h1>
      <ArticleList articles={articles} emptyMessage="記事がありません" />
    </PageWithSidebar>
  );
}
