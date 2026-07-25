# 拡張スプリント E19: カテゴリ整理・記事サムネイル画像・タイトル省略の廃止

対象プラットフォーム: web（既存アーキテクチャに従う）。ユーザー運用フィードバックによる調整4点。

## 含まれる変更

### F-E19-1: 「公式ニュース」カテゴリを廃止し Riot は「パッチ/メタ」へ
- `src/lib/categories.ts` の `CATEGORY_GRADIENTS`/`CATEGORY_SLUGS` から **「公式ニュース」を削除**。
- `src/lib/generation/generate-article.ts` の `CATEGORY_BY_SOURCE` で **`riot` → 「パッチ/メタ」** に変更（Riot Data Dragon＝パッチ/チャンピオンの事実なので「パッチ/メタ」が適切。これで空だった「パッチ/メタ」タブが埋まる）。
- ナビ・カテゴリ一覧・sitemap・サムネ配色は `CATEGORY_LABELS` 起点で自動追従する（ハードコード分岐を作らない）。

### F-E19-2: 「動画・クリップ」カテゴリを廃止しクリップは「eスポーツ」へ
- `CATEGORY_GRADIENTS`/`CATEGORY_SLUGS` から **「動画・クリップ」を削除**。
- `CATEGORY_BY_SOURCE` で **`clip` → 「eスポーツ」** に変更（YouTube/Twitchのプレイクリップ＝eスポーツ的ハイライト。これで空だった「eスポーツ」タブが埋まり、動画・クリップのタブは消える）。clip の収集・埋め込み紹介記事の仕組み（E17）は維持し、カテゴリだけ変える。
- 結果、カテゴリは **「パッチ/メタ・5chの反応・海外の反応・eスポーツ」の4つ**になる（トップ含めナビが整理される）。`Record<CategoryLabel,...>`/`Record<SourceType,...>` の網羅性を保ち tsc エラーを出さない。既存テスト（カテゴリ/生成の期待値）が「公式ニュース」「動画・クリップ」を参照していれば新カテゴリに更新する。

### F-E19-3: 記事サムネイル画像を入れる（Riotチャンピオン記事はチャンピオン画像／無ければ汎用LoL画像）
現状 `Article.thumbnailUrl` が未設定でカテゴリ色プレースホルダーのまま。収集元から**画像URL**を取り込み記事に反映する。
- **収集アイテムに画像URLを持たせる**: `RawCollectionItem` に任意の `imageUrl?: string | null` を追加。`CollectedItem`（Prisma）に **`imageUrl String?` を追加（要マイグレーション）**。収集パイプライン（upsert）で保存し、記事生成時に `Article.thumbnailUrl` へ渡す（`GenerationCandidate` に imageUrl を通し `generate-article.ts` が `GeneratedArticle`→Article に設定。DB作成箇所 `src/lib/generation/pipeline.ts` を更新）。
- **各アダプタで imageUrl を設定**:
  - **Riot（riot-datadragon）**: チャンピオン紹介アイテムは Data Dragon の**チャンピオンのスプラッシュ画像**（`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/<ChampId>_0.jpg`。champion.json のキー=ChampId が使える）を `imageUrl` に。パッチ検知アイテムは画像なし（null）でよい（下記フォールバックに委ねる）。
  - **Reddit**: 投稿の画像（`preview.images[0].source.url`（HTMLエンティティ`&amp;`をデコード）または `thumbnail` が `http(s)` の実画像URLのとき）を `imageUrl` に。無ければ null。
  - **Clip（YouTube/Twitch）**: 動画/クリップのサムネイル（YouTube `snippet.thumbnails.high.url`、Twitch clip `thumbnail_url`）を `imageUrl` に。
- **表示とフォールバック**: `Article.thumbnailUrl` があればそれを表示。**無い記事は、カテゴリ色プレースホルダーではなく汎用の「LoLテーマの既定サムネイル画像」を表示**する（`public/` にSVG等で用意。例 `public/default-thumb.svg`。ユーザー要望「見つからない場合は話題に近いLoL画像」の best-effort）。`src/components/article-thumbnail.tsx` を、thumbnailUrl 未設定時に既定画像を出すよう変更。
- **安全性**: 外部画像URLは `<img src>` で表示する（既存の `no-img-element` eslint-disable 踏襲）。保存/表示前に **`https://` の妥当なURLであることを検証**し、不正値は無視して既定画像にフォールバック（純関数 `isSafeImageUrl` 相当を流用/用意）。閲覧者入力ではなく信頼できる外部APIのURLだが、念のため検証する。`dangerouslySetInnerHTML` は使わない。

### F-E19-4: 記事一覧のタイトルの「…」省略を廃止（完全なタイトルにする）
現状、生成タイトルに `…`（省略記号）が入る（例「【朗報か？】リリア、リリアはFighter・M…が話題に」）。`src/lib/generation/title.ts` の本文フィラー詰め込みで `buildCoreText` が途中切りに `…` を付けているため。
- **タイトルに `…`（省略）を入れない**。`buildCoreText` の `…` 付与を廃止し、**自然な区切り（句読点・助詞など）で切る**か、きれいに収まらない場合は**中間フィラーを入れずに「【ラベル】主語＋フック」の完結したタイトル**にする（例「【朗報か？】リリアが話題に」）。主語とフックの結合が不自然にならないよう調整（フック先頭に読点があるもの/ないものの整合）。
- 完全なタイトルを優先し、`MIN_TITLE_LENGTH` に満たなくても `…` で埋めない（必要なら最低長の扱いを緩める）。ただし `MAX_TITLE_LENGTH` は保持し、超える場合も `…` ではなく自然な位置で収める。
- 表示側 `article-card.tsx` の見出しは現状 line-clamp 無しで全文表示なので基本OK。**タイトルが省略されない（`…`が出ない・CSSでも切られない）**ことを担保する（ランキング等ほかの一覧でも生成タイトル起因の`…`が消える）。

## 実装原則（CLAUDE.md）
- テスト必須(TDD-lite): (a) 生成タイトルに `…` が含まれないこと・完結した読めるタイトルになること（Riotチャンピオン/パッチ・reddit/5ch各パターン）、(b) `CATEGORY_BY_SOURCE` の riot→パッチ/メタ・clip→eスポーツ、公式ニュース/動画・クリップがカテゴリから消えていること、(c) 各アダプタが imageUrl を正しく設定（fetchモック）、(d) imageUrl が Article.thumbnailUrl に渡ること、(e) thumbnailUrl 未設定時に既定画像へフォールバック、(f) `isSafeImageUrl` の検証、を検証。**SourceType/CategoryLabel の Record 網羅性で漏れがコンパイル検知される**こと。
- **新規依存を追加しない**（画像は外部URL文字列＋既存`<img>`）。既存パイプライン・E15〜E18・mock全テストGreenを維持。マイグレーション名は `add_collecteditem_image_e19` 等。既存の `db:seed` のカテゴリ（公式ニュース/動画・クリップを使うシード記事があれば新カテゴリへ更新）。
- サーバー/スクリプトのライフサイクル遵守。DBを汚したら `npm run db:seed` で戻す。

## 受け入れ基準（検証可能・原文）
- [ ] ナビ・カテゴリが「パッチ/メタ・5chの反応・海外の反応・eスポーツ」の4つになり、「公式ニュース」「動画・クリップ」が消えている。
- [ ] riot 記事が「パッチ/メタ」、clip 記事が「eスポーツ」カテゴリで生成・表示される。既存の5ch/reddit記事は従来カテゴリのまま。
- [ ] Riotのチャンピオン記事に**チャンピオンのスプラッシュ画像**がサムネイルとして表示される（例: リリアの記事にリリアの画像）。reddit/clip も画像があれば表示。
- [ ] 画像が無い記事は**汎用のLoL既定サムネイル画像**が出る（カテゴリ色プレースホルダーのままにしない）。不正な画像URLは既定画像にフォールバック。
- [ ] 記事一覧・ランキング等のタイトルに `…`（省略）が出ず、完結した読めるタイトルになっている。
- [ ] `npm test` 全てGreen。tsc/build/eslint通過。新規依存なし。マイグレーションが適用できる。

## 評価基準（evaluator向け）
- 致命的バグ0件／コンソール・実行エラー0件／上記受け入れ基準の充足率100%／テストGreen。1つでも下回れば全体FAIL。
- Playwright/mockで、4カテゴリのナビ・riot記事のサムネイル画像（mockでも既定画像 or 画像URL表示）・タイトルに`…`が無いこと・clipがeスポーツに出ることを確認。実データ（Data Dragonのチャンピオン画像）確認は任意（ネット可なら `COLLECTION_MODE=live npm run collect`＋pipelineでリリア等の画像URLが付くか確認、不可ならmock＋fetchモックで代替）。プレビュー画像を保存。riot/reddit/clip/5ch(E15〜E18)の回帰が無いこと。
