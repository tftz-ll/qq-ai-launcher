// Runs only against a fresh, isolated test installation in this project's directory.
const { app, net, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { install, versions } = require('../src/core/installer.cjs');
const { atomicJson, readJson } = require('../src/core/files.cjs');
const { ensureSupervisor, command } = require('../src/core/supervisor-client.cjs');
const { NativeApi } = require('../src/core/api.cjs');
const root = path.resolve(__dirname,'../.test-artifacts/安装 验证');
let stored;
let supervisor = false;
let lastPhase;
let lastOutput = 0;
async function loadSecrets() {
  const data = await readJson(path.join(root,'.secrets.json'),null);
  if(!data) return null;
  stored = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(data.encrypted,'base64'))).result);
  return stored;
}
async function saveSecrets(_,secrets) {
  stored = secrets;
  await atomicJson(path.join(root,'.secrets.json'),{ encrypted: (await safeStorage.encryptStringAsync(JSON.stringify(secrets))).toString('base64') });
}
app.setPath('userData',path.resolve(__dirname,'../.test-artifacts/electron-install-profile'));
app.whenReady().then(async () => {
  try {
    await fs.mkdir(root,{ recursive: true });
    const manifest = path.join(root,'.qqai-install.json');
    if(!await readJson(manifest,null)) await atomicJson(manifest,{ product: 'qq-ai-launcher', schema: 1, phase: 'installing', installed: {}, ports: await require('../src/core/config.cjs').allocatePorts(), versions });
    await fs.mkdir(path.join(root,'downloads'),{ recursive: true });
    for(const [name,source] of Object.entries({ uv: 'uv.zip', astrbot: 'astrbot.zip', napcat: 'napcat-runtime.zip', dashboard: 'dashboard.zip' })) await fs.copyFile(path.resolve(__dirname,'../research',source),path.join(root,'downloads',`${name}-${versions[name].version}.zip`));
    const state = await install(root,{ fetcher: (url,options) => net.fetch(url,options), loadSecrets, saveSecrets, emit: data => {
      if(data.phase !== lastPhase || Date.now()-lastOutput > 15000) { console.log(JSON.stringify({ phase: data.phase, component: data.component, detail: data.detail?.slice(0,160) })); lastPhase = data.phase; lastOutput = Date.now(); }
    } });
    console.log('REAL_INSTALL_READY');
    await loadSecrets();
    await ensureSupervisor(root,stored.supervisor);
    supervisor = true;
    const live = await command(root,stored.supervisor,'start');
    assert.ok(live.astrbot.running && live.napcat.running);
    const client = new NativeApi(state,stored);
    let astrbotReady = false; let napcatReady = false; let qq; let napcatError;
    for(let attempt=0; attempt<100; attempt++) {
      await new Promise(r => setTimeout(r,1500));
      if(!astrbotReady) try { await client.login('astrbot'); astrbotReady = true; } catch {}
      if(!napcatReady) try { qq = await client.qqStatus(); napcatReady = true; } catch(e) { napcatError = e.message; }
      if(attempt % 10 === 0) console.log(JSON.stringify({ astrbotReady, napcatReady, napcatError }));
      if(astrbotReady && napcatReady) break;
    }
    assert.ok(astrbotReady,'AstrBot authentication did not become ready');
    assert.ok(napcatReady,'NapCat authentication did not become ready');
    const dashboard = await fetch(`http://127.0.0.1:${state.ports.astrbot}/`);
    assert.ok(dashboard.ok,'AstrBot dashboard did not load');
    assert.match(await dashboard.text(),/<html/i);
    await client.persona({ name: '安装验证', persona: '这是隔离测试环境的人设。' });
    console.log(JSON.stringify({ nativeAuthentication: true, personaApi: true, qqLoggedIn: !!qq.isLogin, qqAcceptancePending: true }));
    const result = { installed: true, nativeAuthentication: true, dashboardLoaded: true, personaApi: true, chineseAndSpacePath: true, qqAcceptance: 'pending-user-scan', deepSeekAcceptance: 'pending-user-key', versions: { astrbot: versions.astrbot.version, napcat: versions.napcat.version }, root };
    await atomicJson(path.resolve(__dirname,'../.test-artifacts/installation-result.json'),result);
  } catch(e) { console.error(e.message); process.exitCode = 1; }
  finally {
    if(supervisor && stored) try { await command(root,stored.supervisor,'shutdown'); console.log('TEST_SERVICES_STOPPED'); } catch(e) { console.error(e.message); process.exitCode = 1; }
    app.exit(process.exitCode || 0);
  }
});
