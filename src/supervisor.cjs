const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeName } = require('./core/supervisor-client.cjs');
const { readJson } = require('./core/files.cjs');
const { run } = require('./core/process.cjs');

async function main({ root, token }) {
  const children = {};
  const lastExit = {};
  let mutation = Promise.resolve();
  const stateFile = path.join(root, '.qqai-install.json');

  function status() {
    return Object.fromEntries(['astrbot','napcat'].map(name => [name, { running: !!children[name] && children[name].exitCode === null, pid: children[name]?.pid || null, lastExit: lastExit[name] || null }]));
  }
  async function stop() {
    for (const name of ['napcat','astrbot']) {
      const child = children[name];
      if (!child || child.exitCode !== null) continue;
      if(name === 'napcat') { if(child.connected) child.send({ type: 'qqai-stop' }); }
      else child.stdin.write('stop\n');
      await new Promise(resolve => {
        if(child.exitCode !== null) return resolve();
        const timer = setTimeout(resolve,6000);
        child.once('close',() => { clearTimeout(timer); resolve(); });
      });
      // Force-stop only an unresponsive process tree still owned by this supervisor.
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000 });
        else child.kill('SIGTERM');
      }
      await new Promise((resolve, reject) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const timer = setTimeout(() => reject(new Error(`${name} 未能在规定时间内停止。`)), 5000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
      });
    }
    return status();
  }
  async function start() {
    const state = await readJson(stateFile);
    if (state.phase !== 'ready') throw new Error('请先完成安装。');
    // Detect conflicts before launching any child. Never attach to unrelated listeners.
    for (const [name, port] of Object.entries(state.ports)) {
      if ((name === 'astrbot' && children.astrbot) || (name === 'onebot' && children.astrbot) || (name === 'napcat' && children.napcat)) continue;
      await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', () => reject(new Error(`本机端口 ${port} 被其他程序占用，请关闭冲突程序后重试。`))); probe.listen(port,'127.0.0.1', () => probe.close(resolve)); });
    }
    for (const name of ['astrbot','napcat']) {
      if (children[name]) continue;
      const cwd = path.join(root,name);
      const exe = name === 'astrbot' ? path.join(cwd,'.venv','Scripts','python.exe') : path.join(cwd,'node.exe');
      const runnerName = name === 'astrbot' ? 'astrbot-runner.py' : 'napcat-runner.cjs';
      const runner = path.join(root,'runtime',runnerName);
      await fsp.copyFile(path.join(__dirname,'..','resources',runnerName),runner);
      const args = name === 'astrbot' ? ['-u',runner,path.join(cwd,'main.py'),'--webui-dir',path.join(root,'dashboard','dist')] : [runner,path.join(cwd,'index.js')];
      // Rotate logs between sessions; exported diagnostics deliberately exclude raw output.
      const logfile = path.join(root,'logs',`${name}.log`);
      try { const st = await fsp.stat(logfile); if (st.size > 5*1024**2) await fsp.rename(logfile,`${logfile}.previous`); } catch(e) { if(e.code !== 'ENOENT') throw e; }
      const fd = fs.openSync(logfile,'a');
      const env = { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', ASTRBOT_ROOT: path.join(root,'astrbot'), TEMP: path.join(root,'runtime','tmp'), TMP: path.join(root,'runtime','tmp') };
      // Avoid inheriting development overrides for a different AstrBot/NapCat installation.
      for (const key of Object.keys(env)) if (/^(?:NAPCAT_|DASHBOARD_|ASTRBOT_)/.test(key) && key !== 'ASTRBOT_ROOT') delete env[key];
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(exe,args,{ cwd, env, windowsHide: true, shell: false, stdio: name === 'napcat' ? ['ignore',fd,fd,'ipc'] : ['pipe',fd,fd] });
      child.stdin?.on('error',() => {});
      fs.closeSync(fd);
      children[name] = child;
      child.once('error', e => { lastExit[name] = { at: new Date().toISOString(), error: e.code }; if(children[name] === child) delete children[name]; });
      child.once('close', code => { lastExit[name] = { at: new Date().toISOString(), code }; if(children[name] === child) delete children[name]; });
      await new Promise((resolve, reject) => { child.once('spawn',resolve); child.once('error',reject); });
    }
    return status();
  }

  const server = net.createServer(socket => {
    socket.setTimeout(65000, () => socket.destroy());
    let input = ''; let handled = false;
    socket.on('error', () => {});
    socket.on('data', chunk => {
      if(handled) return;
      input += chunk;
      if (input.length > 16384) return socket.destroy();
      if (!input.includes('\n')) return;
      handled = true;
      const execute = async () => {
        try {
          const req = JSON.parse(input.slice(0,input.indexOf('\n')));
          const a = Buffer.from(String(req.token)); const b = Buffer.from(token);
          if(a.length !== b.length || !crypto.timingSafeEqual(a,b)) throw new Error('后台服务认证失败。');
          let data;
          if (req.action === 'status') data = status();
          else if (req.action === 'start') data = await start();
          else if (req.action === 'stop') data = await stop();
          else if (req.action === 'restart') { await stop(); data = await start(); }
          else if (req.action === 'shutdown') { await stop(); data = status(); server.close(); }
          else throw new Error('不支持的后台操作。');
          socket.end(JSON.stringify({ ok: true, data })+'\n');
        } catch (e) { socket.end(JSON.stringify({ ok: false, error: e.message })+'\n'); }
      };
      mutation = mutation.then(execute,execute);
    });
  });
  server.on('error', e => { console.error(e.code); process.exitCode = 1; });
  server.listen(pipeName(root));
}
let bootstrap = '';
process.stdin.on('data', chunk => { bootstrap += chunk; if(bootstrap.length > 16384) process.exit(1); });
process.stdin.on('end', () => { try { main(JSON.parse(bootstrap)).catch(e => { console.error(e.message); process.exit(1); }); } catch { process.exit(1); } });
