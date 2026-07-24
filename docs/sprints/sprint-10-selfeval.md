---
tags: [sprint-selfeval]
sprint: 10
---

# Sprint 10 自己評価レポート

## 実装した内容
- フッター（`src/components/site-footer.tsx`）を更新: Riot 非公認ディスクレーマーの文言を明確化（「承認・関与・後援するものではありません」）、AI自動生成注記、`/disclaimer`・`/privacy`・`/contact` への常設リンクを追加。
- 固定ページを3件新規実装（いずれも静的、PageWithSidebarを使わずシンプルな1カラム）:
  - `src/app/disclaimer/page.tsx`（免責事項: 非公認・AI生成・出典/引用・外部リンク・削除依頼導線・法的助言でない旨）
  - `src/app/privacy/page.tsx`（プライバシーポリシー: アクセス解析・広告(Cookie)・個人情報の取り扱い・変更可能性・法的助言でない旨）
  - `src/app/contact/page.tsx`（お問い合わせ・掲載削除依頼: 連絡先メールアドレスの案内・対応時間の目安）
- `src/lib/contact.ts`: 連絡先メールアドレス解決の純関数 `resolveContactEmail`（`CONTACT_EMAIL` 環境変数優先、未設定時は `SITE_URL` ホスト名から `contact@<host>` を自動生成）。
- `src/components/article-body-view.tsx`: 引用ブロック(blockquote)に「引用」ラベルを追加し、自サイト生成文（見出し・段落）との視覚的区別を強化（既存の枠線・背景色・斜体・出典元表記に加え明示ラベル）。
- `.env.example` / `README.md` に `CONTACT_EMAIL`（任意、秘密情報ではない）を追記、README に F15 の法務ページ導線の節を追加。
- `vitest.config.ts` の `include` に `*.test.tsx` を追加（コンポーネントテスト対応。jsdom/testing-library等の新規依存は追加せず、既存の `react-dom/server` の `renderToStaticMarkup` のみで検証）。

## 技術選定
- コンポーネントテストは jsdom や `@testing-library/react` を新規追加せず、既存依存の `react-dom/server`（`renderToStaticMarkup`）でサーバー側静的レンダリングした HTML 文字列に対しアサーションする方式を採用。理由: (a) 対象コンポーネント（フッター・固定ページ・記事本文ビュー）はいずれも同期・非インタラクティブな表示ロジックのみで、DOMイベントやクライアント状態を検証する必要がない。(b) 新規依存追加ゼロで実現でき、サプライチェーンリスク・保守コストを増やさない。既存の `environment: "node"` のまま流用でき運用コストもゼロ。

## 受け入れ基準チェック（自己申告）
- [x] 全公開記事に出典（元ソースへのリンク＋サービス名）が表示される: Sprint 4/9 時点で実装済みを確認・維持（`[5ch]`/`[Reddit]`/`[Riot公式]` + URLリンク）。本番ビルドを起動し複数記事（5ch記事・esports記事）で実機確認。
- [x] フッター等に Riot 非公認ディスクレーマーが常時表示される: 文言を「承認・関与・後援するものではありません」に強化。全公開ページ（トップ・記事・固定ページ）で `SiteChrome` 経由の共通フッターとして表示されることを確認（`/admin` のみ非表示、Sprint 9 の意図通り）。
- [x] 全公開記事に AI自動生成注記が表示される: Sprint 5 時点の既存注記を維持・確認（「この記事は AI により自動生成された記事です。内容は変動・変更される場合があります。」）。
- [x] 免責事項・プライバシー方針・掲載削除依頼（オプトアウト）の固定ページが存在しフッターから到達できる: `/disclaimer`・`/privacy`・`/contact` を実装、フッターに常設リンク。ビルド後にHTTP 200を確認。
- [x] 記事内の引用部分が自サイト生成文と視覚的に区別され、引用として明示される: blockquote（枠線・背景色・斜体）+「引用」ラベル + 出典元表記（例: 「— 5ch まとめ」）で明示。実記事で確認。
- [x] これらの表示が全ページ共通・全記事で欠落なく出ることを複数記事・複数ページで確認: 本番ビルド起動後、複数記事(`5ch-support-item-change-giron`・`esports-mid-season-invitational-preview`)・トップページ・`/admin`（フッター非表示の確認）・3固定ページで curl による実機確認済み。

## アプリの起動方法
```bash
npm run build && npm run start   # http://localhost:3000（本番相当）
# または開発モード
npm run dev                      # http://localhost:3000
npm test                         # Vitest（157件）
```
- フッターの各リンク: `/disclaimer`・`/privacy`・`/contact`
- 記事例: `/articles/5ch-support-item-change-giron`（出典[5ch]・AI注記・引用ラベル確認済み）、`/articles/esports-mid-season-invitational-preview`（出典[Riot公式]確認済み、この記事は引用ブロックを含まない構成のため blockquote 表示なし＝仕様通り）

## 既知の問題・懸念点
- `/contact` の連絡先メールアドレスは `CONTACT_EMAIL` 未設定時 `SITE_URL`（既定 `http://localhost:3000`）から `contact@localhost` を自動生成する。実運用ドメイン確定後は `SITE_URL` を実ドメインに設定するか `CONTACT_EMAIL` を明示的に設定する必要がある（現状はローカル検証用のプレースホルダーとして機能）。
- Riot の Legal Jibber Jabber ポリシーは一般的な非公認表記の慣行に沿って作成したが、これは法律アドバイスではない一般的な文言であり、実運用前に運営者自身による最終確認を推奨（免責事項ページ内にもその旨明記済み）。
- コンポーネントテストは `renderToStaticMarkup` によるHTML文字列アサーションのみで、クリック等のインタラクション検証は行っていない（対象コンポーネントに該当ロジックが無いため不要と判断）。

## 追加したテスト
- `src/lib/__tests__/contact.test.ts`: `resolveContactEmail` の分岐（env設定あり/トリム/未設定時のホスト名からの自動生成/不正URL時のフォールバック）を4件。
- `src/components/__tests__/site-footer.test.tsx`: 非公認ディスクレーマー文言・AI注記・3固定ページへのリンクの表示を3件。
- `src/components/__tests__/legal-pages.test.tsx`: 3固定ページそれぞれの必須文言（免責/Cookie/広告/個人情報/削除依頼導線/連絡先メール）を4件。
- `src/components/__tests__/article-body-view.test.tsx`: 引用ブロックのblockquote描画・「引用」ラベルと出典表記・段落との非混在を3件。
- 全体: 既存143件 + 新規14件 = 157件、`npm test` 全件Green（複数回連続実行でも決定的に成功）。

## 関連ドキュメント
- [[sprint-10-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
