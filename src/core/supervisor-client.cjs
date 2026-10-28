const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

function pipeName(root) {
  const id = crypto.createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 24);
  return process.platform === 'win32' ? `\\\\.\\pipe\\qqai-${id}` : path.join(root, `.qqai-${id}.sock`);
}
function command(root, token, action, payload = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipeName(root));
    let buffer = ''; let settled = false;
    const fail = e => { if (!settled) { settled = true; socket.destroy(); reject(e); } };
    socket.setTimeout(60000, () => fail(new Error('后台服务响应超时。')));
    socket.on('error', fail);
    socket.on('connect', () => socket.write(JSON.stringify({ token, action, payload })+'\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024*1024) return fail(new Error('后台响应过大。'));
      if (!buffer.includes('\n')) return;
      try {
        const data = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))); settled = true; socket.end();
        data.ok ? resolve(data.data) : reject(new Error(data.error));
      } catch (e) { fail(e); }
    });
    socket.on('end', () => { if (!settled) fail(new Error('后台服务连接关闭。')); });
  });
}
async function ensureSupervisor(root, token) {
  try { return await command(root, token, 'status'); }
  catch (e) { if (!['ENOENT','ECONNREFUSED'].includes(e.code)) throw e; }
  const target = path.join(root,'runtime','launcher');
  for(const name of ['src/supervisor.cjs','src/core/supervisor-client.cjs','src/core/files.cjs','src/core/process.cjs','resources/astrbot-runner.py','resources/napcat-runner.cjs']) {
    const dest = path.join(target,name);
    await fsp.mkdir(path.dirname(dest),{ recursive: true });
    await fsp.copyFile(path.resolve(__dirname,'..','..',name),dest);
  }
  const executable = path.join(root,'napcat','node.exe');
  const script = path.join(target,'src','supervisor.cjs');
  const log = fs.openSync(path.join(root, 'logs', 'supervisor.log'), 'a');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  // Bootstrap secrets travel over stdin; never command-line arguments or a public HTTP port.
  const child = spawn(executable, [script], { cwd: target, detached: true, windowsHide: true, stdio: ['pipe', log, log], env });
  fs.closeSync(log);
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ root, token })); child.unref();
  let spawnError; child.on('error', e => { spawnError = e; });
  for (let i = 0; i < 40; i++) {
    if (spawnError) throw spawnError;
    await new Promise(r => setTimeout(r, 150));
    try { return await command(root, token, 'status'); } catch(e) { if(!['ENOENT','ECONNREFUSED'].includes(e.code)) throw e; }
  }
  throw new Error('后台托管服务未能启动，请查看本机诊断。');
}
module.exports = { pipeName, command, ensureSupervisor };
