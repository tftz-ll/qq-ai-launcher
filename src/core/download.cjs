const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform, Readable } = require('node:stream');

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(asset, file, fetcher = fetch, progress = () => {}) {
  if (!/^https:\/\//.test(asset.url) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('下载清单必须包含 HTTPS 地址与固定 SHA-256。');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try { if (await digest(file) === asset.sha256) { progress({ received: (await fsp.stat(file)).size, cached: true }); return file; } }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const temp = `${file}.part`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetcher(asset.url, { signal: AbortSignal.timeout(900000), redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`下载失败 HTTP ${response.status}`);
      if (response.url && !response.url.startsWith('https://')) throw new Error('下载被重定向到非 HTTPS 地址。');
      const total = Number(response.headers.get('content-length')) || 0;
      let received = 0; let last = 0;
      const meter = new Transform({ transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > 1024 ** 3) return callback(new Error('下载文件超过 1 GB 限制。'));
        if (Date.now()-last > 250) { last = Date.now(); progress({ received, total, attempt }); }
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(temp));
      if (await digest(temp) !== asset.sha256) throw new Error('文件校验失败，已拒绝安装。请重试或检查下载网络。');
      await fsp.rename(temp, file);
      progress({ received, total: received, attempt }); return file;
    } catch (e) { lastError = e; await fsp.rm(temp, { force: true }); if(attempt < 3) await new Promise(r => setTimeout(r, 500*attempt)); }
  }
  throw lastError;
}
module.exports = { download, digest };
