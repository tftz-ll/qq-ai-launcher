const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function readJson(file, fallback) {
  try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/,'')); }
  catch (e) {
    if (e.code === 'ENOENT' && arguments.length > 1) return fallback;
    if(e instanceof SyntaxError) throw new Error(`配置文件 ${path.basename(file)} 无法解析，已保留原文件。`);
    throw e;
  }
}

async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

async function backup(file, root) {
  try {
    const target = path.join(root, 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`, path.basename(file));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file, target);
    return target;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

async function inspectRoot(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.length > 170) throw new Error('请选择完整的本机安装路径（长度不超过 170 个字符）。');
  const root = path.resolve(input);
  if (root === path.parse(root).root || root.startsWith('\\\\')) throw new Error('请选择本机磁盘中的专用文件夹，不能使用磁盘根目录或网络共享。');
  if (process.platform === 'win32' && /[<>"|?*\x00-\x1f]|:(?!\\)/.test(root.slice(2))) throw new Error('安装路径含有 Windows 不支持的字符。');
  const protectedPaths = [process.env.WINDIR, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.USERPROFILE].filter(Boolean).map(p => path.resolve(p).toLowerCase());
  if (protectedPaths.some(p => root.toLowerCase() === p || (p !== path.resolve(process.env.USERPROFILE || '.').toLowerCase() && root.toLowerCase().startsWith(p + path.sep)))) throw new Error('请选择个人数据目录，例如 D:\\QQ-AI，避免使用系统目录。');
  let ancestor = root;
  while (true) {
    try {
      const st = await fs.lstat(ancestor);
      if (st.isSymbolicLink()) throw new Error('安装路径不能经过目录链接或联接点。');
      if (!st.isDirectory()) throw new Error('安装位置必须是文件夹。');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
  }
  const entries = await fs.readdir(root).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const manifest = await readJson(path.join(root, '.qqai-install.json'), null);
  if (entries.length && (!manifest || manifest.product !== 'qq-ai-launcher' || manifest.schema !== 1)) {
    return { root, kind: 'unmanaged', entries: entries.slice(0, 12), message: '发现已有文件。请选择新的专用目录；此版本不会覆盖或接管未知安装。' };
  }
  let existing = root;
  while (true) {
    try { await fs.access(existing); break; }
    catch (e) {
      if(e.code !== 'ENOENT') throw e;
      const parent = path.dirname(existing);
      if(parent === existing) throw new Error('所选磁盘不存在或不可访问，请重新选择安装位置。');
      existing = parent;
    }
  }
  const stat = await fs.statfs(existing);
  return { root, kind: manifest ? 'managed' : 'new', availableGB: Number(stat.bavail) * Number(stat.bsize) / 1024 ** 3, manifest };
}

async function withLock(root, task) {
  const lock = path.join(root, '.operation.lock');
  let fd;
  try { fd = await fs.open(lock, 'wx'); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = await readJson(lock);
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (err) { if (err.code === 'ESRCH') alive = false; }
    if (alive) throw new Error('此安装目录正在执行另一项操作，请等待完成。');
    await fs.unlink(lock);
    fd = await fs.open(lock, 'wx');
  }
  await fd.writeFile(JSON.stringify({ pid: process.pid }));
  try { return await task(); } finally { await fd.close(); await fs.unlink(lock); }
}

module.exports = { readJson, atomicJson, backup, inspectRoot, withLock };
