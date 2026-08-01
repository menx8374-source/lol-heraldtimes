/**
 * 公開可否の統合判定（admincms-S1 F3）。安全フィルタ（moderation）の結果とカテゴリの公開ポリシー
 * （自動公開/要レビュー）の2つの入力から、記事をどの状態で保存するかを決める純関数。
 * DB非依存・LLM非依存で、パイプライン（generation/pipeline.ts・generation/post-pipeline.ts）の
 * 両経路から共通で使う。
 *
 * 優先順位: 安全フィルタ不通過(held)が最優先。ポリシーより常に優先し、
 * 「自動公開」カテゴリでもNGワード等に該当する記事は公開されない（既存の保留キューへ入る）。
 */
export type PublishDecisionState = "held" | "published" | "review";

export type PublishDecisionInput = {
  /** 安全フィルタ（moderateArticleContent）が不通過だったか。true なら他の入力によらず"held"。 */
  moderationHeld: boolean;
  /** 記事カテゴリの公開ポリシーが「自動公開」か（false=要レビュー）。 */
  autoPublish: boolean;
};

/**
 * （安全フィルタ不通過, ポリシー自動公開）→held
 * （通過, 自動公開）→published
 * （通過, 要レビュー）→review
 * の3分岐（held優先のため moderationHeld=true のときは autoPublish の値に関わらず held）。
 */
export function decidePublishState(input: PublishDecisionInput): PublishDecisionState {
  if (input.moderationHeld) return "held";
  return input.autoPublish ? "published" : "review";
}
