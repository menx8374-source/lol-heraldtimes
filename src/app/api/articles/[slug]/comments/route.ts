/**
 * 匿名コメント・返信投稿エンドポイント（拡張E2・拡張E8で返信対応）。
 * POST { name?, body, website?, parentNumber? } を受け取り、入力検証→（返信先解決）→
 * 連投スパム判定→安全フィルタ（NGワード/個人中傷）の順に判定する。信頼境界
 * （閲覧者からの入力）のため、失敗はすべて捕捉してエラーレスポンスにし、例外を投げっぱなしにしない。
 * 保留(held)判定の詳細理由はユーザーに見せない（穏当なメッセージのみ返す）。
 * `parentNumber` は返信先コメントの記事内番号（拡張E8）。省略時はトップレベルコメントになる。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PUBLISHED_ONLY } from "@/lib/articles";
import { commentValidationMessage } from "@/lib/comments";
import { createComment } from "@/lib/comments-db";

type Params = { params: Promise<{ slug: string }> };

const HELD_MESSAGE =
  "不適切な内容が含まれる可能性があるため、このコメントは公開できませんでした。内容をご確認のうえ再度お試しください。";
const SPAM_MESSAGE =
  "投稿の間隔が短すぎるか、直前の投稿と内容が重複しています。しばらく時間をおいて再度お試しください。";
const INVALID_PARENT_MESSAGE = "返信先のコメントが見つかりませんでした。ページを再読み込みしてお試しください。";

export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "rejected", message: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const name = typeof b.name === "string" ? b.name : undefined;
  const text = typeof b.body === "string" ? b.body : "";
  // ハニーポット隠しフィールド。人間の利用者は入力しない想定で、埋まっていればbotとみなす。
  const honeypot = typeof b.website === "string" ? b.website : undefined;
  // 返信先の記事内番号（拡張E8）。数値以外・省略はトップレベルコメント扱い。
  const parentNumber = typeof b.parentNumber === "number" && Number.isInteger(b.parentNumber) ? b.parentNumber : undefined;

  // 保留(held)中の記事は公開閲覧できないため、コメントも受け付けない（PUBLISHED_ONLY で絞る）。
  const article = await prisma.article.findFirst({
    where: { slug, ...PUBLISHED_ONLY },
    select: { id: true },
  });
  if (!article) {
    return NextResponse.json({ status: "rejected", message: "記事が見つかりません。" }, { status: 404 });
  }

  try {
    const result = await createComment(article.id, { name, body: text, honeypot, parentNumber });

    if (result.outcome === "published") {
      return NextResponse.json(
        { status: "published", comment: result.comment, parentNumber: result.parentNumber },
        { status: 201 },
      );
    }
    if (result.outcome === "held") {
      return NextResponse.json({ status: "held", message: HELD_MESSAGE }, { status: 422 });
    }
    if (result.reason === "invalid_parent") {
      return NextResponse.json({ status: "rejected", message: INVALID_PARENT_MESSAGE }, { status: 400 });
    }
    const message =
      result.reason === "spam" ? SPAM_MESSAGE : commentValidationMessage(result.error);
    return NextResponse.json({ status: "rejected", message }, { status: 400 });
  } catch (err) {
    console.error(`コメント投稿に失敗しました (slug=${slug}):`, err);
    return NextResponse.json(
      { status: "rejected", message: "投稿に失敗しました。時間をおいて再度お試しください。" },
      { status: 500 },
    );
  }
}
