/**
 * コメント・返信への賛否投票エンドポイント（拡張E8）。POST { type: "good" | "bad" } で
 * 対象コメント（記事slug＋記事内番号で特定）の件数を1加算し、加算後の件数を返す。
 * ログイン無し方針のためユーザー単位の多重投票防止はせず、連打抑止はクライアント側（楽観更新・
 * 二重送信防止）で行う。信頼境界（外部からのリクエスト）のため、JSONパース失敗・不正な種別・
 * 数値でない番号・存在しない/保留中のコメント・非公開記事はいずれもエラーレスポンスにし、
 * 例外を投げっぱなしにしない。
 */
import { NextResponse } from "next/server";
import { isValidCommentVoteType } from "@/lib/comments";
import { voteOnComment } from "@/lib/comments-db";

type Params = { params: Promise<{ slug: string; number: string }> };

export async function POST(request: Request, { params }: Params) {
  const { slug, number: numberParam } = await params;

  const number = Number(numberParam);
  if (!Number.isInteger(number)) {
    return NextResponse.json({ error: "invalid_number" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const type = typeof body === "object" && body !== null && "type" in body ? (body as { type: unknown }).type : undefined;
  if (typeof type !== "string" || !isValidCommentVoteType(type)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }

  try {
    const result = await voteOnComment(slug, number, type);
    if (!result.ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ goodCount: result.goodCount, badCount: result.badCount });
  } catch (err) {
    console.error(`コメント投票に失敗しました (slug=${slug}, number=${number}, type=${type}):`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
