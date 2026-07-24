import type { Metadata } from "next";
import Link from "next/link";
import { resolveContactEmail } from "@/lib/contact";
import { getSiteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "お問い合わせ・掲載削除依頼",
  description: "掲載記事の内容に関するお問い合わせ・掲載削除依頼（オプトアウト）の連絡先。",
};

export default function ContactPage() {
  const contactEmail = resolveContactEmail(getSiteUrl());

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-bold">お問い合わせ・掲載削除依頼</h1>

      <section className="mt-6">
        <h2 className="text-base font-bold">掲載内容の削除依頼（オプトアウト）</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700">
          本サイトが引用・要約している掲示板（5ch 等）・SNS（Reddit 等）投稿の投稿者様、または
          当該内容の権利者様で、掲載内容の削除・修正を希望される場合は、下記の連絡先まで
          <strong>対象記事のURL・削除を希望する箇所・ご連絡先</strong>
          を明記の上ご連絡ください。内容を確認のうえ、速やかに対応いたします。
        </p>
      </section>

      <section className="mt-4 rounded border border-neutral-300 bg-neutral-50 px-4 py-3">
        <h2 className="text-sm font-bold text-neutral-600">連絡先</h2>
        <p className="mt-1 text-sm">
          <a href={`mailto:${contactEmail}`} className="text-sky-700 hover:underline">
            {contactEmail}
          </a>
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">その他のお問い合わせ</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700">
          記事内容の誤りのご指摘・その他のお問い合わせも、上記と同じ連絡先で受け付けています。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">対応にかかる時間について</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700">
          内容の確認のため、ご連絡から対応完了まで一定の時間をいただく場合があります。あらかじめ
          ご了承ください。
        </p>
      </section>

      <p className="mt-8 text-xs text-neutral-500">
        あわせて
        <Link href="/disclaimer" className="text-sky-700 hover:underline">
          免責事項
        </Link>
        ・
        <Link href="/privacy" className="text-sky-700 hover:underline">
          プライバシーポリシー
        </Link>
        もご確認ください。
      </p>
    </div>
  );
}
