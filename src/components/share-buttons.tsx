"use client";

import { useState } from "react";
import { buildShareUrl } from "@/lib/share";

const LINK_CLASS =
  "rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";

/** 個別記事のSNSシェアボタン（拡張E1）。X／LINE／はてなブックマークは各サービスの共有URLを新規タブで開く。 */
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
      <a
        href={buildShareUrl("x", url, title)}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        X
      </a>
      <a
        href={buildShareUrl("line", url, title)}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        LINE
      </a>
      <a
        href={buildShareUrl("hatena", url, title)}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        はてブ
      </a>
      <button type="button" onClick={handleCopy} className={LINK_CLASS}>
        {copied ? "コピーしました" : "URLコピー"}
      </button>
    </div>
  );
}
