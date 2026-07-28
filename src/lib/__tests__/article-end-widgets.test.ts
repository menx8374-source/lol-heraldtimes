/**
 * 記事末回遊ウィジェット（成長G2 F-G2-2）の候補プール取得関数の結合テスト。
 * 専用テストDBに実際に記事を投入し、published のみ・自分除外・件数上限・主要タグ限定を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getArticleBySlug,
  fetchSameCategoryLatestCandidates,
  fetchSameTagPopularCandidates,
} from "@/lib/articles";

async function resetDb() {
  await prisma.articleReaction.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createArticle(params: {
  slug: string;
  category: string;
  status?: "published" | "held";
  publishedAt?: Date;
  viewCount?: number;
  tags?: string[];
}) {
  return prisma.article.create({
    data: {
      slug: params.slug,
      title: `テスト記事 ${params.slug}`,
      category: params.category,
      body: [{ type: "paragraph", text: "本文" }],
      publishedAt: params.publishedAt ?? new Date(),
      status: params.status ?? "published",
      viewCount: params.viewCount ?? 0,
      tags: params.tags
        ? {
            create: params.tags.map((name) => ({
              tag: { connectOrCreate: { where: { name }, create: { name } } },
            })),
          }
        : undefined,
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("fetchSameCategoryLatestCandidates", () => {
  it("published のみを対象にする（held記事は含まれない）", async () => {
    await createArticle({ slug: "current", category: "パッチ/メタ" });
    await createArticle({ slug: "held-1", category: "パッチ/メタ", status: "held" });
    const current = await getArticleBySlug("current");
    expect(current).not.toBeNull();

    const candidates = await fetchSameCategoryLatestCandidates(current!);

    expect(candidates.some((c) => c.slug === "held-1")).toBe(false);
  });

  it("件数上限（poolSize）を超えない", async () => {
    await createArticle({ slug: "current", category: "パッチ/メタ" });
    for (let i = 0; i < 10; i++) {
      await createArticle({ slug: `other-${i}`, category: "パッチ/メタ" });
    }
    const current = await getArticleBySlug("current");

    const candidates = await fetchSameCategoryLatestCandidates(current!, 5);

    expect(candidates.length).toBeLessThanOrEqual(5);
  });
});

describe("fetchSameTagPopularCandidates", () => {
  it("自分自身を候補から除外する", async () => {
    await createArticle({ slug: "current", category: "パッチ/メタ", tags: ["ヨネ"] });
    const current = await getArticleBySlug("current");

    const { candidates } = await fetchSameTagPopularCandidates(current!);

    expect(candidates.some((c) => c.slug === "current")).toBe(false);
  });

  it("タグが無い記事は候補0件（mainTagNameも空）を返す", async () => {
    await createArticle({ slug: "current", category: "パッチ/メタ" });
    const current = await getArticleBySlug("current");

    const result = await fetchSameTagPopularCandidates(current!);

    expect(result.mainTagName).toBe("");
    expect(result.candidates).toEqual([]);
  });

  it("published のみを対象にする（held記事は含まれない）", async () => {
    await createArticle({ slug: "current", category: "パッチ/メタ", tags: ["ヨネ"] });
    await createArticle({ slug: "other-1", category: "eスポーツ", tags: ["ヨネ"], viewCount: 100 });
    await createArticle({
      slug: "held-1",
      category: "eスポーツ",
      tags: ["ヨネ"],
      status: "held",
      viewCount: 999,
    });
    const current = await getArticleBySlug("current");

    const { candidates } = await fetchSameTagPopularCandidates(current!);

    expect(candidates.some((c) => c.slug === "held-1")).toBe(false);
    expect(candidates.some((c) => c.slug === "other-1")).toBe(true);
  });

  it("主要タグ（記事数の多いタグ最大2つ）に限定して候補を集める", async () => {
    // メジャー:3件(current含む) / サブ:2件(current含む) / マイナー:1件(currentのみ)
    // → 上位2タグ(メジャー・サブ)だけが候補集めに使われ、マイナー由来の候補は増えない。
    await createArticle({
      slug: "current",
      category: "パッチ/メタ",
      tags: ["メジャー", "サブ", "マイナー"],
    });
    await createArticle({ slug: "major-1", category: "eスポーツ", tags: ["メジャー"], viewCount: 5 });
    await createArticle({ slug: "major-2", category: "eスポーツ", tags: ["メジャー"], viewCount: 50 });
    await createArticle({ slug: "sub-1", category: "eスポーツ", tags: ["サブ"], viewCount: 20 });
    const current = await getArticleBySlug("current");

    const result = await fetchSameTagPopularCandidates(current!);

    expect(result.mainTagName).toBe("メジャー");
    expect(result.candidates.map((c) => c.slug).sort()).toEqual(["major-1", "major-2", "sub-1"]);
  });
});
