/**
 * 収集アダプタのレジストリ。mock↔live の切替をここ1箇所に閉じ込める
 * （architecture.md「収集アダプタ構造」）。live 実装は本接続用の認証情報・実装が
 * 揃ったソースから段階的にこのレジストリへ追加する（拡張E15: riotはキー不要のため実装済み。
 * 拡張E16: reddit はOAuth(app-only)実装済み・クレデンシャル未設定時は空配列で自動グレースフル。
 * 拡張E18: 5ch はsubject.txt/dat スクレイピングで実装済み・板無効/取得失敗時は空配列で自動
 * グレースフル。
 * 拡張E45: 「eスポーツ」単独ソース（YouTube/Twitch検索型のclipアダプタ）は質が低く削除した。
 * 反応記事内の動画埋め込み（別機能、compose.tsのdetectClipEmbedBlocks）は不変。
 * リファクタリングS7b: `riot-news`（Riot公式ニュース、RiotNewsAdapter）をlive実装として登録した。
 */
import { SOURCE_TYPES, type SourceAdapter, type SourceType } from "@/lib/collection/types";
import { MockSourceAdapter } from "@/lib/collection/adapters/mock";
import { RiotDataDragonAdapter } from "@/lib/collection/adapters/riot-datadragon";
import { RiotNewsAdapter } from "@/lib/collection/adapters/riot-news";
import { RedditAdapter } from "@/lib/collection/adapters/reddit";
import { FiveChAdapter } from "@/lib/collection/adapters/fivech";
import { getCollectionMode } from "@/lib/collection/config";

/** live実装が用意されているソースのみここに登録する（未登録ソースは「未実装」エラーになる）。 */
const LIVE_ADAPTER_FACTORIES: Partial<Record<SourceType, () => SourceAdapter>> = {
  riot: () => new RiotDataDragonAdapter(),
  reddit: () => new RedditAdapter(),
  "5ch": () => new FiveChAdapter(),
  "riot-news": () => new RiotNewsAdapter(),
};

/**
 * 指定ソース種別のアダプタを返す。`mode` 省略時は `getCollectionMode()`（env `COLLECTION_MODE`）に従う。
 * live モードでは全ソース（riot・reddit・5ch・riot-news）が live 実装を返す。
 * 将来ソースが追加され未実装のまま live 指定された場合のみ、分かりやすいエラーで失敗する。
 */
export function getAdapter(sourceType: SourceType, mode: "mock" | "live" = getCollectionMode()): SourceAdapter {
  if (mode === "live") {
    const factory = LIVE_ADAPTER_FACTORIES[sourceType];
    if (!factory) {
      throw new Error(
        `live収集アダプタは未実装です（sourceType=${sourceType}）。本接続の認証情報・実装が揃い次第 adapters/index.ts に追加してください。`,
      );
    }
    return factory();
  }
  return new MockSourceAdapter(sourceType);
}

/**
 * 全ソース種別分のアダプタをまとめて取得する。live モードでは（現状は全4ソース実装済みのため
 * 該当しないが、将来ソースが追加された場合に）未実装ソースをエラーで全体停止させず、
 * スキップしてログに残す（実装済みソースだけで運用を開始できるように）。
 * mock モードの挙動（全ソースfixture）は変えない。
 */
export function getAllAdapters(mode: "mock" | "live" = getCollectionMode()): SourceAdapter[] {
  if (mode === "mock") {
    return SOURCE_TYPES.map((t) => getAdapter(t, mode));
  }
  // 未実装ソースの「スキップ」は期待される正常フローなので、getAdapter の例外を catch する
  // 制御フローにはせず、live 実装の有無（LIVE_ADAPTER_FACTORIES）を直接判定する。
  const adapters: SourceAdapter[] = [];
  for (const sourceType of SOURCE_TYPES) {
    const factory = LIVE_ADAPTER_FACTORIES[sourceType];
    if (factory) {
      adapters.push(factory());
    } else {
      console.log(`[collection] live収集アダプタ未実装のためスキップします: sourceType=${sourceType}`);
    }
  }
  return adapters;
}
