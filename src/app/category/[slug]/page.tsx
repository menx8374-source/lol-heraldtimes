import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryLabelForSlug } from "@/lib/categories";
import { listArticlesByCategory } from "@/lib/articles";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = categoryLabelForSlug(slug);
  return { title: category ? `${category} の記事一覧` : "カテゴリが見つかりません" };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = categoryLabelForSlug(slug);

  if (!category) {
    notFound();
  }

  const articles = await listArticlesByCategory(category);

  return (
    <PageWithSidebar>
      <nav className="mb-3 text-xs text-neutral-500">
        <Link href="/" className="hover:underline">
          トップ
        </Link>
      </nav>
      <h1 className="mb-4 text-lg font-bold">{category}</h1>
      <ArticleList articles={articles} emptyMessage="記事がありません" />
    </PageWithSidebar>
  );
}
