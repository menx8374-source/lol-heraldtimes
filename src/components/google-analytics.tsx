"use client";

import Script from "next/script";

/**
 * GA4計測タグ（拡張E5）の読み込み。呼び出し側（BottomOverlayStack）が
 * 「Cookie同意済み かつ 計測ID設定済み」の場合のみこのコンポーネントをマウントするため、
 * ここでは条件判定をせず単純にタグを出力する（同意前トラッキング禁止の判定はshouldLoadAnalytics側）。
 *
 * measurementId は運営者がenv(NEXT_PUBLIC_GA_MEASUREMENT_ID)で設定した値のみ（getGaMeasurementId経由）。
 */
export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', ${JSON.stringify(measurementId)});`}
      </Script>
    </>
  );
}
