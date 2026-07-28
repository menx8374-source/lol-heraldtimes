# 成長G4 — 翻訳品質の底上げ（LoLスラング対訳表＋Few-shot）＋プロンプトキャッシュ導入

成長提案書(docs/growth-research.md 観点②・G4)。「海外の反応」記事の翻訳を、日本人プレイヤーにこなれて伝わる自然な訳に底上げしつつ、
プロンプトキャッシュで入力トークン課金を抑える。**AIの呼び出し回数は増やさない**（1呼び出しの質を上げる）。対象: Web。

## 背景（現状と重要な制約）
- 現状 `translateReactionLines`（compose.ts）は reddit のみ、Haiku（`claude-haiku-4-5`）でレス全文を自然な日本語に意訳（バッチ6レス）。system `REACTION_TRANSLATE_SYSTEM_PROMPT` は良質だが、**LoL特有スラング（inting/diff/hard stuck 等）の用語統一辞書とFew-shot例が無く**訳ゆれが出る。
- LLMクライアント `src/lib/generation/llm-client.ts` の `AnthropicLLMClient.generate` は system を単一文字列で渡し、**`cache_control`（プロンプトキャッシュ）未使用**＝不変の長い system を毎バッチ全額課金。
- **既存の `src/lib/lol-data/glossary.ts` は「表示用の日本語用語辞典」**（アグロ/ガンク等の解説）であり、英日スラング対訳ではない。**翻訳用対訳表は別ファイルに新設**し、glossary.ts の既存用途（用語ページ）は一切壊さない。

### プロンプトキャッシュの正確な仕様（claude-apiスキルで確認済み・必読）
- 書式: `system: [{ type: "text", text: "<不変プロンプト>", cache_control: { type: "ephemeral" } }]`（プレフィックス一致でキャッシュ。5分TTL）。`@anthropic-ai/sdk` の `messages.create` の `system` は `string | TextBlockParam[]` を受け、`TextBlockParam` に `cache_control` を付与できる。
- **最小キャッシュ長はモデル依存で、Haiku 4.5 は 4096 トークン**。これ未満の system は**マーカーを付けても静かにキャッシュされない**（エラーにはならず `cache_creation_input_tokens: 0`＝通常課金。害はない）。
- 経済性: cache read ≈ 0.1×、cache write ≈ 1.25×（5分TTL）。同一 system を5分以内に2回以上送れば損益分岐を超える。翻訳は1記事内で連続バッチ＝5分以内に複数回送るため、**systemが4096トークンを超えていればヒットして課金減**。
- 従って本スプリントの方針: **①翻訳品質の向上（対訳表＋Few-shot）を主目的**とし、**②cache_control 実装は副次**（systemが最小長を超えたバッチでのみ効く／超えなくても害なし／将来のモデル・プロンプト拡張で効く）。**品質に寄与しない水増しで無理に4096トークンへ膨らませない**。

## 含まれる機能

### F-G4-1: プロンプトキャッシュ対応（llm-client.ts）
`AnthropicLLMClient.generate` を、system を `cache_control` 付きテキストブロックで渡すよう拡張する:
- system が非空のとき `system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]` として `messages.create` に渡す（空なら従来どおり system を付けない）。`max_tokens` 等その他は不変。mock（`MockLLMClient`）は無変更。
- 失敗時は従来どおり空文字フォールバック（本体を止めない原則を維持）。
- **観測ログ**: レスポンスの `usage.cache_read_input_tokens` / `cache_creation_input_tokens` / `input_tokens` を、デバッグ用に `console.log`（または既存のログ方針に沿った軽量出力）で1回出せるようにする（キャッシュが効いているか実測できるように。過剰なログにはしない）。
- コメントに「Haiku 4.5 のキャッシュ最小は4096トークン。未満のsystemは自動的に通常課金（害なし）」と明記する。

### F-G4-2: 翻訳用スラング対訳表（新規 translation-glossary.ts）
`src/lib/generation/translation-glossary.ts`（新規）に、LoLコミュニティの英語スラング→日本人プレイヤーが使う自然な言い回しの**対訳表（純データ）**と、それを system 用テキストに整形する純関数を追加する:
- 対訳例（実用的な範囲で数十語。**確実で誤解のないものだけ**。曖昧なものは入れない）: `inting/int→わざと負け(利敵行為)`, `diff→（レーン/ロール）差でボロ負け`, `hard stuck→万年〇〇帯から上がれない`, `gap→力量差`, `throw→勝ち試合を落とす`, `smurf→サブ垢の格上`, `griefing→味方妨害`, `ff→降参`, `gg→お疲れ/good game`, `nerf/buff→弱体化/強化`, `broken/OP→ぶっ壊れ/強すぎ`, `gutted→過剰弱体でゴミ化`, `feed→敵に塩(キル)を献上`, `clutch→大事な場面での好プレー`, `carry→試合を牽引`, `tilt→熱くなって崩れる` 等。
- 整形関数 `buildTranslationGlossaryText()`：対訳表を「英語: 日本語ニュアンス」の簡潔な箇条書きテキストにして返す（systemへ差し込む用）。決定論・純関数。
- これは**翻訳の用語統一のためのデータ**であり、表示用 glossary.ts とは無関係（importもしない）。

### F-G4-3: 翻訳 system プロンプトの強化（compose.ts）
`REACTION_TRANSLATE_SYSTEM_PROMPT` を強化する（既存の良質な指示は残し、末尾に追記）:
- `buildTranslationGlossaryText()` の対訳表を「以下のLoLスラングは日本のプレイヤーが使う自然な言い回しに寄せて訳すこと」として注入。
- **Few-shot 1〜2例**（英語コメント→自然な日本語訳のペア）を1〜2組含め、口調・`>>N` 返信の保持・草/絵文字の扱い・数値固有名詞保全の記法を安定化。例は短く、事実を作らない範囲で。
- systemは**完全に不変（フリーズ）**を保つ（日付・ランダム・レス内容などの動的値を system に混ぜない。プレフィックスキャッシュの前提）。動的なレス本文は従来どおり user メッセージ側に置く。

## 制約・非目標
- **AIの呼び出し回数は増やさない**（キャッシュと用語集で「1呼び出しの質」を上げるのみ）。翻訳対象（reddit反応レス）・バッチ構成・出力JSON形式（`{translations:[{index,text}]}`）・`normalizeTranslations` は変更しない。
- **翻訳品質が主目的**。cache_control は害のない副次実装で、Haiku 4.5 の4096トークン最小に届かない場合はキャッシュされないことを許容する（無理に膨らませない）。
- **事実・数値・固有名詞の保全**は不変（対訳表・Few-shotは意訳の指針であって、情報の追加/削除/改変を促さない）。
- 表示用 `glossary.ts`・パッチ/ニュース要約・SEO・収集・他ソースは変更しない（PATCH_SUMMARY/NEWS_SUMMARY へのキャッシュ適用は F-G4-1 の llm-client 側変更で自動的に効く＝これらも `getLLMClient().generate` 経由なので、systemが最小長を超えれば恩恵を受ける。個別の追記はしない）。新規npm依存なし・DBスキーマ変更なし。
- system をフリーズし続ける（動的値を混ぜない）。`messages.create` の `system` 配列化以外の呼び出し形は変えない。

## テスト（必須・実ネット非依存）
1. `translation-glossary.ts`: `buildTranslationGlossaryText()` が主要スラング（inting/diff/hard stuck 等）を含む決定論テキストを返す。対訳データが重複キー無し。
2. `REACTION_TRANSLATE_SYSTEM_PROMPT`（または生成後のsystem文字列）に対訳表とFew-shotが含まれ、かつ動的値（日付等）が混ざっていない（フリーズ確認）。
3. `AnthropicLLMClient.generate`: Anthropic SDK をスタブ/モックし、**system が `[{type:"text", text, cache_control:{type:"ephemeral"}}]` の形で `messages.create` に渡る**こと・user が従来どおり渡ること・空system時は system を付けないこと・API失敗時に空文字フォールバックすることを検証（実APIは呼ばない）。
4. `MockLLMClient` と既存の翻訳正規化（`normalizeTranslations`/`translateReactionLines`）の挙動が回帰しないこと。
5. 既存の compose/llm-client/生成パイプラインのテストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. 翻訳 system に LoLスラング対訳表とFew-shotが入り、`AnthropicLLMClient` が `cache_control` 付き system で呼び出す（実装・テストで確認）。
3. AIの呼び出し回数不変・出力JSON形式不変・事実/数値/固有名詞保全不変・表示用glossary.ts不変・新規依存なし・DBスキーマ変更なし。
4. Haiku 4.5 でキャッシュ最小(4096)未満のsystemはキャッシュされないが通常課金で害がないこと（コメント/レポートに明記）。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- 翻訳systemの強化（対訳表/Few-shot）とcache_control実装がテストで確認できる。mock/live切替・翻訳フォールバックが壊れない。
- （live実測は任意・APIキー課金のため必須にしない。mock経路で回帰が無いこと・cache_control付与がユニットで確認できることを合否とする。）
- 受け入れ基準1〜4を満たす。
