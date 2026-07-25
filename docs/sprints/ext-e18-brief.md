# 拡張スプリント E18: 5ch 収集の本接続（ベストエフォート・ガードレール前提）

対象プラットフォーム: web（既存アーキテクチャに従う）／フェーズ2「実データ収集の本接続」第4弾（最終）。

## 前提・リスク（ユーザー承知の上で実装）
5ch は**公式APIが無く、HTML/dat のスクレイピング**になる。逐語転載は**著作権・5chの転載規約（板ごとに厳格）に
抵触し得る最大リスク**で、HTML/dat 仕様変更で**壊れやすい**。よって本アダプタは以下の**ガードレール前提の
ベストエフォート**とする（法的責任は運営者側に帰属・本ブリーフはその前提で実装するもの）:
- **対象板は環境変数で限定**（既定を持つが運営者が差し替え可能）。**低頻度アクセス**（config のレート制限＋実行間隔）。
- **適切な User-Agent**（5chは空UA等を弾くため必須。env で設定可・既定は説明的UA）。**robots/利用規約の尊重**は運営者責務。
- **削除依頼（`CONTACT_EMAIL`）への即応が唯一の実質的な安全弁**（既存の削除依頼導線を活かす）。
- 取得失敗（403/ネット断/仕様変更で解析不能）は**握り潰して空配列＋スキップログ**（他ソース・全体を止めない＝E15〜E17と同方針）。「動かなくなる前提」で作る。

## 含まれる機能

### F-E18-1: 5ch live アダプタ（subject.txt → スレッド dat → スレッドダンプ整形）
- `FiveChAdapter implements SourceAdapter`（`sourceType:"5ch"`）を新設。**共通の `adapters/http.ts` を使う**。
  - 5ch応答は **JSONではなくプレーンテキスト**（subject.txt・dat）なので、`http.ts` に **`fetchTextSafe(url, init?, opts?): Promise<string | null>`**（`fetchJsonSafe` と同型でタイムアウト・失敗握り潰し・非秘密ログ）を追加して使う。
- 手順:
  1. 対象板の **subject.txt**（`https://<server>/<board>/subject.txt`）を取得。形式: 各行 `"<threadId>.dat<>スレタイトル (レス数)"`。
  2. スレタイトルを **LoL関連キーワード**（config の relevance keywords）で絞り込み、上位N件を対象にする。
  3. 各スレッドの **dat**（`https://<server>/<board>/dat/<threadId>.dat`）を取得。dat形式: 各行 `name<>mail<>日付ID<>本文<>(1行目のみスレタイtrue)`、レス番号＝行番号(1始まり)。本文の `<br>`（および ` <br> `）→改行、HTMLエンティティ（`&gt;`/`&lt;`/`&amp;`/`&#\d+;`等）をデコード、`<a ...>>>1</a>` 等のタグを除去して `>>1` を残す。
  4. 各スレッドを `RawCollectionItem` へ: `content` は**スレッドダンプ形式**（`"1: 本文\n\n2: >>1\n本文\n\n3: ..."`＝`src/lib/generation/thread-format.ts` の `parseThreadReses` が解釈できる形。レス番号 `N: ` 始まり・空行区切り・`>>N` アンカー保持）。`title`=スレタイトル、`sourceUrl`=**read.cgi のスレURL**（`https://<server>/test/read.cgi/<board>/<threadId>/`・**スレッドごとに一意**でdedup）、`fetchedAt`=取得時刻（`now` 注入可）。
- 件数上限（対象スレ数・1スレのレス数）を**有界**にする（config `COLLECTION_5CH_MAX_ITEMS` はアイテム＝スレ数の上限。1スレのレス取り込み数も定数で上限）。
- **対象板・UA は env で設定**: 例 `FIVECH_BOARDS`（`server/board` をカンマ区切り。既定はLoLスレが立つ板の妥当な値）・`FIVECH_USER_AGENT`（既定は説明的UA）。板未設定なら既定を使う。取得系の失敗は全て握り潰し空配列＋スキップログ。
- 5chの返すテキストは信頼できない入力として扱う（安全フィルタ・XSSエスケープ・出典必須は既存の生成/表示層が担保。アダプタは整形済みテキストを content に入れるだけ・HTML解釈経路に入れない）。

### F-E18-2: live レジストリへ 5ch を追加（フェーズ2完了）
- `LIVE_ADAPTER_FACTORIES` に `"5ch": () => new FiveChAdapter()` を追加。これで `getAllAdapters("live")` は **riot+reddit+clip+5ch の全4ソース**を含む（未実装スキップが無くなる＝フェーズ2完了）。
- mock モードは従来どおり（`fixtures/5ch.json`。変更しない）。

## 実装原則（CLAUDE.md）
- テスト必須(TDD-lite): `global.fetch` をモックし、(a) subject.txt パース→スレ一覧（id/タイトル/レス数）、(b) LoLキーワードでの絞り込み、(c) dat パース→**スレッドダンプ content**（レス番号付与・`<br>`→改行・エンティティデコード・`>>N`アンカー保持・タグ除去）、(d) 生成した content が `parseThreadReses` で正しくレス配列に戻る（下流互換の担保）、(e) `sourceUrl`=read.cgi URL で一意（dedup）、(f) 板未設定/subject.txt失敗/dat失敗→空配列＋スキップログ（throwしない）、を検証（実ネットに出ない）。整形（dat行→レス本文・エンティティデコード・スレッドダンプ組み立て）は純関数に切り出す。
- **新規依存を追加しない**（Node標準 `fetch`・自前の軽量パーサ。HTMLパーサライブラリを足さない）。**シークレットは無い**（5chはキー不要）が、UA等の設定は env。既存パイプライン契約・E15〜E17・mock全テストGreenを維持。
- `.env.example`（`FIVECH_BOARDS`・`FIVECH_USER_AGENT` をキー名＋一言）・README・architecture.md を最小限更新。**転載リスク・robots/規約尊重・削除依頼即応**の注意をコード/README に明記。
- 自己確認で起動したものは自己評価レポート作成前に停止。DBを汚したら `npm run db:seed` で戻す。

## 受け入れ基準（検証可能・原文）
- [ ] `FiveChAdapter` が subject.txt→対象スレ絞り込み→dat→**スレッドダンプ形式の content** を持つ `RawCollectionItem[]` を返す（fetchモック検証）。`content` が `parseThreadReses` で複数レスに正しく分解できる。
- [ ] `sourceUrl` が read.cgi のスレURLで一意・安定（同一スレは重複排除）。
- [ ] `http.ts` に `fetchTextSafe` を追加し、取得失敗（403/ネット断/不正）/板未設定は例外を投げず空配列＋スキップログ（他ソース・全体を止めない）。取り込み件数・レス数が有界。
- [ ] `getAllAdapters("live")` が riot+reddit+clip+5ch の**全4ソース**を含む（フェーズ2完了）。mockモードは従来どおり。
- [ ] 対象板・UA が env で設定でき、既定値で動く。5chの生テキストはHTML解釈経路に入らない（安全フィルタ/XSSは既存層が担保）。
- [ ] `npm test` 全てGreen（fetchモックのオフラインテスト）。tsc/build/eslint通過。新規依存なし。

## 評価基準（evaluator向け）
- 致命的バグ0件／コンソール・実行エラー0件（板未設定/取得失敗のスキップログは仕様上の想定内でありJSバグではない）／上記受け入れ基準の充足率100%／テストGreen。1つでも下回れば全体FAIL。
- **実ネット確認は任意で、期待もしない**（5chはアクセス制限/地域制限/仕様変更で失敗しうる。失敗＝仕様のベストエフォート）。「検証モード: フィクスチャ＋mock」を基本とし、fetchモックテストGreen＋**mockモードで5ch記事が反応形式で生成・表示される**回帰＋live無効時のグレースフルをPASS根拠にする。もし実ネットで subject.txt/dat が取れるなら `COLLECTION_MODE=live npm run collect` で5ch収集を確認してよいが、取れなくてもFAILにしない。
- riot(E15)/reddit(E16)/clip(E17) の回帰が無いこと。生成した5ch content が反応まとめ（レス羅列）として正しく記事化・表示されること（mockでも可）。
