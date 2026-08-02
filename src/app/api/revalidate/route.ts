/**
 * 一覧ページのオンデマンド再検証エンドポイント（revalidate-S1 F-RV1-2、B）。
 * パイプラインが記事を公開した直後に叩き、再ビルドせず一覧ページ（home/category/tags/patches/
 * archive/tier/champions）へ新着を即時反映させる。
 *
 * セキュリティ（信頼境界）:
 * - env `REVALIDATE_SECRET` が未設定なら常に401（開けっ放しのDoS可能な再検証口を作らない＝安全側既定）。
 * - リクエストの `x-revalidate-secret` ヘッダ（またはJSON body `secret`）が一致しないときも401。
 * - 再検証パスは**固定の一覧パス群のみ**（ユーザー入力のパスを`revalidatePath`に渡さない）。
 * - POST以外は405（GET等の誤操作でキャッシュが無闇に飛ばないようにする）。
 */
import { NextResponse } from "next/server";
import { revalidateListingPathsInProcess } from "@/lib/generation/revalidate-listings";

export const dynamic = "force-dynamic";

/** env `REVALIDATE_SECRET` を読む。未設定・空文字はnull（=機能無効）。 */
function getConfiguredSecret(): string | null {
  const raw = process.env.REVALIDATE_SECRET?.trim();
  return raw ? raw : null;
}

/** リクエストから提示されたシークレットを取り出す（ヘッダ優先、無ければJSON bodyのsecret）。 */
async function extractProvidedSecret(request: Request): Promise<string | null> {
  const headerSecret = request.headers.get("x-revalidate-secret");
  if (headerSecret) return headerSecret;

  try {
    const body: unknown = await request.clone().json();
    if (body && typeof body === "object" && typeof (body as { secret?: unknown }).secret === "string") {
      return (body as { secret: string }).secret;
    }
  } catch {
    // bodyが無い/JSONでない場合はヘッダのみで判定する（bodyは任意入力のため失敗させない）。
  }
  return null;
}

export async function POST(request: Request) {
  const configuredSecret = getConfiguredSecret();
  if (!configuredSecret) {
    return NextResponse.json({ error: "not_configured" }, { status: 401 });
  }

  const providedSecret = await extractProvidedSecret(request);
  if (!providedSecret || providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // 再検証対象は固定の一覧パス群のみ（`revalidateListingPathsInProcess`、ユーザー入力由来の
    // パスは一切受け付けない）。管理画面のサーバーアクションと共有するsource of truth
    // （`src/lib/generation/revalidate-listings.ts`、admincms-S5で共有化）。
    revalidateListingPathsInProcess();
    return NextResponse.json({ revalidated: true });
  } catch (err) {
    console.error("一覧ページの再検証に失敗しました:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/** POST以外は405（固定応答。GET等で誤って再検証が走らないようにする）。 */
export async function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
