const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Workspace, readChat, patchChat } = require('../src/core/workspace.cjs');
const { NativeApi } = require('../src/core/api.cjs');
const { patchAstrBot, MODEL, PERSONA } = require('../src/core/config.cjs');
const { normalizeSettings, validateSettings } = require('../src/core/preferences.cjs');
const original = {
  dashboard: { password:'do-not-expose', host:'127.0.0.1' },
  provider_sources:[{id:'source',enable:true,key:['do-not-expose']}],
  provider:[{id:'external',model:'example',provider_source_id:'source',provider_type:'chat_completion',enable:true},{id:'disabled',enable:false,provider_type:'chat_completion'},{id:'embedding',provider_type:'embedding'}],
  agent_runner:{runner_type:'local',config:{model:{provider_id:'external',keep:42},persona:{persona_id:'original'},extra:'keep'}},
  platform_settings:{custom:'keep',segmented_reply:{regex:'existing-regex',content_cleanup_rule:'keep',split_mode:'regex',log_base:3}},
  provider_settings:{custom:'keep'},provider_ltm_settings:{active_reply:{enable:true},group_message_history_enable:true},
};
const chat = {segmented:true,onlyLlm:true,interval:'1.5,3.5',threshold:350,useSimpleSplit:false,mention:false,quote:true,datetime:true,groupContext:true,groupContextSize:30};
async function fixture(t,responses = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'qqai-workspace-')); t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const calls = [], client = { request:async (component,route,body,method) => {
    calls.push({component,route,body,method});
    if(Object.hasOwn(responses,route)) { const data = responses[route]; if(data instanceof Error) throw data; return structuredClone(data); }
    if(route.includes('/api/config/abconf')) return {config:structuredClone(original)};
    if(route === '/api/persona/list') return [{persona_id:'original',system_prompt:'prompt',tools:null,skills:['keep'],begin_dialogs:['keep']},{persona_id:PERSONA,system_prompt:'managed'}];
    if(route === '/api/plugin/get') return [{name:'third_party',display_name:'插件',desc:'描述',version:'1',activated:true,reserved:false,repo:'do-not-expose'},{name:'builtin',reserved:true},{name:'astrbot_plugin_qzone'}];
    return null;
  }};
  return { workspace:new Workspace(client,dir),calls,dir };
}
test('workspace overview sends only display fields, omitting credentials and plugin paths',async t => {
  const {workspace} = await fixture(t); const result = await workspace.overview();
  assert.equal(result.models.length,2); assert.equal(result.models[1].enabled,false);
  assert.equal(result.plugins[0].enabled,true); assert.equal(result.personaId,'original');
  assert.doesNotMatch(JSON.stringify(result),/do-not-expose|system_prompt|existing-regex/);
});
test('partial workspace reads report failure without erasing other sections',async t => {
  const {workspace} = await fixture(t,{'/api/plugin/get':new Error('private path')});
  const result = await workspace.overview(); assert.equal(result.configLoaded,true); assert.equal(result.pluginsLoaded,false); assert.equal(result.errors.length,1); assert.doesNotMatch(result.errors[0],/private path/);
});
test('model selection validates source and capability before mutation and preserves other configuration',async t => {
  const {workspace,calls,dir} = await fixture(t);
  await assert.rejects(workspace.select({kind:'model',id:'embedding'})); await assert.rejects(workspace.select({kind:'model',id:'disabled'}));
  assert.equal(calls.filter(c => c.method !== 'GET').length,0);
  await workspace.select({kind:'model',id:'external'});
  const config = calls.find(c => c.route.endsWith('/astrbot/update')).body.config;
  assert.equal(config.agent_runner.config.model.keep,42); assert.equal(config.dashboard.password,'do-not-expose');
  assert.deepEqual(config.provider,original.provider); assert.equal((await fs.readdir(path.join(dir,'backups'))).length,1);
});
test('chat settings preserve advanced regex, active replies, persistence and unrelated fields',() => {
  const next = patchChat(original,chat);
  assert.equal(next.platform_settings.segmented_reply.regex,'existing-regex'); assert.equal(next.platform_settings.segmented_reply.content_cleanup_rule,'keep');
  assert.equal(next.provider_ltm_settings.group_message_max_cnt,30); assert.equal(next.provider_ltm_settings.group_message_history_enable,true);
  assert.deepEqual(next.provider_ltm_settings.active_reply,{enable:true}); assert.equal(next.platform_settings.custom,'keep');
  assert.equal(original.platform_settings.segmented_reply.enable,undefined);
  const simple = patchChat(original,{...chat,useSimpleSplit:true}); assert.equal(simple.platform_settings.segmented_reply.split_mode,'words'); assert.ok(simple.platform_settings.segmented_reply.split_words.includes('\n'));
  assert.equal(readChat(next).quote,true);
  for(const input of [{interval:'5,2'},{interval:'0,1'},{threshold:Infinity},{threshold:2.5},{groupContext:'yes'},{groupContextSize:0}]) assert.throws(() => patchChat(original,{...chat,...input}));
});
test('persona edits update the prompt only and new personas start without tools or skills',async t => {
  const {workspace,calls,dir} = await fixture(t);
  await workspace.persona({operation:'update',id:'original',prompt:'new prompt'});
  assert.deepEqual(calls.find(c => c.route === '/api/persona/update').body,{persona_id:'original',system_prompt:'new prompt'});
  const backup = await fs.readFile(path.join(dir,'backups',(await fs.readdir(path.join(dir,'backups')))[0]),'utf8'); assert.match(backup,/'|keep/);
  await workspace.persona({operation:'create',id:'new',prompt:'new prompt'});
  assert.deepEqual(calls.find(c => c.route === '/api/persona/create').body.tools,[]);
  await assert.rejects(workspace.persona({operation:'update',id:PERSONA,prompt:'overwrite'}));
  await assert.rejects(workspace.persona({operation:'create',id:'original',prompt:'overwrite'}));
});
test('plugin controls reject missing, built-in, space and arbitrary route operations',async t => {
  const {workspace,calls} = await fixture(t);
  for(const name of ['','missing','builtin','astrbot_plugin_qzone']) await assert.rejects(workspace.plugin({name,operation:'on'}));
  await assert.rejects(workspace.plugin({name:'third_party',operation:'../uninstall'}));
  await workspace.plugin({name:'third_party',operation:'off'});
  assert.deepEqual(calls.filter(c => c.route === '/api/plugin/off').map(c => c.body),[{name:'third_party'}]);
});
test('conversation lists exclude history and encode search; metadata edits cannot replace history',async t => {
  const {workspace,calls} = await fixture(t); workspace.client.request = async (component,route,body,method) => {
    calls.push({component,route,body,method});
    if(route.includes('/list?')) return {conversations:[{cid:'cid',user_id:'uid',title:'title',history:'private conversation'}],pagination:{page:1,total_pages:1}};
    if(route === '/api/persona/list') return [];
    return null;
  };
  const result = await workspace.conversations({search:'title&include_history=true'});
  assert.doesNotMatch(JSON.stringify(result),/private conversation/);
  const params = new URL('http://local'+calls[0].route).searchParams;
  assert.equal(params.get('include_history'),'false'); assert.equal(params.get('search'),'title&include_history=true');
  await workspace.conversation({operation:'update',cid:'cid',user_id:'uid',title:'new',persona_id:'',history:[]});
  assert.deepEqual(calls.find(c => c.route.endsWith('/update')).body,{cid:'cid',user_id:'uid',title:'new',persona_id:''});
  await assert.rejects(workspace.conversation({operation:'delete',cid:'cid',user_id:'uid'}));
});
test('saving launcher settings retains workspace-selected models and personas',async t => {
  assert.doesNotThrow(() => validateSettings({personaId:'original'}));
  const prefs = normalizeSettings({name:'name',persona:'draft',modelProvider:'external',personaId:'original'});
  const next = patchAstrBot(original,{ports:{onebot:12345},personaApplied:true},{apiKey:'fixture-key',onebot:'fixture'},prefs);
  assert.equal(next.agent_runner.config.model.provider_id,'external'); assert.equal(next.agent_runner.config.persona.persona_id,'original');
  const {dir} = await fixture(t); const api = new NativeApi({ports:{astrbot:12345}},{apiKey:'fixture-key'}); const mutations = [];
  api.request = async (component,route,body,method) => {
    if(route.includes('/abconf')) return {config:structuredClone(original)};
    if(route === '/api/persona/list') return [{persona_id:'original'}];
    mutations.push({route,body,method});
  };
  await api.applySettings(dir,prefs);
  assert.deepEqual(mutations.map(m => m.route),['/api/config/astrbot/update']);
  assert.equal(mutations[0].body.config.agent_runner.config.model.provider_id,'external');
  const failing = normalizeSettings({...prefs,modelProvider:'removed'}); mutations.length = 0;
  await assert.rejects(api.applySettings(dir,failing)); assert.equal(mutations.length,0);
  await assert.rejects(api.applySettings(dir,normalizeSettings({...prefs,modelProvider:'embedding'}))); assert.equal(mutations.length,0);
});
