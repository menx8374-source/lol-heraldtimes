---
tags: [sprint-selfeval]
sprint: E37
---

# 拡張E37 自己評価レポート

## 実装した内容
- `src/lib/generation/champion-thumbnail.ts`
  - 見栄えのする代表チャンピオンID固定プール `CURATED_SPLASH_CHAMPION_IDS`（Ahri/Yasuo/Jinx/LeeSin/Lux/Ezreal/Zed/Katarina/MissFortune/Thresh/Garen/Darius/Vayne/Kaisa/Yone/Sett/Viego/Jhin/Akali/Riven/Irelia/Lucian/Kindred/Aphelios の24体）を追加。
  - `deterministicIndex(key, poolLength)`: keyの各文字コード合計をプール長で剰余するだけの純粋関数（`Math.random`/`Date.now` 不使用、実ネット非依存）。
  - `pickDeterministicChampionSplashUrl(key: string): string` を追加。既存の `buildChampionSplashUrl` を再利用してURLを組み立てるのみ（新規URL組み立てなし）。
- `src/lib/generation/generate-article.ts`
  - thumbnailUrl決定ロジックに③を追加: `isReactionFormat`（5ch/reddit）かつ①imageUrlも②detectChampionSplashUrlも無い場合のみ `pickDeterministicChampionSplashUrl(candidate.id)` を設定。非reaction（riot/clip）は従来どおり null のまま変更なし。
  - `GeneratedArticle.thumbnailUrl` のJSDocを優先順①〜④に更新。
- `src/lib/__tests__/generation-generate-article.test.ts`
  - 既存テスト2件（「ソース画像もチャンピオン検出も無ければthumbnailUrlはnullになる」「championMapを渡さない場合」）を、reaction記事では決定論スプラッシュにフォールバックする新仕様の期待値に更新。
  - 新規describeブロック「反応記事の決定論チャンピオンスプラッシュフォールバック」を追加し、テスト観点1〜4（決定論・分散の代わりに同一key→同一URL/回帰なし優先順/非reactionはnull不変）をカバー。

## 技術選定（該当する場合のみ）
- 新規依存なし。既存の `buildChampionSplashUrl` を再利用し、ハッシュは文字コード和の剰余という最小実装（外部ライブラリ・crypto等不要）。ブリーフの指示どおり。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全Green（75ファイル/793テスト成功、うち今回追加分含む）。
- [x] 基準2: `npx tsc --noEmit`（出力なし=エラーなし）・`npm run build`（成功）・`npm run lint`（0 errors、警告4件はいずれも本スプリント変更と無関係の既存warning）通過。
- [x] 基準3: reaction記事（5ch/reddit）でimageUrl・本文チャンピオン検出とも無い場合に決定論スプラッシュURL（`ddragon...splash/<ChampionId>_0.jpg`形式）になることをテストで確認。同一candidate.idなら常に同じURLになることもテストで確認（`e37-stable`ケース）。①imageUrl優先・②本文検出優先の回帰なしもテストで確認。非reaction（riot/clip）はnullのまま変更なしをテストで確認。
- [x] 基準4: 逐語維持（既存コードの構造・コメントスタイルを踏襲）。新規npm依存追加なし（package.json変更なし）。LLM呼び出し回数増加なし（thumbnailUrl決定は純粋関数、LLMクライアントに触れていない）。

## アプリの起動方法
- 本スプリントはロジック層（記事生成のサムネ決定）のみの変更で、UI/APIエンドポイント自体の変更はなし。
- 通常起動: `npm run dev`（http://localhost:3000）。
- テスト: `npx vitest run`。
- 型チェック: `npx tsc --noEmit`。ビルド: `npm run build`。lint: `npm run lint`。
- 実機での見た目確認が必要な場合は、既存のmockパイプライン実行経路（管理画面からのパイプライン実行等）で5ch/reddit記事を生成し、サムネがチャンピオンスプラッシュになることを目視できる想定（本スプリントではユニット/結合テストレベルでのみ確認、ブラウザでの実機目視確認は未実施＝evaluatorでの実機確認を想定）。

## 既知の問題・懸念点
- ブラウザでの実機目視確認（実際に生成された反応記事のサムネ画像が壊れずに表示されるか）は本スプリントでは未実施。ロジックはURL文字列の組み立てのみで実ネット非依存のため、公式ddragon CDNへの到達性・画像の実在は本スプリントのテスト範囲外（既存のdetectChampionSplashUrl/buildChampionSplashUrlと同じCDN・同じURLパターンを使うため、既存機能と同等の信頼性と考える）。
- サーバーは自己確認のために起動していない（ロジックのみの変更のため、vitest/tsc/build/lintの静的検証で完結）。

## 追加したテスト（任意）
- `pickDeterministicChampionSplashUrl`自体の直接ユニットテストは追加していないが、`generate-article.test.ts`側で決定論（同一candidate.id→同一URL）・reaction記事へのフォールバック適用・優先順回帰なし・非reaction不変の4観点を実データ経由でカバー済み（ブリーフのテスト1〜4を満たす）。
- 具体的な追加テストケース:
  1. reaction(5ch)でimageUrl/本文検出なし → 決定論スプラッシュURLになる（`pickDeterministicChampionSplashUrl("e37-c1")`と一致することを直接比較）。
  2. 同一candidate.id（`e37-stable`）で2回生成しても同じURLになる。
  3. reactionでもimageUrlがあればそちらが優先（回帰なし）。
  4. reactionで本文にチャンピオン名があれば本文検出が優先（回帰なし）。
  5. 非reaction（riot/clip）はチャンピオン未検出時に従来どおりnull（回帰なし）。

## 関連ドキュメント
- [[ext-e37-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
