import { DESIGN_CLASS, DESIGN_STORAGE_KEY } from "@/lib/design-mode";

/**
 * デザイン軸（拡張E14）の初期状態を描画前に決定し、<html> にクラスを付与するスクリプト。
 * ダークモードの NO_FLASH_THEME_SCRIPT（layout.tsx）と同じ役割・同じ制約
 * （React水和後に効かせると一瞬classicがちらつくため<head>で同期的に実行する。
 * 埋め込む値はユーザー入力を含まない固定の静的スクリプトのみ）。
 * DESIGN_STORAGE_KEY/DESIGN_CLASS を design-mode.ts から埋め込むことで、
 * DesignToggle 側の実装とキー名・クラス名がずれないようにする。
 */
export const NO_FLASH_DESIGN_SCRIPT = `(function(){try{var d=localStorage.getItem('${DESIGN_STORAGE_KEY}');if(d==='news'){document.documentElement.classList.add('${DESIGN_CLASS}')}}catch(e){}})();`;
