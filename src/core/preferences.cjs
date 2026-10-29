const DEFAULTS = {
  name: '', persona: '', model: 'deepseek-flash', trigger: 'mention', prefix: '', modelProvider: '', personaId: '',
  activeReply: { enable: false, probability: 0.1, groups: [] },
  qzone: { enable: false, view: true, publish: true, images: true, like: true, comment: true, delete: false, ai: false, autoPublish: false, autoComment: false, publishCron: '', commentCron: '' },
};
function normalizeSettings(input = {}) {
  const base = structuredClone(DEFAULTS); const value = structuredClone(input);
  return { ...base, ...value, activeReply: { ...base.activeReply,...value.activeReply }, qzone: { ...base.qzone,...value.qzone } };
}
function validateSettings(input) {
  if(!input || typeof input !== 'object') throw new Error('配置格式无效。');
  const value = normalizeSettings(input);
  value.name = String(value.name || '').trim(); value.persona = String(value.persona || '').trim(); value.prefix = String(value.prefix || '').trim();
  if((!value.name && !value.personaId) || value.name.length > 32) throw new Error('请先为自己的角色取一个名字（1–32 个字符）。');
  if((!value.persona && !value.personaId) || value.persona.length > 8000) throw new Error('请填写角色设定，也可以先选择一个模板再自由修改。');
  if(!['deepseek-flash','deepseek-v4-pro'].includes(value.model)) throw new Error('请选择支持的模型。');
  for(const key of ['modelProvider','personaId']) if(typeof value[key] !== 'string' || value[key].length > 200 || /[\u0000-\u001f]/.test(value[key])) throw new Error('工作台选择项无效。');
  if(!['mention','prefix'].includes(value.trigger)) throw new Error('请选择消息触发方式。');
  if(value.trigger === 'prefix' && (!value.prefix || value.prefix.length > 20)) throw new Error('请输入 1–20 个字符的触发词。');
  if(typeof value.activeReply.enable !== 'boolean' || !Number.isFinite(value.activeReply.probability) || value.activeReply.probability < 0 || value.activeReply.probability > 1) throw new Error('主动接话概率应在 0%–100% 之间。');
  if(!Array.isArray(value.activeReply.groups) || value.activeReply.groups.length > 100 || value.activeReply.groups.some(g => !/^\d{5,20}$/.test(String(g)))) throw new Error('群范围请填写群号，一行一个，最多 100 个。');
  value.activeReply.groups = [...new Set(value.activeReply.groups.map(String))];
  for(const key of ['enable','view','publish','images','like','comment','delete','ai','autoPublish','autoComment']) if(typeof value.qzone[key] !== 'boolean') throw new Error('空间开关格式无效。');
  for(const key of ['publishCron','commentCron']) { value.qzone[key] = String(value.qzone[key] || '').trim(); if(value.qzone[key] && !/^[\d\s*,/\-]+$/.test(value.qzone[key])) throw new Error('定时设置请使用五段 Cron 表达式，例如 30 23 * * *。'); if(value.qzone[key] && value.qzone[key].split(/\s+/).length !== 5) throw new Error('定时设置需要五段 Cron 表达式。'); }
  if(value.qzone.autoPublish && (!value.qzone.publish || !value.qzone.publishCron)) throw new Error('定时发布需要开启发布功能并设置时间。');
  if(value.qzone.autoComment && (!value.qzone.comment || !value.qzone.commentCron)) throw new Error('定时评论需要开启评论功能并设置时间。');
  if(value.qzone.ai && !['view','publish','images','like','comment'].every(k => value.qzone[k])) throw new Error('现成插件的 AI 工具同时包含查看、点赞、评论和图文发布，请启用这五项后再允许 AI 调用。');
  if(value.qzone.ai && value.personaId) throw new Error('空间 AI 工具由小屋角色管理。使用原生人设时，请先关闭此项，再到原生人设页面选择工具。');
  return value;
}
function patchQzone(original, prefs) {
  const result = structuredClone(original);
  result.trigger = { ...result.trigger, publish_cron: prefs.enable && prefs.autoPublish ? prefs.publishCron : '', comment_cron: prefs.enable && prefs.autoComment ? prefs.commentCron : '', read_prob: 0, like_when_comment: prefs.like };
  return result;
}
function authorizeQzone(prefs, action) {
  const allowed = { feed: 'view', detail: 'view', publish: 'publish', like: 'like', comment: 'comment', reply: 'comment', delete: 'delete' };
  if(!prefs.enable || !allowed[action] || !prefs[allowed[action]]) throw new Error('这项 QQ 空间操作尚未开启，请先在功能开关中启用并应用。');
}
function validateQzoneOperation(prefs,input) {
  const action = input?.action; authorizeQzone(prefs,action);
  const body = {};
  if(['publish','comment','reply'].includes(action)) { body.content = String(input.content || '').trim(); if(!body.content || body.content.length > 5000) throw new Error('请输入 1–5000 个字符。'); }
  if(['detail','like','comment','reply','delete'].includes(action)) { body.id = String(input.id || ''); if(!/^\d{5,20}:[A-Za-z0-9_-]{1,128}$/.test(body.id)) throw new Error('请先刷新动态并选择一条说说。'); }
  if(action === 'reply') { body.commentid = String(input.commentid || ''); body.comment_uin = String(input.comment_uin || ''); if(!/^\d{1,30}$/.test(body.commentid) || !/^\d{5,20}$/.test(body.comment_uin)) throw new Error('请选择一条可回复的评论。'); }
  const image = action === 'publish' ? input.image : null;
  if(image && (!prefs.images || !/^[a-f0-9]{64}\.png$/.test(image))) throw new Error('带图发布未开启，或所选图片无效。');
  return {action,body,image};
}
module.exports = { DEFAULTS, normalizeSettings, validateSettings, patchQzone, authorizeQzone, validateQzoneOperation };
