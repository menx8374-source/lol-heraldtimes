import { POSITION_LABELS } from "@/components/ad-slot";

/**
 * アンカー（追従フッター/オーバーレイ）広告枠（拡張E5）の表示のみを担当する提示コンポーネント。
 * 主にモバイル想定のため lg 以上（PCサイドバーが追従広告を持つ）では表示しない。
 * 表示可否・閉じる操作の保存は呼び出し側（BottomOverlayStack）が管理する。
 * 画面下部への固定配置(fixed)は呼び出し側の共通ラッパーが担当する
 * （Cookie同意バナーと同じ画面下部に表示され得るため、重なり順は呼び出し側でスタックする）。
 *
 * `code` は運営者がenv(AD_SLOT_ANCHOR)に設定した信頼済みの広告タグ文字列のみ
 * （サーバー側 layout.tsx → SiteChrome 経由で受け取る。閲覧者由来のデータは混ぜない）。
 */
export function AnchorAdBar({ code, onClose }: { code?: string; onClose: () => void }) {
  return (
    <div
      className="border-t border-neutral-300 bg-neutral-50 px-3 py-1.5 shadow-lg lg:hidden dark:border-neutral-700 dark:bg-neutral-900"
      data-ad-slot="anchor"
      aria-label={POSITION_LABELS.anchor}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-2">
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            広告 / PR
          </p>
          {code ? (
            // code は運営者が env(AD_SLOT_ANCHOR) に設定した広告タグ文字列のみ。
            <div dangerouslySetInnerHTML={{ __html: code }} />
          ) : (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">広告枠（未設定）</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="広告を閉じる"
          className="shrink-0 rounded px-2 py-0.5 text-base leading-none text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          ×
        </button>
      </div>
    </div>
  );
}
