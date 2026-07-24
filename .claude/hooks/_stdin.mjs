// hook 共通: stdin から Claude Code の hook 入力 JSON を読み取る小さなヘルパー。
// Claude Code は hook プロセスの stdin に JSON を流し込んで即 close するため、
// 通常は 'end' で即解決する。入力が来ない異常時に固まらないよう保険のタイマーを置く。
export function readHookInput() {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { resolve(JSON.parse(data || '{}')); }
      catch { resolve({}); }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    setTimeout(finish, 1500);
  });
}
