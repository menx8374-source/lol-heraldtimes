---
tags: [sprint-evaluation]
sprint: E13
result: PASS
---

# Sprint E13 評価レポート（再検証・試行2/3）

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- `npm run db:seed` → `npm run build` → `npx next start -p 3100` で本番ビルド起動。Playwright MCPで実機操作、API直叩き（node fetch）とVitestを併用。検証後サーバー停止・`npm run db:seed`でDB復元済み。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 前回FAIL点（リロード後ハイライト非復元・逆挙動）が解消。全観点で欠陥なし。 |
| コンソールエラー0件 | PASS | 記事ページ通常フロー・ホームページとも error/warning 0件。 |
| 受け入れ基準充足率100% | PASS | 全受け入れ基準を実機/APIで充足確認。 |
| テストGreen（全テスト成功） | PASS | `npm test` → 61ファイル・544テスト全PASS。 |

## 個別観点の結果（前回FAID点を最重点に）
- **【最重点】リロード後ハイライト復元: PASS**。😡をadd（24→25）→リロード→`aria-pressed=true`・`bg-blue-50`が復元（localStorage=😡・DB=25も保持）。コメント1👍add（8→9）→同一リロードで👍も`aria-pressed=true`・`bg-blue-50`復元。1.5秒待機で確認。恒久非表示・遅延非表示なし。`useSyncExternalStore`方式でhydration後にlocalStorage値を自動再レンダーする修正が有効。
- **state/DOM整合（前回の実害）: PASS**。リロード後、ハイライト表示された😡を再クリック→正しく取消（25→24、`aria-pressed=false`、ls=null）。逆挙動（未選択に見えて押すと-1）は解消。
- 1回制限・トグル: PASS。👍を連続クリックで 7→6(off)→7(on)→6(off)。複数加算なし。
- 切替（記事）: PASS。😮add(12,pressed)→👍クリックで😮-1=11(unpressed)・👍+1=7(pressed)、ハイライト単一移動、ls=👍。
- 切替（コメント）: PASS。👍(9,pressed)→👎で good-1=8(unpressed)・bad+1=2(pressed)、ls=bad。
- 0フロア: PASS。API直叩きで seed0の😂を op=remove ×2 → 0のまま。コメント3の bad(seed0) を op=remove ×7 → badCount 0のまま（goodCount 5不変）。
- 公開限定・不正弾き: PASS。invalid_op=400／invalid_emoji(🚀)=400／未知slug=404（reactions）。vote: invalid_type=400／invalid_op=400／未知コメント番号=404／未知slug=404。held/scheduled/rejected は本seedに存在しないが、非公開slugは未知slugと同一の `findFirst(where:{slug,...PUBLISHED_ONLY})` → `!article` → 404 パスを通り、PUBLISHED_ONLYはユニットテストで担保。
- 回帰: PASS。ダークモード切替（false↔true）動作。E11固定シェアバー・E12コメントUI・E8コメント/返信/賛否・E9関連記事一覧・レスポンシブレイアウト（Tailwind）を記事/ホームで確認。ホームページ通常訪問でコンソール error/warning 0件。

## 発見したバグ・問題点
- なし。

## 軽微な改善点（ブロッカーではない）
- 記事絵文字ボタンのアクセシブルネームが数値カウントのみ（絵文字spanは`aria-hidden`）。aria-labelで「笑う 0」等を付けると判別性が上がる（コメント投票側はaria-label="Good"/"Bad"付与済み）。前回から継続の軽微指摘。

## 未検証項目（実機確認が必要）
- localStorage無効/プライベートモードでの実ブラウザ挙動は直接未検証（コード上のtry/catchラッパと`local-selection.test.ts`で担保）。
- held/scheduled/rejected記事へのリアクション拒否は、本seedに該当記事が無いため実POSTでは未検証（未知slug=404と同一コードパス＋ユニットテストで担保）。
- 切替時の2リクエスト逐次送信で2件目がネットワーク失敗した場合の中間状態（self-eval記載の既知懸念、通常フロー外）。
- 別タブ/別ウィンドウ間のstorageイベント同期（スコープ外・未実装）。

## プレビュー画像
- `ext-e13-preview-1.png`（リロード後も😡・コメント👍のハイライトが維持された状態）

## 関連ドキュメント
- [[ext-e13-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e13-brief]]（本スプリントの仕様抜粋）
