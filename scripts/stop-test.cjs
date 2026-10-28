const { app,safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { command } = require('../src/core/supervisor-client.cjs');
app.setPath('userData',path.resolve(__dirname,'../.test-artifacts/electron-install-profile'));
app.whenReady().then(async () => {
  try {
    const root = path.resolve(__dirname,'../.test-artifacts/安装 验证');
    const data = JSON.parse(await fs.readFile(path.join(root,'.secrets.json'),'utf8'));
    const secret = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(data.encrypted,'base64'))).result);
    const action = process.argv.includes('status') ? 'status' : 'shutdown';
    const result = await command(root,secret.supervisor,action);
    console.log(JSON.stringify({ action, result }));
  } catch(e) { if(e.code !== 'ENOENT') { console.error(e.message); process.exitCode = 1; } }
  app.exit(process.exitCode || 0);
});
