"use client";

import { useState } from "react";
import { SHARE_TARGETS, ShareIconLink } from "@/components/share-icons";

const LINK_CLASS =
  "rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";

/**
 * 個別記事のSNSシェアボタン（拡張E1、拡張E11で本物ロゴアイコン化）。
 * X／LINE／はてなブックマーク／Facebookは各サービスの共有URLを新規タブで開く。
 * アイコン・シェア対象は固定シェアバー（ShareBar）と `share-icons.tsx` を共有する。
 */
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API 非対応・権限拒否時は静かに失敗させる（UIをブロックしない）。
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-bold text-neutral-500 dark:text-neutral-400">シェア:</span>
      {SHARE_TARGETS.map((target) => (
        <ShareIconLink
          key={target.id}
          target={target}
          url={url}
          title={title}
          className={`flex items-center gap-1 ${LINK_CLASS}`}
          iconClassName="h-3.5 w-3.5"
        >
          {target.label}
        </ShareIconLink>
      ))}
      <button type="button" onClick={handleCopy} className={LINK_CLASS}>
        {copied ? "コピーしました" : "URLコピー"}
      </button>
    </div>
  );
}
