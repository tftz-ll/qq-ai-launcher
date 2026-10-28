const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { command } = require('../src/core/supervisor-client.cjs');
const { atomicJson, readJson } = require('../src/core/files.cjs');
const project = path.resolve(__dirname,'..');
const root = path.join(project,'.test-artifacts','安装 验证');
const profile = path.join(project,'.test-artifacts','electron-install-profile');
const packaged = process.argv.includes('--packaged');
async function launch() {
  const env = { ...process.env, QQAI_TEST_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({ args: packaged ? ['--no-sandbox',`--user-data-dir=${profile}`] : ['--no-sandbox',project], ...(packaged ? { executablePath: path.join(project,'dist','win-unpacked','QQ AI 小屋.exe') } : {}), env, timeout: 30000 });
}
async function main() {
  await atomicJson(path.join(profile,'location.json'),{ root });
  let instance; let token;
  try {
    instance = await launch();
    const page = await instance.firstWindow();
    await page.waitForFunction(() => !!window.qqai);
    console.log('INITIAL_LIFECYCLE_STATE',await page.evaluate(async () => { try { const s = await window.qqai.invoke('snapshot'); return { installed: s.installed, installPhase: s.installPhase, busy: s.busy, services: s.services }; } catch(e) { return { error: e.message }; } }));
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    token = await instance.evaluate(async ({ safeStorage },dir) => {
      const fs = process.getBuiltinModule('node:fs/promises'); const path = process.getBuiltinModule('node:path');
      const stored = JSON.parse(await fs.readFile(path.join(dir,'.secrets.json'),'utf8'));
      return JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(stored.encrypted,'base64'))).result).supervisor;
    },root);
    await page.locator('#start').click();
    await page.waitForFunction(() => !document.querySelector('#stop').disabled);
    await page.locator('[data-tab="tools"]').click();
    await page.locator('#hide-panel').click().catch(e => { if(!e.message.includes('has been closed')) throw e; }); instance = null;
    await new Promise(resolve => setTimeout(resolve,1500));
    const afterClose = await command(root,token,'status');
    assert.ok(afterClose.astrbot.running && afterClose.napcat.running,'Closing the panel stopped background services');
    const pids = [afterClose.astrbot.pid,afterClose.napcat.pid];
    console.log('BACKGROUND_SURVIVES_PANEL_CLOSE');
    if(packaged) {
      const folder = path.join(project,'dist','win-unpacked'); const moved = path.join(project,'dist','release-unlock-proof');
      assert.ok(folder.startsWith(project+path.sep) && moved.startsWith(project+path.sep));
      await fs.rename(folder,moved); await fs.rename(moved,folder);
      console.log('PACKAGED_DIRECTORY_UNLOCKED_WHILE_BACKGROUND_RUNS');
    }
    instance = await launch();
    const reopened = await instance.firstWindow();
    await reopened.waitForFunction(() => !document.querySelector('#stop').disabled);
    const afterReopen = await command(root,token,'status');
    assert.deepEqual([afterReopen.astrbot.pid,afterReopen.napcat.pid],pids,'Reopening duplicated service processes');
    await reopened.waitForFunction(() => document.querySelector('#status-astrbot').textContent === '已就绪',{},{ timeout: 120000 });
    await instance.evaluate(({net}) => {
      const original = net.fetch;
      net.fetch = (url,options) => String(url) === 'https://api.deepseek.com/chat/completions' ? Promise.resolve(Response.json({choices:[{message:{content:'OK'}}]})) : original.call(net,url,options);
    });
    await reopened.evaluate(() => window.qqai.invoke('testModel','sk-isolated-fixture-not-a-real-key'));
    await reopened.locator('[data-tab="settings"]').click();
    await reopened.locator('#ai-name').fill('小伴测试');
    await reopened.locator('[data-persona="daily"]').click();
    await reopened.locator('#save-settings').click();
    await reopened.waitForFunction(() => !document.querySelector('#toast').hidden,{},{ timeout: 60000 });
    assert.match(await reopened.locator('#toast').innerText(),/已保存并应用/);
    const prefs = await readJson(path.join(root,'launcher-settings.json'));
    assert.equal(prefs.name,'小伴测试');
    const st = await readJson(path.join(root,'.qqai-install.json'));
    assert.equal(st.personaApplied,true);
    const config = await readJson(path.join(root,'astrbot','data','cmd_config.json'));
    assert.equal(config.agent_runner.config.persona.persona_id,'qqai-companion');
    assert.equal(config.provider.find(p => p.id === 'qqai-deepseek').model,'deepseek-flash');
    assert.equal(config.provider_sources.find(p => p.id === 'qqai-deepseek').key[0],'sk-isolated-fixture-not-a-real-key');
    const afterSave = await command(root,token,'status');
    assert.deepEqual([afterSave.astrbot.pid,afterSave.napcat.pid],pids,'Applying settings restarted QQ');
    await reopened.locator('[data-tab="features"]').click();
    await reopened.locator('#active-enable').check();
    await reopened.locator('#active-groups').fill('123456789');
    await reopened.locator('.save-all').first().click();
    await reopened.waitForFunction(async () => { const value = await window.qqai.invoke('snapshot'); return !value.busy && value.settings.activeReply.enable; },{},{timeout:30000});
    const activeConfig = await readJson(path.join(root,'astrbot','data','cmd_config.json'));
    assert.equal(activeConfig.provider_ltm_settings.active_reply.enable,true);
    assert.deepEqual(activeConfig.provider_ltm_settings.active_reply.whitelist,['123456789']);
    await reopened.locator('[data-tab="home"]').click();
    await reopened.locator('#stop').click();
    await reopened.waitForFunction(() => document.querySelector('#stop').disabled && !document.querySelector('#start').disabled,{},{ timeout: 60000 });
    await assert.rejects(command(root,token,'status'),e => ['ENOENT','ECONNREFUSED'].includes(e.code));
    await atomicJson(path.join(project,'.test-artifacts',packaged ? 'packaged-lifecycle-result.json' : 'lifecycle-result.json'),{ packaged, panelClosePreservesBackground: true, reopeningReusesProcesses: true, authenticatedSettingsSave: true, personaSelectedInConfig: true, settingsApplyPreservesQQProcess: true, explicitStopAlsoExitsSupervisor: true });
    console.log('LIFECYCLE_VERIFIED: panel close, reopen without duplication, persona save, explicit stop');
  } finally {
    if(token) try { await command(root,token,'shutdown'); } catch {}
    if(instance) await instance.evaluate(({app}) => app.exit(0)).catch(() => {});
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
