# 署名与第三方说明

Required Notice: Copyright 2026 tftz-ll and QQ AI 小屋 contributors (https://github.com/tftz-ll/qq-ai-launcher)

## 本仓库的许可范围

本仓库作者有权许可的自主代码、界面、文档及原创资源，采用根目录 [LICENSE](LICENSE) 中的 **PolyForm Noncommercial License 1.0.0**。

允许的非商业使用、修改和分发，以及署名、通知等具体义务，以许可原文为准。未经权利人另行书面许可，不得为商业目的转售、打包出售本项目，或将本项目用于商业化服务。该许可属于源码可见的非商业许可，不是 OSI 所定义的开源许可。

本项目许可不覆盖、替换或扩大第三方组件的许可，也不代表作者已获得第三方的商业授权。作者对自主内容作出的额外许可，同样不授予任何第三方权利。

## 上游与依赖

| 项目 | 角色 | 许可与说明 |
| --- | --- | --- |
| [AstrBot](https://github.com/AstrBotDevs/AstrBot) | 会话、人设、上下文、模型及插件框架 | [固定版本许可](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/LICENSE)，AGPLv3；另见上游使用声明 |
| [NapCatQQ](https://github.com/NapNeko/NapCatQQ) | 个人 QQ 协议端与 OneBot 接口 | [固定版本许可](https://github.com/NapNeko/NapCatQQ/blob/v4.18.41/LICENSE)，自定义 Limited Redistribution License，包含非商业限制 |
| [astrbot_plugin_qzone](https://github.com/Zhalslar/astrbot_plugin_qzone) | 可选 QQ 空间插件 | [固定提交许可](https://github.com/Zhalslar/astrbot_plugin_qzone/blob/0f5720f78d7bba45d94778580397e08fcfd02570/LICENSE)，GPLv3；使用时保留原始许可与署名 |
| [uv](https://github.com/astral-sh/uv) | Python 环境和依赖管理 | 以对应发行版本随附的 MIT / Apache-2.0 许可及第三方说明为准 |
| [Electron](https://github.com/electron/electron) | 桌面运行环境 | MIT；其 Chromium 等内含组件保留各自的许可和版权通知 |
| [yauzl](https://github.com/thejoshwolfe/yauzl) | 压缩包读取 | MIT，保留依赖中的原始许可 |

AstrBot、NapCat、uv 和可选插件由用户按需从对应来源下载。本源码仓库不收录这些组件的完整源码、运行包或用户安装数据。接口配置与调用不表示重新许可上游项目。

Windows 发布包包含 Electron 和必要的应用依赖；其中的 `LICENSE.electron.txt`、`LICENSES.chromium.html` 以及依赖随附的版权通知应一并保留。

DeepSeek 是用户自行配置的外部 API 服务；QQ 是腾讯提供的服务。用户分别遵守其适用条款。本项目是第三方工具，不隶属于 AstrBot、NapCat、DeepSeek 或腾讯，也不表示获得上述项目或服务的官方背书。

用户自行上传的图片、角色设定、其他插件及其依赖，权利属于相应权利人，不因在小屋中使用而转移给本项目。仓库界面预览仅使用隔离的纯演示数据，不读取真实安装位置、磁盘信息、账号或密钥，也不包含用户提供的参考插画。
