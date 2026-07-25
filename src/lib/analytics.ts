/**
 * GA4等アクセス解析タグ（拡張E5）の設定読み込みと、読み込み可否の判定。
 * 計測タグはCookie同意後にのみ読み込む（同意前トラッキング禁止）。IDが未設定なら何もしない。
 *
 * 計測ID自体はGoogle Analytics側の仕様上ページに公開される識別子（秘密情報ではない）のため、
 * env は NEXT_PUBLIC_ プレフィックス（クライアントバンドルにも埋め込まれる値）を使う。
 * それでもハードコードはせず、必ずenv経由で運営者が設定する。
 */

/** GA4計測ID（env NEXT_PUBLIC_GA_MEASUREMENT_ID）。未設定・空文字は undefined。 */
export function getGaMeasurementId(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
  return raw ? raw : undefined;
}

/**
 * GA4タグを実際に読み込んでよいか。
 * 「Cookie同意済み」かつ「計測IDが設定されている」の両方を満たす場合のみ true。
 */
export function shouldLoadAnalytics(
  trackingAllowed: boolean,
  measurementId: string | undefined
): boolean {
  return trackingAllowed && Boolean(measurementId);
}
