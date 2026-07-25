/**
 * コメント・返信への賛否投票エンドポイント（拡張E8、拡張E13で1ユーザー1回制限に対応）。
 * POST { type: "good" | "bad", op?: "add" | "remove" } で対象コメント（記事slug＋記事内番号で
 * 特定）の件数を1加算(op="add"、既定)または1減算(op="remove")し、更新後の件数を返す。
 * op省略時は後方互換のため"add"扱い。減算は0未満にならない（floorガード、voteOnComment内で保証）。
 * ログイン無し方針のためユーザー単位の多重投票防止はクライアント側localStorageで行う。
 * 信頼境界（外部からのリクエスト）のため、JSONパース失敗・不正な種別/op・
 * 数値でない番号・存在しない/保留中のコメント・非公開記事はいずれもエラーレスポンスにし、
 * 例外を投げっぱなしにしない。
 */
import { NextResponse } from "next/server";
import { isValidCommentVoteType, isValidCommentVoteOp } from "@/lib/comments";
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

  const opRaw = typeof body === "object" && body !== null && "op" in body ? (body as { op: unknown }).op : undefined;
  const op = opRaw === undefined ? "add" : opRaw;
  if (typeof op !== "string" || !isValidCommentVoteOp(op)) {
    return NextResponse.json({ error: "invalid_op" }, { status: 400 });
  }

  try {
    const result = await voteOnComment(slug, number, type, op);
    if (!result.ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ goodCount: result.goodCount, badCount: result.badCount });
  } catch (err) {
    console.error(`コメント投票に失敗しました (slug=${slug}, number=${number}, type=${type}, op=${op}):`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
