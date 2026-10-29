const path = require('node:path');
const { atomicJson } = require('./files.cjs');
const { MODEL, PERSONA } = require('./config.cjs');

// Renderer input never becomes an arbitrary native route or configuration object.
function text(value, name, max = 200, empty = false) {
  if(typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (!empty && !value.trim())) throw new Error(`${name}格式无效。`);
  return value.trim();
}
function integer(value, min, max, name) {
  if(!Number.isInteger(value) || value < min || value > max) throw new Error(`${name}应在 ${min}–${max} 之间。`);
  return value;
}
function boolean(value) { if(typeof value !== 'boolean') throw new Error('开关格式无效。'); return value; }
function list(value, key) { const result = Array.isArray(value) ? value : value?.[key]; if(!Array.isArray(result)) throw new Error('原生接口格式与当前适配版本不一致。'); return result; }

function readChat(config) {
  const p = config.platform_settings || {}, s = p.segmented_reply || {}, g = config.provider_ltm_settings || {};
  return {
    segmented: !!s.enable, onlyLlm: s.only_llm_result !== false,
    interval: s.interval || '1.5,3.5', threshold: s.words_count_threshold ?? 150,
    splitMode: s.split_mode || 'regex', splitWords: Array.isArray(s.split_words) ? s.split_words : ['。','？','！','\n'], intervalMethod: s.interval_method || 'random',
    mention: !!p.reply_with_mention, quote: !!p.reply_with_quote,
    datetime: config.provider_settings?.datetime_system_prompt !== false,
    groupContext: !!g.group_icl_enable, groupContextSize: g.group_message_max_cnt ?? 1000,
  };
}
function patchChat(config, input) {
  const c = structuredClone(config);
  const interval = text(input.interval, '发送间隔', 30);
  const values = interval.split(',').map(Number);
  if(!/^\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(interval) || values.some(v => v < 0.2 || v > 60) || values[0] > values[1]) throw new Error('发送间隔请填写两个秒数，例如 1.5,3.5，范围为 0.2–60 秒。');
  c.platform_settings = { ...c.platform_settings, reply_with_mention: boolean(input.mention), reply_with_quote: boolean(input.quote), segmented_reply: {
    ...c.platform_settings?.segmented_reply, enable: boolean(input.segmented), only_llm_result: boolean(input.onlyLlm),
    interval_method: 'random', interval, words_count_threshold: integer(input.threshold, 1, 10000, '分段字数上限'),
    // Advanced expressions stay untouched unless the user explicitly chooses the simple mode.
    ...(input.useSimpleSplit === true ? { split_mode: 'words', split_words: ['。','？','！','\n'] } : {}),
  } };
  c.provider_settings = { ...c.provider_settings, datetime_system_prompt: boolean(input.datetime) };
  c.provider_ltm_settings = { ...c.provider_ltm_settings, group_icl_enable: boolean(input.groupContext), group_message_max_cnt: integer(input.groupContextSize, 1, 2000, '群聊背景条数') };
  return c;
}

class Workspace {
  constructor(client, root) { this.client = client; this.root = root; }
  call(route, body, method = 'POST') { return this.client.request('astrbot', route, body, method); }
  async config() { const value = await this.call('/api/config/abconf?id=default', undefined, 'GET'); if(!value?.config) throw new Error('无法读取原生配置。'); return value.config; }
  async backup(kind, data) { await atomicJson(path.join(this.root,'backups',`workspace-${kind}-${Date.now()}.json`),data); }
  async writeConfig(current, next) { await this.backup('config',current); await this.call('/api/config/astrbot/update', { conf_id: 'default', config: next }); }
  async personas() { return list(await this.call('/api/persona/list', undefined, 'GET'), 'personas'); }
  async plugins() { return list(await this.call('/api/plugin/get', undefined, 'GET'), 'plugins'); }
  async overview() {
    const results = await Promise.allSettled([this.config(), this.personas(), this.plugins()]);
    const [config, personas, plugins] = results.map(r => r.status === 'fulfilled' ? r.value : null);
    // A configuration includes keys and local paths. Only these display fields may cross IPC.
    return {
      errors: results.map((r,i) => r.status === 'rejected' ? ['模型与聊天设置','人设库','插件'][i]+'读取失败，请重试或打开原生页面。' : '').filter(Boolean),
      configLoaded: !!config, personasLoaded: !!personas, pluginsLoaded: !!plugins,
      modelId: config?.agent_runner?.config?.model?.provider_id || '', personaId: config?.agent_runner?.config?.persona?.persona_id || '',
      models: (config?.provider || []).filter(p => p.provider_type === 'chat_completion' || (!p.provider_type && !/embedding|rerank|tts|stt/.test(p.type || ''))).map(p => {
        const source = config.provider_sources?.find(s => s.id === p.provider_source_id);
        return { id: String(p.id), model: String(p.model || p.id), enabled: p.enable !== false && (!p.provider_source_id || !!source && source.enable !== false), managed: p.id === MODEL };
      }),
      personas: (personas || []).map(p => ({ id: p.persona_id, managed: p.persona_id === PERSONA })),
      plugins: (plugins || []).map(p => ({ name: p.name, title: p.display_name || p.name, description: p.desc || '', version: p.version || '', enabled: !!p.activated, reserved: !!p.reserved, qzone: p.name === 'astrbot_plugin_qzone' })),
      chat: config ? readChat(config) : null,
    };
  }
  async select(input) {
    const current = await this.config(), next = structuredClone(current);
    const id = text(input.id, '选择项', 200, true);
    if(input.kind === 'model') {
      const provider = current.provider?.find(p => p.id === id);
      const source = current.provider_sources?.find(s => s.id === provider?.provider_source_id);
      if(!provider || provider.enable === false || (provider.provider_source_id && (!source || source.enable === false)) || provider.provider_type && provider.provider_type !== 'chat_completion' || /embedding|rerank|tts|stt/.test(provider.type || '')) throw new Error('请选择已启用的对话模型。新增模型或密钥请使用原生模型页面。');
      next.agent_runner = { ...next.agent_runner, runner_type: 'local', config: { ...next.agent_runner?.config, model: { ...next.agent_runner?.config?.model, provider_id: id } } };
    } else if(input.kind === 'persona') {
      if(!id || !(await this.personas()).some(p => p.persona_id === id)) throw new Error('所选人设不存在。');
      next.agent_runner = { ...next.agent_runner, runner_type: 'local', config: { ...next.agent_runner?.config, persona: { ...next.agent_runner?.config?.persona, persona_id: id } } };
    } else throw new Error('选择类型无效。');
    await this.writeConfig(current,next);
    return { id };
  }
  async persona(input) {
    const id = text(input.id,'人设名称',200), all = await this.personas(), existing = all.find(p => p.persona_id === id);
    if(input.operation === 'detail') {
      if(!existing) throw new Error('人设已不存在，请刷新。');
      return { id, prompt: existing.system_prompt || '', managed: id === PERSONA };
    }
    if(!['create','update'].includes(input.operation)) throw new Error('不支持的人设操作。');
    if(id === PERSONA) throw new Error('小屋角色请在「角色与模型」中编辑，以保持名字与设定一致。');
    if(input.operation === 'create' && existing || input.operation === 'update' && !existing) throw new Error('人设已存在或已被移除，请刷新后重试。');
    const prompt = text(input.prompt, '角色提示词', 32000);
    if(existing) await this.backup('persona',existing);
    await this.call('/api/persona/'+input.operation,{ persona_id: id, system_prompt: prompt, ...(existing ? {} : { begin_dialogs: [], tools: [], skills: [] }) });
    return { saved: true };
  }
  async plugin(input) {
    const name = text(input.name,'插件名称',200);
    if(!['on','off','reload'].includes(input.operation)) throw new Error('不支持的插件操作。');
    const plugin = (await this.plugins()).find(p => p.name === name);
    if(!plugin || plugin.reserved) throw new Error('仅可操作列表中的第三方插件。');
    if(name === 'astrbot_plugin_qzone') throw new Error('QQ 空间请在「互动与扩展」管理，保证权限开关一致。');
    await this.call('/api/plugin/'+input.operation,{ name });
    return { saved: true };
  }
  async conversations(input = {}) {
    const page = integer(input.page ?? 1, 1, 100000, '页码');
    const query = text(input.search ?? '', '搜索内容', 100, true);
    const params = new URLSearchParams({ page: String(page), page_size: '20', include_history: 'false', sort_by: 'updated_at', search: query });
    const result = await this.call('/api/conversation/list?'+params, undefined, 'GET');
    return { conversations: list(result, 'conversations').map(c => ({ cid: c.cid, user_id: c.user_id, title: c.title || '未命名会话', persona_id: c.persona_id || '', updated_at: c.updated_at, platform_id: c.platform_id })), pagination: result.pagination };
  }
  async conversation(input) {
    const body = { user_id: text(input.user_id,'会话标识',500), cid: text(input.cid,'会话编号',200) };
    if(input.operation === 'detail') {
      const result = await this.call('/api/conversation/detail',body);
      // History stays in memory. No file, diagnostics, or launcher cache is written.
      return { title: result.title || '未命名会话', history: result.history, persona_id: result.persona_id || '' };
    }
    if(input.operation !== 'update') throw new Error('不支持的会话操作。');
    body.title = text(input.title,'会话标题',200);
    body.persona_id = text(input.persona_id,'会话人设',200,true);
    if(body.persona_id && !(await this.personas()).some(p => p.persona_id === body.persona_id)) throw new Error('所选人设不存在。');
    await this.call('/api/conversation/update',body);
    return { saved: true };
  }
  async chat(input) { const current = await this.config(); await this.writeConfig(current,patchChat(current,input)); return { saved: true }; }
}
module.exports = { Workspace, readChat, patchChat };
