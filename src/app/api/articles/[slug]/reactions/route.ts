/**
 * 絵文字リアクション加算エンドポイント（拡張E1）。POST { emoji } で該当記事のリアクション件数を
 * 1加算し、加算後の全絵文字カウントを返す。信頼境界（外部からのリクエスト）のため、
 * JSONパース失敗・不正な絵文字・存在しない/保留中の記事はいずれもエラーレスポンスにし、
 * 例外を投げっぱなしにしない。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PUBLISHED_ONLY } from "@/lib/articles";
import { isValidReactionEmoji, mergeReactionCounts } from "@/lib/reactions";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const emoji = typeof body === "object" && body !== null && "emoji" in body ? (body as { emoji: unknown }).emoji : undefined;
  if (typeof emoji !== "string" || !isValidReactionEmoji(emoji)) {
    return NextResponse.json({ error: "invalid_emoji" }, { status: 400 });
  }

  // 保留(held)中の記事は公開閲覧できないため、リアクションも受け付けない（PUBLISHED_ONLY で絞る）。
  const article = await prisma.article.findFirst({
    where: { slug, ...PUBLISHED_ONLY },
    select: { id: true },
  });
  if (!article) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    await prisma.articleReaction.upsert({
      where: { articleId_emoji: { articleId: article.id, emoji } },
      update: { count: { increment: 1 } },
      create: { articleId: article.id, emoji, count: 1 },
    });
    const rows = await prisma.articleReaction.findMany({ where: { articleId: article.id } });
    return NextResponse.json({ counts: mergeReactionCounts(rows) });
  } catch (err) {
    console.error(`リアクション加算に失敗しました (slug=${slug}, emoji=${emoji}):`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
