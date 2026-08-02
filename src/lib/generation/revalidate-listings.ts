/**
 * 一覧ページのオンデマンド再検証（B、revalidate-S1 F-RV1-3）を呼ぶ補助処理。
 * delivery.ts の notifyPublishedArticles と同型: env `REVALIDATE_SECRET` が未設定なら完全no-op
 * （fetch自体を呼ばない＝キー無しでも従来どおりAだけが効く）。設定時のみ `REVALIDATE_URL`
 * （既定は内部URL `http://127.0.0.1:<PORT>/api/revalidate`）へシークレット付きでPOSTする。
 *
 * 内部URLを既定にするのは、公開SITE_URL経由だとnginxのBasic認証で401になるのを避けるため。
 *
 * 「補助処理は本体を絶対に止めない」原則: 送信失敗・タイムアウト・非2xxはすべてtry/catchで
 * 握りつぶし、ログ1行だけ残す。呼び出し元（パイプライン本体）はこの関数の失敗によって
 * 一切影響を受けない。
 *
 * admincms-S5設計整理: このHTTPループバック（B）は**パイプライン（プロセス外）専用**とする。
 * 管理画面（/admin）のサーバーアクションはNext.jsの同一プロセス内で動くため、下記
 * `revalidateListingPathsInProcess` による直接 `revalidatePath` 呼び出しだけで即時反映を保証でき、
 * HTTP往復（REVALIDATE_SECRET設定必須・N件で N 回のHTTP等）は不要かつ不整合の原因になるため使わない。
 */
import { revalidatePath } from "next/cache";

const FETCH_TIMEOUT_MS = 5000;

/**
 * 一覧ページ群の固定パス一覧（唯一のsource of truth、admincms-S5で共有化）。
 * `/api/revalidate`（機能B、`src/app/api/revalidate/route.ts`）と管理画面の各サーバーアクション
 * （`src/app/admin/actions.ts`、admincms-S5 F10/F11）の両方がこの関数を使う。パスの手動同期
 * （ハードコードの二重管理）によるドリフトを防ぐため、パス一覧はここにだけ書く。
 * 同一Next.jsプロセス内（Server Action・Route Handler）からの呼び出しを前提とし、HTTPを介さず
 * 常に即座に反映される。
 */
export function revalidateListingPathsInProcess(): void {
  revalidatePath("/");
  revalidatePath("/tags");
  revalidatePath("/patches");
  revalidatePath("/archive");
  revalidatePath("/tier");
  revalidatePath("/champions");
  revalidatePath("/category/[slug]", "page");
  revalidatePath("/tags/[tag]", "page");
  revalidatePath("/patches/[version]", "page");
  revalidatePath("/archive/[key]", "page");
}

/** env `REVALIDATE_SECRET` を読む。未設定・空文字はnull（=no-op）。 */
function getSecret(): string | null {
  const raw = process.env.REVALIDATE_SECRET?.trim();
  return raw ? raw : null;
}

/** 再検証APIの呼び出し先URL。未設定時は内部URL（nginx Basic認証を回避するため127.0.0.1）。 */
function getRevalidateUrl(): string {
  const raw = process.env.REVALIDATE_URL?.trim();
  if (raw) return raw;
  const port = process.env.PORT?.trim() || "3000";
  return `http://127.0.0.1:${port}/api/revalidate`;
}

/**
 * 一覧ページをオンデマンド再検証する。`REVALIDATE_SECRET` 未設定時は何もしない(fetchを一切呼ばない)。
 * 失敗（HTTP非2xx・ネットワーク断・タイムアウト）は例外を投げず、ログを1行残すだけで正常終了する。
 * パイプライン（`run-pipeline.ts`、プロセス外）専用の補助処理（admincms-S5設計整理で管理画面からの
 * 呼び出しは撤去、詳細はファイル先頭のコメント参照）。戻り値は呼び出し元が使わないため`void`。
 */
export async function revalidatePublishedListings(): Promise<void> {
  const secret = getSecret();
  if (!secret) return;

  const url = getRevalidateUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-revalidate-secret": secret },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`一覧ページの再検証リクエストが失敗しました（status=${res.status}）`);
    }
  } catch (err) {
    console.error(
      "一覧ページの再検証リクエストの送信に失敗しました:",
      err instanceof Error ? err.message : err,
    );
  } finally {
    clearTimeout(timeout);
  }
}
