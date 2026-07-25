import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  description: "本サイトにおけるアクセス解析・広告・個人情報の取り扱い方針について説明します。",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-bold">プライバシーポリシー</h1>

      <section className="mt-6">
        <h2 className="text-base font-bold">アクセス解析について</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          本サイトは、サービス改善のためアクセス解析ツール（Google Analytics 等、Cookie 等の
          技術を利用する場合があります）を利用することがあります。取得され得る情報は、ブラウザの
          種類・閲覧ページ・滞在時間・参照元等、個人を特定しない範囲の情報です。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">Cookieの使用と同意について</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          初回訪問時に画面下部へCookie使用に関する同意バナーを表示します。「同意する」を
          選択いただいた場合のみ、アクセス解析・広告のためのCookieを使用するタグ（Google
          Analytics 等）を読み込みます。「拒否/後で」を選択した場合、これらのタグは読み込まれません。
          同意状況はブラウザに保存され、次回訪問時は同じ選択が適用されます（保存内容を消去すると
          再度バナーが表示されます）。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">広告について</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          本サイトは第三者配信の広告サービス（Google AdSense 等）を利用する場合があります。
          これらの広告配信事業者は、Cookie 等を使用してユーザーの興味関心に応じた広告
          （パーソナライズ広告）を表示することがあります。Cookie の使用を希望されない場合は、
          ご利用のブラウザの設定、または各広告配信事業者が提供する広告設定ページから無効に
          することができます。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">個人情報の取り扱い</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          本サイトはコメント投稿・会員登録等の機能を提供しておらず、氏名・メールアドレス等の
          個人情報を能動的に収集していません。
          <Link href="/contact" className="text-sky-700 hover:underline dark:text-sky-400">
            お問い合わせ・掲載削除依頼
          </Link>
          の際にご提供いただいた情報は、そのお問い合わせへの対応目的の範囲内でのみ利用します。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">本ポリシーの変更</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          本ポリシーの内容は、法令の改正やサービス内容の変更に伴い、予告なく変更される場合が
          あります。変更後の内容は本ページに掲載した時点で効力を生じるものとします。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold">本ページの位置づけ</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          本ページの記載は一般的な案内であり、法律上の助言を目的とするものではありません。
        </p>
      </section>
    </div>
  );
}
