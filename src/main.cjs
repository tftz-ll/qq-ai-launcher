const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, net, nativeImage, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { atomicJson, readJson, inspectRoot, backup, withLock } = require('./core/files.cjs');
const { install, versions } = require('./core/installer.cjs');
const { NativeApi, testDeepSeek } = require('./core/api.cjs');
const { command, ensureSupervisor } = require('./core/supervisor-client.cjs');
const { redact } = require('./core/redact.cjs');
const { run } = require('./core/process.cjs');
const { DEFAULTS, normalizeSettings, validateSettings, patchQzone, validateQzoneOperation } = require('./core/preferences.cjs');
const { download } = require('./core/download.cjs');
const integrations = require('../resources/integrations.json');
const { prepareQzoneDependencies } = require('./core/integrations.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'qqai-media', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let window;
let root;
let suggestedRoot;
let busy = false;
let progress = null;
let lastError = null;
let native;
let connectionApplied = false;
let knownSecrets = [];
let copiedCredential = null;
let quitting = false;
let closing = false;
let rememberedQQ = false;
const defaults = DEFAULTS;
const fetcher = (url, options = {}) => net.fetch(url, options);
const userDataSwitch = app.commandLine.getSwitchValue('user-data-dir');
if(userDataSwitch) app.setPath('userData',path.resolve(userDataSwitch));
// Keep automated development checks separate from the user's real app profile.
if(!app.isPackaged && process.env.QQAI_TEST_PROFILE) app.setPath('userData',path.resolve(process.env.QQAI_TEST_PROFILE));

async function loadSecrets(dir = root) {
  const data = await readJson(path.join(dir, '.secrets.json'), null);
  if(!data) return null;
  if(!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows 凭据加密不可用。');
  let secrets;
  try { secrets = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(data.encrypted,'base64'))).result); }
  catch { throw new Error('无法解密本机凭据。请使用创建此安装的 Windows 用户，并保留原应用数据配置。'); }
  knownSecrets = Object.values(secrets);
  return secrets;
}
async function saveSecrets(dir, secrets) {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows 凭据加密不可用，无法安全保存密钥。');
  await atomicJson(path.join(dir,'.secrets.json'), { storage: 'Windows DPAPI', encrypted: (await safeStorage.encryptStringAsync(JSON.stringify(secrets))).toString('base64') });
  knownSecrets = Object.values(secrets);
}
async function settings() { return normalizeSettings(root ? await readJson(path.join(root, 'launcher-settings.json'), {}) : {}); }
async function state() { return root ? readJson(path.join(root,'.qqai-install.json'),null) : null; }
async function api() {
  if (!native) native = new NativeApi(await state(), await loadSecrets(), fetcher);
  return native;
}
function emit(value) { if(window && !window.isDestroyed()) window.webContents.send('progress',value); }
async function exclusive(task) {
  if(busy) throw new Error('另一项操作正在进行，请等待完成。');
  busy = true;
  try { lastError = null; return await task(); }
  catch(e) { lastError = redact(e.message,knownSecrets); throw new Error(lastError); }
  finally { busy = false; }
}
async function requireReady() { const st = await state(); if(st?.phase !== 'ready') throw new Error('请先完成安装。'); return st; }
async function services() {
  const secrets = await loadSecrets();
  if(!secrets) return null;
  try { return await command(root,secrets.supervisor,'status'); }
  catch(e) { if(['ENOENT','ECONNREFUSED'].includes(e.code)) return null; throw e; }
}

async function snapshot() {
  const st = root ? await state() : null;
  const prefs = await settings();
  let secrets = null; let credentialError = null;
  if(root) try { secrets = await loadSecrets(); } catch(e) { credentialError = e.message; }
  const result = { root, suggestedRoot, busy, progress, lastError, credentialError, settings: prefs, installed: st?.phase === 'ready', installPhase: st?.phase || 'new', versions, hasKey: !!secrets?.apiKey, modelTest: st?.modelTest || null, modelApplied: !!st?.modelApplied, personaApplied: !!st?.personaApplied, services: null, qq: null, onebot: 'unknown', astrbotReady: false };
  result.appearance = await readJson(path.join(app.getPath('userData'),'appearance.json'),{ accent: 'sakura', background: '', avatar: '', opacity: 0.88, blur: 4 });
  result.chainVerified = st?.chainVerifiedAt || null;
  result.qzoneInstalled = root ? await fs.access(path.join(root,'astrbot','data','plugins','astrbot_plugin_qzone')).then(() => true,() => false) : false;
  if(credentialError) return result;
  if (!result.installed) return result;
  result.services = await services();
  if (!result.services) return result;
  const client = await api();
  const checks = await Promise.allSettled([
    result.services.napcat?.running ? client.qqStatus() : Promise.resolve(null),
    result.services.astrbot?.running ? client.request('astrbot','/api/platform/stats',undefined,'GET') : Promise.resolve(null),
  ]);
  if(checks[0].status === 'fulfilled') result.qq = checks[0].value;
  else result.napcatError = redact(checks[0].reason.message,knownSecrets);
  result.astrbotReady = checks[1].status === 'fulfilled' && !!checks[1].value;
  if(result.qzoneInstalled && result.astrbotReady && !busy) {
    const loaded = await client.request('astrbot','/api/config/get?plugin_name=astrbot_plugin_qzone',undefined,'GET').catch(() => null);
    result.qzoneInstalled = !!loaded?.config;
    result.qzoneLoadFailed = !result.qzoneInstalled;
  }
  if (result.qq?.isLogin && result.astrbotReady && !connectionApplied && !busy) {
    try { await exclusive(async () => { await client.connect(root); connectionApplied = true; if(!rememberedQQ) { await client.rememberQQ(); rememberedQQ = true; } }); }
    catch(e) { result.connectionError = redact(e.message,knownSecrets); }
  }
  // A listening port alone is never reported as an established message connection.
  if(result.services.astrbot?.running && result.services.napcat?.running && result.qq?.isLogin) {
    try {
      const table = await run('netstat.exe',['-ano','-p','tcp'],{ timeout: 4000 });
      const endpoint = `127.0.0.1:${st.ports.onebot}`;
      result.onebot = table.split(/\r?\n/).some(line => { const cols = line.trim().split(/\s+/); return (cols[1] === endpoint || cols[2] === endpoint) && cols[3] === 'ESTABLISHED'; }) ? 'tcp-connected' : 'waiting';
    } catch { result.onebot = 'unknown'; }
  }
  if(result.qq) { delete result.qq.qrcodeurl; delete result.qq.loginError; }
  return result;
}

async function importImage() {
  const chosen = await dialog.showOpenDialog(window,{ title: '选择自己的图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png','jpg','jpeg','webp'] }] });
  if(chosen.canceled) return null;
  const file = chosen.filePaths[0];
  if((await fs.stat(file)).size > 12*1024**2) throw new Error('请选择不超过 12 MB 的图片。');
  const decoded = nativeImage.createFromBuffer(await fs.readFile(file));
  const size = decoded.getSize();
  if(decoded.isEmpty() || size.width*size.height > 40000000) throw new Error('图片无法读取或尺寸过大。');
  const image = size.width > 2560 || size.height > 2560 ? decoded.resize(size.width > size.height ? { width: 2560 } : { height: 2560 }) : decoded;
  const bytes = image.toPNG();
  const id = crypto.createHash('sha256').update(bytes).digest('hex')+'.png';
  const dir = path.join(app.getPath('userData'),'media'); await fs.mkdir(dir,{ recursive: true });
  await fs.writeFile(path.join(dir,id),bytes);
  return id;
}
async function configureQzone(client, prefs) {
  const current = await client.request('astrbot','/api/config/get?plugin_name=astrbot_plugin_qzone',undefined,'GET');
  if(!current?.config) { if(prefs.enable) throw new Error('请先安装 QQ 空间插件，再开启空间功能。'); return; }
  await atomicJson(path.join(root,'backups',`qzone-${Date.now()}.json`),current.config);
  await client.request('astrbot','/api/config/plugin/update?plugin_name=astrbot_plugin_qzone',patchQzone(current.config,prefs));
  await client.request('astrbot',prefs.enable ? '/api/plugin/on' : '/api/plugin/off',{ name: 'astrbot_plugin_qzone' });
}
async function shutdown() {
  const live = root ? await services() : null;
  if(live) await command(root,(await loadSecrets()).supervisor,'shutdown');
  native = null; connectionApplied = false;
}

const handlers = {
  snapshot,
  pickFolder: async () => {
    const selected = await dialog.showOpenDialog(window, { title: '选择 QQ AI 的安装位置', defaultPath: root || suggestedRoot, properties: ['openDirectory','createDirectory'] });
    if(selected.canceled) return null;
    const chosen = selected.filePaths[0];
    const info = await inspectRoot(chosen);
    return info.kind === 'unmanaged' ? path.join(chosen,'QQ-AI') : chosen;
  },
  inspect: input => inspectRoot(input),
  install: input => exclusive(async () => {
    const info = await inspectRoot(input);
    if(info.kind === 'unmanaged') throw new Error(info.message);
    const running = root && await services();
    if(root && path.resolve(input).toLowerCase() !== root.toLowerCase() && Object.values(running || {}).some(s => s.running)) throw new Error('请先停止当前机器人，再切换安装目录。');
    root = info.root; native = null; connectionApplied = false;
    await atomicJson(path.join(app.getPath('userData'),'location.json'), { root });
    return install(root,{ fetcher, loadSecrets, saveSecrets, emit: value => { progress = redact(value, knownSecrets); emit(progress); } });
  }),
  start: () => exclusive(async () => {
    await requireReady(); const secrets = await loadSecrets();
    if(await fs.access(path.join(root,'astrbot','data','plugins','astrbot_plugin_qzone','metadata.yaml')).then(() => true,() => false)) await prepareQzoneDependencies(root);
    await ensureSupervisor(root,secrets.supervisor);
    native = null; connectionApplied = false;
    return command(root,secrets.supervisor,'start');
  }),
  stop: () => exclusive(shutdown),
  exit: () => exclusive(async () => { await shutdown(); quitting = true; setImmediate(() => app.quit()); return true; }),
  hide: () => { quitting = true; app.quit(); return true; },
  appearance: async input => {
    const current = await readJson(path.join(app.getPath('userData'),'appearance.json'),{ accent: 'sakura', opacity: 0.88, blur: 4 });
    const value = { ...current };
    if(input?.upload) {
      if(!['background','avatar'].includes(input.upload)) throw new Error('图片用途无效。');
      const id = await importImage(); if(!id) return current; value[input.upload] = id;
    } else {
      if(!['sakura','ocean','night'].includes(input?.accent)) throw new Error('主题无效。');
      value.accent = input.accent; value.opacity = Math.max(0.5,Math.min(1,Number(input.opacity)||0.88)); value.blur = Math.max(0,Math.min(16,Number(input.blur)||0));
      for(const key of ['background','avatar']) if(input[key] === '') value[key] = '';
    }
    await atomicJson(path.join(app.getPath('userData'),'appearance.json'),value); return value;
  },
  verifyChain: () => exclusive(async () => { const snap = await snapshot(); if(!snap.qq?.isLogin || snap.onebot !== 'tcp-connected' || !snap.modelApplied) throw new Error('请先完成 QQ 登录、模型应用和消息连接，再确认收到回复。'); const st = await state(); st.chainVerifiedAt = new Date().toISOString(); await atomicJson(path.join(root,'.qqai-install.json'),st); return true; }),
  reconnect: () => exclusive(async () => {
    await requireReady();
    const client = await api();
    const qq = await client.qqStatus();
    if(!qq.isLogin) throw new Error('请先在 QQ 登录页面扫码登录。');
    await client.connect(root); connectionApplied = true;
  }),
  testModel: key => exclusive(async () => {
    const st = await requireReady(); const prefs = await settings(); const secrets = await loadSecrets();
    const candidate = typeof key === 'string' && key.trim() ? key.trim() : secrets.apiKey;
    if(candidate) knownSecrets.push(candidate);
    const test = await testDeepSeek(candidate,prefs.model,fetcher);
    secrets.apiKey = candidate;
    await saveSecrets(root,secrets);
    if(native) native.secrets = secrets;
    st.modelTest = test;
    st.modelApplied = false;
    await atomicJson(path.join(root,'.qqai-install.json'),st);
    return test;
  }),
  saveSettings: input => exclusive(async () => {
    const prefs = validateSettings(input);
    const st = await requireReady();
    const live = await services();
    const secrets = await loadSecrets();
    if(live?.astrbot?.running) {
      const client = await api();
      await configureQzone(client,prefs.qzone);
      await client.applySettings(root,prefs); st.personaApplied = true;
    } else throw new Error('请先启动 AstrBot，等待就绪后应用角色与模型设置。');
    await withLock(root, async () => {
      await backup(path.join(root,'launcher-settings.json'),root);
      await atomicJson(path.join(root,'launcher-settings.json'),prefs);
      if(st.modelTest?.model !== prefs.model) delete st.modelTest;
      st.modelApplied = !!secrets.apiKey;
      delete st.chainVerifiedAt;
      await atomicJson(path.join(root,'.qqai-install.json'),st);
    });
    return { restarted: false };
  }),
  installQzone: () => exclusive(async () => {
    await requireReady();
    const client = await api(); await client.login('astrbot');
    const current = await client.request('astrbot','/api/config/get?plugin_name=astrbot_plugin_qzone',undefined,'GET');
    if(current?.config) { if(!(await settings()).qzone.enable) await client.request('astrbot','/api/plugin/off',{name:'astrbot_plugin_qzone'}); return { installed: true }; }
    const conf = path.join(root,'astrbot','data','config','astrbot_plugin_qzone_config.json');
    if(!await readJson(conf,null)) await atomicJson(conf,{ trigger: { publish_cron: '', comment_cron: '', read_prob: 0, like_when_comment: false } });
    const file = path.join(root,'downloads',`qzone-${integrations.qzone.commit}.zip`);
    await download(integrations.qzone,file,fetcher,() => {});
    await prepareQzoneDependencies(root);
    if(await fs.access(path.join(root,'astrbot','data','plugins','astrbot_plugin_qzone','metadata.yaml')).then(() => true,() => false)) await client.request('astrbot','/api/plugin/reload-failed',{dir_name:'astrbot_plugin_qzone'});
    else await client.installPluginZip(file);
    const loaded = await client.request('astrbot','/api/config/get?plugin_name=astrbot_plugin_qzone',undefined,'GET');
    if(!loaded?.config) throw new Error('空间插件文件已保留，但未能加载。请查看原生插件面板中的失败原因，再重试。');
    await client.request('astrbot','/api/plugin/off',{ name: 'astrbot_plugin_qzone' });
    return { installed: true };
  }),
  qzoneStatus: async () => {
    const client = await api();
    const conf = await client.request('astrbot','/api/config/get?plugin_name=astrbot_plugin_qzone',undefined,'GET');
    if(!conf?.config) return { installed: false };
    const prefs = await settings(); if(!prefs.qzone.enable) return { installed: true, enabled: false };
    const result = await client.request('astrbot','/api/plug/astrbot_plugin_qzone/page/status',undefined,'GET');
    return { installed: true, enabled: true, bound: !!result?.login?.bound };
  },
  qzoneAction: input => exclusive(async () => {
    const prefs = await settings();
    const {action,body,image} = validateQzoneOperation(prefs.qzone,input);
    if(image) {
      const bytes = await fs.readFile(path.join(app.getPath('userData'),'media',image));
      body.media = [{ source: 'base64://'+bytes.toString('base64') }];
    }
    const route = '/api/plug/astrbot_plugin_qzone/page/'+action+(action === 'feed' ? '?scope=self&limit=10' : action === 'detail' ? '?id='+encodeURIComponent(body.id) : '');
    return (await api()).request('astrbot',route,body,['feed','detail'].includes(action) ? 'GET' : 'POST');
  }),
  pickQzoneImage: importImage,
  openPanel: async component => {
    const st = await requireReady();
    if(!['astrbot','napcat'].includes(component)) throw new Error('无效的管理面板。');
    await shell.openExternal(`http://127.0.0.1:${st.ports[component]}${component === 'napcat' ? '/webui' : ''}`);
  },
  copyCredential: async component => {
    if(!['astrbot','napcat'].includes(component)) throw new Error('无效凭据类型。');
    const secrets = await loadSecrets();
    if(!secrets) throw new Error('请先安装。');
    clipboard.writeText(secrets[component]);
    copiedCredential = secrets[component];
    setTimeout(() => { if(clipboard.readText() === secrets[component]) clipboard.clear(); if(copiedCredential === secrets[component]) copiedCredential = null; },60000).unref();
    return { username: component === 'astrbot' ? 'astrbot' : undefined };
  },
  exportDiagnostic: async () => {
    const st = await state();
    const report = { product: 'QQ AI 小屋', appVersion: app.getVersion(), platform: `${process.platform}/${process.arch}`, time: new Date().toISOString(), versions: Object.fromEntries(['astrbot','napcat','uv'].map(n => [n,versions[n].version])), installPhase: st?.phase || 'new', installedComponents: Object.keys(st?.installed || {}), services: root ? await services() : null, modelTest: st?.modelTest || null, lastErrorCode: lastError ? 'OPERATION_FAILED' : null, note: '仅导出运行元数据。聊天内容、原始日志、配置、密钥、账号、路径和人设均不包含在此文件中。' };
    const selected = await dialog.showSaveDialog(window,{ title: '导出诊断信息', defaultPath: path.join(root || app.getPath('documents'),`QQ-AI-诊断-${Date.now()}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if(selected.canceled) return null;
    await atomicJson(selected.filePath,report);
    return selected.filePath;
  },
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',() => { if(window) { if(window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    protocol.handle('qqai-media',request => {
      const url = new URL(request.url);
      const id = url.pathname.slice(1);
      if(url.host !== 'asset' || !/^[a-f0-9]{64}\.png$/.test(id)) return new Response('',{ status: 404 });
      return net.fetch(pathToFileURL(path.join(app.getPath('userData'),'media',id)).href);
    });
    const location = await readJson(path.join(app.getPath('userData'),'location.json'),null);
    root = location?.root || null;
    suggestedRoot = await fs.access('D:\\').then(() => 'D:\\QQ-AI',() => path.join(app.getPath('documents'),'QQ-AI'));
    window = new BrowserWindow({ width: 1420, height: 940, minWidth: 1040, minHeight: 740, backgroundColor: '#fcf7fb', title: 'QQ AI 小屋 · 我的角色', icon: path.join(__dirname,'..','resources','app.ico'), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname,'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate',event => event.preventDefault());
    ipcMain.handle('action',async (event,name,input) => {
      if(event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || fileURLToPath(event.senderFrame.url) !== path.join(__dirname,'ui','index.html')) throw new Error('来源无效。');
      if(!Object.hasOwn(handlers,name)) throw new Error('未知操作。');
      try { return { ok: true, data: await handlers[name](input) }; }
      catch(e) { return { ok: false, error: redact(e.message,knownSecrets) }; }
    });
    await window.loadFile(path.join(__dirname,'ui','index.html'));
    window.on('close',async event => {
      if(busy) { event.preventDefault(); dialog.showMessageBox(window,{ type: 'info', message: '当前操作正在进行，请等待完成后关闭窗口。' }); }
      else if(!quitting) {
        event.preventDefault(); if(closing) return; closing = true;
        try {
          const choice = await dialog.showMessageBox(window,{ type: 'question', title: '如何离开小屋？', message: '选择停止并退出，或只关闭面板', detail: '停止并退出会结束机器人和托管进程。仅关闭面板会继续运行机器人，之后可重新打开小屋管理。', buttons: ['停止机器人并彻底退出','仅关闭面板，后台继续运行','取消'], defaultId: 0, cancelId: 2 });
          if(choice.response === 0) { await exclusive(shutdown); quitting = true; app.quit(); }
          else if(choice.response === 1) { quitting = true; app.quit(); }
        } catch(e) { dialog.showErrorBox('退出未完成',redact(e.message,knownSecrets)); }
        finally { closing = false; }
      }
    });
    window.on('closed',() => { window = null; });
  }).catch(e => { dialog.showErrorBox('启动失败',redact(e.message,knownSecrets)); app.quit(); });
  app.on('window-all-closed',() => app.quit());
  app.on('before-quit',() => { if(copiedCredential && clipboard.readText() === copiedCredential) clipboard.clear(); });
}
