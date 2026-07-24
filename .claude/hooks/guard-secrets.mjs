// PreToolUse(Bash) hook — 秘密情報の混入したコミットを機械的に拒否する。
//
// git commit 実行の直前に、ステージ済みの変更（git diff --cached）へ .env や
// 各種鍵ファイル・APIキー様の文字列が混入していないかを検査する。見つかれば
// exit 2 でコミット自体をブロックし、理由を Claude に差し戻す。
//
// 設計原則:
// - 対象は「git commit を含む Bash コマンド」だけ。それ以外の Bash は即素通し。
// - フレームワーク第一原則「補助処理は本体を止めない」に従い、hook 内部エラー
//   （git が無い・パース失敗等）では fail-open（exit 0）して本体を妨げない。
//   秘密検出はモデル側の目視確認と併用する多層防御の一枚という位置づけ。
import { execSync } from 'node:child_process';
import { readHookInput } from './_stdin.mjs';

const SECRET_FILE_PATTERNS = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]+$/, // .env.local 等はNG。.env.example のみ許可
  /\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)token\.json$/, /\.token$/,
  /(^|\/)id_rsa$/, /(^|\/)\.npmrc$/,
];

const SECRET_CONTENT_PATTERNS = [
  { name: '秘密鍵ブロック', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'AWSアクセスキーID', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'OpenAI形式のキー', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'Anthropicキー', re: /\bsk-ant-[A-Za-z0-9-]{20,}\b/ },
  { name: 'GitHubトークン', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'GoogleAPIキー', re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { name: 'Slackトークン', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
];

function isGitCommit(cmd) {
  // `git commit ...`（-m 有無問わず）を対象にする。`git commit-tree` 等の別コマンドは除外。
  return /\bgit\b[\s\S]*\bcommit\b(?!-)/.test(cmd);
}

(async () => {
  try {
    const input = await readHookInput();
    const cmd = (input.tool_input && input.tool_input.command) || '';
    if (!isGitCommit(cmd)) process.exit(0);

    let stagedFiles = '';
    let diff = '';
    try {
      stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' });
      diff = execSync('git diff --cached --unified=0', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch {
      process.exit(0); // git が使えない等 → fail-open
    }

    const problems = [];
    for (const f of stagedFiles.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (SECRET_FILE_PATTERNS.some((re) => re.test(f))) {
        problems.push('秘密ファイルがステージされています: ' + f);
      }
    }
    // 追加行(+始まり。ただし +++ ヘッダは除く)だけを対象に内容をスキャンする
    const addedText = diff
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .join('\n');
    for (const p of SECRET_CONTENT_PATTERNS) {
      if (p.re.test(addedText)) {
        problems.push('秘密情報らしき文字列が追加行に含まれます: ' + p.name);
      }
    }

    if (problems.length) {
      console.error(
        'コミットを中止しました。ステージ済みの変更に秘密情報が混入している可能性があります:\n' +
          problems.map((p) => '  - ' + p).join('\n') +
          '\n\n対応:\n' +
          '  1. `git restore --staged <file>` で該当ファイルをステージから外す\n' +
          '  2. 値は .env（.gitignore 済み）経由で読み込み、.env.example にはキー名だけを残す\n' +
          '  3. 秘密を含まない状態にしてから再コミットする\n' +
          '（明らかな誤検知の場合のみ、人手で内容を確認した上でコミットしてください）'
      );
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0); // 想定外のエラーも fail-open（本体を止めない）
  }
})();
