// Maintenance helper: stops the explicitly named managed installation, never deletes data.
const { app,safeStorage } = require('electron');
const path = require('node:path');
const { readJson } = require('../src/core/files.cjs');
const { command } = require('../src/core/supervisor-client.cjs');
app.setPath('userData',path.join(app.getPath('appData'),'qq-ai-launcher'));
app.whenReady().then(async () => {
  try {
    const argument = process.argv.find(v => v.startsWith('--stop-root='));
    if(!argument) throw new Error('An explicit installation path is required.');
    const root = path.resolve(argument.slice('--stop-root='.length));
    const location = await readJson(path.join(app.getPath('userData'),'location.json'));
    if(path.resolve(location.root).toLowerCase() !== root.toLowerCase()) throw new Error('The installation is not the registered active installation.');
    const manifest = await readJson(path.join(root,'.qqai-install.json'));
    if(manifest.product !== 'qq-ai-launcher') throw new Error('Not a managed installation.');
    const stored = await readJson(path.join(root,'.secrets.json'));
    const secrets = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(stored.encrypted,'base64'))).result);
    const result = await command(root,secrets.supervisor,'shutdown');
    console.log(JSON.stringify({ stopped: !result.astrbot.running && !result.napcat.running }));
    app.exit(0);
  } catch(e) { console.error(e.message); app.exit(1); }
});
