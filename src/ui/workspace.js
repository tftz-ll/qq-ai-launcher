let nativeOverview = null, nativeSection = 'library', personaOperation = 'create', sessionRows = [], sessionPage = 1, sessionPages = 1, selectedSession = null;
let workspaceLoading = false, workspaceLoaded = false;
const nativeInput = (id,value) => { $(id).value = value; };
function option(value,label) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }
function empty(container,message) { const node = document.createElement('p'); node.className = 'field-note'; node.textContent = message; container.replaceChildren(node); }
function nativeButton(label,callback) { const node = document.createElement('button'); node.className = 'secondary compact workspace-mutation'; node.textContent = label; node.onclick = callback; return node; }
function nativeReady() { return !!snapshot?.astrbotReady && !snapshot?.busy && !actionRunning; }
window.renderWorkspaceAvailability = () => {
  const ready = nativeReady();
  for(const id of ['workspace-refresh','native-session-load']) $(id).disabled = !ready;
  for(const el of document.querySelectorAll('[data-native-page]')) el.disabled = !ready;
  for(const id of ['native-model','native-model-apply']) $(id).disabled = !ready || !nativeOverview?.configLoaded || !nativeOverview.models.some(p => p.enabled);
  for(const id of ['native-persona','native-persona-apply','native-persona-edit']) $(id).disabled = !ready || !nativeOverview?.personasLoaded || !nativeOverview.personas.length;
  for(const id of ['native-persona-new','native-persona-save']) $(id).disabled = !ready || !nativeOverview?.personasLoaded;
  $('native-chat-save').disabled = !ready || !nativeOverview?.configLoaded;
  for(const id of ['native-segmented','native-only-llm','native-interval','native-threshold','native-simple-split','native-mention','native-quote','native-datetime','native-group-context','native-group-context-size']) $(id).disabled = !ready || !nativeOverview?.configLoaded;
  for(const id of ['native-session-save','native-session-history']) $(id).disabled = !ready || !selectedSession;
  $('native-session-prev').disabled = !ready || sessionPage <= 1; $('native-session-next').disabled = !ready || sessionPage >= sessionPages;
  for(const el of document.querySelectorAll('.workspace-mutation')) el.disabled = !ready;
  if(!snapshot?.services?.astrbot?.running) {
    workspaceLoaded = false; nativeOverview = null;
    $('workspace-status').textContent = '请先启动角色，等待 AstrBot 就绪后刷新工作台。';
    $('native-persona-editor').hidden = true; $('native-persona-prompt').value = '';
    selectedSession = null; sessionRows = []; $('native-session-editor').hidden = true;
    empty($('native-session-list'),'启动后重新读取会话。'); window.clearWorkspaceHistory();
  }
};
window.clearWorkspaceHistory = () => $('native-history').replaceChildren();
function showNativeSection(name) {
  nativeSection = name;
  document.querySelectorAll('.workspace-section').forEach(n => n.hidden = n.id !== 'workspace-'+name);
  document.querySelectorAll('[data-workspace-section]').forEach(n => { n.classList.toggle('selected',n.dataset.workspaceSection === name); n.setAttribute('aria-pressed',String(n.dataset.workspaceSection === name)); });
  if(name !== 'sessions') window.clearWorkspaceHistory();
}
document.querySelectorAll('[data-workspace-section]').forEach(n => n.onclick = () => showNativeSection(n.dataset.workspaceSection));
document.querySelectorAll('[data-native-page]').forEach(n => n.onclick = () => action('openPanel',{component:'astrbot',page:n.dataset.nativePage}));
async function loadWorkspace(force = false) {
  if(workspaceLoading || !nativeReady() || workspaceLoaded && !force) return;
  workspaceLoading = true; $('workspace-status').textContent = '正在读取 AstrBot 当前配置…';
  try {
    const result = await action('workspaceRead');
    if(!result) { $('workspace-status').textContent = '读取失败，可以重试。'; return; }
    nativeOverview = result; workspaceLoaded = true;
    $('workspace-status').textContent = result.errors.length ? result.errors.join('；') : '已读取当前配置。修改后点击对应的应用按钮生效。';
    $('native-model').replaceChildren(...result.models.map(p => { const n = option(p.id,(p.managed ? '小屋 DeepSeek' : p.id)+' · '+p.model+(p.enabled ? '' : '（已停用）')); n.disabled = !p.enabled; return n; }));
    if(result.models.some(p => p.id === result.modelId)) nativeInput('native-model',result.modelId);
    else { $('native-model').prepend(option('','请选择模型')); nativeInput('native-model',''); }
    $('native-model-note').textContent = '当前默认：'+(result.modelId || '尚未选择')+'。启用不代表密钥或余额已通过测试。';
    $('native-persona').replaceChildren(...result.personas.map(p => option(p.id,p.managed ? '小屋角色 · '+p.id : p.id)));
    if(result.personas.some(p => p.id === result.personaId)) nativeInput('native-persona',result.personaId);
    if(result.chat && !nativeChatDirty) {
      const c = result.chat;
      for(const [id,key] of [['native-segmented','segmented'],['native-only-llm','onlyLlm'],['native-mention','mention'],['native-quote','quote'],['native-datetime','datetime'],['native-group-context','groupContext']]) $(id).checked = !!c[key];
      nativeInput('native-interval',c.interval); nativeInput('native-threshold',c.threshold); nativeInput('native-group-context-size',c.groupContextSize);
      $('native-simple-split').checked = false;
      $('native-split-note').textContent = '当前拆分方式：'+(c.splitMode === 'words' ? '分段词列表' : '正则表达式')+'；当前间隔方式：'+(c.intervalMethod === 'random' ? '随机' : '按长度计算')+'。应用本页将使用上方随机间隔。';
    }
    renderPlugins(); updateSessionPersonas();
  } finally { workspaceLoading = false; window.renderWorkspaceAvailability(); }
}
window.workspaceLoad = () => loadWorkspace();
$('workspace-refresh').onclick = async () => {
  if((!$('native-persona-editor').hidden || nativeChatDirty) && !confirm('刷新会重新读取聊天表现；请先保存正在编辑的内容。继续刷新？')) return;
  nativeChatDirty = false; await loadWorkspace(true);
};
for(const [id,kind] of [['native-model-apply','model'],['native-persona-apply','persona']]) $(id).onclick = async () => {
  if(dirty) { toast('请先保存「角色与模型 / 互动与扩展」中的修改，再切换默认项。',true); return; }
  const result = await action('workspaceSelect',{ kind, id: $(kind === 'model' ? 'native-model' : 'native-persona').value },'已应用默认'+(kind === 'model' ? '模型' : '人设')+'，QQ 保持运行。');
  if(result) await loadWorkspace(true);
};
$('native-persona-new').onclick = () => {
  personaOperation = 'create'; $('native-persona-editor').hidden = false; $('native-persona-id').disabled = false;
  nativeInput('native-persona-id',''); nativeInput('native-persona-prompt',''); $('native-persona-editor-title').textContent = '创建新的人设'; $('native-persona-id').focus();
};
$('native-persona-edit').onclick = async () => {
  const id = $('native-persona').value;
  if(id === 'qqai-companion') { tab('settings'); toast('小屋角色请在这里编辑名字和设定。'); return; }
  const result = await action('workspacePersona',{ operation:'detail', id }); if(!result) return;
  personaOperation = 'update'; $('native-persona-editor').hidden = false; $('native-persona-id').disabled = true;
  nativeInput('native-persona-id',result.id); nativeInput('native-persona-prompt',result.prompt); $('native-persona-editor-title').textContent = '编辑人设提示词';
};
$('native-persona-cancel').onclick = () => { $('native-persona-editor').hidden = true; nativeInput('native-persona-prompt',''); };
$('native-persona-save').onclick = async () => {
  const id = $('native-persona-id').value;
  const result = await action('workspacePersona',{ operation:personaOperation,id,prompt:$('native-persona-prompt').value },'人设已保存到 AstrBot。若要用于默认聊天，请再选择并点击使用。');
  if(result) { $('native-persona-cancel').click(); await loadWorkspace(true); nativeInput('native-persona',id); }
};
let nativeChatDirty = false;
document.querySelectorAll('#workspace-chat-options input').forEach(n => n.addEventListener('input',() => { nativeChatDirty = true; }));
$('native-chat-save').onclick = async () => {
  const result = await action('workspaceChat',{
    segmented:$('native-segmented').checked, onlyLlm:$('native-only-llm').checked,
    interval:$('native-interval').value, threshold:Number($('native-threshold').value), useSimpleSplit:$('native-simple-split').checked,
    mention:$('native-mention').checked, quote:$('native-quote').checked, datetime:$('native-datetime').checked,
    groupContext:$('native-group-context').checked, groupContextSize:Number($('native-group-context-size').value),
  },'聊天表现已应用，不需要重新登录 QQ。');
  if(result) { nativeChatDirty = false; await loadWorkspace(true); }
};
function renderPlugins() {
  const query = $('native-plugin-search').value.trim().toLowerCase(), container = $('native-plugin-list'); container.replaceChildren();
  for(const plugin of nativeOverview?.plugins || []) {
    if(!`${plugin.name} ${plugin.title} ${plugin.description}`.toLowerCase().includes(query)) continue;
    const row = document.createElement('article'); row.className = 'workspace-item';
    const title = document.createElement('strong'); title.textContent = plugin.title+' · '+plugin.version;
    const desc = document.createElement('p'); desc.textContent = plugin.description; desc.className = 'field-note';
    const state = document.createElement('span'); state.className = 'tag'; state.textContent = plugin.enabled ? '已启用' : '已停用';
    row.append(title,state,desc);
    if(plugin.qzone) row.append(nativeButton('到互动与扩展管理',()=>tab('features')));
    else if(plugin.reserved) { const note = document.createElement('small'); note.textContent = 'AstrBot 内置功能'; row.append(note); }
    else for(const [label,operation] of [[plugin.enabled ? '停用' : '启用',plugin.enabled ? 'off' : 'on'],['重载','reload']]) row.append(nativeButton(label,async () => {
      if(operation === 'reload' && !confirm('重载此插件可能短暂中断其任务，继续？')) return;
      const result = await action('workspacePlugin',{ name:plugin.name,operation },'插件操作已完成。'); if(result) await loadWorkspace(true);
    }));
    container.append(row);
  }
  if(!container.children.length) empty(container,'没有匹配的插件。加载失败的插件可在原生插件页面查看。');
  window.renderWorkspaceAvailability();
}
$('native-plugin-search').oninput = renderPlugins;
function updateSessionPersonas() {
  const current = selectedSession?.persona_id || '';
  $('native-session-persona').replaceChildren(option('','跟随默认角色'),...(nativeOverview?.personas || []).map(p => option(p.id,p.managed ? '小屋角色 · '+p.id : p.id)));
  if(current && !nativeOverview?.personas.some(p => p.id === current)) $('native-session-persona').append(option(current,current+'（当前已不可用）'));
  nativeInput('native-session-persona',current);
}
async function loadSessions(page = 1) {
  const result = await action('workspaceConversations',{ page,search:$('native-session-search').value }); if(!result) return;
  sessionRows = result.conversations; sessionPage = result.pagination?.page || page; sessionPages = result.pagination?.total_pages || 1;
  selectedSession = null; $('native-session-editor').hidden = true; window.clearWorkspaceHistory();
  $('native-session-pagination').textContent = `第 ${sessionPage} / ${sessionPages} 页 · ${result.pagination?.total || 0} 个会话`;
  const container = $('native-session-list'); container.replaceChildren();
  for(const row of sessionRows) {
    const item = document.createElement('article'); item.className = 'workspace-item'; const name = document.createElement('strong'); name.textContent = row.title;
    const desc = document.createElement('p'); desc.className = 'field-note'; desc.textContent = (row.persona_id ? '人设：'+row.persona_id : '跟随默认角色')+' · '+(row.updated_at ? new Date(row.updated_at).toLocaleString() : '暂无时间');
    item.append(name,desc,nativeButton('管理 / 查看',() => { selectedSession = row; $('native-session-editor').hidden = false; nativeInput('native-session-title',row.title); updateSessionPersonas(); window.clearWorkspaceHistory(); window.renderWorkspaceAvailability(); $('native-session-editor').scrollIntoView({behavior:'smooth',block:'nearest'}); })); container.append(item);
  }
  if(!sessionRows.length) empty(container,'没有找到会话。先在 QQ 发起一次对话，或修改搜索内容。'); window.renderWorkspaceAvailability();
}
$('native-session-load').onclick = () => loadSessions();
$('native-session-prev').onclick = () => loadSessions(sessionPage-1); $('native-session-next').onclick = () => loadSessions(sessionPage+1);
$('native-session-search').onkeydown = e => { if(e.key === 'Enter' && nativeReady()) loadSessions(); };
$('native-session-save').onclick = async () => {
  if(!selectedSession) return;
  const result = await action('workspaceConversation',{operation:'update',cid:selectedSession.cid,user_id:selectedSession.user_id,title:$('native-session-title').value,persona_id:$('native-session-persona').value},'会话设置已保存，历史消息保留。');
  if(result) await loadSessions(sessionPage);
};
$('native-session-history').onclick = async () => {
  if(!selectedSession) return;
  const result = await action('workspaceConversation',{operation:'detail',cid:selectedSession.cid,user_id:selectedSession.user_id});
  if(!result || activeTab !== 'workspace' || nativeSection !== 'sessions') return;
  let history = result.history; if(typeof history === 'string') { try { history = JSON.parse(history); } catch { history = []; } }
  const container = $('native-history'); container.replaceChildren();
  if(!Array.isArray(history) || !history.length) { empty(container,'此会话暂无已保存的上下文。'); return; }
  if(history.length > 200) empty(container,'仅展示最近 200 条上下文；完整内容可在原生会话页面查看。');
  for(const message of history.slice(-200)) {
    const article = document.createElement('article'); article.className = 'history-message';
    const role = document.createElement('b'); role.textContent = ({ user:'用户',assistant:'角色',system:'系统',tool:'工具' })[message.role] || '消息';
    const body = document.createElement('p'); body.textContent = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.filter(c => c.type === 'text').map(c => c.text).join('\n') || '（包含图片、音频或其他内容，请到原生页面查看）' : '（工具调用或其他内容）';
    article.append(role,body); container.append(article);
  }
};
$('native-history-clear').onclick = window.clearWorkspaceHistory;
showNativeSection('library');
window.renderWorkspaceAvailability();
