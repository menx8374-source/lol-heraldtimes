/**
 * 関連記事の選定ロジック（LLM非依存の純関数）。DB アクセスを含まないため、
 * lib/articles.ts の listRelatedArticles から呼ばれ、ここ単体でテストできる。
 */

export type RelatedCandidate = {
  slug: string;
  category: string;
  tags: string[];
  publishedAt: Date;
};

/**
 * 同カテゴリ／同タグの記事を関連度（一致タグ数 > 同カテゴリ）の高い順・新しい順に選ぶ。
 * 自分自身は必ず除外する。関連度のある候補が limit に満たない場合は、
 * 既に選ばれた記事と自分自身を除く最新記事で不足分を補う（サイト立ち上げ初期でカテゴリ内の
 * 記事数が少なくても「関連記事」欄が最低件数を割らないようにするための現実的なフォールバック）。
 */
export function selectRelatedArticles<T extends RelatedCandidate>(
  current: RelatedCandidate,
  candidates: T[],
  limit: number,
): T[] {
  const others = candidates.filter((c) => c.slug !== current.slug);

  const scored = others
    .map((c) => {
      const sharedTagCount = c.tags.filter((t) => current.tags.includes(t)).length;
      const sameCategory = c.category === current.category;
      return { candidate: c, score: sharedTagCount * 10 + (sameCategory ? 1 : 0) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.candidate.publishedAt.getTime() - a.candidate.publishedAt.getTime();
    })
    .map((s) => s.candidate);

  if (scored.length >= limit) {
    return scored.slice(0, limit);
  }

  const selectedSlugs = new Set(scored.map((c) => c.slug));
  const fallback = others
    .filter((c) => !selectedSlugs.has(c.slug))
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  return [...scored, ...fallback].slice(0, limit);
}
