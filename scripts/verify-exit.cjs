const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const {command} = require('../src/core/supervisor-client.cjs');
async function main() {
  const project = path.resolve(__dirname,'..'); const root = path.join(project,'.test-artifacts','安装 验证');
  const env = {...process.env,QQAI_TEST_PROFILE:path.join(project,'.test-artifacts','electron-install-profile')}; delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({args:['--no-sandbox',project],env,timeout:30000});
  let token;
  try {
    const page = await instance.firstWindow(); await page.waitForFunction(() => !document.querySelector('#start').disabled);
    await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#status-astrbot').textContent === '已就绪',{},{timeout:120000});
    token = await instance.evaluate(async ({safeStorage},root) => { const fs = process.getBuiltinModule('node:fs/promises'); const path = process.getBuiltinModule('node:path'); const encrypted = JSON.parse(await fs.readFile(path.join(root,'.secrets.json'),'utf8')); return JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(encrypted.encrypted,'base64'))).result).supervisor; },root);
    await instance.evaluate(({dialog,BrowserWindow}) => {dialog.showMessageBox = async () => ({response:2});BrowserWindow.getAllWindows()[0].close();});
    await new Promise(r => setTimeout(r,300)); assert.equal(page.isClosed(),false);
    const running = await command(root,token,'status'); assert.ok(running.astrbot.running && running.napcat.running);
    await instance.evaluate(({dialog,BrowserWindow}) => {dialog.showMessageBox = async () => ({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(e => {if(!e.message.includes('closed')) throw e;});
    let gone = false;
    for(let n=0;n<50;n++) {
      await new Promise(r => setTimeout(r,200));
      try {await command(root,token,'status');} catch(e) {if(['ENOENT','ECONNREFUSED'].includes(e.code)){gone=true;break;}throw e;}
    }
    assert.equal(gone,true,'Window close did not shut down the supervisor');
    for(const child of Object.values(running)) assert.throws(() => process.kill(child.pid,0),e => e.code === 'ESRCH');
    await fs.writeFile(path.join(project,'.test-artifacts','exit-result.json'),JSON.stringify({cancelKeepsWindowAndServices:true,defaultCloseStopsServicesAndSupervisor:true},null,2));
    console.log('WINDOW_CLOSE_CANCEL_AND_COMPLETE_SHUTDOWN_VERIFIED');
  } finally { if(token) await command(root,token,'shutdown').catch(() => {}); await instance.evaluate(({app}) => app.exit(0)).catch(() => {}); }
}
main().catch(e => {console.error(e);process.exitCode=1;});
