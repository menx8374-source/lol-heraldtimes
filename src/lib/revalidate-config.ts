/**
 * 一覧ページの自動更新（revalidate-S1）: A＝短いISR（保険）の秒数。
 * 自動公開は主にB（`/api/revalidate` へのオンデマンド再検証、pipeline公開後に即時実行）で
 * 一覧に反映されるが、Bが未設定/失敗した場合でも最悪この秒数で新着が反映されるようにする。
 *
 * 注意: Next.js の `export const revalidate` はビルド時の静的AST解析で値を読み取るため、
 * **インポートした変数を参照する形では書けない**（`export const revalidate = LISTING_REVALIDATE_SECONDS;`
 * はビルド失敗になる。Next.js公式仕様上の制約）。そのため各一覧page.tsxには本定数と同じ値の
 * **数値リテラル**を直接書く（`export const revalidate = 300; // = LISTING_REVALIDATE_SECONDS`）。
 * この定数はテスト・ドキュメント上の単一の真実源として保持し、値を変える場合は全ページの
 * リテラルも合わせて変更すること。
 */
export const LISTING_REVALIDATE_SECONDS = 300;
