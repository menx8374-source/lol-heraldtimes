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
] as const;

/** text にNGワードが含まれていれば最初に一致した語を返す。含まれなければ null。 */
export function findNgWord(text: string): string | null {
  return NG_WORDS.find((word) => text.includes(word)) ?? null;
}

/** text からNGワードをすべて除去する（タイトル生成の具体要素穴埋め等で安全側に倒すために使う）。 */
export function stripNgWords(text: string): string {
  return NG_WORDS.reduce((acc, word) => acc.split(word).join(""), text);
}
