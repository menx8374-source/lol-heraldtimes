/**
 * LLM 呼び出し抽象（architecture.md「LLM 接続方針」）。F7(本文)・F8(タイトル) は
 * 必ずこのインターフェース越しに呼ぶ。
 *
 * 拡張E24でAnthropic Claude(Haiku)への本接続(AnthropicLLMClient)を追加した。
 * `GENERATION_MODE=live` かつ `ANTHROPIC_API_KEY` 設定時のみ本接続になり、未設定なら
 * 決定論的モック実装(MockLLMClient)にフォールバックする（既定は mock・無課金）。
 * 呼び出し側(compose.ts等)は `getLLMClient()` 経由で受け取るだけで差し替えの影響を受けない
 * （収集アダプタの adapters/index.ts と同じ mock/live 切替構造）。
 */
import Anthropic from "@anthropic-ai/sdk";
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
  | { kind: "closing"; sourceType: SourceType; title: string }
  | {
      kind: "reaction-select";
      title: string;
      reses: { index: number; number: number; lines: string[] }[];
    }
  | {
      /**
       * 拡張E47 F-E47-1: reddit反応記事のレスを日本語訳させるタスク。拡張E51 F-E51-1で翻訳単位を
       * 「行」から「レス（コメント）全体の全文」に変更（行を改行結合したtext）。文脈が行単位に
       * 分断されないようにし、自然な日本語訳にする。
       * 出力は `{ translations: [{ index, text: "自然な日本語訳（複数文可）" }, ...] }`（行数一致の制約は撤廃）。
       */
      kind: "reaction-translate";
      reses: { index: number; text: string }[];
    };

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

/**
 * 反応記事のレス抜粋・強調選定（拡張E25 F-E25-1）のモック応答。決定論的モックは実際の話題関連性
 * 判定を行わないため、渡された全レスの index を keep に、emphasize は空で返す
 * （＝mockモードでは compose.ts 側の正規化を経ても「全レス・強調なし」という従来どおりの結果になる）。
 */
function renderReactionSelect(task: Extract<GenerationTask, { kind: "reaction-select" }>): string {
  return JSON.stringify({ keep: task.reses.map((r) => r.index), emphasize: [] });
}

/**
 * レス翻訳タスク（拡張E47 F-E47-1）のモック応答。決定論的モックは実際の翻訳を行わないため、
 * 常に空文字を返す（＝呼び出し側の `translateReactionLines` がparse失敗として null 扱いにし、
 * reddit記事は英語原文のまま表示される。翻訳はlive時のみという設計）。
 */
function renderReactionTranslate(): string {
  return "";
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
    case "reaction-select":
      return renderReactionSelect(task);
    case "reaction-translate":
      return renderReactionTranslate();
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

/** 生成モード。mock: 決定論的モック実装（既定）。live: 本接続（ANTHROPIC_API_KEY設定時）。 */
export function getGenerationMode(): "mock" | "live" {
  return process.env.GENERATION_MODE === "live" ? "live" : "mock";
}

/** モデル既定値。コスト最小のHaiku固定（拡張E24: 月$3〜4程度の低頻度運用を想定）。 */
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

/**
 * Anthropic Claude(Haiku) への本接続実装（拡張E24 F-E24-1）。
 * APIキーは env `ANTHROPIC_API_KEY`（SDKの既定解決に任せる。ハードコードしない）。
 * API呼び出しはtry/catchで囲み、失敗・タイムアウト時は例外を投げず空文字を返す
 * （本体を止めない原則。呼び出し側＝title.tsのgenerateHookTitleLLM等がルールベースに
 * フォールバックできるようにする）。
 */
export class AnthropicLLMClient implements LLMClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor() {
    // 引数なしの new Anthropic() は SDK が ANTHROPIC_API_KEY を自動解決する。
    this.client = new Anthropic();
    this.model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
  }

  async generate(messages: LLMMessage[]): Promise<string> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const user = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n\n");
    if (user.trim().length === 0) return "";

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        ...(system.length > 0 ? { system } : {}),
        messages: [{ role: "user", content: user }],
      });
      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
    } catch (error) {
      console.error(
        "[AnthropicLLMClient] API呼び出しに失敗しました。呼び出し側のフォールバック処理に委ねます。",
        error,
      );
      return "";
    }
  }
}

let mockFallbackNotified = false;

/**
 * 設定に応じた LLMClient を返す。`mode` 省略時は `getGenerationMode()`（env `GENERATION_MODE`）に従う。
 * live モードでも `ANTHROPIC_API_KEY` が未設定なら MockLLMClient にフォールバックする
 * （例外を投げない。未課金・未設定でも本体を止めない）。フォールバック発生を1回だけログに残す。
 */
export function getLLMClient(mode: "mock" | "live" = getGenerationMode()): LLMClient {
  if (mode === "live") {
    if (process.env.ANTHROPIC_API_KEY) {
      return new AnthropicLLMClient();
    }
    if (!mockFallbackNotified) {
      console.log(
        "[getLLMClient] GENERATION_MODE=live ですが ANTHROPIC_API_KEY が未設定のため MockLLMClient にフォールバックします。",
      );
      mockFallbackNotified = true;
    }
    return new MockLLMClient();
  }
  return new MockLLMClient();
}
