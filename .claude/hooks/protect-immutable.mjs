// PreToolUse(Edit|Write) hook — 凍結ファイルの書き換えを物理的にブロックする。
//
// docs/dashboard.html は表示ロジック・デザインが固定された静的ファイルで、
// 「書き換えない」ことが運用ルールになっている。モデルが誤って編集しようとしても
// exit 2 で拒否する。ダッシュボードのデータは docs/pipeline-status.js 側を更新する。
//
// 注: この hook が塞ぐのは Edit/Write ツール経由の書き換えのみ。Bash による
// リダイレクト書き込み等までは対象外（そこまでの防御は過剰と判断）。
import { readHookInput } from './_stdin.mjs';

const FROZEN = [
  /(^|[\\/])docs[\\/]dashboard\.html$/,
];

(async () => {
  try {
    const input = await readHookInput();
    const fp = (input.tool_input && input.tool_input.file_path) || '';
    if (fp && FROZEN.some((re) => re.test(fp))) {
      console.error(
        'このファイルは凍結ファイルのため書き換えできません: ' + fp + '\n' +
          'docs/dashboard.html の表示ロジックは固定です。進捗の反映は docs/pipeline-status.js を\n' +
          'Write で上書きしてください（ダッシュボードはそれを読み込んで自動描画します）。'
      );
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
})();
