---
name: spec-pipeline
description: 短いプロダクトアイデア（1〜4行）から、仕様策定→技術ベースライン確定→スプリント単位の実装→自浄(simplify)→Playwright MCPによる実機検証→セキュリティ/コードレビュー→不合格時の修正、を自動で繰り返すパイプラインを実行する。「〜を作って」のような一文のアイデアから本格的なアプリをゼロから作り始めたいとき、または既存のspec.mdに沿ってスプリントを進めたいときに使う。/spec-pipeline <アイデア> または /spec-pipeline <spec.mdへのパス> [開始スプリント番号] の形で呼び出す。
---

このスキルは `planner` / `architect` / `generator` / `evaluator` の4つのサブエージェント（`.claude/agents/`配下）を、Agentツールで順番に呼び出してオーケストレーションする。あなた（呼び出し元のClaude）がループの状態管理・git操作・`/simplify`/`/security-review`/`/code-review`スキルの呼び出し・横断学習メモリの更新を担う。各サブエージェントは自分の役割以外に踏み込まない設計なので、スプリント間の進行管理・合否によるフロー分岐・コミットはこのスキルの責務。

## 決定論ガードレール（hooks）を前提にする

このフレームワークは `.claude/settings.json` で以下の hooks を有効化しており、モデルの遵守に頼らず**危険な操作を機械的に止める**。あなたはこれらが背後で効いていることを前提に動いてよい（ただし依存はしても油断はせず、下記の自前チェックも従来通り行う。多層防御）。

- **guard-secrets**（PreToolUse/Bash）: `git commit` の直前に `git diff --cached` を走査し、`.env`・鍵ファイル・APIキー様の文字列が混入していたらコミットを拒否する。→ 拒否されたら `git restore --staged <file>` で外し、値を`.env`へ移してから再コミットする。
- **no-push**（PreToolUse/Bash）: `git push` を一律拒否する。このパイプラインはローカルコミットのみで、リモート反映は人間の手動操作に委ねる（あなたが push しようとしないこと）。
- **protect-immutable**（PreToolUse/Edit·Write）: `docs/dashboard.html` の書き換えを拒否する。ダッシュボードのデータは `docs/pipeline-status.js` を更新する。
- **post-edit-check**（PostToolUse/Edit·Write）: 変更ファイルを prettier で軽量整形する（導入済みのときのみ・非ブロッキング）。あなたの操作を妨げない。

hook が exit 2 で操作を止めた場合、その理由（stderr）が差し戻される。理由に従って修正すればよい。hook はコード/設定の不備ではなく「危険操作の検知」なので、リトライ上限とは無関係。

## 最重要原則: 記録・可視化のための処理は本来の進捗を絶対に止めない

このスキルには、本体の進行（`planner`→`architect`→スプリントループ→コミット）と、それを補助する副次的な記録・可視化の処理（`docs/pipeline-status.js`・`docs/project-memory.md`・`docs/Home.md`・`reference/learnings.md`の更新、多重起動チェックなど）の2種類の作業が登場する。**後者は前者より常に優先度が低く、後者の不具合が前者を遅延・停止させることは絶対に許容しない。**

- 記録・可視化の更新でエラーが起きた場合（Editツールの文字列不一致、ファイル読み取り失敗など）、原因調査や修正に時間をかけない。**1回だけ修正を試み、それでも直らなければその回の更新は諦めて本体のスプリントループを続行する。** 記録の欠落は実害がないが、本体の進行が止まる方が実害が大きい。
- 記録・可視化の都合でユーザーに確認を求めたり処理を一時停止したりしない。ユーザー確認が必要なのは「前提: 多重起動の検知」で明示した1箇所（パイプライン開始前）と、後述の「事前確認」だけ。
- `docs/project-memory.md`・`docs/Home.md`・`reference/learnings.md`の更新は、Editの完全一致要件によるエラーを避けるため、**部分編集(Edit)より全文の書き直し(Write)を基本とする**（既存の構成・説明文は省略せずそのまま含めて書き直す）。

## 最重要原則: 一時的な基盤障害でスプリントを止めない・誤判定しない

Agent/Skill/Bash/Edit/Write等の呼び出しが、コードや設定の不備ではなく「ツール呼び出し基盤側の一時的な瞬断」（例:「temporarily unavailable」「rate limit」「timeout」）で失敗することがある。**これはスプリントの実装・検証結果とは無関係な偶発的事象であり、上の「記録・可視化」の不具合とも異なる第三のカテゴリとして扱う。**

- この種の失敗は**同じ呼び出しをそのまま数回再試行すれば大抵は解消する**。原因調査や設定変更に時間をかけない。
- **スプリントのリトライ上限（3回）を絶対に消費させない。** evaluatorのFAILやレビュー指摘とは性質が異なり、実装をやり直させるべき事象ではない。これを理由に「要人手介入」やFAIL扱いにもしない。
- `generator`・`evaluator`・`/simplify`・`/security-review`・`/code-review`の呼び出しなど**本体の進行**がこの種のエラーに遭遇した場合は、目安5回程度は無言で再試行する。それでも解消しなければユーザーに「ツール呼び出し基盤が一時的に不安定なようです。しばらく時間を置いて自動的に再試行します」と一言共有した上で、なお再試行を続ける。目安20回、あるいは数分以上続けても解消しない場合のみ、「基盤障害が長引いている可能性があるため、しばらく時間を置いてからの再開を推奨します」と伝えて一旦待機する。ユーザーから明示的な停止指示があれば直ちに従う。
- `docs/pipeline-status.js`等の記録処理がこの種のエラーに遭遇した場合も数回は再試行してよいが、それでも解消しなければ記録を諦めて本体の進行を優先する。

## 前提: gitリポジトリ

このパイプラインはスプリント境界をgitコミットで区切り、`/security-review`（git差分ベース）でレビューを行う。gitリポジトリでない場合は、開始前にユーザーに `git init` の許可を取る（user.name/user.emailが未設定ならユーザー自身に設定してもらう。Claude側からgit configは変更しない）。

## 前提: 多重起動の検知（競合防止）

同じフォルダに対して2つ以上のセッションが同時に`/spec-pipeline`を実行すると、git操作や状態ファイルへの書き込みが競合する。**開始前に必ず次を確認する**（新規・再開いずれでも）:

- `docs/pipeline-status.js`が存在すれば`phase`と`lastUpdated`を読む。`phase`が`idle`・`completed`のいずれでもなく、かつ`lastUpdated`が現在からおおむね10分以内なら、別セッションが実行中の可能性が高い。この場合、処理を開始せずユーザーに「別セッションがこのプロジェクトを実行中の可能性があります（最終更新: 〜分前、フェーズ: 〜）。本当にこのセッションでも開始しますか？」と確認し、明示的な許可を得てから続行する。
- `docs/pipeline-status.js`が存在しない、または`phase: "idle"`/`"completed"`なら即座にPASSとし通常通り開始する（毎回確認を強いない）。
- **このチェック自体が失敗した場合（ファイル破損等）は「進行を止めない側」に倒す。** 通常通り開始してよい。

## 前提: ダッシュボード（`docs/dashboard.html`）

`docs/dashboard.html` と `docs/pipeline-status.js` はテンプレート同梱の実行状況ダッシュボードで、ユーザーがブラウザで直接開いて（`file://`でよい、サーバー不要）今どのエージェントが何をしているか・スプリント進捗・生成済みドキュメントへのリンクを確認できる。30秒ごとに自動リロードされる。

- **`docs/dashboard.html` は静的ファイルであり、書き換えない**（protect-immutable hook でも保護されている）。
- **`docs/pipeline-status.js` だけを、状況が変わるたびに`Write`ツールで丸ごと上書きする。** これがダッシュボードの唯一のデータソース（スキーマはファイル冒頭のコメント参照）。`currentActivity.agent`には `planner`/`architect`/`generator`/`evaluator`/`simplify`/`security-review`/`code-review`/`orchestrator`/`idle` を使う。更新に失敗しても構わず先へ進む。
- 更新すべきタイミング: パイプライン開始時／planner・architect呼び出し前後／各スプリントでgenerator・simplify・evaluator・security-review・code-reviewを呼ぶ前後／PASS・FAIL・要人手介入・コミット確定時／全スプリント完了時。`currentActivity`と`recentEvents`は必ず最新化し、`lastUpdated`を現在時刻(ISO8601)に更新する。
- `docs/pipeline-status.js` は実行時状態であり`.gitignore`済み。スプリントコミットに混ざらない。
- ユーザーには開始直後に一度だけ「進捗は `docs/dashboard.html` をブラウザで開くとリアルタイムに確認できます」とパスを案内する（毎スプリント繰り返さない）。**オーケストレーターは`docs/dashboard.html`を自らブラウザで開かない**（Bashでのブラウザ起動やPlaywright MCPでのナビゲーションを含む）。案内はテキストでパスを伝えるだけに留める。

## 前提: ドキュメント構成とトークン節約

サブエージェント呼び出しは独立コンテキストで動くため、素朴に実装すると毎スプリント仕様書全体を読み直しトークンを消費する。これを避けるため次のファイルを維持する。**いずれも要約ではなく原文の再配置・抜粋であり、情報の欠落や品質低下は起きない**（受け入れ基準・評価基準は一言一句そのまま転記する）。

- **`docs/sprints/sprint-<N>-brief.md`**: 仕様書の対象スプリント部分（含まれる機能・受け入れ基準・評価基準・対象プラットフォームを原文のまま）を抜粋したファイル。plannerの結果を受け取った直後に全スプリント分をまとめて1回だけ生成する。
- **`docs/project-memory.md`**: プロジェクト全体の進捗・技術選定・既知の課題を集約した、常に最新化されるダイジェスト。スプリントのPASS/要人手介入確定のたびに更新する。
- **`docs/Home.md`**: Obsidianで開いたときの入口(MOC)。spec.md・architecture.md・project-memory.md・reference/learnings.md・各スプリントのレポートへのリンクを持つ。
- **`reference/learnings.md`**: **案件をまたぐ横断学習メモリ**。planner/architect/generatorが着手前に参照し、要人手介入や繰り返しFAILの根本原因を一般化して蓄積する（下記「学習メモリの更新」参照）。

**`docs/project-memory.md`・`docs/Home.md`・`reference/learnings.md`はテンプレートに初期状態で同梱済みで、新規作成ではなく更新する。** 既存の構成・見出し・説明文は省略せずそのまま含め、プレースホルダー部分だけを実データに置き換えた全文を`Write`で書き直す。

**NotebookLMには公開APIが無く、このパイプラインが`docs/project-memory.md`等を外部へ自動送信することは一切行わない。** 使いたい場合はユーザーが手動でアップロードする（README.md参照）。

## 全体フロー

```
[新規アイデアの場合]
  0. アイデアが曖昧なら、planner呼び出し前にAskUserQuestionで2〜3問だけ確認する（ブレインストーミング）
  1. planner を1回呼ぶ → docs/spec/<slug>-spec.md（画面があればwireframes.htmlも）
  1.5 architect を1回呼ぶ → docs/spec/<slug>-architecture.md（技術ベースライン確定）

[スプリントループ: spec.md の各スプリントについて]
  2. generator を呼ぶ（対象スプリント番号 + 前回のFAILフィードバックがあれば渡す）
  2.5 /simplify をそのスプリントの差分に実行（検証前の自浄。品質のみ・バグ探索はしない）
  3. evaluator を呼ぶ（対象スプリント番号） → FAILなら2に戻る（リトライ）
  4. PASSなら、そのスプリントの変更（pending changes）に対して品質ゲートを実行:
       git add → 秘密混入チェック → /security-review → /code-review → 依存監査(必要時)
     - Critical/High、または /code-review CONFIRMED の正しさのバグ → FAIL扱い、指摘を持って2に戻る
     - 指摘なし/軽微のみ → 最終PASSとしコミット、次のスプリントへ
  4.5 要人手介入が確定したスプリントがあれば、根本原因を一般化して reference/learnings.md に追記
  5. 全スプリント終了後、サマリーをユーザーに報告する
```

## 実行手順

1. **入力の判定**: まず**多重起動の検知**を行い、問題なければ続行する。引数が短い自然文（1〜4行）なら新規アイデアとして扱う。
   - **ブレインストーミング（新規アイデアの場合のみ）**: アイデアの中で、対象プラットフォーム・主要ターゲットユーザー・スコープの境界・（該当しそうなら）収益化方法のいずれかが読み取れない/解釈が大きく割れうると判断した場合、`planner`を呼ぶ前に**AskUserQuestion**で2〜3問だけ確認する。既に明記済み/曖昧さがない場合は省略し質問攻めにしない。得られた回答をアイデアに統合してから進む。
   - `docs/pipeline-status.js` を初期化（`phase: "planning"`, `currentActivity: {agent: "planner", label: "製品仕様書を作成中"}`）してから、`planner` をAgentツールで呼び出す。既に `docs/spec/*.md` へのパスが渡された場合はplannerをスキップしそのspecを使う（この場合も初期化は同様に行う）。`docs/project-memory.md` が存在する場合は、途中経過の把握のため必ず読んでから作業を開始する。
2. **plannerの結果を受け取る**: 生成されたspec.mdのパス、スプリント数、「対象プラットフォーム」を把握する。TodoWriteでスプリント一覧をタスク化し、対象プラットフォームを併記する。`docs/pipeline-status.js` も同じ内容で更新する（`projectName`・`specPath`・`platform`・`phase`は当面`"planning"`のまま・`sprints`配列を各`status: "pending"`・`attempts: 0`・`maxAttempts`は適用中のリトライ上限で初期化）。`recentEvents`に「製品仕様書を作成しました」を追記。ユーザーには最初の1回だけ「進捗は `docs/dashboard.html` で確認できます」と案内する。
   - `docs/sprints/sprint-<N>-brief.md` がまだ無いスプリントについて、仕様書を読んで全スプリント分をこの時点でまとめて生成する。内容は該当スプリントの「含まれる機能」「受け入れ基準」「評価基準」「対象プラットフォーム」を**原文のまま**転記する（要約しない）。
   - `README.md`がテンプレート由来の汎用説明のままなら、仕様書の「概要」を基にプロダクト名・概要で該当箇所を書き換える。起動方法・環境変数の欄は空のまま残し、generatorが最初のスプリントで反映できるようにする。
   - **事前確認（外部サービス依存・管理者権限インストール予想）**: 以下2種類をチェックし、いずれか該当すればスプリントループ開始前にAskUserQuestion等で**一度にまとめて**確認する（該当が1種類ならその1問、両方あれば2問。割り込みを1回に集約）。いずれも該当しなければ省略する。
     - **(A) 外部サービス依存**: 仕様書の「リスク・留意事項」に外部API連携・OAuth認証・決済等、**ユーザー自身の操作が必要な項目**があれば、「(a)今このタイミングで認証情報等を用意する、(b)揃うまでモック/スタブ実装で進め揃い次第本接続に切り替える、どちらにしますか？」と確認する。(a)なら`.env`への設定方法を案内する（値はチャットに平文で残させない）。(b)またはユーザー未対応なら、その外部サービスに関わる機能(F#)を含む**全てのスプリント番号**と「モック実装で進める」方針を`docs/project-memory.md`の「既知の課題・要人手介入」に記録し、該当スプリントのgenerator呼び出し時にその指示をプロンプトに含める。
     - **(B) 管理者権限インストールの予想**: 仕様書の「対象プラットフォーム」が`デスクトップ`である、または機能一覧に動画/音声のローカル処理・重量級ローカルDB（PostgreSQL/MySQL等の常駐サービス）・OSトレイ常駐・Bluetooth/USB等ハードウェア直接アクセスのような、通常ネイティブビルドツール/OSサービスのインストールを伴う内容が含まれる場合、「(a)該当ツールを今のうちにインストールしておく、(b)管理者権限不要な代替手段（クラウド/Docker/純npm実装等）で進める、(c)到達時点で都度判断する、のどれにしますか？」と確認する。(b)なら該当する**全てのスプリント番号**と方針を`docs/project-memory.md`に記録し、該当スプリントのgenerator呼び出し時に指示を含める。(c)/未回答なら通常通り進め、実際に必要になった時点の通常フォールバックに委ねる。**これは予想であり、外れても構わない。**
3. **architect を呼ぶ（技術ベースラインの確定。1回のみ）**: `docs/pipeline-status.js` の`currentActivity`を`{agent: "architect", label: "技術ベースラインを策定中"}`に更新してから、`architect` エージェントをAgentツールで呼び出す。プロンプトには spec.mdのパス・対象プラットフォームを含める。`reference/learnings.md` は architect 自身が読む。
   - architect から `docs/spec/<slug>-architecture.md` のパスと確定した骨格の要点を受け取ったら、`docs/pipeline-status.js` の `architecturePath` と `docs/Home.md` のリンク一覧にこのファイルを追加する。`recentEvents`に「技術ベースラインを確定しました」を追記。
   - `docs/project-memory.md`（プレースホルダー部分）を、概要・対象プラットフォーム・**技術選定（architectの決定サマリー）**・スプリント一覧で更新する。`docs/Home.md`の「## 仕様」プレースホルダーをspec.mdへのwikilinkで更新し、`wireframes.html`が存在すればそのリンクも「## 仕様」欄と`docs/pipeline-status.js`（`wireframesPath`）に追加する。「## スプリント」欄はまだ空でよい。
   - 既存specから再開する場合で architecture.md が既に存在するなら、architect の再実行は不要（既存のベースラインを使う）。存在しない場合のみここで architect を呼ぶ。
   - 以上を終えたら`docs/pipeline-status.js`の`phase`を`"sprint_loop"`に更新する。
4. **スプリントループを開始する**（開始番号の指定があればそこから、なければSprint 1から）。各スプリントについて:
   - `docs/pipeline-status.js` の該当スプリントの`attempts`を1つインクリメントし、`status: "in_progress"`、`currentActivity`を`{agent: "generator", sprintNumber: N, label: "Sprint N の実装中（試行<attempts>/<maxAttempts>）", startedAt: 現在時刻}`に更新してから、`generator` をAgentツールで呼び出す。プロンプトには次を含める: **`docs/sprints/sprint-<N>-brief.md`のパス（主な参照先）**、spec.mdのパス、`docs/spec/<slug>-architecture.md`のパス、対象スプリント番号、（再試行の場合）直前の不合格理由。**不合格理由はレポートのパスだけでなく、evaluatorレポートの「発見したバグ・問題点」節、または`/security-review`・`/code-review`のCritical/High相当の指摘そのものだけをプロンプト本文に転記する**（PASSした基準一覧・検証モード欄など修正に不要な部分は転記しない）。モック実装対象のスプリントならその旨と対象機能も伝える。
   - **自浄（simplify）**: generatorから自己評価レポートのパスを受け取ったら、`docs/pipeline-status.js` の該当スプリントに`selfEvalPath`を記録し、`currentActivity`を`{agent: "simplify", sprintNumber: N, label: "Sprint N の実装を自浄中"}`に更新する。その上で **`/simplify` スキルをSkillツールで呼び出し、今スプリントで変更されたコードに対して再利用・簡潔化・効率化のクリーンアップを適用する**（品質のみ。バグ探索はしない）。これは**evaluatorの検証より前**に行うため、simplifyが加えた変更も後段のevaluatorで必ず検証される（PASS=検証済みの不変条件を壊さない）。simplifyが一時的な基盤障害で動かない場合は数回再試行し、それでも動かなければ**この回の自浄は諦めてevaluatorに進む**（simplifyの失敗自体はスプリントをFAILにしない。品質向上の付加ステップであり本体ではない）。
   - **検証（evaluator）**: `currentActivity`を`{agent: "evaluator", sprintNumber: N, label: "Sprint N を実機検証中"}`に更新し、`evaluator` をAgentツールで呼び出す。プロンプトには: `docs/sprints/sprint-<N>-brief.md`のパス、spec.mdのパス、対象スプリント番号、generatorの自己評価レポートのパスを含める。**このスプリントがモック/スタブ実装の対象なら、その旨と対象機能も伝える**（例:「F3のGoogleログインは認証情報待ちのためモック実装です。モックとして一貫して動作すれば十分とし、本物の外部サービス連携としては判定しないでください」）。伝え忘れると、承知の上の未実装を理由に不当にFAILさせてしまう。
   - evaluatorがFAILなら、`docs/pipeline-status.js` の該当スプリントを`status: "fail_retry"`・`lastIssue`に理由を一言、`recentEvents`に追記した上でリトライ制御へ（品質ゲートを経ずに generator に戻る）。
   - evaluatorがPASSなら（この時点でテストGreenを含む機能面の基準は全て満たされている）、該当スプリントに`evaluationPath`を記録し、`sprint-<N>-preview-*.png`があれば`previewPaths`にも記録する。`currentActivity`を`{agent: "orchestrator", label: "Sprint N の品質ゲート準備中"}`に更新した上で、`git add -A` でそのスプリントの変更をステージする（まだコミットしない）。
   - `git diff --cached --stat` でステージ内容を確認し、`.env`・鍵ファイル・認証情報が紛れ込んでいれば `git restore --staged <file>` で除外する（guard-secrets hookもコミット時に二重で守るが、ここで先に除外しておく）。
   - `currentActivity`を`{agent: "security-review", label: "Sprint N のセキュリティレビュー中"}`に更新し、`/security-review` スキルをSkillツールで呼び出し、ステージされた差分（`git diff --cached`）を対象にレビューさせる。
   - 続けて`currentActivity`を`{agent: "code-review", label: "Sprint N のコードレビュー中"}`に更新し、`/code-review` スキルを（effort: `low`、追加コスト・外部依存なし）同じ差分に実行し、機能面(evaluator)にもセキュリティ観点(security-review)にも含まれない「正しさのバグ」「簡潔化・効率化の余地」を検出する。
   - 依存関係マニフェスト（`package.json`/`requirements.txt`等）が今スプリントで変更・追加されていれば、`Bash`で脆弱性スキャン（`npm audit`/`pip-audit`等）を実行し判定材料にする。
   - **判定**: Critical/High相当の指摘（`/security-review`の指摘、脆弱性スキャン、除外しきれない機密情報、`/code-review`が`CONFIRMED`とした正しさのバグのいずれか）があれば、そのスプリントをFAIL扱いにする。`docs/pipeline-status.js`を`status: "fail_retry"`・`lastIssue`更新の上、`git reset` でステージを解除（作業ツリーの変更は保持）し、該当する指摘そのもの（レビュー出力全文ではない）を次のgenerator呼び出しのプロンプトに含めてリトライ制御へ。`/code-review`の`PLAUSIBLE`判定は即FAILにはせず、次点の「軽微な改善点」としてPASS後に記録する。
   - 指摘なし/Medium・Low相当・簡潔化提案等の軽微な指摘のみなら、コミット前に`docs/project-memory.md`（該当スプリントをPASS済みとして記録・技術選定や既知の課題を更新）と`docs/Home.md`（このスプリントのレポート・プレビュー画像（あれば）へのリンクを追記）を更新する。その上で`git add -A`し直し、`git commit -m "Sprint <N>: <スプリント目標>"` でコミットし、そのスプリントを最終PASSとしてTodoWriteを更新、次のスプリントに進む。`docs/pipeline-status.js`の該当スプリントを`status: "pass"`・`commit`にコミットハッシュを記録し、`summary.passed`をインクリメント、`recentEvents`に「Sprint N PASS（コミット済み）」を追記する。
5. **リトライ制御**: 同一スプリントで不合格（evaluatorのFAILであれレビューのFAILであれ）が続く場合、合計の上限（デフォルト3回、ユーザー指定があればそれに従う）に達したらそのスプリントを「要人手介入」としてマークする。作業ツリーに残ったそのスプリントの変更は `git stash push -u -m "Sprint <N> 要人手介入: <直近の不合格理由を一言>"` で退避してから次のスプリントに進む（コミットはしない）。これを怠ると次スプリントの`git add -A`に未解決変更が混入し、スプリント境界=コミット境界の原則が崩れる。理由もなく上限を増減しない。`docs/pipeline-status.js`の該当スプリントを`status: "human_intervention"`に更新し`summary.humanIntervention`をインクリメント、`recentEvents`に理由とともに追記する。`docs/project-memory.md`の「既知の課題・要人手介入」にも同じ理由を記録する（stashはコミット前なので次スプリントの`git add -A`で自然にコミットされる）。
   - **学習メモリの更新（要人手介入時）**: 要人手介入が確定したスプリントについて、その不合格の根本原因を**次案件でも再利用できる一般化された教訓**に落とし込み、`reference/learnings.md` の該当分類（product/tech/impl/ops）に追記する（`/retro` と同じ要領。固有名詞・秘密情報は書かず、同じ教訓が既にあれば更新、記録日は今日）。これは記録・可視化処理と同じ優先度なので、更新に失敗しても本体の進行を止めない。
6. **進捗報告**: 各スプリントのPASS/FAIL確定時に、簡潔な一文でユーザーに共有する（レポート全文の垂れ流しはしない）。プレビュー画像が保存されたスプリントではそのパスも一言添える。
7. **完了時のサマリー**: 全スプリント終了後、`docs/pipeline-status.js`を`phase: "completed"`・`currentActivity: {agent: "idle", label: "全スプリント完了"}`に更新した上で、以下を報告する:
   - 総スプリント数、PASS数、要人手介入数
   - 要人手介入となったスプリントとその理由（レポートへのパスまたは要約）。`git stash`で退避した場合は`git stash list`で参照できる旨とスタッシュメッセージ（スプリント番号）を明記する
   - evaluatorレポートの「検証モード」がBash縮退だったスプリント（あれば）とその番号。実機検証されていないため後日再検証を推奨する旨を添える
   - 各スプリントの「未検証項目（実機確認が必要）」の一覧（あれば）
   - `/security-review`でMedium/Low、または`/code-review`で軽微な指摘があったが非ブロッカーとしてPASSさせたスプリント（あれば）とその概要
   - `reference/learnings.md` に新しい教訓を追記した場合はその要点
   - 次にユーザーが確認・対応すべきこと

## ネイティブアプリのストア公開フェーズ（該当する場合のみ）

spec.mdの対象プラットフォームが`モバイル(Expo)`で、かつユーザーがApp Storeへの公開を希望する場合、全スプリントの最終PASS後に本フェーズを行う。generator/evaluatorのスコープ外であり、オーケストレーターが直接進める。

1. **ユーザーに依頼する一度きりの事前準備（代行不可）**:
   - Apple Developer Programへの登録（年間$99、Apple ID・支払い・本人確認はユーザー自身）。
   - App Store Connect API Key（.p8ファイル、Key ID、Issuer ID）の発行。ユーザー自身がポータルで生成しファイルパスを教えてもらう。鍵の中身はチャットに貼らせず`.env`等gitignore対象のローカルファイルとして扱う。
2. **上記が揃い次第、オーケストレーターが実行する**: EAS CLI導入、`eas.json`等のビルド設定作成、`eas build --platform ios`でのクラウドビルド（Mac不要）。App Store Connect API経由でのBundle ID登録・アプリレコード作成・掲載文面・年齢レーティング・プライバシー申告の登録。Web版レンダリングを基にしたスクリーンショット生成。ビルドのアップロード。
3. **審査提出（`eas submit`等）の直前に、登録内容・スクリーンショットのサマリーをユーザーに見せて一度確認を取る。** 提出は審査枠を消費し取り消しにくいため無断で実行しない。
4. Appleからの審査結果（却下・要修正等）はそのままユーザーに報告し、コンテンツ/ポリシー判断が必要な却下理由はユーザーの判断を仰いでから対応する。

## 注意事項

- 各エージェント呼び出しは独立コンテキストで動くため、Agentツールのプロンプトには必要な情報（spec.mdのパス、architecture.mdのパス、スプリント番号、直前のフィードバック）を毎回明示的に含める。前の呼び出しの記憶には頼れない。
- 呼び出し順は planner → architect →（スプリントごとに）generator → simplify → evaluator。**並列実行しない。** 異なるスプリントを並列で進めることもしない。
- **git操作（add/commit）はオーケストレーターのみが行う。** generator/evaluatorにBashツールがあってもコミットさせない。`git push`はno-push hookが拒否する（このパイプラインは自動pushしない）。
- ユーザーから明示的な停止指示があれば、現在進行中のスプリントの区切りで停止する。
- `docs/pipeline-status.js`・`docs/project-memory.md`・`docs/Home.md`・`reference/learnings.md`・`docs/sprints/*`は`docs/pipeline-status.js`と`.playwright-mcp/`を除き、正式なプロジェクト成果物としてコミット対象に含める。
- **環境不足への対応はgenerator/evaluator自身が行う**（無料・プロジェクトローカルな範囲での自動インストール）。オーケストレーターは「ツールが無いので手動で」という報告を転送する前に、レポートに実際に自動インストールを試みた記載があるか確認する。
