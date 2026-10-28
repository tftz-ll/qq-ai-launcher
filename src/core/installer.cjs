const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectRoot, atomicJson, readJson, withLock } = require('./files.cjs');
const { download } = require('./download.cjs');
const { extract } = require('./archive.cjs');
const { run } = require('./process.cjs');
const { allocatePorts, writeConfigurations } = require('./config.cjs');
const versions = require('../../resources/versions.json');

async function install(root, { fetcher = fetch, emit = () => {}, loadSecrets, saveSecrets }) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('此首版支持 Windows 10/11 x64。');
  const info = await inspectRoot(root);
  if (info.kind === 'unmanaged') throw new Error(info.message);
  if (info.availableGB < 3) throw new Error(`安装磁盘可用空间不足 3 GB（当前 ${info.availableGB.toFixed(1)} GB）。`);
  await fs.mkdir(root, { recursive: true });
  return withLock(root, async () => {
    const manifestFile = path.join(root, '.qqai-install.json');
    const state = await readJson(manifestFile, { product: 'qq-ai-launcher', schema: 1, phase: 'installing', installed: {}, versions, createdAt: new Date().toISOString(), ports: await allocatePorts() });
    if (state.phase === 'ready') return state;
    await atomicJson(manifestFile, state);
    let secrets = await loadSecrets(root);
    if (!secrets) {
      secrets = { astrbot: `Aa1${crypto.randomBytes(20).toString('base64url')}`, napcat: crypto.randomBytes(24).toString('hex'), onebot: crypto.randomBytes(24).toString('hex'), supervisor: crypto.randomBytes(32).toString('hex') };
      await saveSecrets(root, secrets);
    }
    try {
      for (const [index, name] of ['uv', 'astrbot', 'dashboard', 'napcat'].entries()) {
        const asset = versions[name];
        emit({ phase: 'download', component: name, step: index+1, totalSteps: 6, detail: `正在下载 ${name} ${asset.version}` });
        const archive = path.join(root, 'downloads', `${name}-${asset.version}.zip`);
        await download(asset, archive, fetcher, progress => emit({ phase: 'download', component: name, step: index+1, totalSteps: 6, ...progress }));
        if (state.installed[name] === asset.sha256) continue;
        const target = path.join(root, name === 'uv' ? 'runtime/uv' : name);
        const staging = path.join(root, `.staging-${name}`);
        // Staging contains only this installer's disposable extraction, never user data.
        await fs.rm(staging, { recursive: true, force: true });
        emit({ phase: 'extract', component: name, step: index+1, totalSteps: 6, detail: `正在校验并展开 ${name}` });
        await extract(archive, staging, asset.stripPrefix);
        try { await fs.access(target); throw new Error(`${name} 目录已存在但没有完成标记，已保留原文件，请选择新目录。`); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(staging, target);
        state.installed[name] = asset.sha256;
        await atomicJson(manifestFile, state);
      }
      const uv = path.join(root, 'runtime', 'uv', 'uv.exe');
      const env = {
        UV_CACHE_DIR: path.join(root, 'runtime', 'cache'), UV_PYTHON_INSTALL_DIR: path.join(root, 'runtime', 'python'), UV_PYTHON_BIN_DIR: path.join(root, 'runtime', 'bin'),
        UV_TOOL_DIR: path.join(root, 'runtime', 'tools'), UV_TOOL_BIN_DIR: path.join(root, 'runtime', 'bin'), UV_LINK_MODE: 'copy', UV_NO_PROGRESS: '1',
        TEMP: path.join(root, 'runtime', 'tmp'), TMP: path.join(root, 'runtime', 'tmp'),
      };
      await fs.mkdir(env.TEMP, { recursive: true });
      emit({ phase: 'python', step: 5, totalSteps: 6, detail: `正在安装独立 Python ${versions.python} 运行环境` });
      const output = text => emit({ phase: 'dependencies', detail: text.slice(-600), step: 5, totalSteps: 6 });
      await run(uv, ['python', 'install', versions.python, '--no-bin'], { cwd: root, env, onOutput: output });
      const astrbotDir = path.join(root, 'astrbot');
      const python = path.join(astrbotDir, '.venv', 'Scripts', 'python.exe');
      if (!await fs.access(python).then(() => true, () => false)) await run(uv, ['venv', '--python', versions.python, path.join(astrbotDir, '.venv')], { cwd: root, env, onOutput: output });
      // Save the resolved dependency snapshot for repeatable reinstalls and support.
      const lock = path.join(root, 'runtime', 'astrbot-requirements.lock');
      if (!await fs.access(lock).then(() => true, () => false)) await run(uv, ['pip', 'compile', 'requirements.txt', '--python', python, '--generate-hashes', '--output-file', lock], { cwd: astrbotDir, env, onOutput: output });
      await run(uv, ['pip', 'install', '--python', python, '--require-hashes', '-r', lock], { cwd: astrbotDir, env, onOutput: output });
      emit({ phase: 'configure', step: 6, totalSteps: 6, detail: '正在初始化本机凭据和消息连接' });
      await writeConfigurations(root, state, secrets, { trigger: 'mention', name: '', persona: '' });
      state.phase = 'ready'; state.completedAt = new Date().toISOString(); delete state.error;
      await atomicJson(manifestFile, state);
      emit({ phase: 'ready', step: 6, totalSteps: 6, detail: '安装完成，可以启动并扫码登录 QQ。' });
      return state;
    } catch (e) {
      state.phase = 'failed'; state.error = '安装未完成，可以重试';
      await atomicJson(manifestFile, state);
      emit({ phase: 'failed', detail: e.message }); throw e;
    }
  });
}
module.exports = { install, versions };
