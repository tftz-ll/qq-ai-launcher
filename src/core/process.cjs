const { spawn } = require('node:child_process');
function run(exe, args, { cwd, env, onOutput = () => {}, timeout = 1800000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, env: { ...process.env, ...env }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { const s = data.toString(); tail = (tail+s).slice(-4000); onOutput(s); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(tail) : reject(new Error(timedOut ? '操作超时，请检查网络后重试。' : `子进程退出（${code}）：${tail}`)); });
  });
}
module.exports = { run };
