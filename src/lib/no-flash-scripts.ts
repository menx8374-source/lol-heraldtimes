import { DESIGN_HEXTECH_CLASS, DESIGN_NEWS_CLASS, DESIGN_STORAGE_KEY } from "@/lib/design-mode";

/**
 * デザイン軸（拡張E14・拡張E45）の初期状態を描画前に決定し、<html> にクラスを付与するスクリプト。
 * ダークモードの NO_FLASH_THEME_SCRIPT（layout.tsx）と同じ役割・同じ制約
 * （React水和後に効かせると一瞬classicがちらつくため<head>で同期的に実行する。
 * 埋め込む値はユーザー入力を含まない固定の静的スクリプトのみ）。
 * DESIGN_STORAGE_KEY／各デザインクラスを design-mode.ts から埋め込むことで、
 * DesignToggle 側の実装とキー名・クラス名がずれないようにする。
 * 保存値が news なら design-news、hextech なら design-hextech を付与（相互排他・classicは何も付けない）。
 */
export const NO_FLASH_DESIGN_SCRIPT = `(function(){try{var d=localStorage.getItem('${DESIGN_STORAGE_KEY}');if(d==='news'){document.documentElement.classList.add('${DESIGN_NEWS_CLASS}')}else if(d==='hextech'){document.documentElement.classList.add('${DESIGN_HEXTECH_CLASS}')}}catch(e){}})();`;
