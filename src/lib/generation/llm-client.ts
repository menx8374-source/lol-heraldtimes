/**
 * LLM 呼び出し抽象（architecture.md「LLM 接続方針」）。F7(本文)・F8(タイトル、後続スプリント) は
 * 必ずこのインターフェース越しに呼ぶ。
 *
 * 今スプリントは「LLM もモック」というユーザー決定のため、API キー不要の決定論的モック実装
 * (MockLLMClient) のみを提供する。将来 Anthropic Claude 等の本接続へ差し替える際は、
 * この LLMClient を実装する別クラスを用意し `getLLMClient()` の live 分岐に追加する
 * （収集アダプタの adapters/index.ts と同じ mock/live 切替構造）。呼び出し側(compose.ts)は
 * 差し替えても変更不要。
 */
import type { SourceType } from "@/lib/collection/types";
import { gistOf } from "@/lib/generation/text-utils";

export type LLMRole = "system" | "user";
export type LLMMessage = { role: LLMRole; content: string };

export interface LLMClient {
  generate(messages: LLMMessage[]): Promise<string>;
}

/** compose.ts がモックへ渡す生成タスクの内容（テンプレート分岐のキー）。 */
export type GenerationTask =
  | { kind: "intro"; sourceType: SourceType; title: string }
  | { kind: "fact-summary"; sentence: string; index: number }
  | { kind: "context"; sourceType: SourceType; title: string }
  | { kind: "closing"; sourceType: SourceType; title: string };

function renderIntro(task: Extract<GenerationTask, { kind: "intro" }>): string {
  if (task.sourceType === "riot") {
    return `【速報】Riot Gamesは「${task.title}」に関する新たな情報を公式に発表した。この一報を受けて、日本国内外のLoLプレイヤーコミュニティでは早くも話題が広がっており、SNSや掲示板でも取り沙汰されている。`;
  }
  return `「${task.title}」というスレッドが投稿され、SNSや掲示板上で複数のユーザーから多様な反応が寄せられている。ここではその反応をまとめて要約し、要点を整理してお届けする。`;
}

function renderFactSummary(task: Extract<GenerationTask, { kind: "fact-summary" }>): string {
  return `ポイント${task.index + 1}として、公式からは「${gistOf(task.sentence)}」という趣旨の内容が正式に発表されている。詳細な条件や適用範囲については出典の公式ページで確認してほしい。`;
}

function renderContext(task: Extract<GenerationTask, { kind: "context" }>): string {
  if (task.sourceType === "riot") {
    return `今回の発表内容は今後のゲームバランスや大会展開にも影響を与える可能性があり、続報が入り次第この記事も更新される見込みだ。プレイヤーからは歓迎と懸念の両方の声が上がると見られ、引き続き公式情報を注視したい。`;
  }
  return `この話題はLoLプレイヤーの間で幅広く注目されており、今後さらに反応が広がったり、公式からの言及が入る可能性もある。元スレッドの詳細やその他のコメントについては出典を参照してほしい。`;
}

function renderClosing(task: Extract<GenerationTask, { kind: "closing" }>): string {
  if (task.sourceType === "riot") {
    return `以上、「${task.title}」に関する公式発表の内容を速報としてまとめ、要点を整理した。今後の続報や関連するパッチノートの発表にも注目していきたい。`;
  }
  return `以上、「${task.title}」というスレッドに寄せられた反応を要約してまとめた。今後の展開や追加の反応にも引き続き注目していきたい。`;
}

function renderTask(task: GenerationTask): string {
  switch (task.kind) {
    case "intro":
      return renderIntro(task);
    case "fact-summary":
      return renderFactSummary(task);
    case "context":
      return renderContext(task);
    case "closing":
      return renderClosing(task);
  }
}

/**
 * 決定論的モックLLM実装（既定）。APIキー不要。テンプレート/ルールベースで
 * 日本語のリライト文を生成する。最後の user メッセージを `GenerationTask` の JSON として解釈し、
 * タスク種別ごとに固定テンプレートへ当てはめるだけで、元本文を長く連続でコピーしない
 * （逐語コピー回避は compose.ts 側の抜粋制御と合わせて担保する）。
 */
export class MockLLMClient implements LLMClient {
  async generate(messages: LLMMessage[]): Promise<string> {
    const last = messages[messages.length - 1];
    if (!last) return "";
    let task: GenerationTask;
    try {
      task = JSON.parse(last.content) as GenerationTask;
    } catch {
      // 想定外の形式（JSONでない）の場合は空文字を返し、呼び出し側の文字数チェックで
      // 生成失敗として扱われるようにする（例外を投げて全体を止めない）。
      return "";
    }
    return renderTask(task);
  }
}

/** 生成モード。mock: 決定論的モック実装（既定）。live: 本接続（後日実装、現時点では未対応）。 */
export function getGenerationMode(): "mock" | "live" {
  return process.env.GENERATION_MODE === "live" ? "live" : "mock";
}

/**
 * 設定に応じた LLMClient を返す。`mode` 省略時は `getGenerationMode()`（env `GENERATION_MODE`）に従う。
 * live モードは本接続実装が未整備のため、呼び出すと分かりやすいエラーで失敗する
 * （`ANTHROPIC_API_KEY` 等の認証情報が揃い次第、Anthropic実装をこのファイルに追加して差し替える）。
 */
export function getLLMClient(mode: "mock" | "live" = getGenerationMode()): LLMClient {
  if (mode === "live") {
    throw new Error(
      "live LLMクライアントは未実装です。ANTHROPIC_API_KEY等の認証情報が揃い次第、Anthropic実装をllm-client.tsに追加してください。",
    );
  }
  return new MockLLMClient();
}
