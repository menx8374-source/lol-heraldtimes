/**
 * NGワードリスト（差別語・過度な暴言等の定義済みリスト）の一元管理（F9）。
 * Sprint 5 のタイトル生成（generation/title.ts）の暫定フィルタと共通の語彙をここに集約し、
 * 二重管理（語彙のズレ）を避ける。タイトル・本文の双方の安全判定がこのリストを参照する。
 */
export const NG_WORDS = [
  "死ね",
  "殺す",
  "殺せ",
  "キモい",
  "キモッ",
  "カス",
  "クズ",
  "ゴミ",
  "バカ",
  "アホ",
  "ハゲ",
  "デブ",
  "ブス",
  "気持ち悪い",
  "消えろ",
  "うざい",
  "キチガイ",
  "池沼",
  "知恵遅れ",
  // 障害・精神疾患を侮蔑に使う差別語（拡張E29: 運用フィードバックで素通りが発覚し追加）。
  // まとめ対象の掲示板/Redditでは基本的に侮蔑目的で出現するため伏字対象にする。
  "知的障害",
  "発達障害",
  "精神障害",
  "障害者",
  "ガイジ",
  "がいじ",
  // 追加の差別語（拡張E29/E30。放送禁止用語・障害/民族差別語のうち、中立的用法がほぼ無く
  // 誤検知リスクの低いものを厳選。参考: MosasoM/inappropriate-words-ja(MITライセンス)のカテゴリ）。
  "気違い",
  "気狂い",
  "障がい者",
  "精神異常者",
  "カタワ",
  "つんぼ",
  "めくら",
  "土人",
  "ニガー",
] as const;

/**
 * NGワード照合用にテキストを正規化する（拡張E30）。NFKC正規化で半角カナ・全角/半角の表記ゆらぎを
 * 吸収し、`ｶﾞｲｼﾞ`→`ガイジ`のような回避表記も検出できるようにする（検出のみに使う純関数）。
 * ※空白挿入等の分断回避は誤検知(例「バ カメラ」)を招くため行わない。文脈依存の高度な検出は
 *   LLMモデレーションに委ねる方針。
 */
export function normalizeForNgMatch(text: string): string {
  return text.normalize("NFKC");
}

/** text にNGワードが含まれていれば最初に一致した語を返す。含まれなければ null。
 * NFKC正規化後のテキストに対して照合するため、半角カナ等の表記ゆらぎも検出する（拡張E30）。 */
export function findNgWord(text: string): string | null {
  const normalized = normalizeForNgMatch(text);
  return NG_WORDS.find((word) => normalized.includes(word)) ?? null;
}

/**
 * `findNgWord` と同じ判定だが、`exemptions`（例: LoLチャンピオン名一覧）の文字列に**完全に含まれる形**で
 * 一致したNGワードは無視する（reactqual-S3、バグ3の真因対応）。
 * 例:「グレイブス」（チャンピオン名）は「ブス」というNGワードを部分文字列として偶然含むが、
 * これは差別語ではない誤検知（false positive）であり、`exemptions`に渡すことで除外できる。
 * 一方「ゴミチャンピオン」のように、NGワードが exemptions の文字列の外側に単独で存在する場合は
 * 従来どおり検出する（exemptions文字列の出現箇所だけを無害な記号列に置換してから照合するため、
 * exemptions文字列に重ならない位置のNGワードは検出され続ける）。
 */
export function findNgWordExcluding(text: string, exemptions: readonly string[]): string | null {
  let masked = normalizeForNgMatch(text);
  for (const exemption of exemptions) {
    if (exemption.length === 0) continue;
    if (masked.includes(exemption)) {
      masked = masked.split(exemption).join("〓".repeat(exemption.length));
    }
  }
  return NG_WORDS.find((word) => masked.includes(word)) ?? null;
}

/** text からNGワードをすべて除去する（タイトル生成の具体要素穴埋め等で安全側に倒すために使う）。 */
export function stripNgWords(text: string): string {
  return NG_WORDS.reduce((acc, word) => acc.split(word).join(""), text);
}

/**
 * text 中のNGワードをすべて同じ文字数のアスタリスクに置換する（拡張E27）。
 * 削除する stripNgWords とは異なり、逐語転載の文字数・文脈を保ったまま伏字化するための関数。
 * NGワード以外の文字列は一切変更しない。
 */
export function maskNgWords(text: string): string {
  return NG_WORDS.reduce((acc, word) => acc.split(word).join("*".repeat(word.length)), text);
}
