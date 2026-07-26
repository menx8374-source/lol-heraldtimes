/**
 * チャンピオンの公式スプラッシュ画像URLに関する純粋関数群（拡張E38 F-E38-1）。
 * `@/lib/collection/adapters/http`（サーバー専用fetch）に依存しないため、クライアント
 * コンポーネント（サムネイル描画等）に安全に import できる。実ネット非依存（URL文字列の
 * 組み立てのみ）。
 *
 * `champion-thumbnail.ts` はこのモジュールの純粋関数を re-export するため、
 * `generate-article.ts` 等の既存の import 元はパス変更不要（挙動は不変）。
 */

/**
 * チャンピオンの公式スプラッシュ画像URL（1枚目, `_0`）を組み立てる。
 * 単純なURLテンプレートで、キー不要の公開CDN（拡張E20で一度削除したが本スプリントで再定義）。
 */
export function buildChampionSplashUrl(championId: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_0.jpg`;
}

/**
 * 決定論的フォールバック（拡張E37 F-E37-1、拡張E38 F-E38-3/4）用の、見栄えのする代表チャンピオン
 * ID固定プール。いずれも `_0`（1枚目）の公式スプラッシュが確実に存在するchampionId。
 */
export const CURATED_SPLASH_CHAMPION_IDS: readonly string[] = [
  "Ahri",
  "Yasuo",
  "Jinx",
  "LeeSin",
  "Lux",
  "Ezreal",
  "Zed",
  "Katarina",
  "MissFortune",
  "Thresh",
  "Garen",
  "Darius",
  "Vayne",
  "Kaisa",
  "Yone",
  "Sett",
  "Viego",
  "Jhin",
  "Akali",
  "Riven",
  "Irelia",
  "Lucian",
  "Kindred",
  "Aphelios",
];

/**
 * key（記事の安定キー。生成時は candidate.id、表示側フォールバックは slug を渡す想定）から
 * 決定論的にプール内indexを選ぶ。`Math.random`・`Date.now` は使わない（同じkeyなら常に同じ
 * indexになる）。
 */
function deterministicIndex(key: string, poolLength: number): number {
  let sum = 0;
  for (let i = 0; i < key.length; i++) {
    sum += key.charCodeAt(i);
  }
  return sum % poolLength;
}

/**
 * 反応記事（5ch/reddit）でチャンピオンが未検出/未保存のときの決定論フォールバック
 * （拡張E37 F-E37-1・拡張E38 F-E38-3/4）。key（生成時=candidate.id、表示側=slug）ごとに
 * 固定プールから1体を安定して選び、公式スプラッシュURLを返す。同じkeyなら常に同じチャンピオン、
 * 異なるkeyならプール内で分散する。実ネット非依存（URL文字列を組み立てるだけ）。
 */
export function pickDeterministicChampionSplashUrl(key: string): string {
  const index = deterministicIndex(key, CURATED_SPLASH_CHAMPION_IDS.length);
  return buildChampionSplashUrl(CURATED_SPLASH_CHAMPION_IDS[index]);
}
