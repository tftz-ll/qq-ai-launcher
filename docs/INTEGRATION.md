# 固定版本接入记录

核对日期：2026-10-28。源码下载和接口验证固定到 AstrBot v4.29.3 与 NapCat v4.18.41。

## AstrBot

- [默认配置](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/config/default.py)：主配置为 `data/cmd_config.json`；OneBot 平台类型 `aiocqhttp`，字段 `ws_reverse_host`、`ws_reverse_port`、`ws_reverse_token`。
- [Agent Runner 配置](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/config/agent_runner.py)：默认模型位于 `agent_runner.config.model.provider_id`，默认人设位于 `agent_runner.config.persona.persona_id`。
- [Provider Manager](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/provider/manager.py)：`provider_source_id` 将模型与 `provider_sources` 中的服务来源关联。工具使用固定 ID `qqai-deepseek`，只更新自己创建的项目。
- [密码实现](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/utils/auth_password.py)：PBKDF2-SHA256、600000 次、16 字节 salt，格式 `pbkdf2_sha256$iterations$salt_hex$digest_hex`。初始化随机强密码，同时写入原生兼容字段与升级状态，不关闭认证。
- [认证接口](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/dashboard/api/auth.py)：`POST /api/auth/login` 提交原文密码，通过 `data.token` 取得凭据，后续使用 `Bearer`。
- [人设接口](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/dashboard/api/personas.py)：`GET /api/persona/list`、`POST /api/persona/create`、`POST /api/persona/update`。工具创建 `qqai-companion`，通过认证接口写入，再在停止状态更新配置引用。
- 管理网页发布包最外层为 `dist/`，`--webui-dir` 必须直接指向有 `index.html` 的该目录。只传发布包解压后的父目录会出现 API 可用但网页缺失。
- `GET /api/platform/stats` 可检查平台服务，不能单凭它证明 OneBot WebSocket 已建立。当前面板另检查本机连接表，明确显示消息实测仍待完成。

## NapCat

- [Windows 发布流水线](https://github.com/NapNeko/NapCatQQ/blob/v4.18.41/.github/workflows/release-publish.yml)：`NapCat.Shell.Windows.Node.zip` 包含 Node、QQ 运行文件和 `napcat/`，适合直接部署到自选目录；无需另行安装整个桌面 QQ。
- [便携启动入口](https://github.com/NapNeko/NapCatQQ/blob/v4.18.41/packages/napcat-develop/index.js)：在安装包所在目录运行 `node.exe index.js`，入口为原生模块准备环境变量。
- [WebUI 配置](https://github.com/NapNeko/NapCatQQ/blob/v4.18.41/packages/napcat-webui-backend/src/helper/config.ts)：`napcat/config/webui.json`，工具首次写入 `host`、`port`、随机 `token`，保持认证开启。
- [认证实现](https://github.com/NapNeko/NapCatQQ/blob/v4.18.41/packages/napcat-webui-backend/src/helper/SignToken.ts)：`SHA256(token + '.napcat')`；`POST /api/auth/login` 的 `hash` 取得 `data.Credential`，后续使用 `Bearer`。
- [QQ 登录接口](https://github.com/NapNeko/NapCatQQ/blob/v4.18.41/packages/napcat-webui-backend/src/router/QQLogin.ts)：`POST /api/QQLogin/CheckLoginStatus`，以 `isLogin`、`coreReady` 等状态判断；首次扫码交给原生网页。
- [OneBot 配置接口](https://github.com/NapNeko/NapCatQQ/blob/v4.18.41/packages/napcat-webui-backend/src/api/OB11Config.ts)：登录后 `POST /api/OB11Config/GetConfig`，保留现有配置并只合并 `network.websocketClients` 中的 `qqai-onebot`，写入 `POST /api/OB11Config/SetConfig`，请求字段 `config` 是 JSON 字符串。
- [网络字段](https://github.com/NapNeko/NapCatQQ/blob/v4.18.41/packages/napcat-onebot/config/config.ts)：反向 WS 的 `url`、`token`、`heartInterval`、`reconnectInterval`。
- 包装启动器必须规范化 `process.argv`，避免包装脚本入口被 NapCat 当作额外的快速登录 QQ 号。保留原生入口文件。

## DeepSeek

[当前官方调用示例](https://api-docs.deepseek.com/zh-cn/) 推荐 `deepseek-flash`，另提供 `deepseek-v4-pro`。工具向 `https://api.deepseek.com/chat/completions` 发送最小测试请求；AstrBot 使用 OpenAI 兼容来源、`https://api.deepseek.com/v1`。

工具不会处理 QQ 消息或建立聊天存储。后台托管通过本机命名管道接收经过随机 Token 认证的启动、停止和状态请求，不开放额外 HTTP 管理接口。


## 0.2 接入变更

角色和模型即时更新使用原生认证接口：GET /api/config/abconf?id=default 读取当前配置；POST /api/config/provider_sources/update 合并本工具管理的来源；POST /api/config/provider/new 或 /api/config/provider/update 管理模型；最后 POST /api/config/astrbot/update 重新加载流水线。所有操作先备份，避免通过重启 QQ 应用角色设置。

空间插件使用 SHA-256 校验过的固定提交 zip，通过 /api/plugin/install-upload 交由 AstrBot 安装；安装前创建关闭自动任务的初始配置。用独立 uv 环境准备插件依赖，核心依赖版本受初始锁约束。现成插件配置由 /api/config/plugin/update 管理，/api/plugin/on 与 /api/plugin/off 控制启停。手动操作走插件的 /api/plug/astrbot_plugin_qzone/page/* 原生认证接口，不在小屋另建聊天或空间数据库。

托管代码与启动包装脚本复制到安装目录的 runtime/launcher，使用 NapCat 便携包中的 node.exe 执行；不再通过小屋本身的 EXE 执行托管。停止时发送认证的 shutdown 并等待结束，后台继续运行时程序解压目录不再被托管占用。
