# LoL まとめ速報サイト 自動運営システム

League of Legends（LoL）の情報を扱う日本語の「まとめ速報」型ゲーム情報サイトと、その記事の収集・生成・掲載・定期更新までを人手なしで回す自動運営システム。Reddit（r/leagueoflegends 等）や 5ch のスレッド反応をまとめた記事を主軸に、Riot 公式のパッチノート・大会結果・公式ニュース等の一次情報も記事化し、扇情的（好奇心ギャップ型）なまとめ速報タイトルで多数掲載してディスプレイ広告で収益化することを目指す。運営者の手動操作なしで日々の記事投稿を自動化し、恒久的な収入源にすることが目的。

- 製品仕様書: [docs/spec/lol-matome-sokuhou-spec.md](docs/spec/lol-matome-sokuhou-spec.md)
- 画面ワイヤーフレーム: [docs/spec/lol-matome-sokuhou-wireframes.html](docs/spec/lol-matome-sokuhou-wireframes.html)
- 進捗ダッシュボード: `docs/dashboard.html` をブラウザで開く（30秒ごとに自動更新）

## 対象プラットフォーム
`web`（閲覧者向けの公開サイト＋自動運営のバックエンド／バッチ処理）。スマートフォン・PC 双方のブラウザで崩れず読めるレスポンシブ表示。

## 起動方法

```bash
npm install                # 依存関係インストール（postinstall で prisma generate も実行）
npx prisma migrate dev     # 初回のみ: SQLite DB(prisma/dev.db) を作成・マイグレーション適用
npm run db:seed            # サンプル記事（12件）を投入
npm run dev                # 開発サーバー起動（http://localhost:3000）
```

- 本番相当で確認する場合: `npm run build && npm run start`
- テスト実行: `npm test`（Vitest）
- **収集パイプライン実行**: `npm run collect`（reddit/5ch/riot からの収集 → 重複排除 → 記事化候補キュー再構築を実行し、結果をコンソールに表示。DB は `npx prisma studio` でも閲覧できる）
  - 収集は各ソースとも fixture（`src/lib/collection/fixtures/*.json`）を読む **モック実装**（本番 API 未接続）。
  - ソースごとに実行間隔（既定: reddit/5ch 10分、riot 30分）を設けているため、直後に連続実行すると2回目以降は `skipped-rate-limited` になる（意図した挙動。上限・間隔の検証はこの動作で確認できる）。
- **AIまとめ記事生成パイプライン実行**: `npm run generate`（記事化候補キュー(status="queued")を1件ずつ処理し、Article(+ArticleSource)を作成。結果をコンソールに表示。`npm run collect` の後に実行する）
  - 生成LLMは既定で決定論的な**モック実装**（テンプレート/ルールベース、API キー不要）。`GENERATION_MODE=live`＋`ANTHROPIC_API_KEY`設定時のみAnthropic Claude(Haiku)へ本接続する（拡張E24。未設定ならmockに自動フォールバックし課金しない）。逐語一致率・引用の主従関係・最低文字数を満たさない候補は「生成失敗」(`CollectedItem.status="generation_failed"`、`generationError`にエラー内容を記録)として扱われ、他候補の生成は継続する。
  - 生成に成功した候補は `CollectedItem.articleId` と `status="articled"` が同一トランザクションで同期される（再実行しても二重記事化しない）。
  - **公開前コンテンツ安全フィルタ（F9）**: 生成した本文＋タイトルを NGワード／出典欠落／特定個人への中傷・晒し／重複の観点で判定し、通過した記事のみ `Article.status="published"` として公開される。通過しない記事は `status="held"`（保留）となり `heldReason`/`heldDetail` に理由が記録され、閲覧サイトの一覧・検索・個別ページのいずれにも表示されない（保留キューは `src/lib/moderation/queue.ts` の `listHeldArticles()` で参照できる）。未確定・噂レベルの表現を含む記事は保留にはせず `unconfirmed=true` として公開され、記事ページに「未確認情報」ラベルが表示される。
- **統合パイプライン実行（F10・F11）**: `npm run pipeline`（収集→重複排除→記事生成→タイトル生成→安全フィルタ→公開までを1回の起動で人手介入なしで実行する。`npm run collect`+`npm run generate` を1本のオーケストレーションにまとめたもの）
  - 1回の実行で公開する記事本数の上限は `PIPELINE_MAX_PUBLISH_PER_RUN`（既定5件）。上限を超えた候補は次回実行に持ち越される（破棄されない）。
  - 実行間隔（スケジュール設定）は `PIPELINE_INTERVAL_MS`（既定4時間）。実際のcron常駐は本スプリントの対象外のため、`npm run pipeline` を間隔を空けて再実行する運用を想定する（実行結果に「次回実行の目安」を表示する）。
  - 収集ソース・生成・タイトル・安全フィルタのいずれか1件が失敗しても、パイプライン全体は停止せず他候補の処理を完走する。生成・タイトル付けに失敗した候補（`status="generation_failed"`）は破棄されず、次回実行時に再度候補として処理される。
  - 各実行の収集件数・記事化候補数・生成成功/失敗数・公開数・保留数は `PipelineRunLog` テーブルに記録される（Sprint 9 の運営ダッシュボードが参照する想定）。

## 環境変数

`.env`（gitignore 済み・コミットしない）に以下を設定する。値はキー名のみ `.env.example` に記載済み。いずれも秘密情報ではなく、収集はモックのため外部認証情報は不要。

| 変数名 | 必須 | 説明 |
|---|---|---|
| `DATABASE_URL` | 必須 | SQLite ファイルの場所。既定値 `file:./dev.db`（秘密情報ではない） |
| `ANTHROPIC_API_KEY` | live接続(拡張E24)を使うなら必須 | LLM本接続用のAnthropic APIキー（https://console.anthropic.com で発行）。**秘密情報のため必ず`.env`のみに設定しコミットしない**。未設定時は`GENERATION_MODE=live`でも自動でMockLLMClientにフォールバックする（未課金） |
| `ANTHROPIC_MODEL` | 任意 | 使用モデル。既定 `claude-haiku-4-5`（コスト最小のHaiku固定） |
| `COLLECTION_MODE` | 任意 | `mock`（既定）／`live`。`live` は全3ソース(riot=拡張E15, reddit=拡張E16, 5ch=拡張E18)が本接続で収集する。「eスポーツ」単独ソース(clip、YouTube/Twitch無差別検索型)は質が低いため拡張E45で削除した（反応記事内の動画埋め込みは別機能で不変） |
| `COLLECTION_REDDIT_MAX_ITEMS` / `COLLECTION_5CH_MAX_ITEMS` / `COLLECTION_RIOT_MAX_ITEMS` | 任意 | ソースごとの1回の収集実行あたりの取得件数上限（既定: reddit/5ch=10, riot=20） |
| `COLLECTION_REDDIT_MIN_INTERVAL_MS` / `COLLECTION_5CH_MIN_INTERVAL_MS` / `COLLECTION_RIOT_MIN_INTERVAL_MS` | 任意 | ソースごとの最小実行間隔(ミリ秒)。既定: reddit/5ch=600000(10分), riot=1800000(30分) |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | reddit live収集(拡張E16)を使うなら必須 | Reddit アプリ（https://www.reddit.com/prefs/apps ）のクレデンシャル。Application-only OAuth2(client_credentials)でトークン取得に使う。**秘密情報のため必ず `.env` のみに設定しコミットしない**。未設定時はReddit収集のみ空配列＋ログでスキップ（他ソースは継続） |
| `REDDIT_USER_AGENT` | reddit live収集(拡張E16)を使うなら必須 | Reddit規約で必須の説明的User-Agent文字列（秘密ではない。例 `lol-matome/1.0 by <運用者>`） |
| `FIVECH_BOARDS` | 任意 | 5ch live収集(拡張E18)の対象板。`"server/board"` をカンマ区切りで指定（例 `egg.5ch.net/livegame`）。秘密情報ではない。未設定時は既定板を使用。取得失敗/板無効時は空配列＋ログでスキップ（他ソースは継続） |
| `FIVECH_USER_AGENT` | 任意 | 5ch側が空/既定UAを弾くことがあるための説明的User-Agent文字列（秘密ではない）。未設定時は既定の説明的UAを使用 |
| `GENERATION_MODE` | 任意 | `mock`（既定、APIキー不要の決定論的モックLLM）／`live`（拡張E24: `ANTHROPIC_API_KEY`設定時のみAnthropic Claude(Haiku)へ本接続。未設定ならmockに自動フォールバック） |
| `PATCH_ARTICLE_MODE` | 任意 | riot（パッチ）記事の構成モード（拡張E41）。`fact`（既定）: 事実速報（見出し「パッチ<番号>が公開」＋一般的事実段落＋出典URL、LLM不使用・捏造なし）／`summary`: 従来のLLM要約→決定的抽出→クリーン定型の3段フォールバック |
| `REACTION_SELECT_MODE` | 任意 | 反応記事(5ch/reddit)のレス選別モード（リファクタリングS3 F-S3-3）。`rules`（既定）: 数値ルール（アンカー会話クラスタ選定＋決定論強調、AI不使用）／`llm`: 従来どおりAI(`selectReactionReses`)で選別する旧挙動（質の比較用に残置） |
| `PIPELINE_MAX_PUBLISH_PER_RUN` | 任意 | 統合パイプライン(`npm run pipeline`)1回の実行で処理・公開する記事本数の上限（既定5件） |
| `PIPELINE_INTERVAL_MS` | 任意 | 統合パイプラインの繰り返し実行の目安間隔(ミリ秒)。既定14400000(4時間) |
| `SITE_URL` | 任意 | サイトの絶対URLベース（既定 `http://localhost:3000`）。OGP／構造化データ／サイトマップ／robotsの絶対URL生成に使う |
| `AD_SLOT_ARTICLE_TOP` / `AD_SLOT_ARTICLE_IN_BODY` / `AD_SLOT_ARTICLE_BOTTOM` / `AD_SLOT_SIDEBAR` / `AD_SLOT_LISTING` | 任意 | 各広告枠（記事上部／本文中／記事末尾／サイドバー／一覧内）に差し込む広告タグ文字列（AdSense等）。未設定時はプレースホルダー枠を表示 |
| `CONTACT_EMAIL` | 任意 | `/contact`（お問い合わせ・掲載削除依頼ページ）に表示する連絡先メールアドレス。未設定時は `SITE_URL` のホスト名から `contact@<host>` を自動生成 |
| `SITE_NOTICE` | 任意 | 運営お知らせバー（拡張E1、サイト最上部）に表示する1行の文言。未設定時はバー自体を表示しない |
| `BLOG_RANKING_HTML` | 任意 | ブログランキング/外部集客枠（拡張E4、サイドバー）に差し込む外部ランキング（にほんブログ村等）のバナー/リンクHTML。未設定時はプレースホルダーを表示 |
| `ADMIN_USER` / `ADMIN_PASSWORD` | 運営CMS（拡張E7）を使うなら必須 | `/admin` を保護するBasic認証の資格情報。**秘密情報のため必ず `.env` のみに設定しコミットしない**。両方揃わない場合、`/admin` へのアクセスは常に拒否される（管理機能ごと無効化。安全側の既定動作） |

## 外部サービス接続の方針（現時点）
当面はすべて **モック実装** で全スプリントを通し、将来の実運用時に順次本接続へ差し替える。いずれも差し替え可能な抽象越しに呼ぶ設計。
- **LLM 記事・タイトル生成（F7・F8、拡張E24で本接続対応）**: `LLMClient` 抽象越し。既定は決定論的モック実装（API キー不要）。`GENERATION_MODE=live`＋`ANTHROPIC_API_KEY`設定時のみ Anthropic Claude（既定 `claude-haiku-4-5`）へ本接続する。タイトル生成（F8）はLLM生成→NGワード除去→品質検証を行い、検証不通過・空文字・APIエラー時は必ずルールベース(`generateHookTitle`)にフォールバックする（タイトルが空や例外になることはない）。
- **ソース収集（Reddit／5ch／Riot 公式・F5）**: `SourceAdapter` 抽象越しの fixture モック（既定）。`COLLECTION_MODE=live` で riot（拡張E15）・reddit（拡張E16）・5ch（拡張E18、subject.txt/datスクレイピング・ベストエフォート）の全3ソースが本接続で収集する。5chは公式APIが無くHTML/dat仕様変更で壊れやすい前提のため、取得失敗は空配列＋ログでスキップし他ソースを止めない。逐語転載リスクがあるため削除依頼（`CONTACT_EMAIL`）への即応が運営者の安全弁。「eスポーツ」単独ソース（clip、YouTube/Twitch無差別検索型）は質が低く空カテゴリになりがちだったため拡張E45で削除した。反応記事(5ch/reddit)本文中のYouTube/Twitch URLを検出し埋め込む機能（拡張E22）は別機能として不変。
- **AdSense 広告（F12）**: アカウント開設・審査は Non-Goal。広告タグを差し込める枠と、設定でタグ文字列を受け取る仕組みまで（未設定時はプレースホルダー枠）。

## 回遊・エンゲージメントUI（拡張E1）
公開サイト（トップ／カテゴリ／タグ／検索／個別記事）に以下を追加している（`/admin` には影響しない）。
- 一覧のページネーション（1ページ20件、`?page=` クエリ）
- 記事カードの本文抜粋・コメント数表示（`Article.commentCount`。拡張E2で実際のコメント投稿数に連動）
- 投稿日時の相対表示（「3時間前」等。30日以上前は絶対日時表記）
- 個別記事のSNSシェアボタン（X／LINE／はてなブックマーク／URLコピー）
- 個別記事の絵文字リアクション（😂😮😡👍。押下で加算、`ArticleReaction` テーブルに永続化）
- ヘッダーのダークモード切替（`prefers-color-scheme` 初期値＋localStorage保存）
- 運営お知らせバー（`SITE_NOTICE`、閉じるとlocalStorageで次回以降非表示）
- トップページ上部の注目記事(PICKUP)カード列（閲覧数上位）

## デザイン切替: 現行／ニュースメディア調（拡張E14）
ダークモードと同じ要領（`<html>`へのクラス付け外し＋no-flashスクリプト＋localStorage）で、
テーマ（light/dark）とは独立した第2の軸としてデザイン（classic/news）を切り替えられる。
- ヘッダーのThemeToggle隣に「📰 ニュース」/「◇ 現行」トグル（`DesignToggle`）を常設。押すと
  `<html>` の `design-news` クラスが付け外しされ、localStorage（キー `lol-matome:design`、
  値 `classic`|`news`）に保存される。既定（初回・未保存）は classic（現行デザイン）。
- news時は字体が游ゴシック系スタックになり、記事一覧・サイドバー・記事ページがヘアライン罫線・
  クリムゾンアクセントの報道メディア風レイアウトになる。classic時の見た目は一切変わらない。
- テーマ×デザインの4通り（light×classic / dark×classic / light×news / dark×news）すべてで成立する。

## コメント欄（拡張E2）
ログイン機能は無い方針のため匿名で投稿できる（記名は任意、未入力は「名無しさん」）。
- 個別記事ページ下部にコメント一覧＋投稿フォーム。まとめ速報のレス形式（番号:名前＝緑、`>>N`アンカー＝オレンジ）に表示を揃える。
- 投稿は `POST /api/articles/[slug]/comments`（Route Handler）で受け、入力検証（本文必須・最大1000字／名前最大30字）→ 簡易スパム対策（ハニーポット隠しフィールド・直前と同一本文の10秒以内連投拒否）→ 安全フィルタ（F9のNGワード・個人中傷/晒し検出を再利用）の順に判定する。
- 安全フィルタを通過したコメントのみ `status="published"` として公開され、`Article.commentCount` に加算される。通過しないコメントは `status="held"` として記録だけ残し、公開サイトには一切表示しない（詳細な保留理由はユーザーに見せず、穏当なメッセージのみ返す）。
- サイドバーに全記事横断の「新着コメント」ウィジェットを表示する。
- コメント本文・名前は必ず React の子要素として描画し（自動エスケープ）、`dangerouslySetInnerHTML` は使用しない（XSS対策）。

## 法務コンプライアンス表示（F15）
全ページ共通のフッターに Riot 非公認ディスクレーマー・AI自動生成注記・以下の固定ページへの導線を常設している。
- `/disclaimer`（免責事項）: 非公認・AI生成・出典/外部リンクの責任範囲・法的助言でない旨
- `/privacy`（プライバシーポリシー）: アクセス解析・広告(Cookie)・個人情報の取り扱い方針
- `/contact`（お問い合わせ・掲載削除依頼）: 掲載内容の削除依頼（オプトアウト）の連絡先案内

## SEO/集客（拡張E4）
- `/feed.xml`: 公開記事のRSS 2.0フィード（直近30件、タイトル/リンク/抜粋/公開日時）。`<head>` に `<link rel="alternate" type="application/rss+xml">` を出力。
- 期間別人気ランキング: サイドバーの人気記事ランキングに累計/日間/週間/月間タブを追加（`ArticleView` テーブルの閲覧イベントを期間cutoffで集計。切替は `GET /api/ranking?period=day|week|month` をクライアント側から呼ぶ）。
- サイドバーに人気タグ（タグクラウド）・月別アーカイブウィジェットを追加。`/archive`（月一覧）・`/archive/[YYYY-MM]`（月別記事一覧）ページを新設。
- 個別記事・カテゴリ・タグ・アーカイブページにパンくずリスト（可視表示＋BreadcrumbList JSON-LD）を追加。
- サイトマップにタグページ・アーカイブページを追加（公開記事のみ）。

## 攻略・データ固定ページ（拡張E6）
記事DBとは独立した、SEO集客のための常設コンテンツ。データは `src/lib/lol-data/`（`champions.ts`/`patches.ts`/`glossary.ts`/`tier.ts`）にモジュールとして定義した**当サイト独自の創作モックデータ**（外部Wiki・攻略サイト・Tier表サイトの文章やランク付けの複製ではない。将来、公式API等の実データに差し替える際はこのモジュールを差し替えるだけでよい構造）。
- `/champions`（ロールで絞り込み可）・`/champions/[slug]`: チャンピオン一覧・個別解説（ロール・難易度・Tier・一言説明。約50体）
- `/patches`・`/patches/[version]`: パッチノート一覧・個別（オリジナル創作の変更内容、実在パッチの複製ではない）
- `/tier`: ロール別(TOP/JG/MID/ADC/SUP) S/A/B/C Tier表（当サイト独自の見解である旨を明記）
- `/glossary`: LoL用語集（五十音順、`?q=` で用語/定義文の絞り込み検索）
- ヘッダーの「攻略・データ」ナビからいずれもアクセス可能。サイトマップにも一覧・個別ページを追加済み。

## 運営CMS・認証（拡張E7）
`/admin` ダッシュボード（Sprint 9）は Next.js Proxy（`src/proxy.ts`、旧middleware）による **Basic認証**で保護されている。
- 認証情報は `.env` の `ADMIN_USER` / `ADMIN_PASSWORD`（両方必須）。未設定の場合は正しい資格情報を送っても常に拒否（`503`）され、管理機能ごと無効化される（「未設定なら誰でも見られる」より安全側）。
- 未認証・誤った資格情報でのアクセスは `401`（`WWW-Authenticate` ヘッダー付き、ブラウザの認証ダイアログが出る）。
- パスワード比較は `crypto.timingSafeEqual` 相当の定数時間比較（`src/lib/auth/basic-auth.ts`）で行い、タイミング攻撃を避ける。
- 公開サイト（記事閲覧・コメント投稿等）はこの認証の対象外で、従来どおり認証不要。
- 管理系のミューテーション（承認/却下/編集/ピン留め/予約公開/コメント承認・削除）は Server Actions（`src/app/admin/actions.ts`）で実装し、Proxyでのアクセス制御に加えて各関数（`src/lib/admin/*.ts`）の入口でも独立に認可を再チェックする（UIを隠すだけの対策にしない）。

`/admin` からできること:
- **保留記事の承認/却下**: 承認で `status="published"`（`publishedAt`更新）、却下で `status="rejected"`（非公開のまま。出典URLは保持し同一話題の再生成を防ぐ）。
- **保留コメントの承認/削除**: 承認で `status="published"`＋対象記事の `commentCount` を1加算、削除でレコードごと削除。
- **記事編集**: タイトル・本文（ブロック配列JSON）を編集。編集後は安全フィルタ（NGワード/出典欠落/個人中傷）を再チェックし、公開中記事が編集後に不合格になった場合は自動的に保留へ戻す（公開記事は必ず安全フィルタ通過済みという不変条件を維持）。
- **予約投稿（スケジュール公開）**: `status="scheduled"`＋`scheduledAt`を設定。`npm run pipeline`（`runFullPipeline`）実行のたびに `scheduledAt <= 現在時刻` の記事を自動で `published` に昇格する（無人cron運用でも時刻到来だけで公開される）。予約解除で `held` に戻せる。
- **ピン留め（注目記事固定）**: `Article.pinned` フラグ。ONの記事はトップの注目記事(PICKUP)・各一覧の先頭に優先表示される（📌バッジ表示）。

公開限定クエリ（`PUBLISHED_ONLY`）は `status="published"` のみを返すため、`held`/`scheduled`/`rejected` はいずれも一覧・検索・feed・サイトマップ等の公開サイトに一切表示されず、直URLも404のままになる（従来からの不変条件を維持）。

## 開発フロー
このプロジェクトは `planner` / `architect` / `generator` / `evaluator` の4サブエージェントを `spec-pipeline` スキルがオーケストレーションする自律開発フローで進める。詳細は [CLAUDE.md](CLAUDE.md) を参照。
