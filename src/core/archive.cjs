const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');

// Reject traversal, symlinks, NTFS streams and Windows filename aliases before writing.
function safeEntry(root, name) {
  if (name.includes('\\') || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.' || /[:<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p))) throw new Error(`不安全的压缩包路径：${name}`);
  const dest = path.resolve(root, name);
  if (dest !== root && !dest.startsWith(root + path.sep)) throw new Error('压缩包路径越界。');
  return dest;
}
async function extract(zipFile, dest, stripPrefix = '') {
  await fsp.mkdir(dest, { recursive: true });
  dest = path.resolve(dest);
  await new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(err);
      let total = 0; let count = 0;
      const fail = e => { zip.close(); reject(e); };
      zip.on('error', fail); zip.on('end', resolve);
      zip.on('entry', async entry => {
        try {
          if (++count > 80000 || (total += entry.uncompressedSize) > 3 * 1024 ** 3) throw new Error('压缩包展开大小超出限制。');
          if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error('压缩包包含目录链接。');
          const original = entry.fileName;
          safeEntry(dest, original);
          if (stripPrefix && !original.startsWith(stripPrefix)) throw new Error('压缩包结构与固定版本不符。');
          const name = original.slice(stripPrefix.length);
          if (!name) { zip.readEntry(); return; }
          const target = safeEntry(dest, name);
          // Every ancestor must be a real directory even on resumed extraction.
          let parent = target;
          while (parent.startsWith(dest)) {
            try { if ((await fsp.lstat(parent)).isSymbolicLink()) throw new Error('解压目标包含目录链接。'); }
            catch (e) { if (e.code !== 'ENOENT') throw e; }
            if (parent === dest) break; parent = path.dirname(parent);
          }
          if (name.endsWith('/')) await fsp.mkdir(target, { recursive: true });
          else {
            await fsp.mkdir(path.dirname(target), { recursive: true });
            const stream = await new Promise((res, rej) => zip.openReadStream(entry, (e, s) => e ? rej(e) : res(s)));
            await pipeline(stream, fs.createWriteStream(target, { flags: 'wx' }));
          }
          zip.readEntry();
        } catch (e) { fail(e); }
      });
      zip.readEntry();
    });
  });
}
module.exports = { extract, safeEntry };
