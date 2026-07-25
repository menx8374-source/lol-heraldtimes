/**
 * 収集アダプタのレジストリ。mock↔live の切替をここ1箇所に閉じ込める
 * （architecture.md「収集アダプタ構造」）。live 実装は本接続用の認証情報・実装が
 * 揃ったソースから段階的にこのレジストリへ追加する（拡張E15: riotはキー不要のため実装済み。
 * reddit/5chは未実装のため、live モード指定時は明示的にエラーにする）。
 */
import type { SourceAdapter, SourceType } from "@/lib/collection/types";
import { MockSourceAdapter } from "@/lib/collection/adapters/mock";
import { RiotDataDragonAdapter } from "@/lib/collection/adapters/riot-datadragon";
import { getCollectionMode } from "@/lib/collection/config";

const SOURCE_TYPES: SourceType[] = ["reddit", "5ch", "riot"];

/** live実装が用意されているソースのみここに登録する（未登録ソースは「未実装」エラーになる）。 */
const LIVE_ADAPTER_FACTORIES: Partial<Record<SourceType, () => SourceAdapter>> = {
  riot: () => new RiotDataDragonAdapter(),
};

/**
 * 指定ソース種別のアダプタを返す。`mode` 省略時は `getCollectionMode()`（env `COLLECTION_MODE`）に従う。
 * live モードで実装済みのソース（riot）は live 実装を返す。未実装ソース（reddit/5ch）は
 * 呼び出すと分かりやすいエラーで失敗する（本接続の認証情報・実装が揃い次第 LIVE_ADAPTER_FACTORIES に追加する）。
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
 * 全ソース種別分のアダプタをまとめて取得する。live モードでは未実装ソースをエラーで
 * 全体停止させず、スキップしてログに残す（実装済みソースだけで運用を開始できるように）。
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
