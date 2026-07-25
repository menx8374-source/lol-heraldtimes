---
tags: [sprint-selfeval]
sprint: E3
---

# Sprint E3（コンテンツ表現）自己評価レポート

## 実装した内容
1. **記事内画像ブロック**: `ArticleBodyImageBlock`（`{ type: "image"; url; alt; credit? }`）を`article-body.ts`に追加。`parseArticleBody`でurl/alt必須・危険スキーム拒否（`isSafeImageUrl`: `/`始まりのローカルパス・`data:image/*`・`https://`のみ許可）。表示は`ImageBlockView`（`<img loading="lazy" decoding="async" style max-width:100%>`＋`<figcaption>`でcreditをキャプション表示）。**画像は全てローカルSVG（`public/mock-images/`配下、自サイト編集部作成のオリジナルモック）**。
2. **アイキャッチ画像対応**: 既存`Article.thumbnailUrl`（Sprint1で型は存在済み・未使用）に、2記事（jungle-nerf、worlds組み合わせ）でローカルSVGサムネイルを設定。未設定記事は従来のカテゴリ色グラデーションプレースホルダーのまま（後方互換）。`ArticleThumbnail`に`loading="lazy" decoding="async"`を追加。
3. **埋め込みブロック（X/YouTube/クリップ）**: `ArticleBodyEmbedBlock`（`{ type:"embed"; provider; url; caption? }`）を追加。実iframe/scriptは一切読み込まず、`EmbedBlockView`でproviderアイコン＋ラベル＋caption＋元URLへのリンク＋「※埋め込みは本番接続時に表示されます」の注記のみを表示するプレースホルダーカードにした。`src/lib/embed.ts`に`isAllowedEmbedUrl(provider, url)`（provider別の正規ドメインホワイトリスト・https限定・サブドメイン偽装拒否）を実装し、`parseArticleBody`のパース時とコンポーネント描画時の**二重で検証**（不正データが混入しても描画しない）。
4. **顔文字/AA対応**: `src/lib/aa.ts`に`isAsciiArtLine(text)`（AA用記号2種以上／記号1種+連続スペース／同一記号3連続／縦棒+連続スペース、のいずれかで判定する決定論ヒューリスティック）。`ResLines`（reaction・コメント欄で共用）でAA判定行のみ`whitespace-pre-wrap font-mono`を付与し、単純な顔文字（`(^^)/`等）はAA判定されず通常テキストのまま崩れず表示。fixture/seedに5chヤスオ記事へ顔文字レス(10)＋オリジナル箱型AA「GG!」レス(11)を追加（既存2ch系の著名AAの転載はせず、オリジナルの簡単な箱型AAを新規創作）。
5. **海外の反応の原文併記**: `ArticleBodyReactionLine`に`original?: string`を追加（`text`が日本語訳、`original`が原文=英語のオリジナル創作テキスト）。`ResLines`で`original`がある行は日本語訳の前に「原文: ...（英語）」を表示。overseas-tier-list記事のreddit系reactionに2件、原文併記のデモを追加（すべてオリジナル創作、実在投稿の複製ではない）。
6. **出典/引用元クレジット**: 画像はcredit（キャプション表示）、埋め込みはprovider名ラベル表示、で出典/引用元を明示。既存の引用ブロック（quote）のsource表示（F15）と一貫した扱い。

## 技術選定
- 新規npm依存の追加なし。既存Next.js/Tailwind/Prisma/Vitest構成の範囲内で実装（architecture.mdのベースライン維持）。
- 画像はNext.js `next/image`ではなく素の`<img>`を使用（既存`ArticleThumbnail`と同じパターン踏襲）。ローカルSVG/データURIのみのため外部ドメイン設定(`next.config.ts`のimages.domains)は不要（`next.config.ts`は無変更）。
- 埋め込みは実装コストとセキュリティリスクの両面から「実iframe/oEmbed本接続」を明確にスコープ外とし、URL検証済みのプレースホルダーカードのみとした（タスク指示どおり）。
- AA判定はデータモデルにフラグを追加せず、表示コンポーネント側の純粋なヒューリスティック関数（`isAsciiArtLine`）とした。既存のreaction/コメントデータ構造を変更せず（コメントのフリーテキストにもAAデモが自動的に効く）、テストしやすい決定論ロジックに切り出せた。

## 受け入れ基準チェック（自己申告）
- [x] 記事内画像ブロック: parse検証（url必須・alt必須・危険スキーム拒否・data:image許可）・blockText（alt+credit）をVitest 8件で確認。実機（curl+ビルドHTML）で`loading="lazy"` `decoding="async"` `<figcaption>`+クレジット文言の出力を確認。
- [x] アイキャッチ画像対応: `thumbnailUrl`を2記事に設定、トップページHTMLに該当SVGパスが出力されることをcurlで確認。未設定記事のグラデプレースホルダーは無変更（`ArticleThumbnail`のフォールバック分岐は変更していない）。
- [x] 埋め込みブロック: parse時ホワイトリスト検証（正当/不正provider・URL・http拒否・javascript:拒否）をVitest 8件、`isAllowedEmbedUrl`単体でも9件テスト。実機でclip/twitter/youtubeの3種のプレースホルダーカード（ラベル・caption・URL・注記）が表示されることを確認。コンポーネント描画側の二重防御（不正URLは`null`を返し非表示）もコンポーネントテストで確認。
- [x] 顔文字/AA対応: `isAsciiArtLine`単体テスト6件（AA判定/非判定の両方）。実機で5chヤスオ記事の顔文字レス(10)が`font-mono`クラス無しで、AAレス(11)が`font-mono`クラス付きで出力されることをgrep確認。
- [x] 海外の反応の原文併記: parse/blockTextのテストで`original`フィールドの検証を確認。コンポーネントテストで「原文: ...（英語）」が日本語訳より前に出力されることを確認。overseas-tier-list記事で実機確認（RSCペイロードに原文テキストが含まれることをcurlで確認）。
- [x] 出典/引用元クレジットの明示: 画像credit・埋め込みprovider名表示・既存quote sourceの3経路すべてが表示されることを確認。
- [x] 安全性: `dangerouslySetInnerHTML`未使用（grep確認・テストでも属性使用の不在を確認）。画像urlは`isSafeImageUrl`でjavascript:等の危険スキームを拒否（テスト確認）。埋め込みurlはprovider別ホワイトリスト＋https限定＋サブドメイン偽装拒否（テスト確認）。実際の外部iframe/スクリプト・実画像・実ツイート・実動画は一切取り込んでいない（全てローカルSVGまたはリンクのみのプレースホルダー）。

## アプリの起動方法
```
npm install
npm run db:seed          # 12記事＋画像/埋め込み/AA/原文併記のサンプルを投入
npm run build && npm run start -- -p 3100   # または npm run dev
```
- http://localhost:3100/articles/patch-2614-jungle-nerf-hikkuri-kaeru （記事内画像・アイキャッチ確認用）
- http://localhost:3100/articles/5ch-yasuo-otp-densetsu-no-play （クリップ埋め込み・顔文字・AA確認用）
- http://localhost:3100/articles/overseas-tier-list-patch-146-hantei （画像・X埋め込み・原文併記確認用）
- http://localhost:3100/articles/worlds-2026-group-stage-draw-kekka （アイキャッチ・YouTube埋め込み確認用）

## 既知の問題・懸念点
- **ブラウザ実機（クリック操作・視覚的崩れ確認）は未実施**: 本セッションではPlaywright等のブラウザ操作ツールが利用できず、レスポンシブ崩れ・ダークモード切替時の実際の見た目・画像の遅延読み込み挙動の目視確認はできていない（curlでの静的HTML/RSCペイロード確認、Vitestコンポーネントテスト（renderToStaticMarkup）、ビルド成功の確認に留まる）。evaluatorのPlaywright実機検証で最終確認が必要。
- 埋め込みブロックのURL（YouTube動画ID・Xの投稿ID・Twitchクリップslug）は全てダミー値（実在するコンテンツを指さないサンプル文字列）。クリックすると外部サービス側で「見つかりません」等になる可能性があるが、実iframeを埋め込まないため実害はない。
- AA判定`isAsciiArtLine`は決定論ヒューリスティックであり完全ではない（未知のAA記号パターンを見逃す可能性、逆に稀な日本語記号の組み合わせを誤検出する可能性はゼロではない）。今回のデモ範囲（箱型AA・顔文字）では意図通り動作することをテストで確認済み。
- コメント欄（`commentBodyToLines`）は既存どおり各行を`trim()`しているため、ユーザーが投稿するコメント内でAAの**先頭インデント**を使う場合は崩れる可能性がある（今回のAAデモはseed記事のreactionブロック側で実施し、この既存トリミング挙動には手を加えていない。将来コメント欄でもAAの位置合わせを完全対応する場合は`commentBodyToLines`のtrim方針の見直しが必要）。

## 追加したテスト
- `src/lib/__tests__/aa.test.ts`（`isAsciiArtLine`: 顔文字非判定2件・通常文非判定2件・罫線/記号反復判定3件・縦棒+スペース判定2件・AA記号2種判定1件・空文字/アンカー行非判定2件、計6 describe内テスト）
- `src/lib/__tests__/embed.test.ts`（`isAllowedEmbedUrl`: 正当URL・無関係ドメイン拒否・偽装ドメイン拒否・http拒否・危険スキーム拒否・不正URL拒否・EMBED_PROVIDER_LABELS、計9件）
- `src/lib/__tests__/article-body.test.ts`（追記: reaction original 2件、画像ブロック parse 5件、埋め込みブロック parse 4件、blockText 4件）
- `src/components/__tests__/article-body-view.test.tsx`（追記: 画像ブロック描画3件、埋め込みブロック描画2件（正当表示・不正URL非表示）、AA/顔文字/原文併記描画3件）
- テスト実行結果: `npm test` → 37ファイル307件 全PASS（既存269件+新規38件、複数回連続実行で決定的にGreen確認）。`npx tsc --noEmit`エラー0件。`npm run lint`エラー0件（既存の無関係警告1件のみ、本スプリント差分外）。`npm run build`成功（全ルート生成）。

## 関連ドキュメント
- [[ext-e2-selfeval]]（前スプリント: コメント欄）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
