/**
 * アクセス制御（Next.js Proxy＝旧middleware・Basic認証）。
 *
 * 1) /admin 配下（運営ダッシュボード・そのサーバーアクション）は常に保護する（拡張E7）。
 * 2) `SITE_PRIVATE=true`（env）のときは、**サイト全体**を同じ Basic 認証で保護し一般公開を止める
 *    （公開前の準備・更新中の非公開化に使う。閲覧には ADMIN_USER/ADMIN_PASSWORD が必要になる）。
 *    `SITE_PRIVATE` 未設定/false のときは従来どおり公開サイト（記事閲覧・コメント投稿等）は認証不要。
 *
 * 認証情報未設定（ADMIN_USER/ADMIN_PASSWORD 未設定）時は保護対象へのアクセスを拒否する
 * （「未設定なら誰でも見られる」より安全側に倒す）。証明書更新（/.well-known/acme-challenge）は
 * nginx 側で処理されるためこの Proxy を通らず、非公開化しても更新は妨げない。
 */
import { NextResponse, type NextRequest } from "next/server";
import { isAdminAuthConfigured, verifyBasicAuthHeader } from "@/lib/auth/basic-auth";

const UNAUTHORIZED_HEADERS = {
  "WWW-Authenticate": 'Basic realm="lolheraldtimes", charset="UTF-8"',
};

/** サイト全体を非公開（Basic認証必須）にするか。env `SITE_PRIVATE=true` で有効。 */
function isSitePrivate(): boolean {
  return process.env.SITE_PRIVATE === "true";
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // polish-S1 F-P1-1: /api/revalidate は独自の REVALIDATE_SECRET（Route Handler側）で保護済み
  // （未設定/誤りは401・固定パスのみ・POST限定）なので、Basic認証は課さず素通しする。
  // これにより SITE_PRIVATE=true 下でも B（公開後のオンデマンド再検証）が200を返せる。
  // 除外は完全一致のみ（/api/ 全体は除外しない＝他のAPIルートは従来どおり保護対象）。
  if (path === "/api/revalidate") {
    return NextResponse.next();
  }

  const isAdminPath = path === "/admin" || path.startsWith("/admin/");

  // 保護対象: 常に /admin、加えて SITE_PRIVATE 有効時はサイト全体。それ以外（公開ページ）は素通し。
  if (!isAdminPath && !isSitePrivate()) {
    return NextResponse.next();
  }

  if (!isAdminAuthConfigured()) {
    return new NextResponse(
      "認証情報（ADMIN_USER/ADMIN_PASSWORD）が未設定のためアクセスできません。",
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
  // SITE_PRIVATE でサイト全体を保護できるよう全ルートを対象にする（Next内部・静的アセット・画像は除外）。
  // 公開モードでは /admin 以外は上の early-return で素通しされるため実害のあるオーバーヘッドは無い。
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
