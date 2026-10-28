const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { inspectRoot, atomicJson, readJson, withLock } = require('../src/core/files.cjs');
const { passwordHash, patchAstrBot, patchNapCat, allocatePorts, PLATFORM } = require('../src/core/config.cjs');
const { download } = require('../src/core/download.cjs');
const { safeEntry, extract } = require('../src/core/archive.cjs');
const { redact } = require('../src/core/redact.cjs');
const { NativeApi, testDeepSeek } = require('../src/core/api.cjs');
const { pipeName } = require('../src/core/supervisor-client.cjs');
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(),'qqai-test-')); t.after(() => fs.rm(dir,{ recursive: true, force: true })); return dir; }
const state = { ports: { astrbot: 6185, napcat: 6099, onebot: 6199 } };
const secrets = { astrbot: 'Aa12345678', napcat: 'nap-secret', onebot: 'onebot-secret', apiKey: 'sk-test-secret' };
const prefs = { name: '小伴', persona: '友善', model: 'deepseek-flash', trigger: 'mention', prefix: '小伴' };

test('configuration patch preserves unrelated providers, plugins and nested options',() => {
  const original = { plugin_set: ['my-plugin'], provider: [{ id: 'mine', model: 'untouched' }], platform: [{ id: 'other', enable: true }], dashboard: { username: 'existing', password: 'dont-change', port: 8081 }, provider_settings: { custom: true }, agent_runner: { runner_type: 'local', config: { model: { request_max_retries: 3 }, persona: { persona_id: 'mine' }, compression: { max_turns: 20 } } }, platform_settings: { customOption: true } };
  const before = structuredClone(original);
  const patched = patchAstrBot(original,state,secrets,prefs);
  assert.deepEqual(original,before);
  assert.deepEqual(patched.dashboard,original.dashboard);
  assert.deepEqual(patched.plugin_set,original.plugin_set);
  assert.equal(patched.provider[0].id,'mine');
  assert.equal(patched.agent_runner.config.model.provider_id,'qqai-deepseek');
  assert.equal(patched.agent_runner.config.persona.persona_id,'mine');
  assert.equal(patched.agent_runner.config.compression.max_turns,20);
  assert.equal(patched.platform_settings.customOption,true);
  assert.equal(patched.platform.find(p => p.id === PLATFORM).ws_reverse_token,secrets.onebot);
});
test('new installation retains authentication with random per-device credentials',() => {
  const conf = patchAstrBot({},state,secrets,prefs);
  assert.equal(conf.dashboard.host,'127.0.0.1');
  assert.equal(conf.dashboard.password_storage_upgraded,true);
  const hash = conf.dashboard.pbkdf2_password.split('$');
  assert.equal(crypto.pbkdf2Sync(secrets.astrbot,Buffer.from(hash[2],'hex'),Number(hash[1]),32,'sha256').toString('hex'),hash[3]);
  assert.notEqual(passwordHash(secrets.astrbot),passwordHash(secrets.astrbot));
});
test('OneBot merge is idempotent and preserves original adapters',() => {
  const original = { network: { websocketClients: [{ name: 'mine', token: 'keep' }], httpServers: [{ name: 'server' }] }, other: 42 };
  const patched = patchNapCat(original,state,secrets);
  assert.deepEqual(patchNapCat(patched,state,secrets),patched);
  assert.equal(patched.network.websocketClients[0].token,'keep');
  assert.equal(patched.network.websocketClients[1].url,'ws://127.0.0.1:6199/ws');
  assert.equal(patched.network.websocketClients[1].token,patchAstrBot({},state,secrets,prefs).platform[0].ws_reverse_token);
  assert.equal(patched.other,42);
});
test('directory audit accepts Chinese and spaces, detects existing unknown files',async t => {
  const dir = await temp(t); const target = path.join(dir,'中文 小屋');
  assert.equal((await inspectRoot(target)).kind,'new');
  await fs.mkdir(target); await fs.writeFile(path.join(target,'my-data.txt'),'keep');
  assert.equal((await inspectRoot(target)).kind,'unmanaged');
  await assert.rejects(inspectRoot(path.parse(dir).root));
  await atomicJson(path.join(target,'.qqai-install.json'),{ schema: 1, product: 'qq-ai-launcher' });
  assert.equal((await inspectRoot(target)).kind,'managed');
});
test('a junction path is refused',async t => {
  const dir = await temp(t); const data = path.join(dir,'data'); const linked = path.join(dir,'link');
  await fs.mkdir(data); await fs.symlink(data,linked,process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectRoot(path.join(linked,'new')),/链接|联接/);
});
test('a missing Windows drive fails instead of looping during location inspection',{ skip: process.platform !== 'win32' },async () => {
  for(const drive of ['Z','Y','X','W','V']) {
    if(!await fs.access(`${drive}:\\`).then(() => true,() => false)) {
      await assert.rejects(inspectRoot(`${drive}:\\QQ-AI`),/磁盘不存在/); return;
    }
  }
});
test('operation lock prevents concurrent mutations and releases after failure',async t => {
  const root = await temp(t);
  await withLock(root,async () => { await assert.rejects(withLock(root,async () => {}),/另一项操作/); });
  await assert.rejects(withLock(root,async () => { throw new Error('failure'); }));
  await withLock(root,async () => {});
});
test('native AstrBot UTF-8 BOM configurations load without leaking malformed content',async t => {
  const root = await temp(t); const file = path.join(root,'cmd_config.json');
  await fs.writeFile(file,'\uFEFF'+JSON.stringify({ preserved: true }));
  assert.deepEqual(await readJson(file),{ preserved: true });
  await fs.writeFile(file,'sk-private-value malformed json');
  await assert.rejects(readJson(file),e => e.message.includes('cmd_config.json') && !e.message.includes('private-value'));
});
test('archive entries cannot escape, use NTFS streams or device aliases',async t => {
  const root = await temp(t);
  for (const name of ['../escape','a/../../b','/abs','C:/abs','a\\b','a:stream','CON.txt','a./b','a /b','a/./b']) assert.throws(() => safeEntry(root,name));
  assert.equal(safeEntry(root,'中文 目录/文件.txt'),path.join(root,'中文 目录','文件.txt'));
});
test('digest mismatch never promotes a downloaded file; valid cache is reused',async t => {
  const root = await temp(t); const file = path.join(root,'package.zip'); let requests = 0;
  const asset = { url: 'https://example.com/file.zip', sha256: crypto.createHash('sha256').update('good').digest('hex') };
  await assert.rejects(download(asset,file,async () => { requests++; return new Response('bad'); }),/校验失败/);
  assert.equal(requests,3);
  await assert.rejects(fs.access(file)); await assert.rejects(fs.access(file+'.part'));
  await download(asset,file,async () => new Response('good'));
  await download(asset,file,async () => { throw new Error('cache should prevent request'); });
  assert.equal(await fs.readFile(file,'utf8'),'good');
});
test('diagnostic redactor hides nested secrets, QQ IDs and exact credentials',() => {
  const output = redact({ apiKey: 'abc', nested: { authorization: 'foo', user_id: 12345 }, status: 'Bearer hello sk-leaked mypass' },['mypass']);
  assert.equal(output.apiKey,'[已隐藏]'); assert.equal(output.nested.user_id,'[已隐藏]');
  assert.ok(!JSON.stringify(output).includes('mypass')); assert.ok(!JSON.stringify(output).includes('sk-leaked'));
});
test('NapCat authentication uses salted SHA256 and refreshes missing authentication',async () => {
  const calls = [];
  const api = new NativeApi(state,secrets,async (url,options) => { calls.push({ url, ...options }); return Response.json({ code: 0, data: url.endsWith('/login') ? { Credential: 'signed-token' } : { isLogin: true } }); });
  assert.equal((await api.qqStatus()).isLogin,true);
  assert.equal(JSON.parse(calls[0].body).hash,crypto.createHash('sha256').update(secrets.napcat+'.napcat').digest('hex'));
  assert.equal(calls[1].headers.Authorization,'Bearer signed-token');
});
test('DeepSeek probe does not disclose API key on errors and handles empty responses',async () => {
  await assert.rejects(testDeepSeek('sk-secret-12345','deepseek-flash',async () => new Response('raw key leaked',{ status: 401 })),/密钥无效/);
  await assert.rejects(testDeepSeek('sk-secret-12345','deepseek-flash',async () => Response.json({ choices: [] })),/有效结果/);
  const result = await testDeepSeek('sk-secret-12345','deepseek-flash',async (url, options) => {
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    assert.equal(JSON.parse(options.body).messages.length,1);
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  });
  assert.equal(result.ok,true);
});
test('expired native credentials are refreshed once, including NapCat HTTP 200 errors',async () => {
  let logins = 0; let queries = 0;
  const api = new NativeApi(state,secrets,async url => {
    if(url.endsWith('/login')) { logins++; return Response.json({ code: 0, data: { Credential: `token-${logins}` } }); }
    queries++;
    return queries === 1 ? Response.json({ code: -1, message: 'Unauthorized' }) : Response.json({ code: 0, data: { isLogin: true } });
  });
  assert.equal((await api.qqStatus()).isLogin,true); assert.equal(logins,2); assert.equal(queries,2);
  const denied = new NativeApi(state,secrets,async url => Response.json(url.endsWith('/login') ? { code: 0, data: { Credential: 'bad' } } : { code: -1, message: 'Unauthorized' }));
  await assert.rejects(denied.qqStatus(),/Unauthorized/);
});
test('port allocation produces three distinct non-privileged ports',async () => {
  const ports = await allocatePorts(); assert.equal(new Set(Object.values(ports)).size,3); assert.ok(Object.values(ports).every(p => p > 1024));
});
test('supervisor pipe names are stable and isolated per install',() => { assert.equal(pipeName('D:\\中文 空间'),pipeName('D:\\中文 空间')); assert.notEqual(pipeName('D:\\one'),pipeName('D:\\two')); });
