/**
 * 期間別人気記事ランキング（拡張E4）取得エンドポイント。GET /api/ranking?period=day|week|month
 * を受け付け、サイドバーの PopularRanking ウィジェットがタブ切替時にクライアント側から呼ぶ。
 * 信頼境界（クエリパラメータ）のため、不正な period は400で拒否し、DBエラーは500で捕捉する。
 */
import { NextResponse } from "next/server";
import { listPopularArticlesByPeriod } from "@/lib/articles";
import { isValidRankingPeriod } from "@/lib/ranking";

const RANKING_LIMIT = 5;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period");

  if (!period || !isValidRankingPeriod(period)) {
    return NextResponse.json({ error: "invalid_period" }, { status: 400 });
  }

  try {
    const articles = await listPopularArticlesByPeriod(period, RANKING_LIMIT);
    return NextResponse.json({
      articles: articles.map((a) => ({ slug: a.slug, title: a.title })),
    });
  } catch (err) {
    console.error(`期間別ランキング取得に失敗しました (period=${period}):`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
