// Uses only the existing isolated installation. No QQ login or paid model calls.
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { NativeApi } = require('../src/core/api.cjs');
const { readJson, atomicJson } = require('../src/core/files.cjs');
const { command } = require('../src/core/supervisor-client.cjs');
const project = path.resolve(__dirname,'..'), root = path.join(project,'.test-artifacts','安装 验证');
const profile = path.join(project,'.test-artifacts','electron-install-profile');
const personaId = 'qqai-workspace-fixture-persona', modelId = 'qqai-workspace-fixture-model';
const cid = '36a133d1-8577-4b91-a4bd-1db202610029', uid = 'qqai-onebot:FriendMessage:10000001';
async function until(check, timeout = 30000) { const end = Date.now()+timeout; while(Date.now() < end) { if(await check()) return; await new Promise(resolve => setTimeout(resolve,400)); } throw new Error('Isolated acceptance condition timed out'); }
async function main() {
  assert.ok(root.startsWith(path.join(project,'.test-artifacts')+path.sep));
  const oldPrefs = await readJson(path.join(root,'launcher-settings.json'));
  const oldState = await readJson(path.join(root,'.qqai-install.json'));
  // Seed one synthetic conversation before starting the native service. Production never writes its DB directly.
  const seed = spawnSync('python',['-c',`
import sys,sqlite3,json,datetime
c=sqlite3.connect(sys.argv[1]); now=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).isoformat(' ')
c.execute('INSERT OR IGNORE INTO conversations (created_at,updated_at,conversation_id,platform_id,user_id,content,title,persona_id,token_usage) VALUES (?,?,?,?,?,?,?,?,?)',(now,now,sys.argv[2],'aiocqhttp',sys.argv[3],json.dumps([{'role':'user','content':'Only a synthetic fixture message.'},{'role':'assistant','content':'Fixture reply.'}]),'Workspace fixture','',0))
c.commit()
`,path.join(root,'astrbot','data','data_v4.db'),cid,uid],{encoding:'utf8',windowsHide:true});
  if(seed.status) throw new Error(seed.stderr);
  const pluginDir = path.join(root,'astrbot','data','plugins','astrbot_plugin_qqai_workspace_fixture');
  await fs.mkdir(pluginDir,{recursive:true});
  await fs.writeFile(path.join(pluginDir,'metadata.yaml'),'name: qqai_workspace_fixture\ndesc: Isolated workspace control fixture\nversion: v0.0.1\nauthor: test\nrepo: https://example.invalid/fixture\n');
  await fs.writeFile(path.join(pluginDir,'main.py'),'from astrbot.api import star\n@star.register("qqai_workspace_fixture", "test", "Isolated fixture", "0.0.1")\nclass WorkspaceFixture(star.Star):\n    def __init__(self, context: star.Context):\n        super().__init__(context)\n');
  const env = {...process.env, QQAI_TEST_PROFILE:profile}; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv.includes('--packaged');
  const instance = await electron.launch({args:packaged ? ['--no-sandbox',`--user-data-dir=${profile}`] : ['--no-sandbox',project],...(packaged ? {executablePath:path.join(project,'dist','win-unpacked','QQ AI 小屋.exe')} : {}),env,timeout:30000});
  let client, originalConfig, credentials;
  const page = await instance.firstWindow(), errors = [];
  page.on('pageerror',e => errors.push(e.message));
  try {
    await page.waitForFunction(() => !!window.qqai);
    credentials = await instance.evaluate(async ({safeStorage},dir) => {
      const fs = process.getBuiltinModule('node:fs/promises'), path = process.getBuiltinModule('node:path');
      const stored = JSON.parse(await fs.readFile(path.join(dir,'.secrets.json'),'utf8'));
      return JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(stored.encrypted,'base64'))).result);
    },root);
    await page.evaluate(() => window.qqai.invoke('start'));
    await until(async () => (await page.evaluate(() => window.qqai.invoke('snapshot'))).astrbotReady,120000);
    const readySnapshot = await page.evaluate(() => window.qqai.invoke('snapshot'));
    console.log('ISOLATED_NATIVE_READY',JSON.stringify({expectedRoot:readySnapshot.root === root,services:readySnapshot.services,astrbotReady:readySnapshot.astrbotReady}));
    client = new NativeApi(await readJson(path.join(root,'.qqai-install.json')),credentials);
    originalConfig = (await client.request('astrbot','/api/config/abconf?id=default',undefined,'GET')).config;
    const before = await command(root,credentials.supervisor,'status');
    const oldModel = originalConfig.provider.find(p => p.id === 'qqai-deepseek'); assert.ok(oldModel);
    await client.request('astrbot','/api/config/provider/new',{...oldModel,id:modelId});
    console.log('FIXTURE_MODEL_CREATED');
    await page.evaluate(() => refresh());
    await page.locator('[data-tab="workspace"]').click();
    await until(async () => !(await page.evaluate(() => window.qqai.invoke('snapshot'))).busy);
    await page.waitForFunction(id => !!document.querySelector('#native-model option[value="'+id+'"]'),modelId,{timeout:30000});
    assert.ok(!(await page.locator('#workspace').innerText()).includes(root));
    await page.locator('#native-model').selectOption(modelId); await page.locator('#native-model-apply').click();
    await until(async () => { const s = await page.evaluate(() => window.qqai.invoke('snapshot')); return !s.busy && s.settings.modelProvider === modelId; });
    await page.waitForFunction(() => !document.querySelector('#native-persona-new').disabled);
    await page.locator('#native-persona-new').click();
    await page.locator('#native-persona-id').fill(personaId); await page.locator('#native-persona-prompt').fill('A synthetic original character.');
    await page.locator('#native-persona-save').click();
    await page.waitForFunction(id => !!document.querySelector('#native-persona option[value="'+id+'"]'),personaId);
    await page.locator('#native-persona').selectOption(personaId); await page.locator('#native-persona-apply').click();
    await until(async () => {const s = await page.evaluate(() => window.qqai.invoke('snapshot')); return !s.busy && s.settings.personaId === personaId;});
    let prefs = (await page.evaluate(() => window.qqai.invoke('snapshot'))).settings;
    await page.evaluate(p => window.qqai.invoke('saveSettings',p),prefs);
    let config = (await client.request('astrbot','/api/config/abconf?id=default',undefined,'GET')).config;
    assert.equal(config.agent_runner.config.model.provider_id,modelId); assert.equal(config.agent_runner.config.persona.persona_id,personaId);
    console.log('NATIVE_MODEL_AND_PERSONA_SELECTION_SURVIVE_SETTINGS_SAVE');
    await page.waitForFunction(() => !document.querySelector('#workspace-refresh').disabled);
    await page.locator('[data-workspace-section="chat-options"]').click();
    await page.locator('#native-segmented').check(); await page.locator('#native-simple-split').check();
    await page.locator('#native-interval').fill('1.2,2.5'); await page.locator('#native-threshold').fill('450');
    await page.locator('#native-chat-save').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('聊天表现已应用'));
    config = (await client.request('astrbot','/api/config/abconf?id=default',undefined,'GET')).config;
    assert.equal(config.platform_settings.segmented_reply.enable,true); assert.equal(config.platform_settings.segmented_reply.split_mode,'words');
    assert.equal(config.platform_settings.segmented_reply.interval,'1.2,2.5'); assert.equal(config.platform_settings.segmented_reply.words_count_threshold,450);
    console.log('REAL_NATIVE_SEGMENTED_REPLY_CONFIG_VERIFIED');
    await page.locator('[data-workspace-section="plugins"]').click(); await page.locator('#native-plugin-search').fill('qqai_workspace_fixture');
    const plugin = page.locator('#native-plugin-list .workspace-item'); await plugin.getByRole('button',{name:'停用',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#native-plugin-list').textContent.includes('已停用'));
    await plugin.getByRole('button',{name:'启用',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#native-plugin-list').textContent.includes('已启用'));
    page.on('dialog',dialog => dialog.accept());
    await plugin.getByRole('button',{name:'重载',exact:true}).click();
    await page.waitForFunction(() => !document.querySelector('#workspace-refresh').disabled);
    console.log('REAL_PLUGIN_OFF_ON_RELOAD_VERIFIED');
    await page.locator('[data-workspace-section="sessions"]').click(); await page.locator('#native-session-search').fill('Workspace fixture'); await page.locator('#native-session-load').click();
    await page.locator('#native-session-list').getByRole('button',{name:'管理 / 查看'}).click();
    await page.locator('#native-session-title').fill('Workspace renamed'); await page.locator('#native-session-persona').selectOption(personaId); await page.locator('#native-session-save').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('会话设置已保存'));
    const detail = await client.request('astrbot','/api/conversation/detail',{cid,user_id:uid});
    assert.equal(detail.title,'Workspace renamed'); assert.equal(detail.persona_id,personaId); assert.match(detail.history,/Only a synthetic/);
    await page.locator('#native-session-search').fill('Workspace renamed'); await page.locator('#native-session-load').click(); await page.locator('#native-session-list').getByRole('button',{name:'管理 / 查看'}).click();
    await page.locator('#native-session-history').click(); await page.waitForFunction(() => document.querySelector('#native-history').textContent.includes('Fixture reply.'));
    await page.locator('[data-workspace-section="advanced"]').click(); assert.equal(await page.locator('#native-history').innerText(),'');
    const expected = '/#/knowledge-base';
    await instance.evaluate(({shell}) => {globalThis.openedWorkspaceUrls = []; shell.openExternal = async url => {globalThis.openedWorkspaceUrls.push(url);};});
    await page.locator('[data-native-page="knowledge"]').click();
    const urls = await instance.evaluate(() => globalThis.openedWorkspaceUrls);
    assert.ok(urls.some(u => u.startsWith('http://127.0.0.1:') && u.endsWith(expected)));
    await assert.rejects(page.evaluate(() => window.qqai.invoke('openPanel',{component:'astrbot',page:'https://example.invalid'})));
    await assert.rejects(page.evaluate(() => window.qqai.invoke('workspacePlugin',{name:'astrbot_plugin_qzone',operation:'on'})));
    const after = await command(root,credentials.supervisor,'status');
    assert.equal(after.astrbot.pid,before.astrbot.pid); assert.equal(after.napcat.pid,before.napcat.pid);
    assert.deepEqual(errors,[]);
    await atomicJson(path.join(project,'.test-artifacts',packaged ? 'packaged-workspace-result.json' : 'workspace-result.json'),{modelAndPersonaSelection:true,savePreservesSelections:true,segmentedReply:true,thirdPartyPluginOnOffReload:true,conversationListDetailRenamePersona:true,historyUnchanged:true,historyClearedOnLeaving:true,allowlistedNativePages:true,qqProcessPreserved:true,paidModelCalls:0,realQQActions:0,rendererErrors:errors});
    console.log('WORKSPACE_VERIFIED_NO_PAID_CALLS_OR_REAL_QQ_ACTIONS');
  } catch(e) {
    await page.screenshot({path:path.join(project,'.test-artifacts','workspace-failure.png')}).catch(() => {});
    console.error('WORKSPACE_UI_ERRORS',JSON.stringify(errors));
    throw e;
  } finally {
    // Restore this test fixture only; never touch the user's installation.
    if(client && originalConfig) {
      await client.request('astrbot','/api/config/astrbot/update',{conf_id:'default',config:originalConfig}).catch(() => {});
      await client.request('astrbot','/api/config/provider/delete',{id:modelId}).catch(() => {});
      await client.request('astrbot','/api/persona/delete',{persona_id:personaId}).catch(() => {});
      await client.request('astrbot','/api/conversation/delete',{cid,user_id:uid}).catch(() => {});
    }
    await page.evaluate(() => window.qqai.invoke('stop')).catch(() => {});
    await instance.evaluate(({app}) => app.exit(0)).catch(() => {});
    await atomicJson(path.join(root,'launcher-settings.json'),oldPrefs); await atomicJson(path.join(root,'.qqai-install.json'),oldState);
  }
}
main().catch(e => {console.error(e);process.exitCode = 1;});
