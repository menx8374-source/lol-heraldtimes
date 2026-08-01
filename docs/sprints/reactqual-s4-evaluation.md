---
tags: [sprint-evaluation]
sprint: reactqual-S4
result: PASS
---

# Sprint reactqual-S4 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- `npm run dev`（http://localhost:3000）で起動し、5ch反応記事ページを実機表示して確認。検証後にサーバー停止済み。
- ロジック検証は Playwright に加え、`npx tsx` による独自fixture実行（evaluator自作スクリプト・scratchpad配置）と全テストスイートで実施。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 5ch rules選定・S3不変・reddit/llm不変・実機表示すべて期待どおり（下記詳細）。生成パイプライン（`generateArticlesForQueue`）も成功で完走 |
| コンソールエラー0件 | PASS | `browser_console_messages`: 2件（errors:0 / warnings:0）。ネットワーク失敗リクエスト無し（非静的リクエスト0件・記事ページ200） |
| 受け入れ基準充足率100% | PASS | 基準1〜3すべて充足（下記） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → Test Files 132 passed / Tests 1858 passed（42.9s、失敗0） |

### 受け入れ基準の個別確認
1. **ビルド系**: `npx vitest run` 全Green（132ファイル/1858件）／`npx tsc --noEmit` 終了コード0・エラー0／`npm run build` 成功（全ルート生成）／`npm run lint` **0 errors**（warning 7件はすべて変更外ファイルの既存もの: `site-header.tsx` の no-img-element、既存テストの未使用変数）。
2. **5chが新しめ/活発な会話で表示される**:
   - 独自fixture（古クラスタ52-58-59-61-65＋新しめクラスタ400-403・404-405）を `composeArticleBody("5ch", rules)` に投入 → 選定順 `[404,405,400,401,402,403,52,58,59,61,65]`。新しめレスがprimaryとして先頭に来て、親（>>N参照先）が文脈として親→子のチェーン整合順で連なる。古クラスタ偏重ではない。
   - `REACTION_MAX_RESES=4` に絞ると `[404,405,401,402,403]` となり **古クラスタ（52〜65）は完全に除外**（新しめ優先が実効している）。
   - `>>N` からのparentIndex導出を直接確認: `1: >>1（自己参照）/ 2: >>999（存在しない）/ 3: >>1` → 出力 `[1,3,2]`（自己参照は親にならず無限ループなし、存在しない番号はnull扱い、有効参照のみ親文脈化）。
   - **実機**: 上記fixtureを`CollectedItem(5ch)`として投入し実パイプラインで記事生成 → 記事ページで `404 → 405(>>404) → 400 → 401(>>400) → 402 → 403 → 52 → 58 → 59 → 61 → 65` の順で表示、空白レス無し・`>>N`アンカー表示・強調（orange/red）・出典リンク正常（`reactqual-s4-preview-1.png`）。既存の5ch記事（12レス）でも同様に崩れなし（`reactqual-s4-preview-2.png`）。
   - **S3不変**: 101〜104チェーンで出力 `[101,102,103,104]`、**#102の本文「グレイブスのスモークスクリーンか？」が保持**・`anchors=[101]`。アンカーのみのレス（102が空）のケースでは `[101,103]` となり空レス非掲載ガードも維持。
   - **reddit/llm/X不変**: reddit rules `[70,50,60]`（score=res.score のまま・parent注釈由来）、5ch llmモードはAI選定（`selectReactionReses`）の指定どおり `[10]`（統一選定に載らない）。X（`buildXReactionBlocks`）は本diffで未変更。
3. **スキーマ/依存/LLM**: `git status` 上の変更は `src/lib/generation/compose.ts` とテスト5ファイルのみ（`prisma/schema.prisma`・`package.json`/`package-lock.json` 無変更）。5ch rules経路のLLM呼び出しはスパイ計測で **0回**（NG文を含む記事でも `ng-soften` 1回のみ＝S3設計どおり、レス件数に比例しない）。翻訳（`translateReactionLines`）は従来どおりreddit限定。

### コード確認（brief 2. の項目）
- (a) `compose.ts:811` `useUnifiedSelection = (sourceType === "reddit" || sourceType === "5ch") && mode !== "llm"`。5ch分岐は `score: res.number`、`parentIndex` は `extractAnchors(res.lines).find((n) => n !== res.number && numberToIndex.has(n))` の先頭→index（無ければnull）。reddit分岐は `score: res.score ?? 0` / `parentNumber` 由来のまま不変。
- (b) `selectMajorConversationCluster` は削除されておらず、else節（`REACTION_SELECT_MODE=llm` かつAI選定失敗時のフォールバック、reddit/5ch共通）で使用継続。`buildReactionBlocks` のシグネチャは `sourceType: "5ch" | "reddit"` なので、else節に来るのがllmモードのみという実装コメントは型上も正しい。
- (c) `target=reactionMaxReses()` / `anchorDepth=reactionAnchorDepth()` / `hardCap=target+3` は現行同値。統一選定の出力は既にチェーン整合順のため文脈追加ブロックを通さず、二重の文脈追加は無し（実出力でも重複レス無しを確認）。
- 更新された既存テスト4ファイルは、いずれも新仕様に沿った期待値の追認（例: `[58,59,61]`→`[413,58,59,61]`）で、検証意図の削除・アサーション弱体化は見られない。

## 発見したバグ・問題点（FAILの原因）
- 該当なし。

## 軽微な改善点（ブロッカーではないもの）
- **`.env.example` の記述が実装と乖離**（doc only・機能影響なし）: 183〜189行目「REACTION_SELECT_MODE=rules: 数値ルール（アンカー会話クラスタ選定…）」「REACTION_MAX_RESES / REACTION_ANCHOR_DEPTH … 5ch・REACTION_SELECT_MODE=llmは対象外（不変）」は、S4以降は5ch rulesにも適用されるため誤り。次スプリントでの1行修正を推奨（README・spec側には該当記述なし）。
- **5ch記事の表示順が実質「新しい話題の塊が先」になる**: レス数がtarget（既定12）以内に収まる記事では選ばれるレス集合は従来と同じで、**順序だけが逆時系列の塊順**になる（例: `[11,12,9,10,7,8,3,4,6,1,2,5]`＝スレの発端レスが記事末尾に来る）。これはbrief指定の`selectScoredAnchorReses`（score降順primary＋親文脈）の仕様どおりでredditと同挙動のためFAILとはしないが、まとめ記事としての読みやすさ観点で「導入となる元レスを先頭に置くか」は別途検討の余地あり。
- **anchorDepth=1のため、表示レスの`>>N`が非掲載レスを指す場合がある**（例: 401が`>>400`を表示するが400は未選定）。resel-S2以降のreddit経路と同じ既存挙動で本S4起因ではないが、5chでも同様に起こり得るようになった。

## 未検証項目（実機確認が必要）
- 実データ（実5chスレッド）での「新しめ優先が体感として直近の議論になるか」の定性評価は、収集層が`COLLECTION_MODE=mock`のため未実施（本番live収集での目視確認が望ましい）。ロジック上は収集層`selectHighlightReses`（被参照上位30件）の中での新しめ優先であることをコードで確認済み。
- `NG_REPHRASE_MODE=soften` の実LLM言い換え結果（mockでは空応答→remove相当にフォールバック）。S3時点からの既知の制約で本S4の変更点ではない。

## プレビュー画像
- `reactqual-s4-preview-1.png`（S4挙動の実機表示: 新しめクラスタ404/405→400〜403が先、古クラスタ52〜65が後、空レス無し・強調維持）
- `reactqual-s4-preview-2.png`（既存の5ch反応記事: レイアウト・アンカー・強調・出典が崩れていないこと）

## 関連ドキュメント
- [[reactqual-s4-selfeval]]（ジェネレーターの自己評価レポート）
- [[reactqual-s4-brief]]（本スプリントの仕様抜粋）
