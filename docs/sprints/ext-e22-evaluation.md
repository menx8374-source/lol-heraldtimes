---
tags: [sprint-evaluation]
sprint: ext-e22
result: PASS
---

# Sprint 拡張E22 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- ブラウザ導入済み、Playwright MCPで実機検証。Bash縮退なし。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | iframe実描画・フォールバック・CSP・回帰すべて正常 |
| コンソールエラー0件 | PASS | 自サイト(first-party)由来のエラー0件。詳細は下記注記 |
| 受け入れ基準充足率100%（基準1〜6） | PASS | 全項目確認 |
| テストGreen | PASS | `npx vitest run` → 71ファイル / 668件 全pass |

### 実行した自動チェック
- `npx vitest run`: 668 passed (668) 全Green
- `npx tsc --noEmit`: エラーなし
- `npm run build`: 成功
- `npm run lint`: エラー0（既存warning2件のみ＝site-header img / 既存テストの未使用変数。今回変更起因なし）

### 実機検証（localhost:3000、seed投入済み）
- Twitchクリップ記事 `5ch-yasuo-otp-densetsu-no-play`: `<iframe>` が1件実描画。src=`https://clips.twitch.tv/embed?clip=SampleHighlightClipDemo&parent=localhost`。属性 loading=lazy / allowFullScreen / referrerPolicy=strict-origin-when-cross-origin / allow=autoplay;encrypted-media;picture-in-picture;web-share を確認。
- YouTube不正ID記事 `worlds-2026-group-stage-draw-kekka`（id `sample1234xyz`＝13文字で11文字規則違反）: iframe0件、プレースホルダーカードにフォールバック。console error 0。
- twitter記事 `overseas-tier-list-patch-146-hantei`: iframe0件、Xカード表示のまま。console error 0。
- CSPヘッダ（`curl -I` で `/` と記事ページ両方）: `Content-Security-Policy: frame-src 'self' https://www.youtube-nocookie.com https://player.twitch.tv https://clips.twitch.tv`。frame-srcのみ、default-src等は含まれない（基準どおり）。
- 回帰確認: 反応記事の逐語reactionグループ・記事内画像(4)・カテゴリ(海外の反応)・ヘッダーマスコット画像 いずれも正常。トップページ（記事リンク27・サムネイル17・マスコット・カテゴリ）console error 0。

### コンソールエラーに関する注記（重要）
- Twitchクリップ記事を **`localhost:3000`** で開いた場合、自サイト(first-party)由来のconsole errorは0件。
- Twitchの実iframe内部からは 429（`k.twitchcdn.net` のfingerprintエンドポイント）と MaxListenersExceededWarning（`assets.twitch.tv` のプレーヤーJS）が出るが、これらは **third-party（Twitch）クロスオリジンiframe内部** の挙動であり、当アプリのコードに起因しない。seedのクリップslugは実在しないサンプル値のためTwitch側がレート制限/内部警告を出しているだけで、ブリーフが明記する「実再生の可否はネットワーク依存」の範囲。iframe要素とsrcの検証で基準充足。
- 初回に `127.0.0.1:3000` で開いた際に出た frame-ancestors CSP違反エラーは、iframeの `parent=localhost`（`getSiteUrl()`由来で正しい）に対しアクセス元ホストを 127.0.0.1 にした検証操作側のミスマッチが原因。正しい `localhost` で開けば消失（0件）するため、アプリ不具合ではない。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- 既存lint warning 2件（`site-header.tsx` の `<img>`、`generation-generate-article.test.ts` の未使用 `_messages`）は本スプリント範囲外の既存事象。

## 未検証項目（実機確認が必要）
- Twitch/YouTubeプレーヤーの実際の映像再生可否（seedのクリップ/動画IDが実在しないサンプル値のため、また外部ネットワーク依存のため）。ブリーフの規定どおりiframe要素とsrcの確認で代替。
- 本番ドメイン（`lolheraldtimes.com`）での `parent` 一致による再生は本番環境でのみ確認可能。

## プレビュー画像
- `sprint-ext-e22-preview-1.png`（Twitchクリップ実iframeを含む反応記事詳細）

## 関連ドキュメント
- [[ext-e22-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e22-brief]]（本スプリントの仕様抜粋）
