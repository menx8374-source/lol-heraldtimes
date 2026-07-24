/**
 * 特定個人を名指しで中傷／晒す内容の検出（F9）。LLM非依存の決定論ロジック。
 *
 * 判定は2パターン:
 * 1. 「人物を指す語（名前様パターン: ◯◯選手／◯◯さん／◯◯氏／英字の固有名詞的表記）」と
 *    「攻撃語（侮辱・脅迫の語彙）」が同一文中に共起する場合 → 名指しの中傷とみなす。
 * 2. 「本名は」「住所は」等、個人情報の暴露（晒し）を示すキーワードが含まれる場合 → 晒しとみなす。
 */
import { splitIntoSentences } from "@/lib/generation/text-utils";

/** 人物名パターン: 2〜12文字の漢字/かな/カナ+敬称・役職語、または英字の固有名詞的表記。 */
const NAME_PATTERN =
  /[一-龠ぁ-んァ-ヶー]{2,12}(?:選手|コーチ|解説者|実況者|氏|さん)|[A-Z][a-zA-Z]{2,15}/;

/** 個人への侮辱・脅迫を示す攻撃語彙（NGワードより「個人への攻撃」に的を絞った語を含む）。 */
const ATTACK_WORDS = [
  "無能",
  "嘘つき",
  "八百長",
  "詐欺師",
  "くたばれ",
  "消えうせろ",
  "死ね",
  "殺す",
  "カス",
  "クズ",
  "ゴミ",
];

/** 個人情報の暴露（晒し）を示すキーワード。 */
const DOXXING_KEYWORDS = ["本名は", "住所は", "電話番号は", "勤務先は", "自宅は", "顔写真を晒"];

export type PersonalAttackResult = { detected: false } | { detected: true; detail: string };

/** text（タイトル+本文）に特定個人への名指しの中傷／晒しが含まれるか判定する。 */
export function detectPersonalAttack(text: string): PersonalAttackResult {
  for (const sentence of splitIntoSentences(text)) {
    const nameMatch = sentence.match(NAME_PATTERN)?.[0];
    const attackWord = ATTACK_WORDS.find((w) => sentence.includes(w));
    if (nameMatch && attackWord) {
      return {
        detected: true,
        detail: `個人名らしき表記「${nameMatch}」と攻撃的表現「${attackWord}」が同一文中に検出されました`,
      };
    }

    const doxxing = DOXXING_KEYWORDS.find((k) => sentence.includes(k));
    if (doxxing) {
      return {
        detected: true,
        detail: `個人情報の暴露（晒し）を示す表現「${doxxing}」が検出されました`,
      };
    }
  }
  return { detected: false };
}
