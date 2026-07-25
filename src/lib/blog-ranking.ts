/**
 * ブログランキング/外部集客枠（拡張E4）の設定読み込み。にほんブログ村等の外部ランキングの
 * バナー/リンクHTMLは環境変数（運営者が設定する信頼済みの値）から受け取る。未設定時は
 * undefined を返し、呼び出し側（BlogRankingSlotコンポーネント）がプレースホルダーを表示する。
 * 方式は広告枠（lib/ads/config.ts）に倣う。
 *
 * セキュリティ注意: ここで返す値は「運営者が env に設定した文字列」のみを想定する。
 * 記事本文・タイトル・検索語等、閲覧者由来のデータをこの経路に混ぜてはならない
 * （BlogRankingSlot は dangerouslySetInnerHTML の対象をこの関数の戻り値だけに限定する）。
 */
export function getBlogRankingHtml(): string | undefined {
  const raw = process.env.BLOG_RANKING_HTML;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}
