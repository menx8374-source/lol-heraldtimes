/**
 * 絵文字リアクション加算/減算エンドポイント（拡張E1、拡張E13で1ユーザー1回制限に対応）。
 * POST { emoji, op? } で該当記事のリアクション件数を1加算(op="add"、既定)または1減算
 * (op="remove")し、更新後の全絵文字カウントを返す。減算は0未満にならない（floorガード）。
 * op省略時は後方互換のため"add"扱い。信頼境界（外部からのリクエスト）のため、
 * JSONパース失敗・不正な絵文字/op・存在しない/保留中の記事はいずれもエラーレスポンスにし、
 * 例外を投げっぱなしにしない。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PUBLISHED_ONLY } from "@/lib/articles";
import { isValidReactionEmoji, isValidReactionOp, mergeReactionCounts } from "@/lib/reactions";

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

  const opRaw = typeof body === "object" && body !== null && "op" in body ? (body as { op: unknown }).op : undefined;
  const op = opRaw === undefined ? "add" : opRaw;
  if (typeof op !== "string" || !isValidReactionOp(op)) {
    return NextResponse.json({ error: "invalid_op" }, { status: 400 });
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
    if (op === "remove") {
      // count>0 の行だけを1減算する（レコード無し/既に0件は where に一致せず no-op＝0未満にしない）。
      // findUnique+update の二度引きを避け、単一の updateMany で floorガードを担保する。
      await prisma.articleReaction.updateMany({
        where: { articleId: article.id, emoji, count: { gt: 0 } },
        data: { count: { decrement: 1 } },
      });
    } else {
      await prisma.articleReaction.upsert({
        where: { articleId_emoji: { articleId: article.id, emoji } },
        update: { count: { increment: 1 } },
        create: { articleId: article.id, emoji, count: 1 },
      });
    }
    const rows = await prisma.articleReaction.findMany({ where: { articleId: article.id } });
    return NextResponse.json({ counts: mergeReactionCounts(rows) });
  } catch (err) {
    console.error(`リアクション更新に失敗しました (slug=${slug}, emoji=${emoji}, op=${op}):`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
