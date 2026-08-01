# reactqual-S2 — レス本文中のURLを安全に自動リンク化（バグ4）

実データで確認したバグ4の修正。レス本文中の `https://twitter.com/...` 等が**プレーンテキストで描画**され、クリックできない（元スレでは機能）。5ch/reddit/X/コメントのレス行に対し、**http/httpsのURLだけを安全に自動リンク化**する。**dangerouslySetInnerHTML不使用・逐語不変**。

## 根本原因（確定）
- `src/components/article-body-view.tsx` の `ResLines`（L74-78付近）が `<p>{line.text}</p>` とプレーンテキスト描画。URL文字列がそのまま出るためリンクにならない。

## 含まれる機能

### F-RQ2-1: linkifyText 純関数（新設 src/lib/linkify.ts）
- `linkifyText(text: string): Array<{ type: "text" | "link"; value: string; href?: string }>`:
  - URL検出は **`https?:\/\/[^\s<>"'）】「」『』、。！？]+`**（compose の `URL_IN_TEXT_RE` と同方針）。**`https?://` プレフィックス必須**なので `javascript:`/`data:`/`vbscript:` は原理的にhrefにならない（危険スキーム排除）。
  - URL末尾の半角/全角句読点（`。、）」』！？` 等）は URL に含めず後続テキストに回す（元compose の trailing-strip と同方針）。
  - テキストとURLを交互のセグメント配列にして返す（URL無しなら `[{type:"text", value:text}]` 1件）。`href` は link セグメントのみ（`value` と同じ絶対URL）。
  - **逐語不変**（文字は一切改変しない・分割するだけ。連結すると元の text に一致）。純関数・テスト可能・依存追加なし。

### F-RQ2-2: 表示（article-body-view.tsx ResLines）
- `ResLines` の各行 `{line.text}` を **`linkifyText(line.text)` の結果でJSX描画**:
  - `type:"text"` はそのまま文字列（React自動エスケープ）。
  - `type:"link"` は `<a href={seg.href} target="_blank" rel="noopener noreferrer nofollow" className="underline text-sky-700 dark:text-sky-400 break-all">{seg.value}</a>`。
  - 既存の強調色（`line.emphasis` 由来の赤/オレンジ、`<p>`側のクラス）は維持し、リンクだけ下線＋sky色にする。AA行（`isAsciiArtLine` 等の等幅表示）も同関数を通してよい（URL混在は稀・逐語不変）。
- `ResLines` は**記事本文のreactionブロック＋コメント欄で共用**のため、5ch/reddit/X の反応レス・コメント全てに一括で効く。
- **`dangerouslySetInnerHTML` は使わない**（セグメント配列をJSXで組むだけ）。ツイートURLの埋め込み化はしない（リンク化のみ・ユーザー要望どおり）。

## 制約・非目標
- **逐語不変**（テキスト内容は改変しない・分割のみ）。**http/httpsのみリンク化**（`javascript:`等の危険スキームは原理的に不可）。**dangerouslySetInnerHTML不使用**。
- reaction/コメント以外のブロック（heading/embed/quote/linkButton/redditSource/patchChange等）・既存の埋め込み（YouTube/Twitch/Twitter iframe）は不変。スキーマ変更なし・新規依存なし。
- コンポーネントの共用先（ReactionGroupView・CommentRow）で崩れないこと。3デザイン（標準/ニュース/Hextech）で読めること。

## テスト（必須）
1. `linkifyText`: URL無し→1テキストセグメント（value=元text）。文中1URL→[前テキスト, link, 後テキスト]。複数URL→交互。末尾句読点strip（`"これ→https://x.com/a。続き"` の link.href に `。` を含めず後続textに `。続き`）。`"javascript:alert(1) を試す"`→**linkにならない**（http/https必須）。連結すると元textに一致（逐語）。
2. 表示（ResLines）: URLを含むレス行が `<a target="_blank" rel="noopener noreferrer nofollow">` として描画される。非URL部分は逐語テキスト。`dangerouslySetInnerHTML` 不使用（renderToStaticMarkup等で検証）。強調色行のリンクも機能。
3. 既存の article-body-view / comment-section / reaction 表示テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. レス本文中のhttp/https URLがクリック可能なリンク（新規タブ・`rel="noopener noreferrer nofollow"`）として表示される。5ch/reddit/X/コメント共通。逐語不変・危険スキーム不可・InnerHTML不使用。
3. 他ブロック・既存埋め込み・スキーマ/依存不変。3デザインで崩れない。

## 評価基準（evaluator向け・Playwright可）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- `linkifyText` の分割・安全性（http/https限定・句読点strip・逐語）。ResLinesでリンク描画（属性確認）・InnerHTML不使用。可能なら実機でURL入りレスがクリック可能なリンクになることを3デザインで確認。
- 受け入れ基準1〜3を満たす。
