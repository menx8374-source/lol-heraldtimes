# X-reply-S1 — X収集の関連フィルタ・バイパス＋議論シグナル強化（低コスト・独立・スキーマ変更なし）

Opus5設計のS1。X反応記事を「議論を生むポスト」中心にする第一歩。**スキーマ変更なし・新規データ増なし**で、①Xが収集段階で全落ちする問題の解消、②いいね数だけでなく**リプライ+引用**を議論シグナルに反映する。**hotnessの仕様・閾値ロジックは一切変えない**（ユーザー意向）。

## 背景（実データで判明）
- X検索クエリ（`x.ts` の `DOMESTIC_QUERY`/`OVERSEAS_QUERY`）は既に `LoL OR LJL …` ＋ `min_faves:` ＋ `lang:` ＋ `-filter:retweets` で**発見段階でLoL関連＋人気度に絞り込み済み**。
- なのに `collect-source.ts` の保存段階で `isRelevantItem`（`filter.ts`）が **title（＝ツイート先頭一文）のキーワード一致**を要求し、ハッシュタグ等で一致した投稿を落として **X saved=0（40件→0）** になっていた。
- `riot-news` は同じ理由で既に `isRelevantItem` をバイパス済み（公式ドメイン信頼）。**Xも同様にバイパスすべき**（検索クエリが関連性を保証しているため）。
- 議論を生むポスト（例: midがlv1 jgファイトに寄るべきかの論争）を拾うには、いいね数だけでなく**リプライ数・引用数**が指標。既存 `isControversial = commentCount/max(score,1) ≥ 0.15`（`hotness/evaluator.ts`）は commentCount を見るので、そこに引用も合算すれば自然に効く。

## 含まれる機能

### F-XR1-1: X を関連フィルタからバイパス（filter.ts）
- `src/lib/collection/filter.ts` の `isRelevantItem` で、`riot-news` バイパスの直後に **`if (item.sourceType === "x") return true;`** を追加。
- 理由コメント（Xは検索クエリのoperatorで既にLoL＋min_favesに絞り込み済みのため、title先頭一文の再判定は冗長かつ誤除外の原因）を付す。
- 他ソース（reddit/5ch/riot）の関連判定は**不変**。

### F-XR1-2: commentCount に引用数を合算（x.ts buildXItem）
- `src/lib/collection/adapters/x.ts` の `buildXItem` で、`commentCount` を **`(replyCount ?? 0) + (quoteCount ?? 0)`** にする（現状は replyCount のみ）。
- **`GetXApiTweet` に `quoteCount` フィールドが実在するか必ず確認**（GetXAPIのtweetオブジェクト定義／既存の型定義）。
  - 実在すれば `quoteCount` を使う。
  - 実在しない/名前が違う場合は、レスポンスに含まれる引用系フィールド（例 `retweetCount`（リツイート＝引用RT含む場合）等）を調査し、**確証のあるフィールドだけ**を合算する。無ければ replyCount のみに留め、自己評価に「quoteCount未提供のため合算せず」と明記（捏造・当て推量のフィールド参照はしない）。
- これにより `isControversial`（commentCount/score比）が**リプライ＋引用の議論量**を拾うようになる。**hotness/controversyの判定ロジック・閾値は変更しない**（合算する入力値を変えるだけ）。

### F-XR1-3: 議論特化の検索クエリを既定に追加（x.ts）
- 既定クエリに**議論特化クエリを1本追加**（いいねだけでなくリプライ多数＝賛否が割れた投稿を発見段階で拾う）。例:
  - 国内: `(LoL OR LJL OR "リーグ・オブ・レジェンド") min_replies:30 min_faves:30 lang:ja -filter:retweets`（`product=Top` 相当）
- `min_replies:` はGetXAPIの確証あるoperator。既存の `X_SEARCH_QUERIES` env で上書きできる仕組み（`parseSearchQueries`）はそのまま。env未設定時の既定クエリ集合にこの1本を足す。
- **コスト**: 既定クエリが2→3本になり収集runあたり +1コール（~$0.001）。`X_API_KEY` 未設定なら従来どおり収集自体スキップ（$0）。

## 制約・非目標
- **スキーマ変更なし・新規npm依存なし・新規テーブル/JSONフィールド追加なし**（S1はfilter/集計/クエリのみ）。
- **hotnessゲート・閾値・isControversialの判定式は不変**（合算する入力値のみ変更）。
- リプライ/引用の**取得・本文への取り込みはS1では行わない**（S2/S3で実施）。S1はあくまで「Xが落ちない・議論投稿が選ばれやすい」ようにするだけ。
- X以外のソース・既存記事・表示は不変（回帰ゼロ）。opt-in/キー無しで$0。

## テスト（必須・実HTTP非依存）
1. `isRelevantItem`: `sourceType:"x"` は title にLoLキーワードが無くても `true`（バイパス）。reddit/5ch/riot は従来どおりキーワード/サブレディット判定（回帰なし）。riot-newsも従来どおりtrue。
2. `buildXItem`: `commentCount` が `replyCount + quoteCount`（quoteCountが型に実在する場合）。実在しない場合は replyCount のみで、テストもその実装に一致させる。score=likeCount 等の既存マッピングは不変。
3. 既定検索クエリ集合に議論特化クエリ（`min_replies:` を含む）が含まれる。`X_SEARCH_QUERIES` 指定時はそちらが優先される（既存挙動不変）。
4. 既存の x.ts / filter / collect-source / 収集・生成テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. X収集が関連フィルタで全落ちしなくなる（バイパス）。commentCountが議論量（reply+quote）を反映。議論特化クエリが既定に入る。hotness仕様は不変。
3. スキーマ変更なし・新規依存なし・X以外/既存表示は不変・opt-in/キー無しで$0。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- Xバイパス・commentCount合算・議論クエリ追加が反映され、他ソース/既存挙動が不変。
- 受け入れ基準1〜3を満たす。
