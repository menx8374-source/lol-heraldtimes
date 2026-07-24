// PostToolUse(Edit|Write) hook — 変更したファイルを軽量に自動フォーマットする。
//
// 設計方針（フレームワーク第一原則「補助処理は本体を絶対に止めない」を厳守）:
// - prettier がプロジェクトにローカルインストール済みのときだけ動く（--no-install）。
//   未導入なら何もしない。ネットワークからの自動ダウンロードは行わない。
// - 対象は編集された単一ファイルのみ。プロジェクト全体は走査しない（高速維持）。
// - lint / typecheck のような重く時間のかかる検査はここでは行わない。それらは
//   generator の自己確認と、evaluator / 品質ゲート（/code-review 等）に任せる。
// - いかなる失敗・エラーも握り潰し、常に exit 0（Edit/Write の結果を妨げない）。
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readHookInput } from './_stdin.mjs';

const FORMATTABLE = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'json', 'jsonc', 'css', 'scss', 'less',
  'html', 'md', 'mdx', 'yaml', 'yml', 'vue', 'svelte',
]);

(async () => {
  try {
    const input = await readHookInput();
    const fp = (input.tool_input && input.tool_input.file_path) || '';
    if (!fp) process.exit(0);

    const ext = fp.split('.').pop().toLowerCase();
    if (!FORMATTABLE.has(ext)) process.exit(0);

    // prettier がローカルに無ければ何もしない（グローバル取得やDLはしない）
    const hasPrettier =
      existsSync('node_modules/.bin/prettier') ||
      existsSync('node_modules/.bin/prettier.cmd') ||
      existsSync('node_modules/prettier');
    if (!hasPrettier) process.exit(0);

    try {
      execSync('npx --no-install prettier --write "' + fp + '"', {
        stdio: 'ignore',
        timeout: 15000,
      });
    } catch {
      // フォーマット失敗（設定不備・対象外等）は無視して本体を優先する
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
})();
