import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "免責事項",
  description:
    "本サイトの非公認ディスクレーマー・AI自動生成記事に関する免責事項について説明します。",
};

export default function DisclaimerPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-bold">免責事項</h1>

      <section className="mt-6">
        <h2 className="text-base font-bold">Riot Games との関係について（非公認）</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          本サイトは League of Legends（LoL）に関する話題を個人が非公式にまとめるファンサイトです。
          Riot Games, Inc. とは提携しておらず、Riot Games, Inc. が本サイトを承認・関与・後援するもの
          ではありません。League of Legends および関連する商標・著作物等は、それぞれの権利者（Riot
          Games, Inc. 等）に帰属します。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">AI による自動生成記事について</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          本サイトに掲載する記事は AI により自動生成されています。内容の正確性・最新性・完全性を
          保証するものではなく、公開後に事実関係が変動・修正される場合があります。重要な判断を行う
          際は、必ず一次情報（公式サイト・公式発表等）をご確認ください。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">出典・引用について</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          記事内で紹介する掲示板（5ch 等）・SNS（Reddit 等）・公式サイトの投稿内容は、各出典元の
          ものであり、その内容の真偽・正確性について本サイトは責任を負いません。引用箇所は本文の
          自動生成部分と視覚的に区別（枠線・斜体表示・「引用」表示）して掲載しています。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">外部リンクについて</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          記事末尾の「出典」に掲載する外部サイトへのリンク先の内容・安全性について、本サイトは
          一切の責任を負いません。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">掲載内容の削除依頼について</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          掲載記事が引用・要約している投稿の投稿者様、または権利者様で、掲載内容の削除・修正を
          希望される場合は、
          <Link href="/contact" className="text-sky-700 hover:underline dark:text-sky-400">
            お問い合わせ・掲載削除依頼ページ
          </Link>
          よりご連絡ください。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">本ページの位置づけ</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          本ページの記載は一般的な案内であり、法律上の助言を目的とするものではありません。
          個別の法的判断が必要な場合は、弁護士等の専門家にご相談ください。
        </p>
      </section>
    </div>
  );
}
