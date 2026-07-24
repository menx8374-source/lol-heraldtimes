import { describe, expect, it } from "vitest";
import { selectRelatedArticles, type RelatedCandidate } from "@/lib/related-articles";

function make(slug: string, category: string, tags: string[], publishedAt: string): RelatedCandidate {
  return { slug, category, tags, publishedAt: new Date(publishedAt) };
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
