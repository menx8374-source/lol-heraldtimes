import { describe, expect, it } from "vitest";
import {
  selectRelatedArticles,
  selectSameCategoryLatest,
  selectSameTagPopular,
  type RelatedCandidate,
} from "@/lib/related-articles";

function make(
  slug: string,
  category: string,
  tags: string[],
  publishedAt: string,
  viewCount = 0,
): RelatedCandidate {
  return { slug, category, tags, publishedAt: new Date(publishedAt), viewCount };
}

describe("selectRelatedArticles", () => {
  it("同カテゴリかつ同タグの記事を最優先で選び、自分自身は除外する", () => {
    const current = make("a", "patch", ["jungle"], "2026-07-20");
    const candidates = [
      current,
      make("b", "patch", ["jungle"], "2026-07-19"), // 同カテゴリ+同タグ（最も関連度が高い）
      make("c", "esports", [], "2026-07-18"), // 無関係
      make("d", "patch", [], "2026-07-17"), // 同カテゴリのみ
    ];

    const result = selectRelatedArticles(current, candidates, 3);

    expect(result.map((r) => r.slug)).not.toContain("a");
    expect(result[0].slug).toBe("b");
  });

  it("関連度のある候補が limit 未満の場合は他の新しい記事で不足分を補う", () => {
    const current = make("a", "patch", ["x"], "2026-07-20");
    const candidates = [
      current,
      make("b", "esports", [], "2026-07-19"),
      make("c", "official", [], "2026-07-18"),
      make("d", "official", [], "2026-07-17"),
    ];

    const result = selectRelatedArticles(current, candidates, 3);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.slug).sort()).toEqual(["b", "c", "d"]);
  });

  it("候補自体が limit 未満しかない場合はあるだけ返す（無理に水増ししない）", () => {
    const current = make("a", "patch", [], "2026-07-20");
    const candidates = [current, make("b", "esports", [], "2026-07-19")];

    const result = selectRelatedArticles(current, candidates, 3);

    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("b");
  });

  it("同カテゴリより一致タグ数が多い記事を優先する", () => {
    const current = make("a", "patch", ["jungle", "meta"], "2026-07-20");
    const candidates = [
      current,
      make("b", "patch", [], "2026-07-19"), // 同カテゴリのみ: score=1
      make("c", "esports", ["jungle", "meta"], "2026-07-18"), // 別カテゴリだがタグ2件一致: score=20
    ];

    const result = selectRelatedArticles(current, candidates, 2);

    expect(result[0].slug).toBe("c");
    expect(result[1].slug).toBe("b");
  });
});

describe("selectSameCategoryLatest", () => {
  it("同カテゴリのみ・自分除外・publishedAt降順で limit 件を選ぶ", () => {
    const current = make("a", "patch", [], "2026-07-20");
    const candidates = [
      current,
      make("b", "patch", [], "2026-07-18"),
      make("c", "patch", [], "2026-07-19"),
      make("d", "esports", [], "2026-07-25"), // 別カテゴリなので除外
    ];

    const result = selectSameCategoryLatest(current, candidates, 10);

    expect(result.map((r) => r.slug)).toEqual(["c", "b"]);
  });

  it("limit を超える件数は切り詰める", () => {
    const current = make("a", "patch", [], "2026-07-20");
    const candidates = [
      current,
      make("b", "patch", [], "2026-07-19"),
      make("c", "patch", [], "2026-07-18"),
      make("d", "patch", [], "2026-07-17"),
    ];

    const result = selectSameCategoryLatest(current, candidates, 2);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.slug)).toEqual(["b", "c"]);
  });

  it("同カテゴリの候補が0件なら空配列を返す（フォールバックしない）", () => {
    const current = make("a", "patch", [], "2026-07-20");
    const candidates = [current, make("b", "esports", [], "2026-07-19")];

    const result = selectSameCategoryLatest(current, candidates, 5);

    expect(result).toEqual([]);
  });

  it("excludeSlugs で指定した slug は除外する（ウィジェット間の重複防止）", () => {
    const current = make("a", "patch", [], "2026-07-20");
    const candidates = [
      current,
      make("b", "patch", [], "2026-07-19"),
      make("c", "patch", [], "2026-07-18"),
    ];

    const result = selectSameCategoryLatest(current, candidates, 5, new Set(["b"]));

    expect(result.map((r) => r.slug)).toEqual(["c"]);
  });
});

describe("selectSameTagPopular", () => {
  it("一致タグ数 → viewCount → publishedAt の順で並べる", () => {
    const current = make("a", "patch", ["jungle", "meta"], "2026-07-20");
    const candidates = [
      current,
      make("b", "esports", ["jungle"], "2026-07-10", 100), // 一致1・viewCount100
      make("c", "esports", ["jungle", "meta"], "2026-07-05", 10), // 一致2（最優先）
      make("d", "esports", ["jungle"], "2026-07-15", 200), // 一致1・viewCount200（bより優先）
      make("e", "esports", [], "2026-07-25", 999), // 一致0件は除外
    ];

    const result = selectSameTagPopular(current, candidates, 10);

    expect(result.map((r) => r.slug)).toEqual(["c", "d", "b"]);
  });

  it("一致タグ0件の候補は含めない（フォールバック無し）", () => {
    const current = make("a", "patch", ["jungle"], "2026-07-20");
    const candidates = [current, make("b", "esports", [], "2026-07-19", 500)];

    const result = selectSameTagPopular(current, candidates, 5);

    expect(result).toEqual([]);
  });

  it("自分自身は除外する", () => {
    const current = make("a", "patch", ["jungle"], "2026-07-20", 999);
    const candidates = [current, make("b", "esports", ["jungle"], "2026-07-19", 1)];

    const result = selectSameTagPopular(current, candidates, 5);

    expect(result.map((r) => r.slug)).toEqual(["b"]);
  });

  it("limit を遵守する", () => {
    const current = make("a", "patch", ["jungle"], "2026-07-20");
    const candidates = [
      current,
      make("b", "esports", ["jungle"], "2026-07-19", 300),
      make("c", "esports", ["jungle"], "2026-07-18", 200),
      make("d", "esports", ["jungle"], "2026-07-17", 100),
    ];

    const result = selectSameTagPopular(current, candidates, 2);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.slug)).toEqual(["b", "c"]);
  });

  it("excludeSlugs で指定した slug は除外する（ウィジェット間の重複防止）", () => {
    const current = make("a", "patch", ["jungle"], "2026-07-20");
    const candidates = [
      current,
      make("b", "esports", ["jungle"], "2026-07-19", 300),
      make("c", "esports", ["jungle"], "2026-07-18", 200),
    ];

    const result = selectSameTagPopular(current, candidates, 5, new Set(["b"]));

    expect(result.map((r) => r.slug)).toEqual(["c"]);
  });
});

describe("3ウィジェット間の既出slug除外（成長G2）", () => {
  it("関連記事で選ばれた記事は同カテゴリ最新に重複しない", () => {
    const current = make("a", "patch", ["jungle"], "2026-07-20");
    const candidates = [
      current,
      make("b", "patch", ["jungle"], "2026-07-19"), // 関連(同カテゴリ+同タグ)で選ばれる想定
      make("c", "patch", [], "2026-07-18"), // 同カテゴリ最新の候補
      make("d", "patch", [], "2026-07-17"),
    ];

    const related = selectRelatedArticles(current, candidates, 1);
    expect(related.map((r) => r.slug)).toEqual(["b"]);

    const relatedSlugs = new Set(related.map((r) => r.slug));
    const sameCategoryLatest = selectSameCategoryLatest(current, candidates, 10, relatedSlugs);

    expect(sameCategoryLatest.map((r) => r.slug)).not.toContain("b");
    expect(sameCategoryLatest.map((r) => r.slug)).toEqual(["c", "d"]);
  });
});
