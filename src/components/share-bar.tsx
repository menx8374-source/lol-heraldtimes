import { SHARE_TARGETS, ShareIconLink } from "@/components/share-icons";

/**
 * 記事内の固定シェアバー（拡張E11）。X最優先・本物ロゴアイコン(インラインSVG)で常時表示する。
 *
 * - PC(lg以上): 本文左側にsticky（`lg:top-24 lg:self-start`）で縦並び追従。呼び出し側で
 *   本文と横並びのflex行（`lg:flex lg:items-start`）に置くことで、本文左側に配置される。
 * - モバイル(lg未満): 画面上部にsticky（`sticky top-0`）の横並びバーにフォールバックする。
 *   ページ下部に固定表示するCookie同意バナー・アンカー広告枠（`BottomOverlayStack`）と
 *   重ならないよう、あえて画面「上部」に追従させ、本文の可読性を損なわない。
 */
export function ShareBar({ url, title }: { url: string; title: string }) {
  return (
    <>
      <nav
        aria-label="この記事をシェア"
        className="hidden lg:sticky lg:top-24 lg:flex lg:h-fit lg:w-12 lg:shrink-0 lg:flex-col lg:items-center lg:gap-3 lg:self-start"
      >
        {SHARE_TARGETS.map((target) => (
          <ShareIconLink key={target.id} target={target} url={url} title={title} />
        ))}
      </nav>
      <nav
        aria-label="この記事をシェア"
        className="sticky top-0 z-20 -mx-4 mb-3 flex items-center justify-center gap-3 border-b border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur lg:hidden dark:border-neutral-800 dark:bg-neutral-950/95"
      >
        {SHARE_TARGETS.map((target) => (
          <ShareIconLink
            key={target.id}
            target={target}
            url={url}
            title={title}
            className={`flex h-8 w-8 items-center justify-center rounded-full shadow-sm transition hover:opacity-80 ${target.badgeClassName}`}
          />
        ))}
      </nav>
    </>
  );
}
