---
tags: [growth, research, strategy]
status: proposal
updated: 2026-07-28
---

# LoLまとめ速報サイト 成長戦略・改善提案書（Web調査ベース）

> ゴール: **「日本で最も閲覧されるLoLまとめ速報サイト」**になり全体PVを最大化する。
> 制約: **現状の運用コストと同程度**（AIはHaiku中心・月数ドル規模）。AI呼び出しを大幅に増やす案は不可。話題性判定・分類・スコアリングはAI禁止＝**数値ルール**。既存Next.js/Prisma基盤を**作り直さず拡張**する。
>
> 本書は 2026-07 時点のWeb調査（各所に出典URL）＋既存コードの実測に基づく。各観点を「現状→課題→具体案→実装方法（既存コードのどこを変えるか）→期待効果→コスト影響→優先度」で記述する。

---

## 0. エグゼクティブサマリ（コスト同等で効く順）

PV最大化の効き目とコスト影響・実装容易性で並べた最優先施策。**いずれもAI呼び出しを増やさない（増やしても既存の1記事1回の範囲内、または削減）。**

| # | 施策 | 観点 | AIコスト影響 | 優先度 |
|---|---|---|---|---|
| 1 | **論争度シグナルを HotnessEvaluator に追加**（コメント/スコア比・コメント急増＝賛否が割れるスレを数値で拾う） | ③話題性 | ±0（純ルール） | 高 |
| 2 | **回遊ウィジェット強化**（記事末「同カテゴリ最新＋同タグ人気」、サイドバー「直近7/30日PV上位」、チャンピオン/パッチのハブページ） | ④⑥ | ±0（純ルール） | 高 |
| 3 | **パッチ記事をlol-times/FISTBUMP型に**（目次＋バフ/ナーフ/調整の自動3分類＋`旧値 ⇒ 新値`＋チャンピオン画像）。既に近いが分類・目次・鮮度接頭辞を強化 | ①⑤⑥ | ±0〜微減（要約AIを一部ルールに寄せる） | 高 |
| 4 | **翻訳品質の底上げ（プロンプト強化＋用語集＋プロンプトキャッシュ）** | ②翻訳 | **減**（キャッシュで入力トークン削減） | 高 |
| 5 | **タイトル/SEOテンプレの型化**（`パッチノート[Ver]：…` 固定型・`【更新日】`接頭辞・鉤括弧引用）＋構造化データ | ①⑥ | ±0（ルール）／SEOは既存1回 | 高 |
| 6 | **投稿スケジュールの最適化**（7/12/15/18/21時＋15分オフセット、アンテナ/RSS/SNS導線） | ⑥集客 | ±0 | 中 |
| 7 | **X（Twitter）収集アダプタ追加**（GetXAPI/TwitterAPI.io、min_faves で話題性を数値フィルタ、表示は公式oEmbed埋め込み） | ⑦X収集 | 低額従量（月$1.5〜5）＋翻訳AIは既存経路に合流 | 中 |
| 8 | **Reddit速報性の改善**（Arctic Shift 2〜4日窓の短縮検討／「論争」コメント取得） | ①②③ | ±0〜微増 | 中 |

---

## 1. 前提・制約の再確認（この提案が守るライン）

- **AIの用途は「記事生成・翻訳・SEO」だけ**。話題性・分類・選別・スコアリングは数値ルール（`src/lib/hotness/*`）。本書の新施策もこの境界を守る。
- **コスト同等**: AIに渡る母数を数値ルールで絞り続ける。翻訳・SEOは1記事あたりの呼び出し回数を増やさず、**プロンプトキャッシュ・用語集・構成改善で「1呼び出しの質」を上げる**。
- **作り直さない**: `SourceAdapter`／`Post`／`PostMetricsHistory`／`Article`／`HotnessEvaluator` の既存構造の上に足す。
- 逐語転載・AdSense複製コンテンツ・引用主従関係のリスクは既存方針（出典明記・オプトアウト・非公認表記）を踏襲（`docs/project-memory.md`）。

---

## 2. 現状システムの棚卸し（コード実測サマリ）

提案の土台として、実コードで確認した現状を要点だけ。

- **話題性判定** `src/lib/hotness/evaluator.ts`：純関数。`現在値（score/comments が閾値超）` **OR** `増加率（score/comment の毎時増加）` を、経過時間窓 `[minAgeMinutes=30, maxAgeHours=72]` 内で判定。**「賛否が割れる＝論争」を測るシグナルが無い**（コメント/スコア比・controversy指標なし）。閾値は `src/lib/hotness/config.ts`（env上書き）。reddit=score主体・5ch=comment主体。
- **Reddit収集** `src/lib/collection/adapters/reddit.ts`：Arctic Shift（無料・無認証）。スコアのバックフィル遅延のため **2〜4日前の窓**で取得しクライアント側 score 降順で上位5件＋上位コメント20件。**hot/rising順位・controversial順は未使用**。速報性に制約。
- **翻訳** `src/lib/generation/compose.ts` `translateReactionLines`：reddit のみ、Haiku で「レス全体を自然な日本語に意訳」。バッチ（既定6レス／3000字）。system プロンプト `REACTION_TRANSLATE_SYSTEM_PROMPT` は良質だが**毎バッチ丸ごと再送**（キャッシュ未使用）。
- **AIクライアント** `src/lib/generation/llm-client.ts`：`AnthropicLLMClient`、`claude-haiku-4-5`、`max_tokens:1024`。**`cache_control`（プロンプトキャッシュ）を使っていない**＝長い system を毎回フル課金。失敗時は空文字でフォールバック（本体を止めない）。
- **SEO生成** `src/lib/generation/seo.ts`：1記事1回、seoTitle/meta/OGP/タグをまとめて生成。良い設計。
- **関連記事** `src/lib/related-articles.ts`：純ルール（`一致タグ数×10 + 同カテゴリ`）で選定。**チャンピオン別ハブ・パッチ別アーカイブ等の「クラスタ」導線は未整備**。
- **タイトル** `src/lib/generation/title.ts`：ルール＋LLMの2系統。ラベルに `議論`／フックに `賛否両論`「を巡り議論に」等の**論争型が既にある**（＝論争度シグナルと接続すれば活きる）。
- **パッチ記事** `compose.ts`：既に「チャンピオン別 `⇒` 変更点」を逐語抽出＋章立て（E54）。lol-times型に近い。
- **収集ソース種別** `src/lib/collection/types.ts`：`SOURCE_TYPES = ["reddit","5ch","riot","riot-news"]`（単一SoT）。**X追加はここに `"x"` を足し、`Record<SourceType,…>` の網羅漏れをコンパイラが指摘**する構造。

---

## 3. 観点別 改善提案

### 観点① 記事の質（読ませる構成・情報価値・速報性と正確性）

**現状**：反応記事はレス羅列＋強調色。パッチ記事は逐語 `⇒` 抽出＋章立て。Riot公式は事実速報。

**課題**：
- ベンチマーク（lol-times / FISTBUMP）は**冒頭に1文サマリ＋目次＋バフ/ナーフ/調整の明確な3分類＋チャンピオン画像**を持ち「読ませる」設計（[lol-times パッチ記事](https://lol-times.com/archives/8250)、[FISTBUMP パッチ記事](https://fistbump-news.jp/article/2026/05/28/2490.html)）。当サイトは章立てはあるが**目次・3分類の明示・冒頭サマリ**が弱い。
- 反応記事は「導入（元スレ状況）→連番コメント→締め」の型が海外反応系の標準（[reddit-matome 実例](https://reddit-matome.com/archives/5476)）。現状は導入・締めが薄い。

**具体案**：
1. パッチ記事に **目次ブロック**（章見出しから自動生成）と **冒頭1文サマリ**（バフ n体・ナーフ m体・アイテム変更あり…を数値から生成、AI不要）。
2. チャンピオン変更ブロックを **バフ/ナーフ/調整に自動3分類**：`⇒` の前後の数値の増減で機械判定（増=バフ、減=ナーフ、両方/不明=調整）。lol-times/FISTBUMPと同型。
3. 各チャンピオン節の頭に **チャンピオン画像**（`champion-splash.ts` の `buildChampionSplashUrl` を既に保有）。
4. 反応記事の **導入文・締め文をテンプレ強化**（元スレの話題を1行で提示。既存 `renderIntro/renderClosing` の文面を型化、AI追加呼び出しなし）。

**実装方法**：
- `src/lib/generation/compose.ts`：`extractPatchSectionsDeterministic` の結果（`champions`/`other`）に対し、`⇒` 前後を数値パースして `buff|nerf|adjust` を付与する純関数を追加 → 見出し「主な強化」「主な弱体化」「その他調整」に振り分け。目次は章 `heading` を集めて `toc` ブロック化（`ArticleBodyBlock` に `toc` 型を追加）。
- チャンピオン画像は各節先頭に `image` ブロックを挿入（既存 `championNameToId`＋`buildChampionSplashUrl`）。

**期待効果**：滞在時間・パッチ記事の完読率と被リンク・回遊増（パッチ記事は検索需要が固定で流入の柱）。

**コスト影響**：**±0〜微減**。3分類・目次・サマリは純ルール。むしろパッチ要約AI（`composePatchSummaryBody`）をルール抽出（E54）優先に寄せれば呼び出しを減らせる。

**優先度**：**高**。

---

### 観点② 翻訳の質（海外の反応が日本人にこなれて伝わる）

**現状**：`REACTION_TRANSLATE_SYSTEM_PROMPT`（compose.ts）で「日本人プレイヤーが書いたような自然な口語に意訳」。Haiku・バッチ処理。方向性は正しい。

**課題**：
- Haikuは**LoL特有スラング・チャンピオン愛称・レーン用語**の訳ゆれが出やすい（例: "inting"→わざと負ける／"diff"→〇〇差、"hard stuck"→万年〇〇帯）。用語の統一辞書が無い。
- 長い system を**毎バッチ丸ごと再送**（キャッシュ未使用）＝入力トークンを無駄に課金。
- 数値・固有名詞の保全はプロンプトで担保しているが、**Few-shot例**が無く出力が安定しない。

**具体案**（品質を上げつつコストを下げる）：
1. **LoL用語・スラング対訳表を system に固定注入**（数十語の小辞書）。おばにゅー/万国反応記系の「日本人プレイヤー語」に寄せる（[海外反応系フォーマット標準](https://sow.blog.jp/)）。用語表は静的データ（`src/lib/lol-data/glossary.ts` を活用/拡張）。
2. **プロンプトキャッシュ（`cache_control`）を導入**：不変の system（翻訳・SEO・パッチ要約の各プロンプト）を `cache_control: {type:"ephemeral"}` でマーク。同一 system を短時間に複数バッチへ送る翻訳で**入力トークンのキャッシュヒット分が約1/10課金**になり、質を上げても総コストは下がる。
3. **Few-shot 1〜2例**を system に含め、口調・記法（`>>返信`保持、絵文字/草の扱い）を安定化。
4. 匿名ハンドルは万国反応記標準に寄せる（`海外プレイヤーさん` は維持で可。連番＋`>>N`は既に実装済み）。

**実装方法**：
- `src/lib/generation/llm-client.ts`：`AnthropicLLMClient.generate` を、system を `messages` の `system` 引数ではなく**`cache_control` 付きブロック**として渡せるよう拡張（Haikuはプロンプトキャッシュ対応。最小キャッシュ長に満たない短い system は自動的に通常課金になるだけで害はない）。→ 実装前に `claude-api` スキルでHaikuのキャッシュ最小トークン/課金仕様を確認。
- `src/lib/generation/compose.ts`：`REACTION_TRANSLATE_SYSTEM_PROMPT` に用語表とFew-shotを追記。用語表は `glossary.ts` から生成。

**SEO面の補足（重複コンテンツ）**：**言語が異なる翻訳は重複コンテンツにならない**（Google公式見解）ので Reddit英語コメントの日本語化自体は問題ない。ただし**機械翻訳の生出力は「自動生成スパム」扱いされ得る**ため自然な日本語化が前提で、さらに①話題の背景・文脈解説、②なぜ話題かの要約、③パッチ/チャンピオンhubへの内部リンクを足して「翻訳の寄せ集め」から脱すること（サイト内重複も回避）（[翻訳と重複コンテンツ](https://www.suzukikenichi.com/blog/does-translated-content-cause-a-duplicate-content-issue/)）。これは引用の主従関係（AdSense複製ポリシー対策）とも一致する。

**期待効果**：訳のこなれ・用語統一が上がり「海外の反応」記事の読みやすさ＝再訪・回遊が改善。**コストはキャッシュで横ばい〜減**。

**コスト影響**：**減**（プロンプトキャッシュ）。呼び出し回数は不変。

**優先度**：**高**。

---

### 観点③ 話題性（LoL勢が思わず見る「賛否・対立・論争」を数値で拾う）

**現状**：`HotnessEvaluator` は「現在値」「増加率」のみ。**賛否が割れる＝論争を測る指標が無い**。

**課題**：LoLコミュニティで伸びるのは**対立・賛否・やらかし・メタ論争・Riot批判・プロ/配信者ドラマ**。実例: LCS放送炎上スレは7.1kupvote/1.1kコメント、Riotのバランスへの批判（Phreak/Tyler1）、シネマティック炎上、Doublelift処分など（[r/LoL 2026ガイド](https://happysmurf.com/blog/r-lol-reddit-guide/)、[Tyler1 バランス批判](https://sportskeeda.com/esports/news-tyler1-slams-league-legends-balance-team-claims-celebrate-got-fired)）。Redditの「controversial」順は **賛否が拮抗（up/downが近い）** を検出する＝controversy rank ≈ `min(|up|,|down|)`（[Reddit ranking解説](https://medium.com/hacking-and-gonzo/how-reddit-ranking-algorithms-work-ef111e33d0d9)）。

**重要な実測（Web調査）**：Redditの厳密な論争式は `controversy = (ups+downs)^(min(ups,downs)/max(ups,downs))`（賛否が拮抗×総票が多いほど高）だが、**Reddit APIは投稿のdownvoteを隠し `score` と `upvote_ratio`（0〜1）しか返さない**ため投稿レベルでは直接使えない（[reddit _sorts.pyx](https://github.com/reddit-archive/reddit/blob/master/r2/r2/lib/db/_sorts.pyx)、[Reddit ranking解説](https://medium.com/hacking-and-gonzo/how-reddit-ranking-algorithms-work-ef111e33d0d9)）。→ **代理指標**を使う。5chは「勢い＝レス数/経過日数」がそのまま論争・注目の指標（[5ch勢い](https://www.ikioi2ch.net/help.html)）。

**具体案（AI禁止＝純数値ルール）**：`score`・`commentCount`・`upvote_ratio`・履歴（`PostMetricsHistory`）から論争度を近似。
1. **コメント/スコア比ルール（核）**：`commentCount / max(score,1) ≥ 0.15`＝議論/炎上サイン。**平常の人気スレは概ね0.05〜0.10**、論争スレは0.15以上（Web調査の実測値）。「みんな黙って賛成upvote」ではなく「言い返したい人が多い」状態を拾う。
2. **upvote_ratio ルール（Reddit）**：`upvote_ratio ≤ 0.80`＝賛否が割れている（1.0に近いほど平和なコンセンサス）。**Arctic Shiftのpostが `upvote_ratio` を返すなら Post に保存して使う**（要確認。無ければ1.のコメント比のみで代替）。
3. **コメント急増ルール（初速）**：`commentGrowthPerHour` が高いのに `scoreGrowthPerHour` が伸び悩む＝荒れている初速（既存履歴で算出可）。
4. **相対分位で閾値を持つ**：固定絶対値ではなく**直近30日ローリングのP90/P95**を閾値化するとサブレ/板の規模差・パッチ周期に強い（Web調査の設計指針）。まずは固定閾値で開始し、運用データが溜まったら分位へ移行。
5. **論争キーワード辞書ルール**（title/flairの含有判定、AI分類ではない）：英語 `Riot why/nerf/buff/broken/overtuned/gutted/deleted/revert/refund/unfair/int/griefer/hardstuck/elo hell/unpopular opinion/hot take/is X broken/$（価格）`／日本語 `ナーフ/壊れ/環境おかしい/運営仕事しろ/萎え/煽り/晒し/炎上/やらかし/高すぎ/課金`。flair（既に `link_flair_text` を保存）で `Discussion`/`News`/`Esports`/`BUG` を加点（Web調査で高反応フレアと確認）。
6. **カレンダートリガ**：パッチ配信日±2日・LJL/大会の試合時間帯という**時間窓**でコメントが跳ねる型（バランス反応・ポストマッチ）は、その窓だけ閾値を緩めて拾う（定期発火）。
7. これらを満たしたPostは **`isHot` に加え `isControversial` フラグ**を立て、タイトル生成に **`議論`/`賛否両論`/`大荒れ`ラベル**（既存 `title.ts` の LABELS/HOOKS）を優先適用。

**実装方法**：
- `src/lib/hotness/evaluator.ts`：`HotnessResult` に `controversyScore:number` と `isControversial:boolean` を追加（純関数のまま）。`commentCount/max(score,1)` を計算し `config.minControversyRatio`（既定0.15）超、または `upvote_ratio ≤ config.maxUpvoteRatio`（既定0.80）で true。
- `src/lib/hotness/config.ts`：`minControversyRatio`（既定0.15）・`maxUpvoteRatio`（既定0.80）・`controversyKeywordBonus` を env で追加。
- `src/lib/collection/adapters/reddit.ts`：`RedditPostData` に `upvote_ratio?` を足し、`RawCollectionItem`（media JSON等）に保存（現状 score/num_comments/author/flair は保持済み）。論争キーワード判定は `title+flair` の含有チェック（既存 `matchKeywordPosts` 同様の純関数）。
- `src/lib/generation/title.ts`：`isControversial` のとき LABELS を `議論/賛否両論`、HOOKS を `で大荒れ/を巡り議論に/に賛否両論` に寄せる分岐（ルールベース、既存語彙を使う）。

**期待効果**：クリック率の高い「対立・論争」記事を機械的に優先量産 → PVの当たり本数増。LoL勢が最も反応する型に合致。

**コスト影響**：**±0**（純ルール、AI不使用）。むしろ論争スレを優先して記事化母数を絞れば無駄なAI生成を減らせる。

**優先度**：**高**。

---

### 観点④ 見やすい画面（UI/UX・回遊・スマホ・広告両立）

**現状**：関連記事は純ルール、人気ランキング等の回遊ウィジェットは一部あり。

**課題**：ベンチマークは**5点セット記事カード（サムネ＋カテゴリ＋見出し＋抜粋＋日付）**、**サイドバー人気ランキング（サムネ付き）**、**ロングテール「大全」へのハブリンク常設**で回遊を作る（[lol-times](https://lol-times.com/)、[LoL News](https://leagueoflegendsns.com/)）。回遊率＝1訪問PVはPV総量に直結（[回遊率とPVの関係](https://ss-complex.com/column-pv/)、[内部リンクと回遊率](https://www.sales-dx.jp/blog/internallinks-migrationrate)）。

**具体案（すべて純ルール）**：
1. **記事末 回遊ウィジェット**：「同カテゴリ最新N件」＋「同タグ人気N件」を自動挿入（`related-articles.ts` を拡張）。
2. **サイドバー人気ランキング**：`ArticleView`（既存）から**直近7日/30日のPV上位**を集計してサムネ付き表示（AI不要のカウント集計）。
3. **ハブページ（クラスタ）**：チャンピオン別・パッチ別・「スキン大全」的まとめページを常設し全記事から内部リンク（観点⑥と連動）。
4. 記事カードを5点セットに統一（未整備なら抜粋・カテゴリラベルを追加）。広告は既存 `ads/anchor.ts` のアンカー広告＋記事内枠を維持し、回遊ウィジェットと干渉しない配置。

**実装方法**：
- `src/lib/related-articles.ts` / `src/lib/articles.ts listRelatedArticles`：「同タグ人気（PV降順）」を追加選定。
- `src/lib/ranking.ts` / `blog-ranking.ts`：直近7/30日窓のPV集計関数を追加（`ArticleView` の `viewedAt` cutoff）。
- 表示コンポーネント（`src/components/*`）にウィジェットを差し込み。

**期待効果**：1訪問あたりPV（回遊率）向上＝**同じ流入で総PVが増える**最も費用対効果の高い施策。

**コスト影響**：**±0**（AI不使用）。

**優先度**：**高**。

---

### 観点⑤ 公式関連記事（パッチ/Dev Blog/eスポーツ）の正確性

**現状**：`riot`/`riot-news` はhotness免除で必ず記事化。パッチは逐語 `⇒` 抽出（捏造防止）。

**課題**：正確性は良好だが、**「先取り速報（PBE）」で鮮度を稼ぐ**競合に対し速報性で劣る余地（[eSports World PBE先取り](https://esports-world.jp/column/63394)、[lol-times PBEカテゴリ](https://lol-times.com/archives/category/pbe-patch-note)）。パッチ・新チャンピオン・スキン・大会結果は**QDF（Query Deserves Freshness）が強く効く典型**で、発表と同時に番号/日付入りで先着公開すると権威サイトを一時的に上回れる（[QDF](https://searchengineland.com/guide/query-deserves-freshness-qdf)）。また `⇒` 抽出のパースがページ構造変化で崩れるリスク。

**具体案**：
1. **PBEパッチノートの取得追加**（Data Dragon PBE / 公式PBEページ）。`riot-datadragon` アダプタに PBE 検知を足し、`【PBE】` ラベル＋`【随時更新】`接頭辞で早出し。
2. パッチ番号・日付を**タイトルに機械挿入**（`パッチノート26.14：チャンピオン・アイテム・システム変更、スキン一覧`固定型）。
3. 逐語抽出が失敗したら**クリーンなフォールバック**（既存 `composeCleanPatchFallbackBody`）＋公式リンクボタン（実装済み）で正確性を守る。

**実装方法**：
- `src/lib/collection/adapters/riot-datadragon.ts` / `riot-news.ts`：PBE検知の分岐とカテゴリ付与（URLルール、AI分類なし）。
- `src/lib/generation/compose.ts` / `title.ts`：パッチ番号抽出（既存 `extractPatchNumberLabel`）を使った固定タイトルテンプレ。

**期待効果**：検索需要が固定のパッチ/PBEで**鮮度と網羅性**を確保し、指名検索・被リンクの柱にする。

**コスト影響**：**±0〜微増**（riot系は既に免除・低頻度。PBEは週数回）。

**優先度**：**中**。

---

### 観点⑥ 集客・SEO・回遊（検索流入・内部リンク・シリーズ化・SNS）

**現状**：SEO生成は1記事1回で良好。sitemap/robots/JSON-LDは実装済み。内部リンクは関連記事のみ。

**課題**：
- 日本のLoL検索需要は**パッチ番号・チャンピオン名＋（カウンター/ビルド/対策）・ティア表・大会結果**に集中（[LoLStats パッチ](https://lolstats.gg/ja/patch-notes)、[カウンター検索](https://www.lol-guide.com/champions/counters)、[チャンピオン攻略図鑑](https://lol-champ.com/about-patch-notes/)）。これらを**タイトル・見出し・内部リンク**で確実に取りにいく設計が弱い。
- まとめ系はSEOだけでなく**アンテナサイト/RSS/SNS流入が最大級**。投稿本数・時刻・オフセットが効く（[まとめPV施策](https://fukugyo-napoleon.com/access-countup/)）。

**具体案**：
1. **タイトル/メタの型化（前半32字にキーワード＋数字）**：日本語検索結果のタイトル表示は**約28〜32字**で、超過は省略されるため**重要語（パッチ番号・チャンピオン名・大会名・日付）を必ず前半へ**（[日本語タイトル文字数](https://www.lany.co.jp/blog/title-tag)）。カテゴリ別公式:
   - パッチ: `【LoL】パッチ26.15変更点まとめ｜強化/弱体チャンピオン一覧`
   - チャンピオン: `【アーリ】ビルド・対策・カウンター｜パッチ26.15最新`
   - Tier/メタ: `【LoL】26.15最強チャンピオンTier表｜ミッドおすすめ`
   - esports: `【LJL 2026 Summer】第5週結果・順位表まとめ`
   - 海外の反応: `【海外の反応】〇〇に外国人ニキ「（象徴的な一言）」`（[すらるど型](https://sow.blog.jp/)）
   区切りは全角 `｜`・`・`、`【更新日】`『【随時更新】』接頭辞で鮮度提示（[lol-times接頭辞](https://lol-times.com/archives/8250)）。SEO生成プロンプト（`seo.ts`）にこの型を渡す（呼び出し回数は不変）。
2. **トピッククラスタ＝ハブ＆スポーク（純タグルールの内部リンク R1〜R8）**：AI不要でタグの完全一致・件数/日付ソートのみで実装（[トピッククラスタ](https://searchengineland.com/guide/topic-clusters)）。
   - R1 同一チャンピオン（`champions[]`共有）で相互リンク・記事末「関連記事」上位6件。
   - R2 同一パッチ（`patch`一致）を相互リンク。パッチ記事本文の各チャンピオン名を**そのチャンピオンhubへ機械リンク化**。
   - R3 同一シリーズ（`series`）で「前/次の試合」「同シーズンまとめ」を時系列リンク。
   - R4 同カテゴリ最新N件。R5 全記事は最も近いhub（チャンピオン/パッチ/シリーズ）へ**本文冒頭で1リンク**（上向き保証）。R6 hubは配下スポークを新着＋人気順で列挙（下向き保証）。
   - R7 アンカーテキストに対象キーワード（チャンピオン名/パッチ番号/大会名）を含める（`こちら`不可）。R8 関連記事は6〜10件に制限。
3. **構造化データ**：各記事に `NewsArticle`/`Article` JSON-LD（`headline`/`image`（**幅1200px以上・16:9/4:3/1:1**）/`datePublished`・`dateModified`（**ISO8601＋TZ**）/`author`/`publisher`＋ロゴ）と `BreadcrumbList`（トップ>カテゴリ>チャンピオン/パッチ番号>記事）。Google Discoverは**アイキャッチ幅1200px以上が事実上必須**（[Google Article docs](https://developers.google.com/search/docs/appearance/structured-data/article)、[Discover最適化](https://www.auncon.co.jp/column/seo/how-to-display-googlediscover/)）。
4. **ニュースサイトマップ（48時間以内の記事のみ）を通常sitemapと併用**。`lastmod` は実質更新時のみ更新（全件today化は無意味）（[ニュースsitemap/lastmod](https://www.searchenginejournal.com/google-seo-tips-for-news-articles-lastmod-tag-separate-sitemaps/478103/)）。
5. **配信導線**：RSS（実装済み `feed.ts`）をアンテナ/SNSに登録、記事公開時のX自動投稿（観点⑦の同API群が使える）、Discord Webhook 通知。
6. **投稿スケジュール**：**7/12/15/18/21時＋15分オフセット**で自動公開（`scheduled-publish.ts`）。

**実装方法**：
- `src/lib/generation/seo.ts`：`SEO_SYSTEM_PROMPT` にカテゴリ別タイトルテンプレ（パッチ/反応/eスポーツ）を渡す。呼び出し回数は不変（1記事1回）。
- `src/lib/related-articles.ts`：チャンピオン/パッチタグの重み付けを上げ、ハブページ用の一覧クエリを追加。
- `src/app/*`：チャンピオン別・パッチ別のタグページ（既存タグ基盤 `tags.ts` を流用）と JSON-LD 拡張。
- `src/lib/generation/scheduled-publish.ts`：公開時刻テーブルを上記に設定。

**期待効果**：検索・アンテナ・SNSの三方向流入増＋回遊増。SEOは既存1回のまま質を上げるだけなのでコスト不変。

**コスト影響**：**±0**（SEOは既存1回。内部リンク・スケジュール・schemaは純ルール）。

**優先度**：**高**（型化・内部リンク）／**中**（スケジュール・配信導線）。

---

### 観点⑦ Xからの情報収集（設計＋実装方法・コスト・法務）

**現状**：X収集は未実装。`SourceAdapter` 抽象・`Post`/`PostMetricsHistory`/`HotnessEvaluator` は流用可能。

**課題**：公式X APIは高額（2026年 pay-per-use：読み取り**$0.005/tweet＝$5/1,000**、無料枠廃止）。snscrape/Nitterは実質死亡。→ **低額サードパーティAPI**が唯一現実的（[X API 2026料金](https://twitterapi.io/blog/x-api-cost-breakdown-2026)、[Xpoz 料金ガイド](https://www.xpoz.ai/blog/guides/understanding-twitter-api-pricing-tiers-and-alternatives/)）。

**採用候補の比較（2026）**：

| サービス | 実効コスト/1,000 tweets | 無料枠 | 認証 | 検索operator(min_faves等) | 評判/安定性 |
|---|---|---|---|---|---|
| **GetXAPI**（第1候補・最安） | **$0.05** | $0.10（≈2,000 tweets）カード不要 | APIキー | ✅対応 | 新興・実績浅め |
| **TwitterAPI.io**（本命・堅実） | **$0.15** | 少額スターター | APIキー `X-API-Key` | ✅ `/twitter/tweet/advanced_search` 全operator | **評判最も確立** |
| **Sorsa API** | 検索$0.10／一括$0.02 | 100 req（無期限） | APIキー | ✅フルoperator透過 | 中堅（$49定額下限あり） |
| **Apify actors** | $0.15〜0.40 | 無料$5/月 | APIトークン | ✅ | actor品質にばらつき |
| 公式X API | $5.00 | ❌ | OAuth2 | v2はmin_favesを黙殺 | 高額 |

出典: [GetXAPI 料金](https://www.getxapi.com/twitter-api-pricing)・[TwitterAPI.io 料金](https://twitterapi.io/blog/twitter-api-pricing)・[Sorsa 料金/検索](https://api.sorsa.io/blog/twitter-api-pricing-2026)・[検索operator対応（min_faves/lang:ja/filter）](https://twitterapi.io/blog/twitter-advanced-search-api-guide)。

**コスト試算**（1日1,000 tweets＝月30,000 tweets を発見に使う想定）：GetXAPI **$1.5/月**、TwitterAPI.io **$4.5/月**。**現状のHaiku月数ドル規模と同等**に収まる。min_faves の閾値で取得件数（＝課金）を直接制御できる。

**具体案（設計）**：
1. **XAdapter（`SourceAdapter` 実装）を追加**。サードパーティの `advanced_search` に検索クエリを投げ、`RawCollectionItem`（externalId=tweet id、score=いいね数、commentCount=リプライ数、author、media）に変換 → 既存の `persist-posts` → `HotnessEvaluator`（論争度含む）→ 記事化（翻訳は既存 reddit 経路に合流）。
2. **話題性は数値ルール**：`min_faves:` で発見段階を絞り、収集後は既存 Hotness（いいね数＝score、リプライ数＝comments、論争度＝comments/score比）で記事化判定。AI分類なし。
3. **表示は公式oEmbed埋め込み**（法務・後述）。API は「どのtweetを拾うか」の**発見**にのみ使い、本文はサイト独自の見出し・要約＋埋め込みで主従関係を確保。
4. **2系統フェイルオーバー**（GetXAPI＋TwitterAPI.io）でベンダー依存リスクを分散。

**検索クエリ例**（各APIは X 検索operatorを透過）：
```
# 国内・話題ピック
(LoL OR LJL OR リーグ・オブ・レジェンド OR リグオブ) min_faves:100 lang:ja -filter:retweets -filter:replies
# 高バズのみ（コスト最小・当たりだけ）
(LoL OR LJL) min_faves:500 lang:ja -filter:retweets
# クリップ/大会（まとめ映え）
(LoL OR LJL) (神プレイ OR クソ試合 OR 大会 OR プロ) min_faves:100 filter:media lang:ja -filter:retweets
# 海外パッチ反応
("League of Legends" OR #LeagueOfLegends OR LoL) min_faves:1000 lang:en -filter:retweets
```
`since:`/`until:` で日次バッチの重複取得を防ぎ、表記ゆれ・チャンピオン愛称を OR で網羅。

**実装方法**：
- `src/lib/collection/types.ts`：`SOURCE_TYPES` に `"x"` を追加 → 依存する `Record<SourceType,…>`（config/カテゴリ対応表/hotness既定）の網羅漏れをコンパイラが指摘するので順に埋める。
- `src/lib/collection/adapters/x.ts`（新規）：`XAdapter implements SourceAdapter`。`fetchItems()` で advanced_search → 変換。`fetchMetrics()`/`fetchContent()` は任意（いいね/リプライ再取得）。APIキーは `.env`（`X_API_PROVIDER`/`X_API_KEY`、`.env.example`にキー名のみ）。失敗は空配列（既存アダプタ同方針）。
- `src/lib/collection/adapters/index.ts`：mock↔live 切替に `x` を登録。
- 表示：tweet id → 記事内に公式oEmbed（`embed.ts` に X provider を追加。iframe許可URL検証を既存 `isAllowedEmbedUrl` に寄せる）。

**法務・規約留意**（[要点]）：
- 公開tweet取得は米国では概ね合法（hiQ v. LinkedIn）だが、**X ToSはスクレイピングを禁止**（民事）。サードパーティAPI利用でもベンダーがToSリスクを負う構図＝**公開データのみ扱うサービスを選ぶ**。
- 日本の**まとめサイトでの引用は著作権法32条の適法引用要件**（明瞭区別・**主従関係**・出典明記）を満たすこと。tweet全文コピペ・スクショ多用は違法リスク大 → **公式oEmbed埋め込み＋サイト独自の論評を「主」**にする（[まとめと著作権](https://aglaw.jp/matome-curation/)、[X oEmbed](https://docs.x.com/x-for-websites/oembed-api)）。
- 個人晒し・中傷は既存 `moderation`（NG語・personal-attack）で除去。

**期待効果**：5ch/Redditに無い**リアルタイムの国内話題（LJL・配信者・炎上）**を最速で拾える＝速報性と話題性の両取り。

**コスト影響**：**低額従量（月$1.5〜5）**。min_faves 閾値でコスト上限を制御。翻訳は既存経路に合流し追加AIコストは記事化分のみ。

**優先度**：**中**（PoCから小さく。まず無料クレジットで精度検証）。

---

## 4. コスト同等を保つ横断施策（重要）

AIを増やさずPVを上げる／むしろ下げるための共通レバー。

1. **数値ルールで母数を絞る**：記事化はhot＋論争度を満たすPostのみ（1投稿1回）。X も min_faves で発見段階から絞る。→ **AIに渡る件数を増やさない**。
2. **プロンプトキャッシュ（`cache_control`）**：翻訳・SEO・パッチ要約の長い system をキャッシュ化＝入力トークン課金を削減。品質を上げても総額は横ばい〜減。※Haikuのキャッシュ最小トークン・課金率は `claude-api` スキルで確認してから実装。
3. **AIを増やさず質を上げる**：用語集・Few-shot・出力型（JSON）の改善は**呼び出し回数を増やさず1回の質を上げる**。
4. **バッチ最適化**：翻訳の `REDDIT_TRANSLATE_BATCH_SIZE`/文字上限を調整し、JSON途中切れによる再送・英語フォールバックを減らす（無駄呼び出し削減）。
5. **純ルールで作れるものはAIに出さない**：目次・バフ/ナーフ3分類・冒頭サマリ・回遊ウィジェット・内部リンク・タイトル接頭辞・スケジュールは全て数値/テンプレ。
6. **監視上限の維持**：`METRICS_MAX_MONITOR_HOURS=48`・`maxPostsPerRun` で無限ポーリング防止（実装済み）。

---

## 5. 実装ロードマップ（小さく安全に・既存を壊さない）

各スプリントは既存テスト回帰なし＋PASS時コミット（CLAUDE.mdのゲート準拠）。

- **G1（高・純ルール）論争度シグナル**：`hotness/evaluator.ts`＋`config.ts` に controversyScore/isControversial。`title.ts` の論争ラベル分岐。テスト（純関数）。
- **G2（高・純ルール）回遊強化**：記事末ウィジェット＋サイドバー直近PVランキング＋チャンピオン/パッチ ハブページ。`related-articles.ts`/`ranking.ts`。
- **G3（高）パッチ記事のlol-times型化**：目次・バフ/ナーフ/調整3分類・冒頭サマリ・チャンピオン画像。`compose.ts`。
- **G4（高・コスト減）翻訳品質＋プロンプトキャッシュ**：`llm-client.ts` に cache_control、`compose.ts` に用語集/Few-shot。`claude-api` スキルで仕様確認。
- **G5（高・±0）タイトル/SEO型化＋構造化データ**：`seo.ts` テンプレ、JSON-LD拡張、更新日接頭辞。
- **G6（中・±0）投稿スケジュール＋配信導線**：`scheduled-publish.ts` 時刻表、RSS/SNS/Discord Webhook。
- **G7（中・低額）X収集PoC**：`SOURCE_TYPES` に `x`、`x.ts` アダプタ、oEmbed表示、無料クレジットで精度検証→採否判断。
- **G8（中）Reddit速報性/論争コメント**：取得窓短縮の検証、controversial寄りのコメント選定。

各Gは独立して価値を出せる順に並べてあり、G1〜G5（すべてコスト同等/減）を先行、X（G7）は費用が出るため最後にPoC。

---

## 6. 効果測定（PV/回遊/検索流入）

- **Google Search Console**：クエリ別の表示回数/クリック/CTR/掲載順位を見て、パッチ番号・チャンピオン名クエリの取りこぼしを特定 → タイトル/見出し/内部リンクを改善。Discover流入も監視（更新記事の鮮度効果）。
- **Striking distance ループ（最重要の運用KPI）**：Performanceで期間28日・**掲載順位8〜20位（2ページ目付近）×表示回数多**のクエリを抽出＝「あと一歩」の宝の山。該当ページにタイトル改善・本文追記・**内部リンク流し込み（§観点⑥のR1〜R4）**で1ページ目へ押し上げる。2ページ目のクリックは全体の約0.6%しかないため、8〜20位→上位化のCTR跳ねが最も費用対効果が高い（[striking distance/GSC](https://neuronwriter.com/striking-distance-audit-gsc-2026/)）。GSC APIで自動抽出→内部リンク追加まで人手なしで回せる。
- **回遊率（1訪問あたりPV）**：既存 `ArticleView` を集計。ウィジェット導入前後で比較（最重要KPI＝同じ流入で総PVが増える）。
- **記事別PV・流入元**：アンテナ/SNS/検索の比率を把握し、投稿時刻・接頭辞・タイトル型のA/B。
- **論争度と成績の相関**：`isControversial` 記事の平均PV/コメント数を追い、閾値（`minControversyRatio`）をチューニング。
- **翻訳コスト**：Anthropicの入力/キャッシュトークン使用量を監視し、キャッシュヒット率で費用対効果を確認。

---

## 7. 主要出典URL

- ベンチマーク（PVの型・タイトル・回遊）：
  - lol-times: <https://lol-times.com/> ・ <https://lol-times.com/archives/category/patch-notes> ・ <https://lol-times.com/archives/8250>
  - FISTBUMP: <https://fistbump-news.jp/category/league_of_legends/> ・ <https://fistbump-news.jp/article/2026/05/28/2490.html>
  - LoL News: <https://leagueoflegendsns.com/> ／ eSports World（PBE先取り）: <https://esports-world.jp/column/63394>
  - 海外の反応フォーマット: <https://reddit-matome.com/archives/5476> ・ <https://sow.blog.jp/> ・ <https://kaikore.blogspot.com/>
  - まとめPV/回遊施策: <https://fukugyo-napoleon.com/access-countup/> ・ <https://note.com/yoko1007/n/nb5daf3c881f6> ・ <https://ss-complex.com/column-pv/> ・ <https://www.sales-dx.jp/blog/internallinks-migrationrate> ・ <https://weblife-changinghacks.com/internal_links/>
- 話題性/論争（LoLコミュニティ・数値式）：
  - Reddit論争式(controversy=magnitude^balance): <https://github.com/reddit-archive/reddit/blob/master/r2/r2/lib/db/_sorts.pyx> ／ 解説: <https://medium.com/hacking-and-gonzo/how-reddit-ranking-algorithms-work-ef111e33d0d9>
  - 5ch勢い式: <https://www.ikioi2ch.net/help.html> ・ <https://www.infiniteloop.co.jp/tech-blog/2012/11/2chcacti/>
  - r/LoL 2026ガイド/フレア: <https://happysmurf.com/blog/r-lol-reddit-guide/> ・ <https://www.zleague.gg/theportal/league-of-legends-introduces-post-flairs-a-new-era-for-r-leagueoflegends/>
  - 炎上事例（バランス/課金/プロ）: <https://sportskeeda.com/esports/news-tyler1-slams-league-legends-balance-team-claims-celebrate-got-fired> ・ <https://www.si.com/esports/league-of-legends/ahri-ban-rate> ・ <https://automaton-media.com/articles/slr/lol-issues-about-pro-scene/>
  - 日本matome炎上タグ/X観測: <https://lolmoriage.blog.jp/archives/cat_222764.html> ・ <https://search.yahoo.co.jp/realtime/search>
- SEO（検索需要・構造化データ・鮮度・内部リンク・計測）：
  - 検索需要: <https://lolstats.gg/ja/patch-notes> ・ <https://www.lol-guide.com/champions/counters> ・ <https://lol-champ.com/about-patch-notes/>
  - 構造化データ(Article): <https://developers.google.com/search/docs/appearance/structured-data/article> ／ ニュースsitemap/lastmod: <https://www.searchenginejournal.com/google-seo-tips-for-news-articles-lastmod-tag-separate-sitemaps/478103/>
  - QDF(鮮度): <https://searchengineland.com/guide/query-deserves-freshness-qdf> ／ トピッククラスタ: <https://searchengineland.com/guide/topic-clusters>
  - Striking distance(GSC): <https://neuronwriter.com/striking-distance-audit-gsc-2026/> ／ 翻訳と重複: <https://www.suzukikenichi.com/blog/does-translated-content-cause-a-duplicate-content-issue/>
  - 日本語タイトル文字数: <https://www.lany.co.jp/blog/title-tag> ／ Discover最適化(JP): <https://www.auncon.co.jp/column/seo/how-to-display-googlediscover/>
- X収集（API・料金・operator・法務）：
  - 公式2026料金: <https://twitterapi.io/blog/x-api-cost-breakdown-2026> ・ <https://www.xpoz.ai/blog/guides/understanding-twitter-api-pricing-tiers-and-alternatives/>
  - GetXAPI: <https://www.getxapi.com/twitter-api-pricing> ／ TwitterAPI.io: <https://twitterapi.io/blog/twitter-api-pricing> ／ Sorsa: <https://api.sorsa.io/blog/twitter-api-pricing-2026>
  - 検索operator（min_faves/lang:ja/filter）: <https://twitterapi.io/blog/twitter-advanced-search-api-guide>
  - 法務（まとめ引用）: <https://aglaw.jp/matome-curation/> ／ X oEmbed: <https://docs.x.com/x-for-websites/oembed-api>

---

> 次アクション: G1（論争度シグナル）とG2（回遊強化）は純ルール・コスト±0で即効性が高く、spec-pipelineの1スプリントずつで安全に着手できる。X収集（G7）は無料クレジットでのPoC結果を見てから本採用を判断する。
