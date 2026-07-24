import Link from "next/link";

/**
 * 全ページ共通フッター（F15）。
 * - Riot 非公認ディスクレーマー: Riot Games の Legal Jibber Jabber ポリシーに沿い、
 *   「承認・関与・後援するものではない」旨を常時表示する。
 * - AI自動生成注記: 記事単位の詳細注記（articles/[slug]）に加え、サイト全体の告知として掲載。
 * - 免責事項／プライバシーポリシー／お問い合わせ・掲載削除依頼の各固定ページへの導線を常設する。
 */
export function SiteFooter() {
  return (
    <footer className="w-full bg-neutral-900 text-neutral-400 text-xs">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6">
        <div className="flex flex-col gap-1">
          <p>
            本サイトは Riot Games, Inc. および League of Legends の非公認ファンサイトであり、
            Riot Games, Inc. が承認・関与・後援するものではありません。
          </p>
          <p>
            掲載記事は AI により自動生成されたものであり、内容は変動・変更される場合があります。
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-800 pt-3">
          <Link href="/disclaimer" className="hover:underline hover:text-neutral-200">
            免責事項
          </Link>
          <Link href="/privacy" className="hover:underline hover:text-neutral-200">
            プライバシーポリシー
          </Link>
          <Link href="/contact" className="hover:underline hover:text-neutral-200">
            お問い合わせ・掲載削除依頼
          </Link>
        </nav>
      </div>
    </footer>
  );
}
