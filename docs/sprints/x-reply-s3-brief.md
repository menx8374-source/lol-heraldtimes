# X-reply-S3 — X反応記事の構成刷新（元ポスト埋め込み→反応まとめ→リプライ/引用のレス群）＋3デザイン検証

Opus5設計のS3（最終）。S2で `candidate.xReplies`（親ポストへのリプライ/引用）が載るので、それを使い**参考OWサイトのような構成**にする: 先頭に元ポストの埋め込み、続いて「反応まとめ」、2番目以降にそのポストへの**評価の高いリプライ/引用をレス形式**で列挙。**スキーマ変更なし・新規依存なし**。ユーザー決定: 引用も表示・X_REPLIES_MODE既定on。

参考構成: https://overwatch2-news.apexlegends-leaksnews.com/ow-20260731-135504/ （先頭に元ポスト埋め込み→評価順のリプライ/引用をレス化）。埋め込みカードの見た目は既存の `platform.twitter.com/embed` iframe（＝ユーザー提供画像と同じ標準Xカード）で満たす。

## 現状（S2まで）
- `composeXBody`（compose.ts）はX記事本文を「見出し＋LLM導入＋**元ポストのembed**＋LLM結び」等で構成（元ポスト自体の埋め込みは既にある）。
- `candidate.xReplies: XReplyItem[]`（`{id,text,author,likeCount,replyCount,quoteCount,url,lang?,isQuote}`）がS2で配線済みだが**composeXBodyは未使用**。
- reaction形式の描画は `ReactionGroupView`（article-body-view）と `ArticleBodyReactionBlock`（article-body.ts）が既存。5ch/redditで実績あり。翻訳 `translateReactionLines`・NG削除 `removeNgSentences` も既存（reddit経路）。

## 含まれる機能

### F-XR3-1: composeXBody を「元ポスト＋反応まとめ」構成に刷新
`candidate.xReplies` が**1件以上あるとき**、本文を次の順で組む:
1. （既存の導入・見出しは踏襲）「Xでの反応」等の見出し＋LLM導入段落（既存流用）
2. **元ポストのembedブロック**（`{type:"embed",provider:"twitter",url:candidate.sourceUrl}`。既存の `embedIframeSrc`/検証済み数値ID経由。生成できない場合は既存のフォールバック＝リンクカード）
3. **見出し「反応まとめ」**
4. **リプライ/引用を reactionブロックで列挙**（`buildXReactionBlocks` の結果）
5. （必要なら）LLM結び段落（既存流用）

`xReplies` が**0件のとき**（キー無し・取得失敗・古い記事）は、**S2以前と同一の従来構成にフォールバック**（reaction群を足さない）。＝回帰ゼロ。

### F-XR3-2: buildXReactionBlocks（compose.ts に新設）
`XReplyItem[]` を `ArticleBodyReactionBlock[]` に変換する薄い専用関数（5ch/redditの `buildReactionBlocks` は `>>N` 掲示板テキスト前提で流用しづらいため新設。ただし翻訳・NG削除・reaction型・Viewは共有）:
- 連番 `number`（1,2,3…）。
- `name`: **`@handle`**（Xの公開ハンドルは出典明記の一部として表示）。加えて**評価と種別を軽量に**併記（例 `@handle ・ 👍1,234 💬56 [引用]`）。`isQuote` のとき「引用」、それ以外「返信」ラベル。**捏造せずAPI値のまま**（数値はカンマ区切り整形のみ）。
- `lines`: リプ/引用本文（逐語）。**日本語（`lang` が ja / `containsJapaneseText` 判定）は翻訳不要**、**英語等は既存 `translateReactionLines` を流用して自然な日本語訳**（redditと同じ）。翻訳失敗時は原文のまま（本体を止めない）。
- **moderation**: 各行に既存 `removeNgSentences`（NG文削除）を適用（5ch/reddit経路と同一）。空になったレスは落とす。
- `anchors`: X会話は `>>N` が無いため**付けない**。
- 表示順は `xReplies` の順（S2で評価順ソート済み＝いいね降順）。上限もS2で適用済み。
- リンク: reaction型にurl欄が無いため既定はテキストにも出さない（逐語主義・リンク過多回避）。出典は @handle と元ポストembedで担保。

### F-XR3-3: 表示（article-body-view.tsx）
- **embed→（見出し）→reaction群**の並びが既存描画で崩れないことを確認。`groupArticleBodyBlocksForDisplay`（連続reactionを1枠化）で反応まとめが1枠になる。
- 追加のView新設は**不要**が、`name` 内の評価表示（👍/💬/引用ラベル）が3デザイン（標準/ニュース記事風/Hextech）で読めることを確認。必要なら最小のスタイル微調整のみ（既存reaction枠の意匠に馴染ませる。過剰な装飾はしない）。
- **セキュリティ**: 埋め込みは既存 `embedIframeSrc`（検証済み数値ID・`platform.twitter.com` sandbox iframe・外部script不使用）のみ。リプ本文は**プレーンテキストでJSXに渡す**（`dangerouslySetInnerHTML`不使用）。リプのURL/HTMLは描画しない。

## 制約・非目標
- **スキーマ変更なし・新規npm依存なし**。**逐語維持・捏造禁止**（本文・数値はAPI値そのまま）。
- **回帰ゼロ**: `xReplies` 0件で従来構成と同一。5ch/reddit/riot等・他記事・既存埋め込み(YouTube/Twitch)は不変。
- **著作権配慮**: 引用は逐語＋出典（@handle）・件数上限（S2適用済み）・主従（元ポスト＋当サイトの導入/結び＋レス群の構成）を維持。
- コスト: S3は表示のみ（追加API呼び出しなし）。翻訳は英語リプがある場合のみLLM（redditと同様・`X_REPLIES_MAX`で上限管理）。
- hotness・収集・S1/S2のロジックは不変。

## テスト（必須・実HTTPを叩かない・fixture）
1. `buildXReactionBlocks`: XReplyItem[]→reactionブロック。連番・`name`に@handle＋評価（👍/💬）＋引用/返信ラベル。日本語は無翻訳・英語は翻訳（モックLLM）・翻訳失敗で原文。NG文削除・空レス除去。anchors無し。
2. `composeXBody`: xReplies≥1で「導入→元ポストembed→『反応まとめ』見出し→reaction群→結び」の順。xReplies=0で**従来構成と同一**（回帰）。embed生成不可時はリンクカードにフォールバック。
3. 表示: embed→reaction が崩れず描画（`groupArticleBodyBlocksForDisplay`で反応まとめ1枠）。`dangerouslySetInnerHTML`不使用。
4. 既存の compose/x/article-body-view/post-pipeline/5ch/reddit テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. `candidate.xReplies` があるX記事が「元ポスト埋め込み→反応まとめ→評価の高いリプライ/引用のレス群」で表示される。@handle・評価・引用/返信が分かる。0件は従来構成（回帰ゼロ）。
3. 逐語維持・捏造なし・セキュリティ（embedは検証済みID・InnerHTML不使用）・スキーマ変更なし・新規依存なし・3デザインで可読。

## 評価基準（evaluator向け・Playwright可）
- テスト全Green・build/tsc/lint通過・コンソールエラー0（CSP違反なし）。
- **Playwrightで実機確認**: xReplies入りのX記事（fixture/seedで用意可能なら）で「元ポストembed→反応まとめ→レス群（@handle＋評価＋引用/返信）」が標準/ニュース記事風/Hextechの3デザインで崩れず表示。埋め込みiframe（platform.twitter.com/embed）存在。0件記事が従来構成のまま。
- 逐語・出典・安全要件を満たす。受け入れ基準1〜3を満たす。
