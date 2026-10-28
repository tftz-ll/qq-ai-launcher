const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, normalizeSettings, validateSettings, patchQzone, authorizeQzone, validateQzoneOperation } = require('../src/core/preferences.cjs');
const { patchAstrBot } = require('../src/core/config.cjs');
test('new characters start blank and existing names and unrelated settings survive migration',() => {
  assert.equal(DEFAULTS.name,''); assert.equal(DEFAULTS.persona,'');
  const migrated = normalizeSettings({ name:'我的原创角色',persona:'自定义世界观',custom:'retain' });
  assert.equal(migrated.name,'我的原创角色'); assert.equal(migrated.persona,'自定义世界观'); assert.equal(migrated.custom,'retain'); assert.equal(migrated.qzone.enable,false);
  migrated.activeReply.groups.push('123456'); assert.deepEqual(DEFAULTS.activeReply.groups,[]);
});
test('original AstrBot probability reply fields are patched without replacing other memories',() => {
  const prefs = normalizeSettings({name:'角色',persona:'设定',activeReply:{enable:true,probability:.25,groups:['123456']}});
  const original = {provider_ltm_settings:{group_message_history_enable:true,customMemory:true},dashboard:{port:6000}};
  const output = patchAstrBot(original,{ports:{onebot:6100}},{onebot:'test'},prefs);
  assert.equal(output.provider_ltm_settings.group_message_history_enable,true);
  assert.equal(output.provider_ltm_settings.customMemory,true);
  assert.deepEqual(output.provider_ltm_settings.active_reply,{enable:true,method:'possibility_reply',possibility_reply:.25,whitelist:['123456']});
});
test('invalid group IDs, probabilities and missing character settings fail before saving',() => {
  assert.throws(() => validateSettings({name:'',persona:'x'}),/名字/);
  assert.throws(() => validateSettings({name:'角色',persona:'x',activeReply:{probability:2}}),/概率/);
  assert.throws(() => validateSettings({name:'角色',persona:'x',activeReply:{groups:['not-a-group']}}),/群范围/);
});
test('space schedules require opt-in and preserve unrelated plugin configuration',() => {
  const original = {manage_group:'keep',llm:{post_prompt:'keep'},trigger:{publish_cron:'0 0 * * *',comment_cron:'0 1 * * *',read_prob:.5,publish_offset:42}};
  const output = patchQzone(original,DEFAULTS.qzone);
  assert.equal(output.trigger.publish_cron,''); assert.equal(output.trigger.comment_cron,''); assert.equal(output.trigger.read_prob,0);
  assert.equal(output.trigger.publish_offset,42); assert.equal(output.llm.post_prompt,'keep'); assert.equal(original.trigger.read_prob,.5);
});
test('space permissions are enforced at the operation boundary',() => {
  assert.throws(() => authorizeQzone(DEFAULTS.qzone,'publish'),/尚未开启/);
  const prefs = {...DEFAULTS.qzone,enable:true,publish:false};
  assert.throws(() => authorizeQzone(prefs,'publish')); assert.doesNotThrow(() => authorizeQzone(prefs,'feed'));
  assert.throws(() => authorizeQzone({...prefs,publish:true},'arbitrary-api'));
});
test('partial permission sets cannot expose combined upstream AI tools',() => {
  assert.throws(() => validateSettings({name:'角色',persona:'x',qzone:{enable:true,ai:true,comment:false}}),/五项/);
  assert.throws(() => validateSettings({name:'角色',persona:'x',qzone:{autoPublish:true}}),/定时发布/);
  const prefs = validateSettings({name:'角色',persona:'x',qzone:{enable:true,autoPublish:true,publishCron:'30 23 * * *'}});
  assert.equal(patchQzone({},prefs.qzone).trigger.publish_cron,'30 23 * * *');
});
test('space payloads accept real hex post IDs and reject unsafe image references and incomplete replies',() => {
  const prefs = {...DEFAULTS.qzone,enable:true};
  assert.equal(validateQzoneOperation(prefs,{action:'comment',id:'123456789:abc123def_45',content:'test'}).body.id,'123456789:abc123def_45');
  assert.throws(() => validateQzoneOperation(prefs,{action:'publish',content:'test',image:'../../private.png'}),/图片无效/);
  assert.throws(() => validateQzoneOperation({...prefs,images:false},{action:'publish',content:'test',image:'a'.repeat(64)+'.png'}));
  assert.throws(() => validateQzoneOperation(prefs,{action:'reply',id:'123456789:abc',content:'reply'}),/可回复/);
  assert.equal(validateQzoneOperation(prefs,{action:'reply',id:'123456789:abc',content:'reply',commentid:'12',comment_uin:'987654321'}).body.commentid,'12');
});
