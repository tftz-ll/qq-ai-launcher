// Installs the pinned plugin in the isolated fixture; never publishes, likes or comments.
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname,'..');
async function main() {
  const root = path.join(project,'.test-artifacts','安装 验证');
  const profile = path.join(project,'.test-artifacts','electron-install-profile');
  const integration = require('../resources/integrations.json').qzone;
  await fs.copyFile(path.join(project,'research','qzone.zip'),path.join(root,'downloads',`qzone-${integration.commit}.zip`));
  const env = {...process.env,QQAI_TEST_PROFILE:profile}; delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({args:['--no-sandbox',project],env,timeout:30000});
  try {
    const page = await instance.firstWindow();
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#status-astrbot').textContent === '已就绪',{},{timeout:120000});
    console.log('INSTALLING_PINNED_QZONE_PLUGIN');
    const result = await page.evaluate(() => window.qqai.invoke('installQzone'));
    assert.equal(result.installed,true);
    const inactive = await page.evaluate(() => window.qqai.invoke('qzoneStatus'));
    assert.equal(inactive.installed,true); assert.equal(inactive.enabled,false);
    const confFile = path.join(root,'astrbot','data','config','astrbot_plugin_qzone_config.json');
    const conf = JSON.parse((await fs.readFile(confFile,'utf8')).replace(/^\uFEFF/,''));
    assert.equal(conf.trigger.publish_cron,''); assert.equal(conf.trigger.comment_cron,''); assert.equal(conf.trigger.read_prob,0);
    const snap = await page.evaluate(() => window.qqai.invoke('snapshot'));
    const settings = snap.settings; settings.qzone.enable = true;
    await page.evaluate(value => window.qqai.invoke('saveSettings',value),settings);
    const enabled = await page.evaluate(() => window.qqai.invoke('qzoneStatus'));
    assert.equal(enabled.enabled,true);
    settings.qzone.enable = false;
    await page.evaluate(value => window.qqai.invoke('saveSettings',value),settings);
    console.log('QZONE_PLUGIN_INSTALL_AND_TOGGLES_VERIFIED_NO_PUBLIC_ACTIONS');
    await fs.writeFile(path.join(project,'.test-artifacts','qzone-result.json'),JSON.stringify({pinnedVersion:integration.version,install:true,enableAndDisable:true,automationOffByDefault:true,publicOperations:'not-executed; pending account acceptance'},null,2));
  } finally {
    const page = instance.windows()[0];
    if(page) await page.evaluate(() => window.qqai.invoke('stop')).catch(() => {});
    await instance.evaluate(({app}) => app.exit(0)).catch(() => {});
  }
}
main().catch(e => {console.error(e);process.exitCode=1;});
