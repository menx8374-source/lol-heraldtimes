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
  | "listing"
  // 以下、拡張E5（収益化拡充）で追加した広告枠の種類。
  | "sidebar-sticky" // PCサイドバーで追従(sticky)表示する広告枠
  | "anchor" // 画面下部固定・閉じるボタン付きのアンカー広告枠(主にモバイル)
  | "matched-content"; // 記事末尾の関連コンテンツ(マッチドコンテンツ)枠

const ENV_KEYS: Record<AdSlotPosition, string> = {
  "article-top": "AD_SLOT_ARTICLE_TOP",
  "article-in-body": "AD_SLOT_ARTICLE_IN_BODY",
  "article-bottom": "AD_SLOT_ARTICLE_BOTTOM",
  sidebar: "AD_SLOT_SIDEBAR",
  listing: "AD_SLOT_LISTING",
  "sidebar-sticky": "AD_SLOT_SIDEBAR_STICKY",
  anchor: "AD_SLOT_ANCHOR",
  "matched-content": "AD_SLOT_MATCHED_CONTENT",
};

/** テスト・呼び出し側から全position一覧を参照するための配列（ENV_KEYSのキーと同一集合）。 */
export const AD_SLOT_POSITIONS = Object.keys(ENV_KEYS) as AdSlotPosition[];

/** 指定位置の広告タグ文字列を設定から取得する。空文字・未設定は undefined として扱う。 */
export function getAdSlotCode(position: AdSlotPosition): string | undefined {
  const raw = process.env[ENV_KEYS[position]];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}
