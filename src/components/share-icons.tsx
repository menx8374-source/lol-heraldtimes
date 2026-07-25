import type { SVGProps } from "react";
import { buildShareUrl, type ShareTarget } from "@/lib/share";

/**
 * SNSシェアの各社ロゴアイコン（拡張E11）。外部CDNを使わず、閲覧者入力を一切混ぜない
 * 信頼済みの静的SVGマークアップのみで構成する（`dangerouslySetInnerHTML` は使わない）。
 */

function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755a.63.63 0 1 1 0 1.26h-2.386a.63.63 0 0 1-.63-.629V8.108a.63.63 0 0 1 .63-.63h2.386a.63.63 0 1 1 0 1.26H17.61v1.125h1.755zm-3.855 3.016a.63.63 0 0 1-1.135.373l-2.19-2.98v2.348a.63.63 0 1 1-1.26 0V8.108a.63.63 0 0 1 1.135-.374l2.19 2.98V8.108a.63.63 0 1 1 1.26 0zm-5.741 0a.63.63 0 0 1-1.26 0V8.108a.63.63 0 1 1 1.26 0zM4.51 12.876H2.756a.629.629 0 0 1-.63-.629V8.108a.63.63 0 1 1 1.26 0v3.509H4.51a.63.63 0 1 1 0 1.259zM24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
    </svg>
  );
}

function HatenaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect x="1" y="1" width="22" height="22" rx="3" fill="currentColor" />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="14"
        fontWeight="700"
        fontFamily="Georgia, 'Times New Roman', serif"
        fill="#fff"
      >
        B
      </text>
    </svg>
  );
}

function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 1.926-.287 1.741h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
    </svg>
  );
}

export type ShareIconTarget = {
  id: ShareTarget;
  /** 記事下シェアボタン(ShareButtons)で使う短いラベル。 */
  label: string;
  /** アイコンのaria-label/title（例: 「Xでシェア」）。 */
  ariaLabel: string;
  Icon: (props: SVGProps<SVGSVGElement>) => React.ReactElement;
  /** バッジ背景色（ブランドカラー）のTailwindクラス。 */
  badgeClassName: string;
};

/**
 * シェア対象SNSの一覧（拡張E11）。Xを最優先・先頭に置く。
 * 固定シェアバー・記事下シェアボタンの双方でこの一覧を共通利用する。
 */
export const SHARE_TARGETS: ShareIconTarget[] = [
  {
    id: "x",
    label: "X",
    ariaLabel: "Xでシェア",
    Icon: XIcon,
    badgeClassName: "bg-black text-white dark:bg-white dark:text-black",
  },
  {
    id: "line",
    label: "LINE",
    ariaLabel: "LINEでシェア",
    Icon: LineIcon,
    badgeClassName: "bg-[#06C755] text-white",
  },
  {
    id: "hatena",
    label: "はてブ",
    ariaLabel: "はてなブックマークに追加",
    Icon: HatenaIcon,
    badgeClassName: "bg-[#00A4DE] text-white",
  },
  {
    id: "facebook",
    label: "Facebook",
    ariaLabel: "Facebookでシェア",
    Icon: FacebookIcon,
    badgeClassName: "bg-[#1877F2] text-white",
  },
];

/** シェア先1件分のアイコン付きリンク。新規タブ・rel="noopener noreferrer"で開く。 */
export function ShareIconLink({
  target,
  url,
  title,
  className,
  iconClassName,
  children,
}: {
  target: ShareIconTarget;
  url: string;
  title: string;
  className?: string;
  iconClassName?: string;
  /** アイコンの右に表示する任意のラベル（記事下シェアボタンでのテキスト併記用）。 */
  children?: React.ReactNode;
}) {
  const { Icon } = target;
  return (
    <a
      href={buildShareUrl(target.id, url, title)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={target.ariaLabel}
      title={target.ariaLabel}
      /* 各SNSのブランド色（バッジ背景＋白アイコン等）を保つためのフック。ニュース記事風デザインの
         リンク色（クリムゾン）を当てず、Tailwindのブランド色クラスを優先させる（globals.css参照）。 */
      data-share-icon
      className={
        className ??
        `flex h-9 w-9 items-center justify-center rounded-full shadow-sm transition hover:opacity-80 ${target.badgeClassName}`
      }
    >
      <Icon className={iconClassName ?? "h-4 w-4"} />
      {children}
    </a>
  );
}
