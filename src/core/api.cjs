const crypto = require('node:crypto');
const { patchNapCat, patchAstrBot, PERSONA, MODEL } = require('./config.cjs');
const { atomicJson } = require('./files.cjs');
const path = require('node:path');

class NativeApi {
  constructor(state, secrets, fetcher = fetch) { this.state = state; this.secrets = secrets; this.fetcher = fetcher; this.tokens = {}; }
  async request(component, route, body, method = 'POST', auth = true, retried = false) {
    if (auth && !this.tokens[component]) await this.login(component);
    const response = await this.fetcher(`http://127.0.0.1:${this.state.ports[component]}${route}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(route.includes('/install') ? 180000 : method === 'GET' ? 5000 : 30000),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${this.tokens[component]}` } : {}) },
      ...(method !== 'GET' ? { body: JSON.stringify(body || {}) } : {}),
    });
    if (!response.ok) {
      if(response.status === 401 && auth) {
        delete this.tokens[component];
        if(!retried) return this.request(component,route,body,method,auth,true);
      }
      throw new Error(`${component} 管理接口返回 ${response.status}`);
    }
    const data = await response.json();
    // NapCat reports an expired one-hour credential as HTTP 200 / Unauthorized.
    if(auth && data.message === 'Unauthorized') {
      delete this.tokens[component];
      if(!retried) return this.request(component,route,body,method,auth,true);
    }
    if (data.status === 'error' || data.ok === false || (component === 'napcat' && data.code !== 0)) throw new Error(data.message || '组件返回错误');
    return data.data;
  }
  async login(component) {
    const body = component === 'astrbot' ? { username: 'astrbot', password: this.secrets.astrbot } : { hash: crypto.createHash('sha256').update(this.secrets.napcat + '.napcat').digest('hex') };
    const data = await this.request(component, '/api/auth/login', body, 'POST', false);
    const token = component === 'astrbot' ? data?.token : data?.Credential;
    if (!token) throw new Error('本机管理认证未完成。若已修改密码或启用双重验证，请通过原生面板管理。');
    this.tokens[component] = token;
  }
  async qqStatus() { return this.request('napcat', '/api/QQLogin/CheckLoginStatus'); }
  async rememberQQ() {
    const info = await this.request('napcat','/api/QQLogin/GetQQLoginInfo');
    const uin = String(info?.uin || info?.qq || '');
    if(/^\d{5,20}$/.test(uin)) await this.request('napcat','/api/QQLogin/SetQuickLoginQQ',{ uin });
  }
  async installPluginZip(file) {
    if(!this.tokens.astrbot) await this.login('astrbot');
    const bytes = await require('node:fs/promises').readFile(file);
    const form = new FormData(); form.append('file',new Blob([bytes],{ type: 'application/zip' }),'astrbot_plugin_qzone.zip');
    form.append('ignore_version_check','false');
    const response = await this.fetcher(`http://127.0.0.1:${this.state.ports.astrbot}/api/plugin/install-upload`,{ method: 'POST', headers: { Authorization: `Bearer ${this.tokens.astrbot}` }, body: form, signal: AbortSignal.timeout(240000), redirect: 'error' });
    const result = await response.json();
    if(!response.ok || result.status === 'error') throw new Error(result.message || '空间插件安装失败。');
    return result.data;
  }
  async applySettings(root, prefs) {
    const current = await this.request('astrbot','/api/config/abconf?id=default',undefined,'GET');
    if(!current?.config) throw new Error('无法读取 AstrBot 当前配置。');
    const patched = patchAstrBot(current.config,{ ...this.state, personaApplied: true },this.secrets,prefs);
    await atomicJson(path.join(root,'backups',`astrbot-before-apply-${Date.now()}.json`),current.config);
    if(this.secrets.apiKey) {
      const source = patched.provider_sources.find(p => p.id === MODEL);
      await this.request('astrbot','/api/config/provider_sources/update',{ original_id: MODEL, config: source });
      const model = patched.provider.find(p => p.id === MODEL);
      if(current.config.provider?.some(p => p.id === MODEL)) await this.request('astrbot','/api/config/provider/update',{ id: MODEL, config: model });
      else await this.request('astrbot','/api/config/provider/new',model);
    }
    await this.persona(prefs);
    await this.request('astrbot','/api/config/astrbot/update',{ conf_id: 'default', config: patched });
  }
  async connect(root) {
    const conf = await this.request('napcat', '/api/OB11Config/GetConfig');
    const patched = patchNapCat(conf, this.state, this.secrets);
    if (JSON.stringify(conf) === JSON.stringify(patched)) return;
    await atomicJson(path.join(root, 'backups', `onebot-before-connect-${Date.now()}.json`), conf);
    await this.request('napcat', '/api/OB11Config/SetConfig', { config: JSON.stringify(patched) });
  }
  async persona(settings) {
    const all = await this.request('astrbot', '/api/persona/list', undefined, 'GET');
    const list = Array.isArray(all) ? all : all?.personas;
    if (!Array.isArray(list)) throw new Error('人设列表格式不符合已选版本。');
    const found = list.some(p => p.persona_id === PERSONA);
    const existingTools = list.find(p => p.persona_id === PERSONA)?.tools;
    const otherTools = Array.isArray(existingTools) ? existingTools.filter(t => !['llm_view_feed','llm_publish_feed'].includes(t)) : [];
    const tools = [...new Set([...otherTools,...(settings.qzone?.enable && settings.qzone?.ai ? ['llm_view_feed','llm_publish_feed'] : [])])];
    const data = { persona_id: PERSONA, system_prompt: `角色名：${settings.name}\n\n${settings.persona}`, tools, ...(found ? {} : { begin_dialogs: [], skills: [] }) };
    await this.request('astrbot', found ? '/api/persona/update' : '/api/persona/create', data);
  }
}

async function testDeepSeek(key, model = 'deepseek-flash', fetcher = fetch) {
  if (typeof key !== 'string' || key.length < 12 || /\s/.test(key)) throw new Error('请输入有效的 DeepSeek API Key。');
  if (!['deepseek-flash', 'deepseek-v4-pro'].includes(model)) throw new Error('请选择支持的 DeepSeek 模型。');
  const started = Date.now();
  const response = await fetcher('https://api.deepseek.com/chat/completions', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: '请只回复 OK。' }], max_tokens: 128, stream: false }),
  });
  if (!response.ok) {
    const messages = { 401: '密钥无效，请检查后重试。', 402: 'DeepSeek 余额不足，请充值后重试。', 429: '模型服务请求过于频繁，请稍后重试。' };
    throw new Error(messages[response.status] || `模型服务暂不可用（HTTP ${response.status}）。`);
  }
  const data = await response.json();
  if (!data.choices?.length) throw new Error('模型未返回有效结果。');
  return { ok: true, latencyMs: Date.now()-started, model, testedAt: new Date().toISOString() };
}
module.exports = { NativeApi, testDeepSeek };
