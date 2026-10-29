const $ = id => document.getElementById(id);
const invoke = (name,input) => window.qqai.invoke(name,input);
let snapshot, first = true, dirty = false, themeDirty = false, actionRunning = false, refreshing = false, activeTab = 'home', toastTimer, manualGuide = 'auto', qzoneImage = '';
const qKeys = { view:'查看动态',publish:'发布文字说说',images:'带图发布',like:'点赞',comment:'评论 / 回复',delete:'删除自己发布的说说',ai:'允许当前角色 AI 调用空间工具',autoPublish:'定时自动发布',autoComment:'定时自动评论' };
for(const [key,label] of Object.entries(qKeys)) {
  const row = document.createElement('label'); row.className = 'toggle-row';
  const text = document.createElement('span'); text.textContent = label;
  const input = document.createElement('input'); input.type = 'checkbox'; input.id = 'qzone-'+key;
  row.append(text,input); $('qzone-switches').append(row);
}
const templates = {
  daily: '【角色身份】\n一位生活在现代日常里的原创角色。身份、年龄与背景：由我填写。\n\n【性格与表达】\n用符合角色性格的自然中文交流。性格关键词：由我填写。可使用适量的语气词、颜文字或短小动作描写，频率由我决定。\n\n【相处方式】\n如何称呼我：由我填写。我们之间的关系：由我填写。不要自行预设亲密关系。\n\n【世界观与边界】\n我希望保留的设定：由我填写。对尚未发生的共同经历不作既成事实描述。',
  fantasy: '【原创角色设定】\n角色种族、身份与来历：由我填写。\n生活的世界与重要经历：由我填写。\n\n【性格与语言】\n性格关键词：由我填写。\n口头禅、语气、动作描写习惯：由我填写。\n\n【与我的故事】\n如何称呼我：由我填写。\n我们如何相识、目前的关系：由我填写。\n允许如何推进剧情：由我填写。\n\n【持续扮演】\n保持设定和表达风格；缺失的设定先与我商量，不替我决定关系或个人经历。',
  blank: '',
};
function toast(text,error = false) { $('toast').textContent = text; $('toast').classList.toggle('error',error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; },error ? 14000 : 6000); }
function tab(name) {
  activeTab = name;
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active',el.id === name));
  document.querySelectorAll('.nav[data-tab]').forEach(el => el.classList.toggle('active',el.dataset.tab === name));
  $('page-title').textContent = {home:'我的小屋',settings:'角色与模型',features:'互动与扩展',workspace:'AstrBot 工作台',appearance:'布置小屋',tools:'管理与诊断'}[name];
  manualGuide = 'auto'; $('guide-topic').value = 'auto'; guide(); window.scrollTo({top:0});
  if(name === 'workspace') window.workspaceLoad?.(); else window.clearWorkspaceHistory?.();
}
document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click',() => tab(el.dataset.tab)));
document.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click',() => tab(el.dataset.goto)));
function openGuide(topic) { document.body.classList.remove('guide-collapsed'); $('help-toggle').setAttribute('aria-expanded','true'); if(topic) { manualGuide = topic; $('guide-topic').value = topic; } guide(); }
document.querySelectorAll('[data-guide]').forEach(el => el.addEventListener('click',() => openGuide(el.dataset.guide)));
$('help-toggle').onclick = () => { document.body.classList.toggle('guide-collapsed'); $('help-toggle').setAttribute('aria-expanded',String(!document.body.classList.contains('guide-collapsed'))); };
$('guide-close').onclick = () => { document.body.classList.add('guide-collapsed'); $('help-toggle').setAttribute('aria-expanded','false'); };
$('guide-topic').onchange = () => { manualGuide = $('guide-topic').value; guide(); };

function nextState(data = snapshot) {
  if(!data?.installed) return ['先选择安装位置，准备角色运行环境','install','查看安装步骤'];
  if(!data.services?.astrbot?.running || !data.services?.napcat?.running) return ['点击「启动角色」，让小屋亮灯','install','查看启动步骤'];
  if(!data.qq?.isLogin) return ['QQ 尚未登录，复制 Token 后扫码','token','查看登录步骤'];
  if((!data.settings.personaId && !data.settings.name) || !data.personaApplied || !data.modelApplied || (!data.settings.modelProvider && !data.hasKey)) return ['完成角色设定和模型配置，再点击保存并应用','model','查看配置步骤'];
  if(data.onebot !== 'tcp-connected') return ['配置已应用，消息通道仍在连接','chat','查看连接排查'];
  if(!data.chainVerified) return ['配置已完成，用另一个 QQ 发消息验证完整链路','chat','查看消息测试'];
  return ['你已确认收到回复，可以开始自己的故事了','character','继续自定义角色'];
}
const guides = {
  install: ['01 · 准备运行环境','从这里开始',[
    '在首页选择<b>专用安装文件夹</b>，支持中文、空格和其他磁盘，至少预留 3 GB。',
    '点击<b>检查并安装</b>，等待下载、校验与部署。失败可以重试，已完成的下载会复用。',
    '安装完成后，点击页面上方的<b>启动角色</b>。首次启动可能约需一分钟。',
    '等 AstrBot / NapCat 就绪后，再继续 QQ 登录。安装完成并不代表已经启动。'], '不需要自己安装 Python 或输入命令。只有程序显示就绪后，登录按钮才可用。', [['回到安装向导',()=>{tab('home');$('install-details').open = true;$('install-details').scrollIntoView({behavior:'smooth'});}]]],
  token: ['02 · 个人 QQ 登录','Token 在哪里？',[
    '点击首页的<b>复制 Token 并打开登录页</b>，Token 会自动复制到剪贴板，浏览器会打开 NapCat 网页。',
    '在网页的 <b>Token 输入框</b>按 Ctrl + V，然后点击登录。这是本机管理口令，不是 DeepSeek 密钥。',
    '在 NapCat 网页用<b>手机 QQ 扫码并确认</b>。等待小屋里「QQ 账号」显示已登录。',
    '如果剪贴板内容丢失，点击下方<b>复制本机 Token</b>。管理与诊断 → NapCat 卡片也有同一个入口。'], 'Token 复制后会在 60 秒后或退出面板时清除。若原生面板中更改了口令，需要使用你更改后的口令。', [['复制本机 Token',()=>action('copyCredential','napcat','已复制，在 NapCat 网页的 Token 框按 Ctrl + V。')],['打开 QQ 登录页',()=>action('openPanel','napcat')]]],
  model: ['03 · 模型与角色','测试之后，还要应用',[
    '进入<b>角色与模型</b>，取名字并填写角色设定。模板可自由修改或清空。',
    '粘贴自己的 DeepSeek API Key，点击<b>测试并保存密钥</b>。该操作会发送一条简短测试请求。',
    '测试成功后，点击<b>保存并应用角色与设置</b>。只保存密钥不会自动替聊天选择模型。',
    '当前版本即时更新 AstrBot，不会因为保存设置重启 QQ。若 QQ 已掉线，先回到登录步骤重新扫码。'], '模型状态是最近一次测试结果，可能随余额或网络变化。不要把 API Key 粘贴到 NapCat 的 Token 输入框。', [['去设置角色与模型',()=>tab('settings')],['打开 AstrBot 原生面板',()=>action('openPanel','astrbot')]]],
  character: ['MY ORIGINAL CHARACTER','角色是什么样，由你决定',[
    '<b>名字、身份、性格、口头禅、如何称呼你、彼此关系</b>都可以自己填写。小屋不强制性别或关系设定。',
    '日常搭子和幻想角色只是<b>提示词模板</b>；也可以完全从空白开始。',
    '在<b>布置小屋</b>上传头像或立绘、自己的背景图，调整配色、卡片遮罩和背景模糊。',
    '展示图片不会自动修改 QQ 头像，也不会自动发给模型。长期记忆等能力需要在 AstrBot 中另行配置插件。'], '旧版已经保存的名字与人设会保留，新装则从空白角色开始。', [['编辑角色档案',()=>tab('settings')],['上传形象 / 布置背景',()=>tab('appearance')]]],
  chat: ['04 · 第一次消息往返','收到回复，才算接通',[
    '先确认<b>QQ 已登录</b>，消息通道已建立，模型已应用。端口存在不代表消息已收发成功。',
    '用<b>另一个 QQ 私聊机器人</b>发送「你好」。默认私聊直接回复，不需要 @。',
    '群聊默认<b>@角色</b>才回复。可在互动与扩展开启原生概率接话；先 @ 进行一次对话，建立会话。',
    '收到回复后，回到首页点击<b>我已在 QQ 收到回复</b>。如果没有回复，去管理与诊断查看最近错误。'], '显示「等待扫码」时，消息无法到达 AstrBot。模型测试通过与 QQ 完整消息往返是两件事。', [['复制 Token 并登录',login],['重新连接消息通道',()=>action('reconnect',undefined,'已重新匹配连接，请等待状态更新。')],['查看诊断与最近错误',()=>tab('tools')]]],
  qzone: ['OPTIONAL · QQ 空间','按需开启，再操作',[
    '启动 AstrBot 后点击<b>安装空间插件</b>。安装固定版本的现成插件，默认暂停其定时发布和评论。',
    '打开空间总开关，选择需要的<b>手动操作、AI 调用和定时操作</b>，点击应用。部分功能组合受上游插件接口限制。',
    '点击<b>检测插件连接</b>。需要 QQ 在线；如登录态过期，先回到 QQ 登录页。',
    '手动控制台可以查看自己的动态、发文字或配图说说、点赞、评论和删除。定时操作按填写的 Cron 生效。'], '发布、点赞和评论是对外实际操作。关闭总开关会停用整个插件；各分项开关控制小屋入口与绑定角色的 AI 工具。原生插件命令在 AstrBot 中独立管理。真实 QQ 空间兼容性待账号实测。', [['打开空间与权限设置',()=>tab('features')],['打开原生插件管理',()=>action('openPanel','astrbot')]]],
  exit: ['LEAVE ON YOUR TERMS','关闭和退出，有区别',[
    '<b>停止机器人并彻底退出</b>会停止两个组件、退出托管进程并关闭窗口，推荐用于结束使用或准备删除。',
    '<b>仅关闭面板，后台继续</b>会保留机器人。新版后台使用安装目录内的独立运行环境，不再占用小屋的 EXE。',
    '关闭窗口右上角的 × 会询问如何离开，默认选择<b>停止并退出</b>，不会不作说明地隐藏运行。',
    '准备删除机器人<b>安装目录</b>时，需要先彻底退出。删除程序的解压目录与删除角色数据是两件事。'], '旧版遗留托管也会由新版的停止与彻底退出指令结束。小屋不会通过退出操作删除聊天、角色或插件数据。', [['停止并彻底退出',()=>action('exit')],['回到管理页',()=>tab('tools')]]],
  workspace: ['ASTRBOT WORKSPACE','角色能力，在这里管理',[
    '<b>模型与人设</b>读取 AstrBot 已有配置。选择后点击使用；切换模型不会自动产生付费测试调用。已有会话的单独配置可能覆盖默认值。',
    '<b>聊天表现</b>可以分成多条发送、调整间隔、@ 或引用回复。注意字数上限：超过上限的回复仍整条发送。群聊背景会增加模型上下文。',
    '<b>插件</b>可启用、停用和重载已安装的第三方插件。安装和复杂配置使用原生插件页面；空间插件在互动与扩展统一管理。',
    '<b>会话</b>按需读取列表，查看时才读取正文。可更改标题和人设，不清空历史。知识库、定时任务、语音、MCP 等入口位于更多能力。'],
    '工作台选择的默认模型和人设会被小屋记住。保存角色档案不会覆盖这些选择。需要回到小屋角色时，在工作台选 qqai-companion；模型选择 qqai-deepseek。首次打开原生网页需用本机管理密码登录。',
    [['复制 AstrBot 管理密码',()=>action('copyCredential','astrbot','管理密码已复制，用户名为 astrbot。')],['打开原生设置',()=>action('openPanel',{component:'astrbot',page:'config'})]]],
};
function guide() {
  let topic = manualGuide;
  if(topic === 'auto') topic = activeTab === 'workspace' ? 'workspace' : activeTab === 'settings' ? 'model' : activeTab === 'appearance' ? 'character' : activeTab === 'features' ? 'qzone' : activeTab === 'tools' ? 'exit' : nextState()[1];
  const [step,title,items,tip,buttons] = guides[topic] || guides.install;
  $('guide-step').textContent = step; $('guide-title').textContent = title; $('guide-tip-text').textContent = tip;
  const ol = document.createElement('ol'); for(const text of items) { const li = document.createElement('li'); li.innerHTML = text; ol.append(li); } $('guide-body').replaceChildren(ol);
  const enabled = snapshot?.installed && !snapshot?.busy && !actionRunning;
  $('guide-actions').replaceChildren(...buttons.map(([label,callback]) => { const b = document.createElement('button'); b.className = 'secondary compact'; b.textContent = label; b.disabled = !enabled && /Token|登录页|原生|退出|通道/.test(label); b.onclick = callback; return b; }));
}
function mediaUrl(id) { return /^[a-f0-9]{64}\.png$/.test(id || '') ? 'qqai-media://asset/'+id : ''; }
function applyAppearance(value,controls = true) {
  document.body.dataset.accent = value.accent || 'sakura';
  document.documentElement.style.setProperty('--panel-opacity',String(value.opacity || .88));
  document.documentElement.style.setProperty('--wall-blur',(value.blur || 0)+'px');
  const opacity = Math.max(.5,Math.min(1,value.opacity || .88));
  document.documentElement.style.setProperty('--card',value.accent === 'night' ? `rgba(43,43,62,${opacity})` : `rgba(255,255,255,${opacity})`);
  const bg = mediaUrl(value.background); $('wallpaper').style.backgroundImage = bg ? `url("${bg}")` : '';
  const avatar = mediaUrl(value.avatar);
  for(const id of ['hero-avatar','avatar-preview']) { $(id).hidden = !avatar; if(avatar) $(id).src = avatar; else $(id).removeAttribute('src'); }
  $('empty-avatar').hidden = !!avatar; $('avatar-placeholder').hidden = !!avatar;
  if(controls) { $('accent').value = value.accent || 'sakura'; $('background-opacity').value = opacity*100; $('background-blur').value = value.blur || 0; }
}
function paintProgress(data) {
  if(!data) return; $('progress-area').hidden = false;
  const percent = data.phase === 'ready' ? 100 : Math.min(98,((data.step || 1)-1+(data.total ? data.received/data.total : .3))/(data.totalSteps || 6)*100);
  $('progress-bar').style.width = percent+'%';
  $('progress-text').textContent = (data.detail || `正在下载 ${data.component || ''}`)+(data.received ? ` · ${(data.received/1024**2).toFixed(1)} MB${data.total ? ' / '+(data.total/1024**2).toFixed(1)+' MB' : ''}` : '');
}
function status(name,text,kind = '') { $('status-'+name).textContent = text; $('dot-'+name).className = kind; }
function form() {
  return { ...snapshot.settings,name:$('ai-name').value,persona:$('persona').value,model:$('model').value,trigger:$('trigger').value,prefix:$('prefix').value,
    activeReply:{enable:$('active-enable').checked,probability:Number($('active-probability').value)/100,groups:$('active-groups').value.split(/\s+/).filter(Boolean)},
    qzone:Object.fromEntries([['enable',$('qzone-enable').checked],...Object.keys(qKeys).map(k => [k,$('qzone-'+k).checked]),['publishCron',$('publish-cron').value],['commentCron',$('comment-cron').value]]) };
}
function render(data) {
  snapshot = data;
  const busy = actionRunning || data.busy || !!data.credentialError;
  const running = !!data.services?.astrbot?.running || !!data.services?.napcat?.running;
  if(first) { $('install-path').value = data.root || data.suggestedRoot || ''; $('install-details').open = !data.installed; first = false; }
  if(!dirty) {
    for(const [id,key] of [['ai-name','name'],['persona','persona'],['model','model'],['trigger','trigger'],['prefix','prefix']]) $(id).value = data.settings[key] || '';
    $('active-enable').checked = !!data.settings.activeReply?.enable; $('active-probability').value = (data.settings.activeReply?.probability ?? .1)*100; $('active-groups').value = (data.settings.activeReply?.groups || []).join('\n');
    $('qzone-enable').checked = !!data.settings.qzone?.enable; for(const k of Object.keys(qKeys)) $('qzone-'+k).checked = !!data.settings.qzone?.[k];
    $('publish-cron').value = data.settings.qzone?.publishCron || ''; $('comment-cron').value = data.settings.qzone?.commentCron || '';
  }
  if(!themeDirty) applyAppearance(data.appearance || {});
  $('prefix-field').hidden = $('trigger').value !== 'prefix'; $('probability-label').textContent = $('active-probability').value+'%';
  $('start').disabled = !data.installed || busy || !!(data.services?.astrbot?.running && data.services?.napcat?.running);
  $('stop').disabled = !running || busy;
  for(const id of ['browse','install-path']) $(id).disabled = busy || data.installed;
  $('install').disabled = busy || data.installed; $('install').textContent = data.installed ? '✓ 安装完成' : data.installPhase === 'failed' ? '重试安装' : '检查并安装';
  $('install-summary').textContent = data.installed ? (data.root || '') : '选择安装位置，下载所需组件';
  $('login').disabled = !data.services?.napcat?.running || busy;
  $('test-model').disabled = !data.installed || busy;
  $('save-settings').disabled = !data.astrbotReady || busy; document.querySelectorAll('.save-all').forEach(b => b.disabled = !data.astrbotReady || busy);
  for(const name of ['astrbot','napcat']) { $('open-'+name).disabled = !data.services?.[name]?.running || busy; $('copy-'+name).disabled = !data.installed || busy; }
  $('reconnect').disabled = !data.qq?.isLogin || busy;
  const displayName = data.settings.personaId || data.settings.name;
  $('hero-title').textContent = displayName ? displayName+'的小屋，今天也在这里。' : '这里，等你创造一位角色。';
  $('portrait-name').textContent = displayName || '尚未命名';
  $('native-selection-note').hidden = !data.settings.modelProvider && !data.settings.personaId;
  $('native-selection-note').textContent = '工作台已选择'+(data.settings.personaId ? '人设「'+data.settings.personaId+'」' : '小屋角色')+'、'+(data.settings.modelProvider ? '模型「'+data.settings.modelProvider+'」' : '小屋 DeepSeek 模型')+'。下方保留小屋角色档案；保存不会覆盖工作台的选择。';
  $('hero-chip').textContent = data.chainVerified && data.qq?.isLogin ? '✦ 你的故事，正在继续' : running ? '✦ 小屋已经亮灯' : '✦ 新的故事，等你开启';
  $('hero-description').textContent = data.settings.name ? '名字与设定属于你。\n从一句话开始，慢慢了解彼此。' : '从一份只属于你的设定开始，\n让对话发生在熟悉的 QQ 里。';
  const [next,topic,label] = nextState(data); $('next-title').textContent = next; $('next-button').textContent = label; $('next-button').onclick = () => openGuide(topic);
  $('detail-path').textContent = data.root || '尚未选择';
  $('last-error').textContent = data.credentialError || data.lastError || data.connectionError || data.napcatError || Object.entries(data.services || {}).filter(([,s]) => s?.lastExit?.code).map(([n,s]) => n+' 退出码 '+s.lastExit.code).join('；') || '暂无';
  $('key-note').textContent = data.hasKey ? '已保存设备加密密钥，留空可测试现有密钥。原生运行配置采用 AstrBot 自身存储格式。' : '密钥由 Windows 设备加密保存，AstrBot 运行配置使用其原生存储格式。';
  status('qq',data.qq?.isLogin ? '已登录' : data.qq?.qrLoginAccepted ? '正在初始化' : '等待扫码',data.qq?.isLogin ? 'good' : running ? 'wait' : '');
  status('astrbot',data.astrbotReady ? '已就绪' : data.services?.astrbot?.running ? '启动中' : data.installed ? '已停止' : '尚未安装',data.astrbotReady ? 'good' : '');
  status('napcat',data.qq ? '已就绪' : data.services?.napcat?.running ? '启动中' : data.installed ? '已停止' : '尚未安装',data.qq ? 'good' : '');
  status('onebot',data.onebot === 'tcp-connected' ? '连接已建立 · 待消息实测' : data.onebot === 'waiting' ? '正在连接' : '等待连接',data.onebot === 'tcp-connected' ? 'good' : running ? 'wait' : '');
  status('model',data.settings.modelProvider ? '已选择 '+data.settings.modelProvider+' · 待消息实测' : data.modelTest ? data.modelApplied ? '上次测试可用 · 已应用' : '测试通过 · 待应用' : data.modelApplied ? '已配置 · 尚未实测' : '尚未测试',!data.settings.modelProvider && data.modelTest && data.modelApplied ? 'good' : data.modelApplied || data.hasKey ? 'wait' : '');
  $('status-foot').textContent = data.credentialError || data.connectionError || data.napcatError || '模型状态显示最近一次测试；消息通道依据本机 TCP 连接，不代替 QQ 回复实测。';
  const stages = [data.installed,!!data.qq?.isLogin,!!data.personaApplied && !!data.modelApplied,!!data.chainVerified && data.qq?.isLogin && data.onebot === 'tcp-connected'];
  ['install','qq','model','chain'].forEach((n,i) => $(n+'-number').classList.toggle('done',!!stages[i]));
  $('setup-count').textContent = stages.filter(Boolean).length+' / 4 已完成';
  $('verify-chain').disabled = busy || !data.qq?.isLogin || data.onebot !== 'tcp-connected' || !data.modelApplied;
  $('chain-result').textContent = data.chainVerified ? '已由你确认收到回复；连接变化后仍需留意当前状态。' : '等待 QQ 消息实测，不会仅凭配置完成而自动标记成功。';
  const available = !busy && data.astrbotReady;
  $('install-qzone').disabled = !available || data.qzoneInstalled; $('install-qzone').textContent = data.qzoneInstalled ? '✓ 插件已安装' : '安装空间插件'; $('check-qzone').disabled = !available;
  for(const [id,key] of [['load-feed','view'],['pick-qzone-image','images'],['publish-qzone','publish']]) $(id).disabled = !available || !data.qq?.isLogin || !data.settings.qzone?.enable || !data.settings.qzone?.[key] || dirty;
  if(!$('qzone-state').dataset.checked) $('qzone-state').textContent = data.qzoneLoadFailed ? '加载未完成 · 可重试安装' : data.qzoneInstalled ? data.settings.qzone?.enable ? '已开启 · 待账号实测' : '已安装 · 未启用' : '未安装';
  if(data.progress) paintProgress(data.progress); guide(); window.renderWorkspaceAvailability?.();
  if(activeTab === 'workspace') window.workspaceLoad?.();
}
async function refresh() { if(refreshing) return; refreshing = true; try { render(await invoke('snapshot')); } catch(e) { toast(e.message,true); } finally { refreshing = false; } }
async function action(name,input,success) {
  if(actionRunning) return;
  actionRunning = true; if(snapshot) render(snapshot);
  try { const result = await invoke(name,input); if(success) toast(typeof success === 'function' ? success(result) : success); return result; }
  catch(e) { toast(e.message,true); }
  finally { actionRunning = false; await refresh(); }
}
async function login() {
  const result = await action('copyCredential','napcat','本机 Token 已复制。在打开的网页中按 Ctrl + V，再点击登录。');
  if(result) await action('openPanel','napcat');
  openGuide('token');
}
async function inspect() { try { const info = await invoke('inspect',$('install-path').value.trim()); $('path-meta').textContent = info.kind === 'unmanaged' ? info.message : `${info.kind === 'managed' ? '发现已有的本工具安装。' : '专用安装目录。'}可用 ${info.availableGB.toFixed(1)} GB`; return info; } catch(e) { $('path-meta').textContent = e.message; return null; } }
$('browse').onclick = async () => { try { const root = await invoke('pickFolder'); if(root) { $('install-path').value = root; await inspect(); } } catch(e) { toast(e.message,true); } };
$('install-path').onchange = inspect;
$('install').onclick = async () => { const info = await inspect(); if(info && info.kind !== 'unmanaged') await action('install',info.root,'安装完成。下一步点击上方「启动角色」。'); };
$('start').onclick = () => action('start',undefined,'已启动。等待组件就绪后，打开 QQ 登录页扫码。');
$('stop').onclick = () => action('stop',undefined,'机器人和托管进程已停止，角色与会话数据保留。');
$('refresh').onclick = refresh; $('login').onclick = login;
for(const name of ['astrbot','napcat']) { $('open-'+name).onclick = () => action('openPanel',name); $('copy-'+name).onclick = () => action('copyCredential',name,name === 'astrbot' ? '管理密码已复制，用户名是 astrbot。' : 'Token 已复制，请粘贴到 NapCat 网页。'); }
$('reconnect').onclick = () => action('reconnect',undefined,'已匹配消息连接，请等待状态更新。');
$('export').onclick = () => action('exportDiagnostic',undefined,r => r ? '诊断信息已导出。' : '已取消导出。');
$('verify-chain').onclick = () => action('verifyChain',undefined,'已记录你确认收到 QQ 回复，完整链路实测完成。');
$('test-model').onclick = async () => {
  if(dirty && $('model').value !== snapshot.settings.model) { toast('请先保存模型选择，再测试密钥。',true); return; }
  $('model-result').textContent = '正在发送一条简短测试请求…';
  const result = await action('testModel',$('api-key').value); $('api-key').value = '';
  $('model-result').textContent = result ? `✓ 测试通过 · ${(result.latencyMs/1000).toFixed(1)} 秒。请再点击「保存并应用」。` : '测试未通过，请查看错误提示。';
};
async function save() { const result = await action('saveSettings',form(),'已保存并应用，QQ 保持运行。'); if(result) { dirty = false; delete $('qzone-state').dataset.checked; await refresh(); } }
$('save-settings').onclick = save; document.querySelectorAll('.save-all').forEach(b => b.onclick = save);
for(const id of ['ai-name','persona','model','trigger','prefix','active-enable','active-probability','active-groups','qzone-enable','publish-cron','comment-cron',...Object.keys(qKeys).map(k => 'qzone-'+k)]) $(id).addEventListener('input',() => { dirty = true; $('prefix-field').hidden = $('trigger').value !== 'prefix'; $('probability-label').textContent = $('active-probability').value+'%'; });
document.querySelectorAll('[data-persona]').forEach(el => el.onclick = () => { $('persona').value = templates[el.dataset.persona]; dirty = true; });
$('natural-style').onclick = () => {
  const style = '【自然表达约束】\n直接回应当前话题，用具体事情、动作或感受表达观点。减少反复套用“不是……而是……”“真正的……是……”“你要明白”“某种意义上”等固定句式；有必要作对比时再用，不为升华而强行转折。不要每轮复述我的话、总结道理或夸奖提问。不把普通聊天写成分点讲课，不用排比和抽象词堆砌情绪。保持角色原有的性格、语气与说话长度；该开玩笑就接梗，该回答问题就直接回答。发送前默读一遍，删去重复的铺垫和套话，不展示检查过程。';
  if(!$('persona').value.includes('【自然表达约束】')) { $('persona').value = ($('persona').value.trim()+'\n\n'+style).trim(); dirty = true; toast('已追加到当前草稿，可继续修改；保存后生效。'); }
  else toast('当前草稿已有自然表达约束，可直接修改。');
};
function appearanceForm() { return { accent:$('accent').value,opacity:Number($('background-opacity').value)/100,blur:Number($('background-blur').value) }; }
for(const id of ['accent','background-opacity','background-blur']) $(id).oninput = () => { themeDirty = true; applyAppearance({...snapshot.appearance,...appearanceForm()},false); };
$('save-appearance').onclick = async () => { const value = await action('appearance',appearanceForm(),'小屋外观已保存。'); if(value) { themeDirty = false; applyAppearance(value); } };
for(const type of ['background','avatar']) {
  $('upload-'+type).onclick = async () => { const result = await action('appearance',{upload:type},'图片已保存到本机。'); if(result) { themeDirty = false; applyAppearance(result); } };
  $('remove-'+type).onclick = async () => { const result = await action('appearance',{...appearanceForm(),[type]:''},'已移除展示图片，原图不受影响。'); if(result) { themeDirty = false; applyAppearance(result); } };
}
$('install-qzone').onclick = async () => { $('qzone-state').dataset.checked = 'true'; $('qzone-state').textContent = '正在安装依赖与插件…'; const result = await action('installQzone',undefined,'插件已安装，默认停用。请选择空间开关并点击应用。'); $('qzone-state').textContent = result ? '已安装 · 未启用' : '安装未完成 · 可重试'; };
$('check-qzone').onclick = async () => { const result = await action('qzoneStatus'); if(result) { $('qzone-state').dataset.checked = 'true'; $('qzone-state').textContent = !result.installed ? '未安装' : !result.enabled ? '已安装 · 未启用' : result.bound ? '已绑定 QQ · 操作待实测' : '已开启 · 等待 QQ 登录态'; } };
$('pick-qzone-image').onclick = async () => { const id = await action('pickQzoneImage'); if(id) { qzoneImage = id; $('qzone-image-name').textContent = '已选择 1 张配图'; } };
$('clear-qzone-image').onclick = () => { qzoneImage = ''; $('qzone-image-name').textContent = '未选择图片'; };
$('publish-qzone').onclick = async () => { const result = await action('qzoneAction',{action:'publish',content:$('qzone-content').value,image:qzoneImage},'说说已发布。'); if(result) { $('qzone-content').value = ''; $('clear-qzone-image').click(); } };
$('load-feed').onclick = async () => { const result = await action('qzoneAction',{action:'feed'}); if(!result) return; $('qzone-feed').replaceChildren(); if(!result.items?.length) { $('qzone-feed').textContent = '暂未读取到动态。'; return; } for(const post of result.items) renderPost(post); };
function renderPost(post) {
  const item = document.createElement('article'); item.className = 'feed-item'; const text = document.createElement('p'); text.textContent = post.content || '（图片或视频动态）'; item.append(text);
  const controls = document.createElement('div');
  for(const [label,type] of [['详情','detail'],['点赞','like'],['评论','comment'],['删除','delete']]) {
    if(type === 'delete' && !post.can_delete) continue;
    const b = document.createElement('button'); b.className = 'text-button'; b.textContent = label;
    const key = type === 'detail' ? 'view' : type; b.disabled = !snapshot.settings.qzone?.[key];
    b.onclick = async () => {
      if(type === 'comment') { const editor = document.createElement('textarea'); editor.placeholder = '输入评论内容'; const send = document.createElement('button'); send.textContent = '发送评论'; send.className = 'secondary compact'; send.onclick = () => action('qzoneAction',{action:'comment',id:post.id,content:editor.value},'评论已发送。'); item.append(editor,send); return; }
      if(type === 'delete' && !confirm('删除这条自己发布的 QQ 空间说说？')) return;
      const result = await action('qzoneAction',{action:type,id:post.id},type === 'detail' ? undefined : type === 'delete' ? '已删除。' : '已点赞。');
      if(type === 'detail' && result?.post) {
        item.querySelectorAll('.feed-comment').forEach(n => n.remove());
        for(const comment of result.post.comments || []) {
          const row = document.createElement('div'); row.className = 'feed-comment'; row.textContent = (comment.author?.nickname || '评论')+'：'+comment.content;
          if(comment.can_reply && snapshot.settings.qzone?.comment) {
            const reply = document.createElement('button'); reply.className = 'text-button'; reply.textContent = '回复';
            reply.onclick = () => { const editor = document.createElement('textarea'); editor.placeholder = '输入回复'; const send = document.createElement('button'); send.textContent = '发送回复'; send.className = 'secondary compact'; send.onclick = () => action('qzoneAction',{action:'reply',id:post.id,commentid:comment.id,comment_uin:String(comment.author?.uin || ''),content:editor.value},'回复已发送。'); row.append(editor,send); reply.disabled = true; };
            row.append(reply);
          } item.append(row);
        }
      }
      if(type === 'delete' && result) item.remove();
    }; controls.append(b);
  }
  item.append(controls); $('qzone-feed').append(item);
}
for(const id of ['exit','exit-all']) $(id).onclick = () => action('exit');
$('hide-panel').onclick = () => action('hide');
window.qqai.onProgress(paintProgress); refresh(); setInterval(() => { if(!document.hidden) refresh(); },5000);
