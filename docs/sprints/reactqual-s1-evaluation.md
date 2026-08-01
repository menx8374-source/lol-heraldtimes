---
tags: [sprint-evaluation]
sprint: reactqual-S1
result: PASS
---

# Sprint reactqual-S1 評価レポート

## 総合判定: PASS

## 検証モード: テスト＋静的確認（Playwright不適用）
- 本スプリントの変更は収集層のロジック（X検索クエリ生成・関連判定純関数）のみでUI変更なし。brief評価基準も「テスト＋静的確認で可（実API不要）」と明記。
- 実挙動は一時プローブテスト（`src/lib/__tests__/zz-eval-probe*.test.ts`として一時配置→実行後に削除。リポジトリには残していない）で `containsLoLTerm` / `buildDefaultSearchQueries` / `isRelevantItem` / `collectFromSource`(mockアダプタ) を実行して確認した。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 受け入れ基準1〜3の再現確認で不整合なし。既存ソース(reddit/5ch/riot/riot-news)の収集件数も mock実行で従来通り（reddit 6→4件、5ch 5→3件、riot 2→2件、riot-news 3→3件） |
| コンソールエラー0件 | PASS | `vitest`/`tsc`/`build`/`lint` いずれも実行時エラー・警告以上の出力なし（lintは既存warning7件のみ・本差分ファイルは0） |
| 受け入れ基準充足率100% | PASS | 下記1〜3を実行確認 |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → **129 files / 1806 tests 全passed**（自己申告と一致） |

### 受け入れ基準の実行確認
1. **ビルド系**: `npx vitest run` 全Green(1806) ／ `npx tsc --noEmit` エラー0 ／ `npm run build` 成功（全ルート生成・revalidate表示も正常） ／ `npm run lint` **0 errors**（warning 7件はすべて既存の無関係ファイル: site-header.tsx・既存テスト群）。
2. **containsLoLTerm（実行結果）**
   - true: `"League of Legends面白い"` / `"ゼドが強すぎる"` / `"アジール強すぎ"` / `"#LoL 今日のランク"` / `"LEAGUE OF LEGENDS"`（大小無視）/ `"リグオブやろうぜ"`。
   - false: `"lol that's so funny"` / `"草www lol"` / `"just lol"` / `"LOL!!!"` / `"政治の話でしかない、まったくlol"` / `""`（空文字）。
   - `LOL_SPECIFIC_TERMS.includes("lol") === false`（裸lolは判定語に含まれない）を実測確認。
3. **buildDefaultSearchQueries（実行結果、hot={minScore:50,minComments:5}）**: クエリ数=3。
   - Q0: `(LJL OR "リーグ・オブ・レジェンド" OR リーグオブレジェンド OR リグオブ OR #LoL OR "League of Legends") min_faves:100 min_replies:5 lang:ja -filter:retweets -filter:replies`
   - Q1: `("League of Legends" OR #LeagueOfLegends OR #LoL OR LJL) min_faves:1000 min_replies:5 lang:en -filter:retweets`
   - Q2（eスポーツ・**現状維持を確認**）: `(LJL OR LCK OR LPL OR LEC OR MSI OR Worlds OR "世界大会") min_faves:100 min_replies:5 lang:ja -filter:retweets`
   - 裸LoL判定 `(?<![#\w"])lol(?![a-z])` は3クエリすべて **false**。`min_faves:`/`min_replies:` は hotness config 由来のまま（floor=100/1000/100・fetchopt-S1導出は無改変）。
4. **isRelevantItem（実行結果）**: x+content(LoL固有語)→true ／ x+`"lol that's so funny, typical politics"`→**false** ／ x+content未指定は title で判定（`"#LoL ranked"`→true） ／ reddit許可sub→true・非許可sub→false ／ 5chキーワード一致→true・不一致→false ／ riot-news→常にtrue（**すべて従来どおり**）。
5. **非改変の確認**: `git status` は `filter.ts`・`x.ts`・テスト2本の変更＋新規 `lol-terms.ts`/テスト1本のみ。`prisma/schema.prisma`・`package.json` 無変更（依存追加なし）。`pbe-x-source.ts`・`X_SEARCH_QUERIES` 経路は無変更。
6. **逆importなし**: `lol-terms.ts` を import しているのは `src/lib/collection/filter.ts`（collection層）とテストのみ（grep全件確認）。generation層からの参照なし。
7. **整合性（クエリ↔再チェック）**: Q0/Q1のOR語（LJL/リーグ・オブ・レジェンド/リーグオブレジェンド/リグオブ/#LoL/"League of Legends"/#LeagueOfLegends）はすべて `LOL_SPECIFIC_TERMS` に含まれるため、クエリで返るツイートは再チェックをほぼ通過する設計になっている（例外は下記「軽微な改善点」の`世界大会`のみ）。

## 発見したバグ・問題点（FAILの原因）
- なし（FAIL要因となる問題は検出されなかった）。

## 軽微な改善点（ブロッカーではないもの）
- **短い英字略語の部分一致による誤検知（over-inclusion）**: `containsLoLTerm` は `includes` の部分文字列一致のため、`"lec"` が **election / select / collect / electric / intellectual** に、`"msi"` が MSIブランド、`"worlds"` が `"Two worlds apart"`、`"アーリ"` が `"アーリーアクセス"` にヒットする。実測: `containsLoLTerm("The election was rigged, lol") === true`、`containsLoLTerm("I bought a new MSI laptop") === true`。
  - 既定クエリ経由では「まずクエリでLoL固有トークンに絞る」ため実害は限定的だが、Q2（現状維持のeスポーツクエリ）が裸トークン `MSI` / `Worlds` を含むため、**MSI（PCパーツ）や他競技の"Worlds"ツイートは再チェックでも止まらない**（本スプリント起因の悪化ではないが、安全網としては未達）。ASCII略語のみ単語境界一致（`\bljl\b` 等）にすると誤検知を閉じられる。
- **`世界大会` がQ2にはあるが `LOL_SPECIFIC_TERMS` に無い**: `世界大会` だけにマッチして取得されたツイートは再チェックで必ず落ちる＝当該OR語が実質デッド（取得クレジットの空振り）。語を追加するかQ2から外すかの整理が望ましい。
- **カタカナ`ヤスオ`の欠落**: `DEFAULT_LOL_KEYWORDS` には `"ヤスオ"` があるが `LOL_SPECIFIC_TERMS` はローマ字 `"yasuo"` のみ（代わりに `"アジール"` を追加）。mockのX fixture 4件のうち関連ありは1件のみになった（実測: `x: fetched=4 relevant=1`、除外された3件は「ヤスオのアウトプレイ」「This jungle nerf...」「今日のランク戦…」＝いずれも実際はLoLツイート）。live既定クエリでは元々これらは取得されないため実害は小さいが、mockでのX反応記事のバリエーションが痩せる。主要カタカナチャンピオン名の拡充を推奨。
- `.env`（未追跡）のコメントに「未設定時は既定2クエリ」という旧記述が残る（`.env.example` は3クエリで正しい）。

## 未検証項目（実機確認が必要）
- 実X API（GetXAPI）での検索クエリの実ヒット内容・誤除外率は、APIキーと課金を要するため未検証（本スプリントは実API不要と定義済み）。
- `X_SEARCH_QUERIES` env による上書き時の挙動は、既定値でのみ検証（コード上は無変更）。

## プレビュー画像（PASSかつ画面を持つプロダクトの場合のみ）
- 該当なし（UI変更を含まないロジック層スプリントのため、ブラウザ検証を実施していない）

## 関連ドキュメント
- [[reactqual-s1-selfeval]]（ジェネレーターの自己評価レポート）
- [[reactqual-s1-brief]]（本スプリントの仕様抜粋）
