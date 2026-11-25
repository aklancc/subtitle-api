# 自建字幕聚合服务

**当前版本：5.6.0**

这是一个运行在 Cloudflare Workers 上的字幕搜索与下载聚合服务。它通过 **Wyzie** 和可选的 **SubDL** 获取字幕，并使用 **TMDB** 将影片名称匹配到正确的电影或电视剧。

服务端负责保存上游 API 密钥。播放器和访问者不需要直接接触 Wyzie、SubDL 的密钥。

## 功能说明

- 支持通过 IMDb ID 或 TMDB ID 搜索字幕。
- 支持按电影名、电视剧名搜索，并通过 TMDB 匹配影片。
- 支持电视剧按季、集搜索。
- 默认同时搜索 Wyzie 和 SubDL，并合并、去重搜索结果。
- SubDL 为可选字幕来源；未配置密钥时会自动标记为未启用。
- 优先排列简体中文，其次繁体中文，再排列其他语言。
- 支持按语言、字幕来源、字幕格式和 AI 标记筛选或排序。
- 支持识别上游标记的 AI 字幕；本项目不生成字幕，也不执行 AI 翻译。
- 支持通过 Worker 代理下载选中的字幕，避免播放器直接访问上游下载地址。
- 提供健康检查、来源状态、语言和用量等接口。
- 可选启用访问密钥，避免接口被他人随意调用。
- 提供 ASSRT 兼容接口，可用于支持 ASSRT 自定义字幕源的播放器，例如 Noctra。

## 部署与更新

本项目入口文件：

`src/index.js`

网页管理界面：

`src/ui.js`

Cloudflare 配置文件：

`wrangler.toml`

如果 GitHub 仓库已连接 Cloudflare Workers Builds，推送新提交后通常会自动触发部署。如果没有启用自动部署，需要在 Cloudflare 控制台手动部署最新版本。

**注意：提交到 GitHub 不等于线上 Worker 已经更新。** 修改代码后，请确认 Cloudflare 的部署记录已出现最新版本，再测试接口。

## Cloudflare 密钥配置

进入 Cloudflare 控制台：

**Workers 和 Pages → subtitle-api → Settings（设置）→ Variables and Secrets（变量和机密）**

以下项目应使用 **Secret（机密）** 类型，不要把密钥写入 GitHub 代码或公开配置文件。

| 密钥名称 | 是否必需 | 用途 |
| --- | --- | --- |
| `WYZIE_API_KEY` | 必需 | Wyzie 字幕搜索 API 密钥，也是当前搜索接口的基础字幕来源 |
| `TMDB_API_KEY` | 标题搜索及 ASSRT 搜索需要 | 用于按影片名称匹配电影或电视剧；直接使用 IMDb / TMDB ID 搜索时不需要标题匹配 |
| `SUBDL_API_KEY` | 可选 | 启用 SubDL 字幕来源及其下载代理 |
| `API_ACCESS_KEY` | 建议配置 | 自己设置的访问密钥，用于保护 Worker 接口 |

TMDB 密钥申请地址：

https://www.themoviedb.org/settings/api

Wyzie API 密钥申请地址：

https://sub.wyzie.io/redeem

SubDL 开发者页面：

https://subdl.com/developers

### 密钥配置注意事项

- `WYZIE_API_KEY` 当前是必需项。即使只想使用 SubDL，当前接口也会先检查它是否存在。
- `TMDB_API_KEY` 用于片名匹配。ASSRT 兼容搜索也会先通过 TMDB 识别片名。
- `SUBDL_API_KEY` 未配置时，Wyzie 仍可正常提供搜索结果；配置后会增加 SubDL 来源。
- `API_ACCESS_KEY` 是自己设置的访问密码，不是 Wyzie、TMDB 或 SubDL 提供的密钥。
- 如果配置了 `API_ACCESS_KEY`，标准 API 使用请求头 `Authorization: Bearer 你的访问密钥`；ASSRT 兼容接口使用 URL 参数 `token=你的访问密钥`。
- 如果没有配置 `API_ACCESS_KEY`，接口不会进行访问密钥验证，任何人都可能调用公开接口。
- 添加或修改 Secret 后，请在 Cloudflare 控制台保存并部署，使新配置应用到 Worker。
- 不要把任何真实密钥提交到 GitHub，也不要在聊天中发送密钥值。

## Noctra 播放器接入

Noctra 的自定义字幕源如果选择 **ASSRT** 类型，可按以下方式配置：

| Noctra 配置项 | 填写内容 |
| --- | --- |
| 名称 | 自建字幕源 |
| 接口地址 / API 服务器 | 你的 Worker 根地址，例如 `https://你的Worker名称.workers.dev` |
| Token / 密钥 | 如果配置了 `API_ACCESS_KEY`，填写同一个值；没有配置则留空 |
| 启用此字幕源 | 开启 |

接口地址填写 Worker 根地址即可，不要在末尾额外添加 `/v1/sub/search`。

### Noctra 使用流程

1. 在 Noctra 中搜索电影或电视剧。
2. Worker 通过 TMDB 匹配影片，再聚合 Wyzie 和 SubDL 的字幕结果。
3. Noctra 展示字幕列表，用户选择需要的字幕。
4. 播放器请求字幕详情和下载接口。
5. Worker 从对应字幕来源获取字幕文件，并将文件内容返回给播放器。

搜索结果与下载映射会暂存在 Cloudflare 边缘缓存中，缓存时间约为 **1 小时**。如果详情或下载提示结果已过期，请重新搜索该影片。

## API 接口

除特别说明外，接口均使用 GET 请求。

### 健康检查

| 接口 | 说明 |
| --- | --- |
| `/health` | 查看服务状态、版本和已支持的功能 |
| `/api/v1/health` | 版本化健康检查 |
| `/api/v1/auth-check` | 检查访问密钥是否验证成功 |

健康检查接口不要求访问密钥。启用访问密钥后，其他受保护接口需要通过鉴权。

### 影片搜索

| 接口示例 | 说明 |
| --- | --- |
| `/api/v1/title-search?query=盗梦空间&type=movie` | 按电影名称搜索候选影片 |
| `/api/v1/title-search?query=绝命毒师&type=tv` | 按电视剧名称搜索候选剧集 |
| `/api/v1/search?id=tt1375666` | 使用 IMDb ID 搜索字幕 |
| `/api/v1/search?id=27205` | 使用 TMDB ID 搜索字幕 |
| `/api/v1/search?id=TMDB_ID&season=1&episode=1` | 搜索电视剧指定季、集 |

标准搜索接口默认同时查询已启用的字幕来源。可以通过 `providers` 指定来源：

- `providers=all`：同时查询 Wyzie 和 SubDL（默认）。
- `providers=wyzie`：只查询 Wyzie。
- `providers=subdl`：只查询 SubDL。

还支持语言、类别、AI 标记和排序参数。具体可查看 `src/index.js` 中的参数校验与筛选逻辑。

### 字幕下载

| 接口 | 说明 |
| --- | --- |
| `/api/v1/download?url=搜索结果中的下载地址` | 通过 Worker 代理下载搜索结果中的字幕 |
| `/api/v1/download?provider=subdl&path=SubDL下载路径` | 通过 Worker 代理下载 SubDL 字幕 |

下载代理只接受代码中允许的字幕服务域名或经过校验的 SubDL 路径，不应将它改成任意 URL 代理。

### 其他信息

| 接口 | 说明 |
| --- | --- |
| `/api/v1/sources` | 查询 Wyzie 支持的字幕来源信息 |
| `/api/v1/languages` | 查询 Wyzie 支持的语言 |
| `/api/v1/status` | 查询 Wyzie 服务状态 |
| `/api/v1/usage` | 查询 Wyzie API 用量信息 |

以上信息接口主要反映 Wyzie 上游状态，不代表 SubDL 的独立用量统计。

## ASSRT 兼容接口

ASSRT 兼容接口位于根路径 `/v1/*)，与通用接口 `/api/v1/*` 是两套不同的接口。

| 接口 | 说明 |
| --- | --- |
| `/v1/sub/search?q=影片名称&token=访问密钥` | 搜索并聚合字幕 |
| `/v1/sub/detail?id=字幕编号&token=访问密钥` | 获取所选字幕的详情和下载地址 |
| `/v1/sub/download?id=字幕编号&token=访问密钥` | 下载所选字幕文件 |
| `/v1/user/quota?token=访问密钥` | ASSRT 兼容性检查接口 |

说明：

- ASSRT 搜索会先通过 TMDB 匹配影片，再查询 Wyzie 和 SubDL。
- 电视剧搜索支持从类似 `剧名.S01E02` 的文本中提取季、集信息。
- 搜索参数支持常见的 `q`、`pos`、`cnt`。
- 搜索结果使用临时数字编号，详情和下载请求通过该编号找到原始字幕记录。
- 临时记录保存在 Cloudflare 边缘缓存中，约一小时后过期；过期后重新搜索即可。
- 这是本项目实现的 ASSRT 兼容接口，并非官方 ASSRT 服务。
- `/v1/user/quota` 返回的是兼容性响应，不是实际账号额度或真实用量统计。

## 字幕语言与 AI 标记

- 简体中文优先于繁体中文，繁体中文优先于其他语言。
- 部分字幕会根据语言标记、文件名和发布名称识别简体或繁体。
- 上游提供的 AI 字幕会保留 AI 标记，可按需筛选。
- 项目只负责搜索、整理和下载上游字幕，不会自行生成字幕或执行 AI 翻译。

## 本地开发

需要 Node.js 环境。进入项目目录后执行：

```bash
npx wrangler secret put WYZIE_API_KEY
npx wrangler secret put TMDB_API_KEY
npx wrangler secret put SUBDL_API_KEY
npx wrangler dev
```

如果本地没有配置可选的 `SUBDL_API_KEY` 或 `API_ACCESS_KEY`，对应功能会按未启用状态运行。

本地密钥请放在 `.dev.vars` 或 `.env` 中，并确保这些文件已加入 `.gitignore`，不要提交到仓库。

## 安全提示

- 所有上游 API 密钥都应保存在 Cloudflare Worker Secrets 中。
- 建议配置 `API_ACCESS_KEY`，避免 Worker 被公开滥用。
- 不要在前端代码、README 示例或 Git 提交中写入真实密钥。
- 下载接口应继续限制上游域名和路径，避免形成开放代理。
- Cloudflare Secret 的值保存后不会再次明文显示，这是正常的安全机制。
