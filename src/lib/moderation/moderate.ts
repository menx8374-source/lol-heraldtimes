/**
 * 公開前コンテンツ安全フィルタ・モデレーション（F9）。本文＋タイトルを対象に、
 * NGワード／出典欠落／特定個人への中傷・晒し／重複を検出する。いずれかに該当すれば
 * 保留(held)＋理由を返し、公開は行わない。該当しなければ published を返し、
 * 未確定・噂レベルの表現があれば unconfirmed=true（「未確認」ラベル対象）にする。
 *
 * 判定ロジックはすべて LLM 非依存の決定論的純関数（ng-words / personal-attack / rumor / duplicate）
 * に委譲し、この関数はそれらを「公開/保留」の1つの判定に統合するだけの薄い層にする。
 */
import { findNgWord } from "@/lib/moderation/ng-words";
import { detectPersonalAttack } from "@/lib/moderation/personal-attack";
import { containsRumorMarker } from "@/lib/moderation/rumor";
import { findDuplicateArticle } from "@/lib/moderation/duplicate";
import type { SimilarityComparable } from "@/lib/collection/similarity";

export type ModerationReason = "ng_word" | "missing_source" | "personal_attack" | "duplicate";

export type ModerationInput = {
  title: string;
  bodyText: string;
  sourceCount: number;
};

export type ModerationResult =
  | { status: "held"; reason: ModerationReason; detail: string }
  | { status: "published"; unconfirmed: boolean };

export type DuplicateCheckOptions = {
  candidate: SimilarityComparable;
  existing: readonly SimilarityComparable[];
};

/**
 * duplicateCheck を渡さない場合、重複判定はスキップされる（呼び出し側が既存記事一覧を
 * 用意できない文脈でも他の判定は独立して使えるようにするため）。
 */
export function moderateArticleContent(
  input: ModerationInput,
  duplicateCheck?: DuplicateCheckOptions,
): ModerationResult {
  const combinedText = `${input.title}\n${input.bodyText}`;

  if (input.sourceCount <= 0) {
    return { status: "held", reason: "missing_source", detail: "出典リンクがありません" };
  }

  const ngWord = findNgWord(combinedText);
  if (ngWord) {
    return { status: "held", reason: "ng_word", detail: `NGワード「${ngWord}」が検出されました` };
  }

  const attack = detectPersonalAttack(combinedText);
  if (attack.detected) {
    return { status: "held", reason: "personal_attack", detail: attack.detail };
  }

  if (duplicateCheck) {
    const duplicate = findDuplicateArticle(duplicateCheck.candidate, duplicateCheck.existing);
    if (duplicate) {
      return {
        status: "held",
        reason: "duplicate",
        detail: `既存記事「${duplicate.title}」と同一話題と判定されました（重複）`,
      };
    }
  }

  return { status: "published", unconfirmed: containsRumorMarker(combinedText) };
}
