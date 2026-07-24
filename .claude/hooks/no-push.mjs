// PreToolUse(Bash) hook — リモートへの自動 push を機械的に拒否する。
//
// このフレームワークはスプリント境界でローカルコミットを積むだけで、リモートへの
// 反映（git push）は一切自動で行わない設計。誤って外部へ公開する事故を防ぐため、
// push を含む Bash コマンドを exit 2 でブロックする。push が必要なときは人間が
// 内容を確認した上で手動で実行する。
import { readHookInput } from './_stdin.mjs';

(async () => {
  try {
    const input = await readHookInput();
    const cmd = (input.tool_input && input.tool_input.command) || '';
    if (/\bgit\b[\s\S]*\bpush\b/.test(cmd)) {
      console.error(
        '自動 push は禁止されています。このフレームワークはローカルコミットのみを行い、\n' +
          'リモートへの反映は人間が内容を確認した上で手動で `git push` を実行してください。'
      );
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
})();
