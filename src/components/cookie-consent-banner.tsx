import Link from "next/link";

/**
 * Cookie同意バナー（CMP、拡張E5）の表示のみを担当する提示コンポーネント。
 * 表示可否・同意状態の保存は呼び出し側（BottomOverlayStack）が管理する。
 * 画面下部への固定配置(fixed)は呼び出し側の共通ラッパーが担当する
 * （アンカー広告と同じ画面下部に表示され得るため、重なり順は呼び出し側でスタックする）。
 */
export function CookieConsentBanner({
  onAccept,
  onReject,
}: {
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Cookie使用に関する同意"
      className="border-t border-neutral-300 bg-white px-4 py-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 flex-1 text-xs text-neutral-700 dark:text-neutral-300">
          本サイトはCookieを使用します（アクセス解析・広告のため）。詳しくは
          <Link href="/privacy" className="mx-1 text-sky-700 hover:underline dark:text-sky-400">
            プライバシーポリシー
          </Link>
          をご確認ください。同意しますか？
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            拒否/後で
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            同意する
          </button>
        </div>
      </div>
    </div>
  );
}
