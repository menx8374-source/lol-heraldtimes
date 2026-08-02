---
tags: [sprint-evaluation]
sprint: admincms-S5
result: PASS
---

# Sprint admincms-S5 評価レポート（再検証・ラウンド2）

## 総合判定: PASS

## 検証モード: Playwright（Web実機・本番ビルド `npm run build` → `npm run start`）
- 本番モード（ISRキャッシュが実際に効く構成）で検証。`.env`のADMIN_USER/ADMIN_PASSWORDはコメントアウト状態のため、検証専用の資格情報を環境変数で与えて起動（`REVALIDATE_SECRET`は未設定＝既定構成のまま）。
- 検証前に`prisma/dev.db`をバックアップし、終了後に復元済み（記事28件＝公開24/保留4の元状態に戻り、テスト記事・テストタグ・review/rejected残留0件を確認）。サーバーも停止済み（ポート3000解放確認）。
- 認証は初回のみブラウザのBasic認証キャッシュを作り、以降は資格情報なしURLで操作（後述の「軽微な改善点」参照）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 前回FAILの原因（個別承認/却下が常に500）が解消。実クリックでいずれもPOST 200・DB遷移正常。他の致命的不具合も未検出 |
| コンソールエラー0件 | PASS | 全操作を通じてブラウザコンソールのエラー0件（アプリ由来）。サーバーログも8行・エラー/⨯ 0件 |
| 受け入れ基準充足率100% | PASS | 16項目すべてPASS（うち1項目は設計上の上位互換として確認・後述） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → Test Files 147 passed / **Tests 2008 passed**（61.0s） |

### ビルド系（必須項目）
| コマンド | 結果 |
|---|---|
| `npx vitest run` | PASS: 147ファイル / **2008テスト** 全passed |
| `npx tsc --noEmit` | PASS: エラー0（出力なし） |
| `npm run build` | PASS: 成功（Next.js 16.2.11 / Turbopack、静的ページ生成完了） |
| `npm run lint` | PASS: **0 errors** / 7 warnings（既存テストの`no-unused-vars` 6件＋`site-header.tsx`の`no-img-element` 1件。いずれも本スプリント変更と無関係の既存warning） |

## 前回FAIL（致命的バグ）の修正確認 ★最重点
### 個別「承認して公開」— PASS
- DOM実測: 個別承認/却下の各`<form>`が `articleId:hidden` を持ち、submitterボタンは`name`なし（`$ACTION_ID_...`による上書きが起きない構造）。
- 実クリック（カテゴリ絞込「5chの反応」を効かせた状態）: `POST /admin?reviewCategory=5ch%E3%81%AE%E5%8F%8D%E5%BF%9C` → **200 OK**。
- 結果: DB `review 5→4` / `published 19→20`、バッジ `未レビュー 5件→4件`、絞込中のキューから当該記事が消えて「要レビューの記事はありません」表示、公開トップに当該slugが出現、詳細ページ200。
- `articleId が指定されていません`・500は一切発生せず（サーバーログにエラー行なし）。

### 個別「却下」— PASS
- 絞込なし状態で実クリック → キューから消えバッジ `4件→3件`、DB `status=rejected`、公開トップ0件・`/category/overseas` 0件・個別URL **404**。
- 絞込「海外の反応」を効かせた状態でも実クリック → 同様に成功（バッジ`2件→1件`、絞込キューが0件表示、個別URL404）。**カテゴリ絞込中でも個別操作が動作**することを承認・却下の両方で確認。

## 一括承認との共存 — PASS
- 同一画面で個別フォームと一括フォーム（`form="review-queue-bulk-approve-form"`属性で紐付け）が共存し、両方とも動作。
- 3件中2件をチェック→「選択した記事をまとめて承認」→ `まとめて承認: 成功 2件 / 失敗 0件` を表示、バッジ`3件→1件`、未選択1件はキューに残留。承認2件は公開トップ・`/category/esports`・`/sitemap.xml`に出現、**個別詳細ページも200**（一括承認も`/articles/[slug]`を再検証＝個別と対称になったことを確認）。
- **全件成功（残り1件を全選択）でも結果表示が消えない**: キューが0件になっても `まとめて承認: 成功 1件 / 失敗 0件` が残り、同時に `未レビュー 0件` ＋ `要レビューの記事はありません` を表示（前回の軽微指摘2が修正済み）。
- 0件選択で実行 → `記事が選択されていません。`、DB・バッジとも変化なし・エラーなし。
- 0件状態でカテゴリ絞込を操作してもエラーなし（フィルタフォームは常時描画）。

## 非回帰（前回PASS項目の再確認）— PASS
- **F10 タイトル変更**: 保存直後にトップ一覧のカード見出しが新タイトル（旧タイトルは0件）、詳細ページのh1/titleも更新。
- **F10 段落ブロック**: 追加保存→詳細に`EVAL-PARA-A`が即表示、削除保存→即消滅（他ブロック不変）。
- **F10 カテゴリ変更**（パッチ/メタ→Riot公式）: `/category/patch-meta`から消え`/category/riot-official`に出現。
- **F10 タグ追加**（S5RETAG）: `/tags/S5RETAG` に出現＋`/tags`索引にも反映。`/search`にも反映。
- **誤警告なし**: 3回の保存成功すべてで`/admin`へredirectし、`data-revalidate-warning`は一度も出現せず（`REVALIDATE_SECRET`未設定の既定構成）。
- **検証エラー時**: 埋め込みURLをホワイトリスト外に変更して保存→`保存に失敗しました: 本文ブロック[4]の埋め込みurlがホワイトリスト外、または不正です`を表示、redirectせず**タイトル・URL等の入力を保持**。公開側は旧内容のまま（新タイトル0件・`evil.example.com`混入0件）。
- **要レビュー差し戻し**: 公開済み記事を「要レビュー」で保存→個別URL404、`/`・`/category/*`・`/tags`・`/tags/[tag]`・`/archive`・`/tier`・`/champions`・`/patches`・`/sitemap.xml`・`/news-sitemap.xml`・`/feed.xml`・`/search`・`/api/ranking?period=week|month`・同カテゴリ記事の関連記事欄すべてで**出現0件**、OGP出力もなし。同時にレビューキューに出現（バッジ 0→1件）、記事管理一覧に「要レビュー」ラベル表示。
- **S1〜S4**: 公開ポリシー切替（eスポーツを自動公開→要レビューへ復元、他5カテゴリ不変）／管理プレビュー画面（`/admin/articles/[id]/preview`が本文をレンダー、承認/却下はhidden input方式、**プレビューからの承認も200で公開側へ即反映**）／手動記事化の非対応URL検証（`この URL 形式には対応していません`）／フル構造エディタ（レス・Redditソース・見出し・段落・引用・埋め込み・画像・リンクボタン・目次・パッチ変更の全10ブロック型を選択・追加・削除・並べ替え可能）＝いずれも従来どおり動作。

## 発見したバグ・問題点（FAILの原因）
- 該当なし。

## 軽微な改善点（ブロッカーではないもの）
- Basic認証を`http://user:pass@localhost:3000/admin`形式でナビゲートすると、Server Actionの`fetch`がブラウザ仕様で拒否され `TypeError: Request cannot be constructed from a URL that includes credentials` になる（アプリ側の不具合ではなく検証手法の制約。資格情報なしURL＋ブラウザの認証キャッシュで回避し、以降エラー0）。検証手順として記録しておくと次回の混乱を防げる。
- `rejectReviewArticleAction` は `revalidatePath("/admin")` のみで一覧パスを再検証しない。却下対象はもともと非公開（review）なので実害はないが、承認側との対称性の観点では差異が残る。
- レビューキューのチェックボックスは`aria-label`があり良好だが、カテゴリ絞込`select`には可視ラベル「カテゴリで絞込:」が隣接するのみで`<label for>`の関連付けがない。
- 記事詳細ページに埋め込まれたサンプルTwitchクリップ/X投稿（シードデータ由来）が外部起因のコンソールエラー（`429 @ k.twitchcdn.net`、`cdn.syndication.twimg.com 404`、iframe内`Permissions policy violation: bluetooth`）を出す。アプリ由来ではなく本スプリントの変更とも無関係のため合否には計上していない（既知ノイズ）。
- 横幅は検証ブラウザの既定1920pxで水平オーバーフローなし（`scrollWidth 1905 <= innerWidth 1920`）。管理画面は`max-w-5xl`固定のため1280pxでも崩れない見込みだが、1280px実測はビューポート変更ツールがなく未実施。

## 未検証項目（実機確認が必要）
- 手動記事化（S2）の正常系（実X/Reddit URLからの記事生成）: 外部ネットワーク・レート制限依存のためURL形式バリデーションのエラー系のみ検証（S2スプリントで検証済みの範囲）。
- 一括承認の「失敗理由」表示: 実操作では全件成功したため画面表示は未再現（集計・表示ロジックは`bulk-approve-review-articles-action.test.ts`の一部失敗ケースで自動テスト済み）。
- 「再検証が設定不足で実行できない環境での警告表示」: 本スプリントの設計（in-process `revalidatePath`一本化）により既定構成では原理的に警告条件へ到達しない＝常に反映成功する上位互換であることを実機で確認するに留めた。警告分岐自体は`update-article-action.test.ts`で`revalidatePath`をthrowさせて検証済み。
- パイプライン実行時の公開ポリシー尊重（S1）: バッチ実行・外部収集依存のため自動テストでの担保のみ。
- 1280px幅でのレイアウト実測（ビューポート変更手段がなく未実施）。

## プレビュー画像
- `admincms-s5-preview-1.png`（`/admin`: 公開ポリシー・レビューキュー＋カテゴリ絞込・個別承認/却下・まとめて承認）
- `admincms-s5-preview-2.png`（公開サイトのトップ一覧）

## 関連ドキュメント
- [[admincms-s5-selfeval]]（ジェネレーターの自己評価レポート）
- [[admincms-s5-brief]]（本スプリントの仕様抜粋）
- [[admin-cms-v2-spec]]（製品仕様書）
</content>
