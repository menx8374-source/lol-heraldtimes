/**
 * 運営ダッシュボード（/admin, 拡張E7）のアクセス制御。Next.js Proxy（旧middleware）による Basic 認証。
 * /admin 配下のページ・サーバーアクション（同一URLへのPOSTとして送られる）を保護する。
 * 公開サイト（記事閲覧・コメント投稿等）はこの対象外で、認証不要のまま。
 *
 * 認証情報未設定（ADMIN_USER/ADMIN_PASSWORD 未設定）時は管理機能ごと無効化し、常に拒否する
 * （「未設定なら誰でも見られる」より安全側に倒す）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { isAdminAuthConfigured, verifyBasicAuthHeader } from "@/lib/auth/basic-auth";

const UNAUTHORIZED_HEADERS = {
  "WWW-Authenticate": 'Basic realm="admin", charset="UTF-8"',
};

export function proxy(request: NextRequest) {
  if (!isAdminAuthConfigured()) {
    return new NextResponse(
      "管理機能は現在利用できません（ADMIN_USER/ADMIN_PASSWORD が未設定のため無効化されています）。",
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!verifyBasicAuthHeader(authHeader)) {
    return new NextResponse("認証が必要です。", { status: 401, headers: UNAUTHORIZED_HEADERS });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
