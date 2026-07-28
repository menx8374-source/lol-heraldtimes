# パッチ刷新S3 — スキル/アイテム/パッシブ/チャンピオンアイコンの転用（画像表示）

`docs/patch-accuracy-research.md` §4・§7 S3。S1で抽出済みのアイコンURLを、patchChangeブロックに**実際の画像として表示**する。**AI不使用**。対象: Web（表示）。

## 背景（S1/S2の成果と現状）
- S1パーサが各対象・各スキルの**アイコンURLを抽出済み**（`PatchChangeTarget.iconUrl`＝対象アイコン、`group.abilityIconUrl`＝スキルアイコン）。S2で `patchChange` ブロックに `targetIconUrl`/`abilityIconUrl` として保持済み（ただし**まだ非表示**）。
- 抽出されるURLは公式HTML由来の**akamaihdラッパ形式**: `https://am-a.akamaihd.net/image?f=https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/MissileBarrage.png`（`f=`パラメータ内にDDragon直URLが入っている）。
- `next.config` に画像許可ドメインの記述は無い（既存の画像は通常 `<img>`/`ArticleThumbnail` 経由で外部URLを直接表示）。**既存のパッチバナー・スプラッシュ画像と同じ表示方法**に合わせる。

## 含まれる機能

### F-S3-1: アイコンURLの正規化（akamaihdラッパ → DDragon直URL）
- 純関数 `normalizePatchIconUrl(url): string | undefined` を用意（`patch-notes-parser.ts` か画像utils）:
  - `am-a.akamaihd.net/image?f=<encoded ddragon url>` を検出したら、**`f=` パラメータをデコードしてDDragon直URLを返す**（例 → `https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/MissileBarrage.png`）。
  - 既にDDragon直URL/その他の https 画像URLはそのまま返す。`isSafeImageUrl`（既存, https/データURI/ローカルのみ）を満たさないURLは `undefined`（表示しない）。
- **S1パーサの `iconUrl`/`abilityIconUrl` 抽出時にこの正規化を適用**して綺麗なDDragon URLを返すようにする（1箇所に集約）。S1の既存フィクスチャテストは**正規化後URLを期待する形に更新**する（回帰扱いにしない・意図的な改善）。

### F-S3-2: patchChangeブロックのアイコン表示（article-body-view.tsx）
S2で入れた素朴レンダリングに、画像を追加する（**デザイン=S4はまだ。ここは機能的な表示のみ**）:
- **対象アイコン**（`targetIconUrl`）: 対象名の左に小さめの正方画像。`alt`＝対象名（例「コーキ」）。
- **スキルアイコン**（`abilityIconUrl`）: 各スキル行の `abilityName`（"R - 連発ミサイル"）の左に小アイコン。`alt`＝abilityName。基本ステータス等アイコンが無い group は画像なしでよい。
- **credit/出典**: パッチ本文内に「画像: Riot Games / Data Dragon」の出典を1箇所明記（既存のパッチ記事の出典表記・パッチバナーの credit 方針に合わせる）。著作権はホットリンク表示（ローカル保存しない）の現行方針を踏襲。
- 表示方法は**既存の画像表示（`ArticleThumbnail` か通常 `<img>`）に合わせる**。Next Image を使う場合のみ `next.config` の許可ドメイン（`ddragon.leagueoflegends.com`）追加が要る→既存が通常imgなら不要。既存に合わせ、追加が必要なら最小限追加する。
- **壊れURL・欠落は省略**（画像が無くても記事は壊れない・テキスト情報は維持）。`onError` 相当 or URL検証で安全に。

### F-S3-3: アイコン欠落時のフォールバック（軽量・任意）
- 対象が champion で `targetIconUrl` が抽出できなかった場合、`PatchChangeTarget.id`（例 "Corki"）または対象名から **DDragon champion square URL**（`https://ddragon.leagueoflegends.com/cdn/<version>/img/champion/<Id>.png`）を組み立てて補完する（`champion-splash.ts` の既存ID解決を再利用。version は riot-datadragon が持つ現行バージョン）。
- アイテムは `id`（数値, 例 "3168"）から `.../img/item/<id>.png` を補完可能。
- **スキルアイコンの補完は困難**（`spells[i].image.full` の解決が必要）なため、欠落時は**省略**でよい（DOM埋め込みが取れているのが通常）。
- フォールバックが失敗しても記事は壊れない（画像省略）。過剰実装しない。

## 制約・非目標
- **AIは使わない**（URL正規化・組み立ては純ルール）。翻訳/SEO/反応記事/他ソースは変更しない。
- **デザイン（黒/紺・金/teal・カード意匠）はS4**。S3は「正しいアイコンが正しい対象/スキルに表示される」ことが目的（見た目の作り込みはしない・既存の素朴レイアウトのまま画像を足す）。
- **逐語維持**（テキストは不変）。DBスキーマ変更なし・新規npm依存なし。画像はホットリンク（ローカル保存しない）・出典明記。
- 壊れURL・欠落で記事が壊れないこと（画像は装飾であり本文の正確性はテキストで担保済み）。

## テスト（必須・実ネット非依存）
1. `normalizePatchIconUrl`: akamaihdラッパ→DDragon直URL抽出（`f=`デコード）。DDragon直URLはそのまま。非https/不正は undefined。
2. S1フィクスチャ（26.14）: パーサの `iconUrl`/`abilityIconUrl` が**正規化後のDDragon URL**で返る（コーキ対象アイコン＝champion/Corki.png、Rスキル＝spell/MissileBarrage.png）。既存S1テストを正規化後URLに更新。
3. article-body-view: patchChangeブロックが対象アイコン・スキルアイコンを `<img>`（or既存方法）で表示し、alt が対象名/abilityName、credit が出る。アイコン欠落の group は画像なしで崩れない（renderToStaticMarkup）。
4. フォールバック: champion で targetIconUrl 欠落時に DDragon square URL が補完される。item は id から補完。スキル欠落は省略。壊れURLは表示しない。
5. 既存の article-body-view/compose/parser/seo/search テストが回帰しない。Next Image許可ドメインを追加した場合はビルドが通る。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. パッチ記事の各対象カードに**チャンピオン/アイテムのアイコン**、各スキル行に**スキルアイコン**が正しい対象・スキルに紐づいて表示され、alt/出典が付く。欠落・壊れURLで記事が壊れない。
3. AI不使用・逐語維持・DBスキーマ変更なし・新規依存なし・画像はホットリンク＋出典明記。デザイン(S4)には踏み込まない（機能表示のみ）。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- パッチ記事でスキルアイコン・アイテムアイコン・チャンピオンアイコンが実表示され、正しい対象/スキルに対応（Playwrightで画像URLが200応答＝表示されることを確認できればなお良い。ネット不可なら静的にsrc属性を確認）。
- 欠落時に崩れない。出典明記。S4デザインに踏み込みすぎていない。
- 受け入れ基準1〜3を満たす。
