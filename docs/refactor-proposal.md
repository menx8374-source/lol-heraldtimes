# LoL海外情報まとめサイト リファクタリング・機能拡張 提案書（承認用）

> 本書は「実装前の現状分析＋設計提案」です。**承認後に、小さなスプリント単位で実装**します（既存機能を壊さないことを最優先）。

---

## PART A — 現状分析

### A-1. 技術スタック（現状）
- **Next.js 16（App Router）+ React 19 + TypeScript**、**SQLite + Prisma 6**、**Tailwind v4**、テストは **Vitest**。
- LLM は **@anthropic-ai/sdk（Claude Haiku 4.5）**。依存は非常に軽量（`next / react / @prisma/client / @anthropic-ai/sdk / dotenv` のみ）。
- 収集は `SourceAdapter` インターフェース＋アダプタ登録（**既にStrategy/プラグイン構造の土台あり**）。
- 実行は `scripts/collect.ts` `generate.ts` `pipeline.ts`（cron常駐は未実装）。

### A-2. ディレクトリ構成（現状）
```
src/lib/
  collection/        収集: adapters/(fivech, reddit, riot-datadragon, mock, http, index), config, queue, pipeline, dedupe, filter, normalize, types
  generation/        生成: compose, generate-article, title, llm-client, champion-thumbnail/splash, thread-format, text-utils, quote-ratio, scheduled-publish
  moderation/        安全: ng-words, moderate, duplicate
  pipeline/          統合: run-pipeline, config
  lol-data/          champions/tier/patches/glossary（静的LoLデータ）
  admin/ ads/ auth/  CMS・広告・認証
src/app/             画面・API route・sitemap/robots/feed
scripts/             collect / generate / pipeline / regenerate-titles
prisma/schema.prisma DB定義
```

### A-3. 現在の処理フロー
```
collect: 各SourceAdapter.fetchItems() → 正規化 → CollectedItem(UPSERT, normalizedUrl一意)
queue:   CollectedItem を重複排除して status=queued
generate: queued を1件ずつ → composeArticleBody(本文) + generateHookTitleLLM(タイトル)
         → moderateArticleContent(NG/出典/中傷/重複) → Article(published/held)
publish: E48でカテゴリ別に1回2本ずつ
```

### A-4. DB構成（現状）
`Article / ArticleSource / Tag / ArticleTag / CollectedItem / ArticleReaction / ArticleComment / ArticleView / SourceFetchLog / PipelineRunLog`
- **CollectedItem は「スナップショット1行」**で、Score・コメント数の**時系列履歴を持たない**。
- ソースは**コード（アダプタ）とconfig**で定義。DBの `sources` テーブルは無い。

### A-5. 問題点・技術的負債・保守性の課題
1. **話題性判定に時系列が無い**：Score/コメントの「伸び率」で判定できない（現状は5ch=勢い/アンカー数、reddit=取得時スコアの一発判定）。要望の「10/20/30分…の履歴→増加率」が作れない。
2. **AIの使いどころが要望とズレている**：現状 `selectReactionReses`（話題関連レスの選別）が **AIによる選別＝要望で禁止された用途**。要望は「話題性判定・分類・スコアリングはAI禁止、AIは生成・翻訳・SEOのみ」。→ **選別を数値ルールへ移す必要**。
3. **CollectedItem が多目的**：生投稿・記事化キュー・失敗記録が1テーブルに同居し責務が混在（要望の `posts / post_metrics_history / articles / article_update_history` 分離に未対応）。
4. **記事更新（伸びたら再生成）の仕組みが無い**：公開後の監視・条件付き再AIが未実装。
5. **SEO生成が部分的**：meta descriptionは有るが、AIによる **SEOタイトル/slug/OGP/タグ** は未生成。
6. **収集項目が薄い**：reddit で author/flair/media/コメント数の履歴などを保存していない（E46は本文＋上位コメントのダンプのみ）。
7. **設定の一元化が中途半端**：閾値/間隔/Subredditが config.ts と各アダプタ定数に散在。要望の「設定ファイルで変更」に寄せたい。
8. **cron常駐・メトリクス更新ジョブが無い**：収集/更新/再生成のスケジューラ未実装。
9. **良い点（活かす）**：`SourceAdapter` 抽象・moderation・逐語維持・グレースフル失敗・テスト文化・軽量依存は**そのまま資産**。

---

## PART B — 設計提案

### B-1. 基本方針
- **既存を土台に拡張（作り直さない）**。`SourceAdapter` を核に「情報ソース抽象」を強化。
- **AIは「生成・翻訳・SEO」だけ**。話題性判定・分類・選別・スコアリングは**すべて数値ルール（閾値は設定ファイル）**。
- **時系列メトリクス**を導入し、伸び率で「記事化」「更新」を判定。
- **責務ごとにDB分離**（posts / metrics history / articles / update history）。
- SOLID/DRY/KISS・テスト容易性・段階的移行。

### B-2. DB改善案（責務分離）
| 新テーブル | 役割 |
|---|---|
| `Source`（任意・設定でも可） | ソース定義（type, 名前, 対象subreddit/board 等）。まずは**設定ファイル**でも可、DB化は任意 |
| **`Post`** | 収集した生投稿（sourceType, externalId, title, body, url, author, flair, media(JSON), postedAt, firstSeenAt）。1投稿1行・重複はexternalIdで一意 |
| **`PostMetricsHistory`** | postId, score, commentCount, capturedAt（**時系列**）。伸び率算出の元 |
| **`Article`**（既存拡張） | 生成記事。`postId` で Post と紐付け。SEO列（seoTitle/metaDescription/ogTitle/ogDescription/slug）を追加 |
| **`ArticleUpdateHistory`** | articleId, reason(score_surge/comment_surge/hot_rank), updatedAt。再生成の記録・重複再実行防止 |
| 既存維持 | ArticleSource/Tag/ArticleTag/Reaction/Comment/View/各種Log |
- **移行方針**：`CollectedItem` → `Post`（生投稿）＋キュー状態に分割。既存データは移行スクリプトで写す（または新テーブル並行運用→切替）。**破壊せず並行**を優先。

### B-3. クラス/モジュール設計（Strategy＋責務分離）
```
SourceAdapter (既存IF・強化)   ← 収集の抽象（Reddit/5ch/Riot/X/YouTube を差し替え可能）
  ├ fetchPosts(): RawPost[]        生投稿（履歴メトリクス付き）
  └ fetchMetrics(post): Metrics    既存投稿の数値更新（履歴ポーリング用）
CollectorService                収集→Post保存→MetricsHistory追記
MetricsUpdaterService           監視中Postの数値を定期更新（10/20/30分…）
HotnessEvaluator (純ルール)     Score/コメント/増加率/経過時間/Hot・Rising入り → 記事化/更新の可否（AI不使用・閾値は設定）
ArticleGenerator                閾値通過Postのみ: AIで 本文/タイトル/リード/要約/SEO/タグ（1投稿1回・重複防止）
ArticleUpdater                  伸びたら条件付き再生成（ArticleUpdateHistoryで多重防止）
Config(設定ファイル)            間隔/閾値/対象subreddit 等を一元管理
```
- **AI境界を1箇所（ArticleGenerator/翻訳/SEO）に集約** → コスト管理・重複実行防止・テストが容易。

### B-4. 新しい処理フロー（AI最小・数値ルール中心）
```
[収集]    SourceAdapter.fetchPosts() → Post保存 + PostMetricsHistory初回追記
[監視]    MetricsUpdater: 監視中Postを 10/20/30分/1h/2h で再取得 → MetricsHistory追記
[判定]    HotnessEvaluator(ルール): score/コメント/増加率/経過/Hot・Rising → 「記事化する」判定（AIなし）
[生成]    通過Postのみ ArticleGenerator: AIで本文/タイトル/リード/要約/SEO/タグ（1投稿1回・articleId紐付けで重複防止）
[公開]    moderation通過 → published（カテゴリ別上限=E48）
[更新]    公開後も監視継続。score急伸/コメント急増/Hot上位 のときだけ ArticleUpdater が再AI（ArticleUpdateHistoryで抑制）
```

### B-5. API/AIコスト削減案
- **AI呼び出しは「記事化確定Postのみ・1回」**。話題性判定を数値化することで、AIに渡る母数を激減。
- 翻訳・SEOは記事生成と**同一プロンプト/最小回数**に束ねる（E49の分割は品質のため維持しつつ、SEO/タグは1回に同梱）。
- 収集は**条件付きGET/ETag・前回取得以降の差分・レート制限＋間隔**でAPI最小化（Arctic Shift/5chはディレイ・直列済み）。
- メトリクス更新は**監視上限時間**（設定）を超えたPostは監視終了（無限ポーリング防止）。
- DB：履歴テーブルにインデックス（postId, capturedAt）、集計は時間窓cutoffで絞る（ArticleView同様）。

### B-6. 拡張性（将来ソース）
- `SourceAdapter` を実装するだけで **Riot公式/Dev Blog/Patch/PBE/X/YouTube/他ゲーム** を追加可能。
- カテゴリ/タグは**取得元・ルールで付与**（AI分類禁止）。タグのみAIで補完（任意）。
- Riot系は「新チャンピオン/スキン/数値変更/イベント/新アイテム」を**種別フィールド**で構造化。
- eSports は「試合情報＋海外コミュニティ反応の紐付け」を Post 関連（relatedPostIds 等）で表現。

### B-7. 段階的実装計画（スプリント案・小さく安全に）
1. **S1 DB基盤**：`Post`/`PostMetricsHistory`/`ArticleUpdateHistory`＋SEO列を追加（既存と**並行**・破壊なし）。移行スクリプト。
2. **S2 収集の履歴化**：既存アダプタを `fetchPosts`＋メトリクス保存に対応（Reddit/5chから）。既存経路は残す（比較用）。
3. **S3 HotnessEvaluator（数値ルール）**：閾値設定ファイル＋純関数＋テスト。AI選別（selectReactionReses）を段階的にルールへ置換。
4. **S4 MetricsUpdater＋スケジューラ**：10/20/30分…のポーリング、監視上限。
5. **S5 ArticleGenerator再編**：AI境界を集約（本文/タイトル/翻訳/SEO/タグ）・1投稿1回・重複防止。
6. **S6 記事更新（条件付き再AI）**：ArticleUpdateHistory。
7. **S7 Riot公式/eSports の構造追加**（アダプタ追加しやすさの実証）。
8. **S8 X（Twitter）対応**：後述の実現可能性を踏まえ、サードパーティAPI経由で追加。
- 各スプリントで **既存機能の回帰なし** をテストで保証。旧収集経路は**残置して品質比較**できるようにする。

---

## PART C — 収集方式の実現可能性（最新調査）＋ ①〜④回答

### C-0. 大前提（重要な助言）
本プロジェクトには**既にNext.js＋Prisma＋Anthropicの完成度の高い収集・生成・審査基盤**があります。ここに **Make（ノーコード）や WordPress を新規導入すると、AI生成・翻訳・審査・DBが二重管理**になり、要望の「重複統合・保守性・拡張性」に逆行します。
→ **推奨：Makeで作り直さず、既存Next.jsアプリを上記設計へ拡張**。Discord通知やWordPress下書きは「出力先の一つ」としてなら容易に足せます（下記④）。Make/RSSの具体策も、比較検討用に回答します。

### C-1. Reddit（実現可能・検証済み）
- **Arctic Shift（無料・無認証・最新データ）採用済み**（拡張E46）。`r/leagueoflegends` を「2〜4日前の投稿＋クライアント側スコア順」で人気スレ＋上位コメント取得（検証済み）。**r/TeamfightTactics も subreddit 追加で対応可**。
- 「過去24時間Top」を厳密に出すなら、Arctic Shiftはスコアがバックフィル遅延のため**2〜4日窓が安定**。速報性を上げたい場合は公式OAuth（要アプリ登録）併用が選択肢。
- `new/hot/rising`：Arctic Shiftは時系列取得は可だが hot/rising ランキング自体は持たない。**hot/rising の“順位”が必要なら公式OAuth（読み取り専用・無料枠）** が必要（要ユーザーのアプリ登録）。

### C-2. 5ch（実現可能・実装済み）
- `egg.5ch.net` の `subject.txt`/`dat`（Shift_JIS）を取得済み（拡張E39）。タイトルにLoL/リーグ・オブ・レジェンド等の関連語一致＋**勢い（レス数）**でスレ選別済み。**「勢い一定以上」は既に数値ルール**。
- 具体URL（②）: `https://<server>/<board>/subject.txt`（スレ一覧＋レス数）、`https://<server>/<board>/dat/<threadId>.dat`（本文）。dat直の403耐性向上（read.cgiフォールバック）は将来課題。

### C-3. X（Twitter）（現実的にはサードパーティAPI）
最新調査（2026）:
- **公式API**：無料枠なしのクレジット制。Basic $100/月〜（1万件・検索7日）、Pro $5,000/月〜。**高い**。
- **無料スクレイピング（snscrape/Nitter）**：現在**不安定・実質困難**。
- **現実解＝サードパーティAPI（OAuth不要・APIキーのみ・従量）**:
  - **TwitterAPI.io**：約$0.15/1,000ツイート・約75エンドポイント・MCP対応・OAuth不要。
  - **GetXAPI**：$0.001/コール（約20ツイート）・Bearerのみ・Python相性良。
  - **Sorsa API**：検索オペレータ（`min_faves:` 等）をそのまま通せる `/search-tweets`・レート上限高。
- **推奨**：`min_faves:（いいね閾値） (LoL OR "League of Legends") lang:ja` 等の検索オペレータを**サードパーティAPIの search エンドポイント**へ渡す。数値フィルタ（いいね数）はAPI側/ルール側で。まずは**小さな無料/低額枠でPoC**→品質を見て採否。
- 法務：各サービス/Xの規約・引用/転載範囲は要確認（既存の出典明記・引用主従の方針を踏襲）。

### ① システム構成案
- **推奨（本命）**：**既存Next.js/TSに `XAdapter`(SourceAdapter実装) を追加**。サードパーティXのsearch APIを叩き、Post/MetricsHistoryに保存→既存の数値ルール→AI生成に合流。**新スタック不要・DB/AI/審査を共通化**。
- （比較用）**Make**：Modules（HTTP/RSS→Filter→Router→Webhook/WordPress）で組めるが、AI生成・翻訳・審査・履歴DBをMake内で再実装するのは非効率。**PoC・通知だけなら可**。
- （比較用）**Python**：`requests`＋各サードパーティAPI＋APScheduler。既存TS資産と二重管理になる。**単発検証には手軽**。

### ② 「最新かつホット」を引く具体策（RSS/スクリプト）
- **Reddit（RSS/無認証）**：`https://www.reddit.com/r/leagueoflegends/top/.rss?t=day`（当日Top）。※レート制限あり・VPS弾かれやすい→**本番は Arctic Shift 推奨**。
- **Reddit（Arctic Shift・採用中）**：`/api/posts/search?subreddit=leagueoflegends&after=<ISO>&before=<ISO>&limit=100&sort=desc` → スコア降順で上位選抜。
- **5ch**：`https://egg.5ch.net/<board>/subject.txt` を取得→`(レス数)`をパース→**勢い＝レス数/経過時間**で閾値判定→`.../dat/<id>.dat` で本文。
- **X**：サードパーティのsearchに `min_faves:100 (LoL OR リーグオブレジェンド) -filter:retweets` のようなクエリ。

### ③ X の現実的アプローチ
1. **サードパーティAPI（推奨）**：TwitterAPI.io / Sorsa / GetXAPI のsearchに検索オペレータ＋いいね閾値。OAuth不要・低額従量・VPSで安定。
2. **半自動**：Xの高度検索（`min_faves:` `lang:ja` `since:`）で人手確認したものだけ取り込む口も用意（品質担保）。
3. **回避すべき**：公式API高額枠・不安定なスクレイパー常用。

### ④ 出力先連携（Discord Webhook / WordPress REST）
- 既存アーキに**「Publisher（出力先）」抽象**を足せば容易:
  - **Discord**：`POST <Webhook URL>` に JSON（title/url/embed）。**新着/ホット検知の通知**に最適（実装容易・無料）。
  - **WordPress**：`POST /wp-json/wp/v2/posts`（`status:"draft"`・Application Password でBasic認証）で**下書き保存**。
- ただし本サイト自体がNext.jsの公開基盤を持つため、**WordPressは「二次配信先」**の位置づけを推奨（主DBは現行のまま）。Discord通知は運用監視として即メリット。

---

## PART D — 承認をお願いしたい論点
1. **方針**：Make/WordPressで作り直さず、**既存Next.js/Prismaを上記設計へ拡張**でよいか（推奨）。
2. **AI境界**：AIを「生成・翻訳・SEO」に限定し、**現状のAIレス選別（selectReactionReses）を数値ルールへ置換**してよいか。
3. **DB分離**：`Post`/`PostMetricsHistory`/`ArticleUpdateHistory`＋SEO列の追加（既存と並行・破壊なし）でよいか。
4. **メトリクス監視**：10/20/30分/1h/2h ポーリング＋監視上限を導入してよいか（cron/スケジューラ前提）。
5. **X**：サードパーティAPI（例：Sorsa/TwitterAPI.io）でのPoCを、S8で行う方針でよいか（費用は従量・小額）。
6. **比較用**：旧収集経路は**残置**して品質比較できるようにする方針でよいか。
7. **実装順**：PART B-7 のスプリント順（S1 DB基盤から）でよいか。

承認・修正のご指示をいただければ、S1から**小さく安全に**着手します。
