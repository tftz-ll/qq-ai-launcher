const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { atomicJson, readJson, backup } = require('./files.cjs');

const PLATFORM = 'qqai-onebot';
const MODEL = 'qqai-deepseek';
const PERSONA = 'qqai-companion';

function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  return `pbkdf2_sha256$600000$${salt.toString('hex')}$${crypto.pbkdf2Sync(password, salt, 600000, 32, 'sha256').toString('hex')}`;
}

function patchAstrBot(original, state, secrets, settings) {
  const conf = structuredClone(original);
  const upsert = (items, item) => { const result = [...(items || [])]; const i = result.findIndex(x => x.id === item.id); if (i < 0) result.push(item); else result[i] = { ...result[i], ...item }; return result; };
  conf.platform = upsert(conf.platform, { id: PLATFORM, type: 'aiocqhttp', enable: true, ws_reverse_host: '127.0.0.1', ws_reverse_port: state.ports.onebot, ws_reverse_token: secrets.onebot });
  if (secrets.apiKey) {
    conf.provider_sources = upsert(conf.provider_sources, { id: MODEL, type: 'openai_chat_completion', provider: 'deepseek', provider_type: 'chat_completion', enable: true, key: [secrets.apiKey], api_base: 'https://api.deepseek.com/v1', timeout: 120 });
    conf.provider = upsert(conf.provider, { id: MODEL, provider_source_id: MODEL, type: 'openai_chat_completion', provider_type: 'chat_completion', enable: true, model: settings.model || 'deepseek-flash', model_config: {} });
    conf.agent_runner = { ...conf.agent_runner, runner_type: 'local', config: { ...(conf.agent_runner?.config || {}), model: { ...(conf.agent_runner?.config?.model || {}), provider_id: MODEL } } };
  }
  // Only the launcher-owned trigger and model fields change; unrelated plugin fields survive.
  conf.wake_prefix = settings.trigger === 'prefix' ? [settings.prefix] : [];
  conf.platform_settings = { ...conf.platform_settings, friend_message_needs_wake_prefix: settings.trigger === 'prefix' };
  if(settings.activeReply) conf.provider_ltm_settings = { ...conf.provider_ltm_settings, active_reply: { ...conf.provider_ltm_settings?.active_reply, enable: settings.activeReply.enable, method: 'possibility_reply', possibility_reply: settings.activeReply.probability, whitelist: settings.activeReply.groups } };
  if (state.personaApplied) {
    conf.agent_runner = { ...conf.agent_runner, runner_type: 'local', config: { ...conf.agent_runner?.config, persona: { ...conf.agent_runner?.config?.persona, persona_id: PERSONA } } };
  }
  if (!Object.keys(original).length) {
    conf.platform_settings.enable_id_white_list = false;
    conf.dashboard = { enable: true, host: '127.0.0.1', port: state.ports.astrbot, username: 'astrbot', password: crypto.createHash('md5').update(secrets.astrbot).digest('hex'), pbkdf2_password: passwordHash(secrets.astrbot), password_storage_upgraded: true, password_change_required: false, jwt_secret: crypto.randomBytes(32).toString('hex') };
  }
  return conf;
}

function patchNapCat(original, state, secrets) {
  const conf = structuredClone(original);
  conf.network ||= {};
  const items = [...(conf.network.websocketClients || [])];
  const item = { name: PLATFORM, enable: true, url: `ws://127.0.0.1:${state.ports.onebot}/ws`, token: secrets.onebot, messagePostFormat: 'array', reportSelfMessage: false, reconnectInterval: 5000, heartInterval: 30000, debug: false };
  const index = items.findIndex(x => x.name === PLATFORM);
  if (index < 0) items.push(item); else items[index] = { ...items[index], ...item };
  conf.network.websocketClients = items;
  return conf;
}

async function freePort() {
  return new Promise((resolve, reject) => { const server = net.createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(e => e ? reject(e) : resolve(port)); }); });
}

async function allocatePorts() {
  const ports = new Set(); while (ports.size < 3) ports.add(await freePort());
  const [astrbot, napcat, onebot] = [...ports]; return { astrbot, napcat, onebot };
}

async function writeConfigurations(root, state, secrets, settings) {
  const file = path.join(root, 'astrbot', 'data', 'cmd_config.json');
  const conf = await readJson(file, {});
  await backup(file, root);
  await atomicJson(file, patchAstrBot(conf, state, secrets, settings));
  const dir = path.join(root, 'napcat', 'napcat', 'config');
  const webuiFile = path.join(dir, 'webui.json');
  const webui = await readJson(webuiFile, {});
  await backup(webuiFile, root);
  if (!Object.keys(webui).length) await atomicJson(webuiFile, { host: '127.0.0.1', port: state.ports.napcat, token: secrets.napcat, disableWebUI: false });
  const onebotFile = path.join(dir, 'onebot11.json');
  const onebot = await readJson(onebotFile, {});
  await backup(onebotFile, root);
  await atomicJson(onebotFile, patchNapCat(onebot, state, secrets));
  await fs.mkdir(path.join(root, 'logs'), { recursive: true });
}
module.exports = { PLATFORM, MODEL, PERSONA, passwordHash, patchAstrBot, patchNapCat, allocatePorts, writeConfigurations };
