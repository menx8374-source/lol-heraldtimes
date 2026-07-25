"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY_PREFIX = "lol-matome:notice-dismissed:";

/**
 * 運営お知らせバー（拡張E1）。サーバー側で env(SITE_NOTICE) から読んだ message を
 * layout.tsx → SiteChrome 経由で受け取り表示する。閉じるボタンで localStorage に
 * 記録し、次回訪問時も再表示しない（メッセージ内容が変わったら再度表示する）。
 *
 * 初期状態は非表示にしておき、useEffect で localStorage を確認できてから表示するかを
 * 決める。SSRとクライアント初回描画の両方で「非表示（ノード無し）」に揃えることで、
 * 「要素の有無」自体が食い違うハイドレーション不整合（テキスト内容の食い違いより重大）を避ける。
 * このため、テーマ切替（テキストのみ差異）とは異なり suppressHydrationWarning では代替できず、
 * effect 内での setState が必要（react-hooks/set-state-in-effect の意図的な例外）。
 */
export function NoticeBar({ message }: { message: string }) {
  const [visible, setVisible] = useState(false);
  const storageKey = `${STORAGE_KEY_PREFIX}${message}`;

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR/CSR初回描画を「非表示」に揃えるための意図的な深追い（上記コメント参照）
      setVisible(window.localStorage.getItem(storageKey) !== "1");
    } catch {
      setVisible(true);
    }
  }, [storageKey]);

  if (!visible) return null;

  function handleClose() {
    setVisible(false);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // 保存に失敗しても、その場で閉じる操作自体は成立させる。
    }
  }

  return (
    <div className="flex w-full items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-900">
      <p className="min-w-0 flex-1 truncate">{message}</p>
      <button
        type="button"
        onClick={handleClose}
        aria-label="お知らせを閉じる"
        className="shrink-0 rounded px-2 py-0.5 text-base leading-none hover:bg-amber-600/40"
      >
        ×
      </button>
    </div>
  );
}
