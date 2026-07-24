/**
 * 広告枠差し込み（F12）の設定読み込み。広告コード（AdSense等のタグ文字列）は
 * 環境変数（運営者が設定する信頼済みの値）から受け取り、枠ごとに出力する。
 * 未設定時は undefined を返し、呼び出し側（AdSlotコンポーネント）がプレースホルダーを表示する。
 *
 * セキュリティ注意: ここで返す値は「運営者が env に設定した文字列」のみを想定する。
 * 記事本文・タイトル・検索語など閲覧者由来のデータをこの経路に混ぜてはならない
 * （AdSlot は dangerouslySetInnerHTML の対象をこの関数の戻り値だけに限定する）。
 */
export type AdSlotPosition =
  | "article-top"
  | "article-in-body"
  | "article-bottom"
  | "sidebar"
  | "listing";

const ENV_KEYS: Record<AdSlotPosition, string> = {
  "article-top": "AD_SLOT_ARTICLE_TOP",
  "article-in-body": "AD_SLOT_ARTICLE_IN_BODY",
  "article-bottom": "AD_SLOT_ARTICLE_BOTTOM",
  sidebar: "AD_SLOT_SIDEBAR",
  listing: "AD_SLOT_LISTING",
};

/** 指定位置の広告タグ文字列を設定から取得する。空文字・未設定は undefined として扱う。 */
export function getAdSlotCode(position: AdSlotPosition): string | undefined {
  const raw = process.env[ENV_KEYS[position]];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}
