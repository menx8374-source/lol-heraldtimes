/**
 * 収集アダプタのレジストリ。mock↔live の切替をここ1箇所に閉じ込める
 * （architecture.md「収集アダプタ構造」）。live 実装は本接続用の認証情報が
 * 揃い次第追加する（現時点は未実装のため、live モード指定時は明示的にエラーにする）。
 */
import type { SourceAdapter, SourceType } from "@/lib/collection/types";
import { MockSourceAdapter } from "@/lib/collection/adapters/mock";
import { getCollectionMode } from "@/lib/collection/config";

const SOURCE_TYPES: SourceType[] = ["reddit", "5ch", "riot"];

/**
 * 指定ソース種別のアダプタを返す。`mode` 省略時は `getCollectionMode()`（env `COLLECTION_MODE`）に従う。
 * live モードは本接続実装が未整備のため、呼び出すと分かりやすいエラーで失敗する
 * （API キー等が揃い次第このレジストリに live 実装を追加して差し替える）。
 */
export function getAdapter(sourceType: SourceType, mode: "mock" | "live" = getCollectionMode()): SourceAdapter {
  if (mode === "live") {
    throw new Error(
      `live収集アダプタは未実装です（sourceType=${sourceType}）。本接続の認証情報が揃い次第 adapters/index.ts に live 実装を追加してください。`,
    );
  }
  return new MockSourceAdapter(sourceType);
}

/** 全ソース種別分のアダプタをまとめて取得する。 */
export function getAllAdapters(mode: "mock" | "live" = getCollectionMode()): SourceAdapter[] {
  return SOURCE_TYPES.map((t) => getAdapter(t, mode));
}
