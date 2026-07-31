# resel-S3 — NG文（暴言等）を「削除」→「LLMで婉曲に言い換えて表示」（全反応経路・moderation整合）

Opus5設計のS3（最終）。反応記事（5ch/reddit/X）で、暴言・侮蔑・差別語を含む文を**丸ごと削除**していたのを、**LLMで意味を保ったまま穏当な表現に言い換えて表示**する。非NG行は従来どおり逐語。**スキーマ変更なし・新規依存なし**。ユーザー確定: NG文はLLMで婉曲に言い換え（既定soften）。

## 背景（現状）
- `removeNgSentences`（compose.ts）が `splitIntoSentences`＋`findNgWord` でNGを含む文を特定し**丸ごと削除**、`buildReactionDisplayLines`（5ch/reddit/X全経路共有）が適用。全行NG化で空になったレスは不掲載。
- **最重要制約**: `moderateArticleContent`（moderate.ts）が最終本文全体に `findNgWord` を掛け、1語でもヒットで記事ごと `held`（非公開）。→ **表示テキストにNG語が残ると記事保留になる**。言い換え結果にNG語が残ってはいけない。
- LLM: `translateReactionLines`/`askLLM` が `GenerationTask`（`llm-client.ts`）をJSONで渡し、mock rendererは決定論・AnthropicClientは実LLM。翻訳と同じくバッチ1回で送る設計。

## 含まれる機能

### F-RS3-1: NG婉曲言い換えタスク（llm-client.ts）
- `GenerationTask` に **`kind: "ng-soften"`**（＋NG文配列 `{ index, text }[]`）を追加。
- mock renderer（`renderTask`）は `ng-soften` で **空文字を返す**（＝mockでは必ずフォールバックに落ちる＝既存テスト回帰ゼロ・無課金）。
- systemプロンプト `NG_SOFTEN_SYSTEM_PROMPT`（静的・プロンプトキャッシュ整合のため動的値を混ぜない）:
  - 役割: 「暴言・侮蔑・差別語を含む**一文だけ**を、意味・論点・批判対象・強度の向きを保ったまま穏当な日本語に言い換える」。
  - 厳守: 事実/数値/固有名詞（チャンピオン・選手・チーム・スコア）を変えない・作らない、新情報を足さない、意味を反転させない、**出力にNG語を残さない**。
  - 出力: `{"softened":[{"index":N,"text":"言い換え後"}]}` のJSONのみ。

### F-RS3-2: バッチsoften＋NG再検査＋フォールバック（compose.ts）
- 新関数 `softenNgSentences(llmClient, sentences: {index,text}[]): Promise<Map<number,string>>`:
  - `ng-soften` タスクで**1記事分をまとめて1回**LLMへ（翻訳と同様のバッチ）。
  - 各言い換え結果を **`findNgWord` で再検査**し、**まだNG語が残る／空/欠落なら採用しない**（安全側）。採用分だけMapに入れる。
  - 失敗（API失敗・空・parse不能・全件不採用）は空Mapで返す（本体を止めない）。
- `buildReactionDisplayLines`（＋呼び出し側 `buildReactionBlocks`/`buildXReactionBlocks`）の改修:
  - 表示テキスト確定後、**NG文を含む行を収集**（`findNgWord`該当）。NG文が1つも無ければ**LLM呼び出しゼロ**（大半の記事は増分なし＝コスト最小）。
  - `NG_REPHRASE_MODE`（既定 `soften`）に応じて:
    - `soften`: NG文を `softenNgSentences` の結果（再検査済み）で置換。**採用できなかったNG文は従来の削除にフォールバック**（`remove`相当）。
    - `remove`: 従来どおり該当文を削除（現行動作・回帰用）。
    - `mask`: 該当語を伏字（既存の伏字機構があれば再利用）。
  - 置換後もNG語が残らないこと（再検査済みのみ採用）を保証し、`moderateArticleContent` の `ng_word` 保留を確実に回避。**全行が空/不採用のレスは従来どおり不掲載**。

### F-RS3-3: 適用範囲・env
- `buildReactionDisplayLines` 共有により **5ch/reddit/X 全経路**へ一律適用。翻訳（reddit/X英語）との順序: **翻訳後の表示テキスト**に対してNG検出→soften（訳文のNGも和らげる）。
- env: `NG_REPHRASE_MODE = soften(既定) | remove | mask`（`.env.example`）。mockでは soften→空→remove へ自動フォールバックのため既存テスト不変。

## 制約・非目標
- **逐語緩和はNG文に限る**（非NG行は逐語のまま・ユーザー承知）。事実/数値/固有名詞の改変・捏造・意味反転は禁止（プロンプト＋再検査で担保）。
- **moderation保留を招かない**（言い換え結果は `findNgWord` 再検査でNG語ゼロを保証。ダメなら削除フォールバック）。`moderate.ts`/`ng-words.ts` の**検出語彙・保留ロジックは変更しない**。
- **スキーマ変更なし・新規依存なし**。コスト最小（NG文を含む記事のみ・バッチ1回/記事）。hotness・G8・S1/S2の選定・出典・埋め込み・riot/riot-news経路は不変。
- 5ch/reddit/X以外・NGを含まない既存記事は回帰ゼロ。

## テスト（必須・実HTTP非依存・mock）
1. `softenNgSentences`: `ng-soften`タスクでバッチ送信、結果を`findNgWord`再検査し**NG残存/空は不採用**、採用分のMapを返す。失敗/空応答で空Map（本体止めない）。
2. `buildReactionDisplayLines`（soften）: NG文が言い換え結果（再検査済み・NG語なし）に置換される。**採用不可のNG文は削除にフォールバック**。非NG行は不変（逐語）。NG文が無い記事はLLMを呼ばない。全行不採用のレスは不掲載。
3. `NG_REPHRASE_MODE=remove` で従来削除、`=mask` で伏字（実装した場合）。既定soften。
4. **moderation整合**: soften後の本文に `findNgWord` 該当が残らない（`moderateArticleContent` が `ng_word` 保留しない）。
5. mock環境（既定）で `ng-soften`→空→removeフォールバックのため、既存の compose/5ch/reddit/X/moderation テストが**全て回帰しない**。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. NG文が（soften時）意味を保った穏当表現で**表示される**（削除されない）。言い換え不可時は削除フォールバック。非NG行は逐語。moderation保留を招かない。全反応経路に適用。
3. 事実/数値/固有名詞不改変・捏造なし・スキーマ変更なし・新規依存なし・コスト最小（NG含む記事のみ）・回帰ゼロ（mock/off）。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- soften時にNG文が言い換え表示される／再検査でNG語が残らない（moderation非保留）／採用不可は削除フォールバック／非NG逐語／NG無し記事はLLM未呼び出し。mock既定で回帰ゼロ。5ch/reddit/X全経路。
- 受け入れ基準1〜3を満たす。UI差分は「NG含む記事のみ」のため、テスト＋静的確認中心で可（NG含むreaction記事をseedできればPlaywright確認）。
