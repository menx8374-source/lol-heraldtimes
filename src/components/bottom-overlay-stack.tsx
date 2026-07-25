"use client";

import { useEffect, useState } from "react";
import {
  CONSENT_STORAGE_KEY,
  isTrackingAllowed,
  parseConsentStatus,
  shouldShowConsentBanner,
  type ConsentStatus,
} from "@/lib/consent";
import { getGaMeasurementId, shouldLoadAnalytics } from "@/lib/analytics";
import { ANCHOR_AD_DISMISS_STORAGE_KEY, shouldShowAnchorAd } from "@/lib/ads/anchor";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { GoogleAnalytics } from "@/components/google-analytics";
import { AnchorAdBar } from "@/components/anchor-ad-bar";

/**
 * 画面下部に表示され得るオーバーレイ（Cookie同意バナー・アンカー広告、拡張E5）をまとめて管理する。
 *
 * 両者は独立した機能だが、どちらも画面下部に固定表示され得るため、この共通コンポーネントで
 * 1つの fixed コンテナ内に flex-col-reverse でスタックする（アンカー広告が一番下、
 * その上にCookie同意バナー）。個別に fixed 配置すると互いに重なり、アンカー広告の
 * 閉じるボタンがバナーの後ろに隠れてクリックできなくなる問題があったため、この構成にしている。
 *
 * GA4計測タグ（GoogleAnalytics）は「Cookie同意済み かつ 計測ID設定済み」の場合のみ読み込む
 * （同意前トラッキング禁止）。
 *
 * `anchorAdCode` は非公開env(AD_SLOT_ANCHOR)のためサーバー側(layout.tsx)で読んで
 * props経由で受け取る（NoticeBarと同じ方式）。
 */
export function BottomOverlayStack({ anchorAdCode }: { anchorAdCode?: string }) {
  const [hydrated, setHydrated] = useState(false);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>("unknown");
  const [anchorDismissed, setAnchorDismissed] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR/CSR初回描画を揃えるための意図的な深追い（NoticeBarと同じ理由）
      setConsentStatus(parseConsentStatus(window.localStorage.getItem(CONSENT_STORAGE_KEY)));
    } catch {
      setConsentStatus("unknown");
    }
    try {
      setAnchorDismissed(!shouldShowAnchorAd(window.localStorage.getItem(ANCHOR_AD_DISMISS_STORAGE_KEY)));
    } catch {
      setAnchorDismissed(false);
    }
    setHydrated(true);
  }, []);

  function persistConsent(next: ConsentStatus) {
    setConsentStatus(next);
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, next);
    } catch {
      // 保存に失敗しても、その場の選択自体は反映する（次回訪問時は再度バナーが出る）。
    }
  }

  function closeAnchorAd() {
    setAnchorDismissed(true);
    try {
      window.localStorage.setItem(ANCHOR_AD_DISMISS_STORAGE_KEY, "1");
    } catch {
      // 保存に失敗しても、その場で閉じる操作自体は成立させる。
    }
  }

  const showBanner = hydrated && shouldShowConsentBanner(consentStatus);
  // 広告コード(AD_SLOT_ANCHOR)未設定のときは、空のプレースホルダーを固定バーで画面下部に出さない
  // （固定オーバーレイでの空枠表示は画面占有・ポリシー配慮の観点で望ましくないため）。
  const showAnchor = hydrated && !anchorDismissed && Boolean(anchorAdCode);
  const gaMeasurementId = getGaMeasurementId();

  return (
    <>
      {showAnchor && <div aria-hidden="true" className="h-16 lg:hidden" />}
      {(showAnchor || showBanner) && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col-reverse">
          {showAnchor && <AnchorAdBar code={anchorAdCode} onClose={closeAnchorAd} />}
          {showBanner && (
            <CookieConsentBanner
              onAccept={() => persistConsent("accepted")}
              onReject={() => persistConsent("rejected")}
            />
          )}
        </div>
      )}
      {shouldLoadAnalytics(isTrackingAllowed(consentStatus), gaMeasurementId) && (
        <GoogleAnalytics measurementId={gaMeasurementId!} />
      )}
    </>
  );
}
