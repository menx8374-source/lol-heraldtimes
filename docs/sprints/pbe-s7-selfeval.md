---
tags: [sprint-selfeval]
sprint: PBE-S7
---

# PBE-S7 自己評価レポート

## 実装した内容
- `src/lib/generation/pbe-article.ts`
  - F-PBE7-1: `maybeFetchPbeXTweets(...)`とキュレーション読み込み(`readPbeCurationNotes`)を、item/champion diff計算の**直後・no_diff判定より前**に移動。
  - F-PBE7-2: no_diff判定を `itemChanges.length===0 && championChanges.length===0 && tweets.length===0 && curationNotes.length===0` に変更(全ソース空のときだけno_diff)。いずれか1つでも内容があれば従来の生成/in-place更新機構(upsert)にそのまま進む。
  - F-PBE7-3: 既存のupsert/一意化(`externalId=pbe-<ver>`)は無変更のため、内容が変われば自動でin-place更新される。全ソース空の場合は判定より前に到達しないため既存記事は一切触らない(残る)。
  - Xのコスト安全設計(`X_API_KEY`未設定/レート制限判定)は`maybeFetchPbeXTweets`内部のガードをそのまま維持(呼び出し位置を移しただけで条件は不変)。
- `src/lib/__tests__/generation-pbe-article.test.ts`
  - `stubFetchNoDiff`(CDragon item/champion差分0件フィクスチャ)を追加。
  - 新規describe「no_diff判定を「全ソース空」に修正（PBE-S7）」に6テストを追加(下記参照)。

## 技術選定（該当する場合のみ）
- 該当なし(ロジック修正のみ、新規依存・技術選定なし)。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（119ファイル / 1624テスト、うち本スプリント追加分6件含む）。`tsc --noEmit`エラー0。`npm run build`成功。`npm run lint`エラー0(既存警告6件のみ、本変更と無関係で回帰なし)。
- [x] CDragon変更0件でもXツイートがあればPBE記事が生成/更新される(no_diffで捨てない)。テスト「CDragon0件（item/champion差分なし）でもXツイートがあれば記事が生成される」で確認。全ソース空のときだけno_diffであることは「全ソース空...ならno_diffで、既存記事はそのまま残す」「X_API_KEY未設定・CDragonも0件ならno_diff」で確認。
- [x] Xコスト安全設計は不変: 「レート制限内(前回取得から間隔未満)ならCDragon0件でもfetchTweetsを呼ばずno_diffになる」「X_API_KEY未設定・CDragonも0件ならno_diff」の2テストでfetchTweets/writeLastXFetchAtが呼ばれないことを確認。
- [x] opt-in(既定off)・逐語・サムネ・未確定バッジは不変: 既存テスト13件(PBE-S4/S5相当)が無修正で全てPASSし続けている(回帰ゼロ)。
- [x] AI不使用・DBスキーマ変更なし・新規npm依存なし(pbe-article.tsとテストファイルのみ変更)。

## アプリの起動方法
- 本スプリントはロジック修正のみでUI操作対象なし。検証は `npx vitest run`（テストDB自動セットアップ、専用sqlite）で完結。サーバー起動は不要なため未起動・未停止(該当なし)。

## 既知の問題・懸念点
- なし。全チェックコマンド(vitest/tsc/build/lint)を実行しGreen/成功/エラー0を確認済み。

## 追加したテスト（任意）
- `src/lib/__tests__/generation-pbe-article.test.ts` に describe「no_diff判定を「全ソース空」に修正（PBE-S7）」を追加(6件):
  1. CDragon0件+Xツイートあり→記事生成(Xセクション含む)。今回の不具合の再現・修正確認。
  2. CDragon0件+人手キュレーションあり→記事生成。
  3. CDragon変更あり(従来ケース)→従来どおり生成(回帰なし)。
  4. 全ソース空(CDragon差分なし・X未設定・キュレーションなし)→no_diff・既存記事(body/title)はそのまま残る。
  5. X_API_KEY未設定+CDragon0件→no_diff・fetchTweetsは呼ばれない。
  6. レート制限内+CDragon0件→no_diff・fetchTweets/writeLastXFetchAtは呼ばれない(無駄打ちなし)。

## 関連ドキュメント
- [[pbe-s7-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
