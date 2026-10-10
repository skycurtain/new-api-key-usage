# new-api-key-usage

> NewAPI 网关下的 key 用量统计工具（产品名 **NAKU**）

定时用每个 sk-key 轮询网关日志接口，按 `request_id` 去重，攒全量日志到数据库；任意时间范围的用量查询，即一条本地聚合查询。

| 项目 | 内容 |
|------|------|
| 当前状态 | **实现推进中**——设计文档主体定稿；后端 + 同步引擎 + 前端（管理面与成员视图）已落地；部署链与衍生形态待收尾 |
| 技术栈 | 全栈 TypeScript（选型见 [`docs/design/技术选型.md`](docs/design/技术选型.md)）：Bun + Hono + Drizzle + PostgreSQL · 前端 Vue 3 + antdv-next |

## 这是什么

面向 [NewAPI](https://github.com/QuantumNous/new-api) 实例的**独立计费辅助平台**：作者购买订阅额度后，创建多个 sk- API key 分发给多名使用者分摊成本。平台只提供**事实服务**——用量、来源标注、支付参数、多维统计；**不算「谁该付谁多少钱」**（分摊是人和人之间的事）。

- 名字直述用途：NewAPI 网关下按 key 查询用量（key usage）；产品展示名 NAKU
- 全场景统一小写 kebab-case：仓库名 / 包名一致

## 背景与约束

- 真实场景：NewAPI（Go + GORM 开源 LLM 网关）实例提供订阅服务，多使用者通过分发 API key 共享订阅额度——**非商业，纯成本分担**
- 项目作者是该实例的**普通用户**：只有 sk-key，**没有实例管理员账号**
  - 一切数据获取只能走 key 级接口（账号级接口用 sk-key 访问会 401）
  - 交付形态为**双形态并行**：完整前后端部署在实例运营方提供的服务器上（作者不接触服务器）+ Cloudflare Workers 抽取版部署在作者自控账号（见 [`docs/design/需求清单.md`](docs/design/需求清单.md) R13）

**双形态并行的动因**：服务器部署形态下，每次迭代都需实例运营方手工升级；部署到作者自控的 Cloudflare 账号后，迭代部署权回到作者手里。母体完整前后端先行，Workers 抽取版延后至功能全集实现后。

## 核心能力

| # | 能力 | 说明 |
|---|------|------|
| 1 | key 用量查询 | 按时间范围查模型请求日志与用量；作者全员视角在管理面总览，成员视角在成员视图 |
| 2 | key 登记 | 管理通道手动登记：入库并加入轮询；生命周期为手动启停（引擎只读 `status`） |
| 3 | 支付事实登记 | 订阅权益与充值入账分表登记；对成员完全公开透明 |
| 4 | 多维统计 | 按成员 / key / 计费来源 / 模型的任意时段聚合 |

完整需求范围（含刻意不做的部分）见 [`docs/design/需求清单.md`](docs/design/需求清单.md)。

## 架构的根本动因：为什么必须攒数据

这不是优化选项，是上游接口的物理约束决定的**唯一路径**（不随部署形态改变）：

1. sk-key 可用的接口（`/api/usage/token`、`/api/log/token` 等）返回的都是**累计值**或**最近 1000 条**，没有任何接口支持时间范围过滤
2. 真正适合算「当月用量」的接口（`/api/log/self/stat`，支持时间范围 + quota 汇总）需要账号登录态，sk-key 访问 401——这是「按时间段统计用量」无法纯客户端实现的**核心障碍**
3. `/api/log/token` 硬上限 1000 条、不支持任何参数（分页 / limit / 时间过滤全被忽略）

→ 结论：轮询同步 + `request_id` 去重入库 + 数据库。**部署形态可以变，攒库架构不变。** 上游接口完整实证（含源码出处）见 [`docs/references/NewAPI-接口范围.md`](docs/references/NewAPI-接口范围.md)。

## 技术栈与结构

全栈 TypeScript，monorepo（Bun workspaces）：

```text
apps/
  server/     # 后端：Hono + Drizzle/pg + Scalar 在线文档
  engine/     # 同步引擎：独立进程，轮询去重入库
  web/        # 前端：Vue 3 + antdv-next + Vite
packages/
  core/       # 业务核心：去重、折算、加密、上游客户端、DTO
  db/         # 数据访问层：Drizzle schema + 仓储
```

数据模型：`api_keys` · `usage_logs` · `subscriptions` · `topups` · `qpu_history` + `members` · `users` · `sessions`。

## 快速开始

前置：Bun、一个可用的 PostgreSQL（本机已有或别处均可）。

```bash
bun install
cp .env.example .env          # DATABASE_URL 指向你已有的 PostgreSQL
bun run db:push               # 开发期推送 schema
bun run dev:server            # 后端（默认 18456）
bun run dev:engine            # 同步引擎（另开终端）
bun run dev:web               # 前端 Vite（5175）
```

在线 API 文档：`http://127.0.0.1:18456/api/docs`。

更多命令与协作约定见 [`AGENTS.md`](AGENTS.md)。

## 部署

生产形态：**Caddy**（前端静态 + `/api` 反代）+ **server / engine 单文件**（Bun `--compile`）+ PostgreSQL；启动时自动应用 `packages/db/drizzle` 迁移。开发不依赖本 Compose——把 `DATABASE_URL` 指到任意可用 PostgreSQL 即可。

### 起服务

```bash
cp .env.example .env
# 必改：DATABASE_URL、SK_KEY_ENCRYPTION_SECRET、NEWAPI_BASE、COOKIE_SECURE
docker compose up -d --build
```

- 页面：`http://<服务器>/`；接口文档：`http://<服务器>/api/docs`
- 升级：`git pull` 后重复 `docker compose up -d --build`（改表随启动迁移）

### 环境变量要点

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 数据库配置的**唯一来源**（用户 / 密码 / 库名都在串里）。开发指向本机库；部署同一份即可，compose 会把主机改写为容器服务名 `postgres` |
| `SK_KEY_ENCRYPTION_SECRET` | ≥32 字节随机数（base64url）。**生成一次、入库后不可更换**——丢失则已登记 key 无法解密，与库同等备份 |
| `NEWAPI_BASE` | 上游 NewAPI 实例根地址 |
| `COOKIE_SECURE` | HTTPS / 域名用 `true`；纯 IP + HTTP 用 `false`（否则登录后立刻 401） |
| `ADMIN_INIT_USERNAME` / `ADMIN_INIT_PASSWORD` | 可选；同时存在时空库首次静默建管理员 |

### 服务分工

| 服务 | 职责 | 对外 |
|------|------|------|
| `caddy` | 前端静态 + `/api` 反代 | 仅 80 / 443 |
| `server` | 管理面 / 成员视图 API | 内网 |
| `engine` | 轮询上游、去重入库 | 内网 |
| `postgres` | 数据（卷 `pgdata`） | 内网 |

### HTTPS

把 `deploy/Caddyfile` 站点行从 `:80` 改成域名（如 `your.domain.example`），重建后 Caddy 自动签证书；同时设 `COOKIE_SECURE=true`。

### 常用命令

```bash
docker compose ps                 # 运行状态
docker compose logs -f engine     # 看同步
docker compose restart server     # 只重启后端
docker compose down               # 全停（数据在卷里，不丢）
```

### 注意

1. `COOKIE_SECURE` 必须与访问方式匹配：HTTP + `true` 会「登录后立刻 401」
2. `SK_KEY_ENCRYPTION_SECRET` 更换等于已登记 key 全部作废
3. `DATABASE_URL` 密码含 `@` `:` `/` 等字符时做 URL 编码

## 文档地图

| 文档 | 什么时候读 | 状态 |
|------|-----------|------|
| [`docs/design/需求清单.md`](docs/design/需求清单.md) | **需求权威索引与裁决档案**——R1–R15 全部定案；含支付拆表裁决 | 定稿（2026-10-09） |
| [`docs/design/技术选型.md`](docs/design/技术选型.md) | 技术栈裁决：全栈 TS；Bun + Hono + Drizzle/pg；前端 Vue 3 + antdv-next；分层落地与回退 | 定稿（2026-10-02） |
| [`docs/design/api_keys表字段设计.md`](docs/design/api_keys表字段设计.md) | key 登记、生命周期与成员归属 | 定稿（2026-10-01） |
| [`docs/design/usage_logs表字段设计.md`](docs/design/usage_logs表字段设计.md) | 日志明细、来源提列、去重与写入策略 | 同上 |
| [`docs/design/payments建模评估.md`](docs/design/payments建模评估.md) | 支付建模复盘：订阅权益 vs 充值入账两分；拆表已采纳 | 定稿（2026-10-09） |
| [`docs/design/subscriptions表字段设计.md`](docs/design/subscriptions表字段设计.md) | 订阅权益：期间 + 额度预算 + 可选付款事实；`subscription_id` 直连日志 | 待审阅（2026-10-09） |
| [`docs/design/topups表字段设计.md`](docs/design/topups表字段设计.md) | 充值入账事件：`paid_at` 主轴；不挂订阅 | 待审阅（2026-10-09） |
| [`docs/design/qpu_history表字段设计.md`](docs/design/qpu_history表字段设计.md) | 换算参数时间线（自动采样、只读） | 定稿（2026-10-01） |
| [`docs/design/members表字段设计.md`](docs/design/members表字段设计.md) | 成员实体——key 归属、成员视图身份与按成员统计的锚点 | 同上 |
| [`docs/design/users表字段设计.md`](docs/design/users表字段设计.md) | 管理员（单行）——登录体系的身份落点 | 同上 |
| [`docs/design/sessions表字段设计.md`](docs/design/sessions表字段设计.md) | 管理面会话——cookie 令牌的服务端对应物 | 同上 |
| [`docs/design/交互设计-总览与共性.md`](docs/design/交互设计-总览与共性.md) | 交互总纲：访问拓扑、导航、跨页组件、状态与数值呈现约定 | 定稿（2026-10-01） |
| [`docs/design/交互设计-登录与会话.md`](docs/design/交互设计-登录与会话.md) | 登录页、引导页、改密、成员登录壳 | 同上 |
| [`docs/design/交互设计-全员总览.md`](docs/design/交互设计-全员总览.md) | 管理面首页：健康带 + 按成员 / key 汇总 | 同上 |
| [`docs/design/交互设计-调用日志.md`](docs/design/交互设计-调用日志.md) | 调用日志：筛选、明细表、与 key/成员/总览的跳转链 | 定稿（2026-10-08） |
| [`docs/design/交互设计-key管理.md`](docs/design/交互设计-key管理.md) | 登记（sk-key 唯一界面露面）、启停、归属、死亡显形 | 定稿（2026-10-01） |
| [`docs/design/交互设计-支付记录.md`](docs/design/交互设计-支付记录.md) | 支付记录（两 Tab）：订阅权益 / 充值入账登记、核对提示 | 待审阅（2026-10-09） |
| [`docs/design/交互设计-成员管理.md`](docs/design/交互设计-成员管理.md) | 开户、令牌签发/重发（明文仅一次）、停用 | 定稿（2026-10-01） |
| [`docs/design/交互设计-审计日志.md`](docs/design/交互设计-审计日志.md) | 管理操作留痕时间线 | 同上 |
| [`docs/design/交互设计-成员视图.md`](docs/design/交互设计-成员视图.md) | 成员视图三页（总览 / 调用日志 / 支付参数）；订阅徽章展开 + 调用详情 | 定稿（2026-10-09） |
| [`docs/design/API契约-公共约定.md`](docs/design/API契约-公共约定.md) | API 总纲：路由隔离与鉴权两档、错误信封、时间 / 数值 / 分页 / 命名 | 定稿（2026-10-02） |
| [`docs/design/API契约-管理面.md`](docs/design/API契约-管理面.md) | 管理面 18 端点 | 待审阅（2026-10-09） |
| [`docs/design/API契约-成员视图.md`](docs/design/API契约-成员视图.md) | 成员视图 3 端点：`/me` · `/overview` · `/logs` | 待审阅（2026-10-09） |
| [`docs/design/同步引擎设计.md`](docs/design/同步引擎设计.md) | 独立 `apps/engine`：轮次、失败只记录、`engine_status` 快照 | 已实现（定稿 2026-10-05） |
| [`docs/references/NewAPI-接口范围.md`](docs/references/NewAPI-接口范围.md) | 上游可用接口参考：鉴权档位、字段语义、实测行为、源码出处（**唯一上游参考**） | 事实依据 |

- 命名与分区：**目录用英文、文档名用中文**；`docs/design/`（方案与决策）· `docs/references/`（平台可用接口参考——实证事实，不做设计决策）
- 生命周期：状态流转（草案 → 讨论中 → 待审阅 → 定稿(日期) → 已实现）；定稿后不搬家、只改状态；被取代时删除（git 历史即考古）

## 关键事实清单（实测 / 源码确认，设计时不得违反）

> 出处均见 [`docs/references/NewAPI-接口范围.md`](docs/references/NewAPI-接口范围.md)，此处仅索引。

1. **`QuotaPerUnit = 500000`**：quota ÷ 500000 = 额度美元——**它不是实付金额**；折算到实付金额还需乘「购买汇率」（由运营方定价、可变）
2. **去重必须用 `request_id`**：`/api/log/token` 返回的 `id` 是每次从 1 重编的展示序号，绝不能用于去重
3. **`created_at` 是 UTC Unix 秒**，本地时间输入需转换
4. **1000 条硬上限**：窗口只保留最近 1000 条——当前日志速率下约等于 3 天；同步停摆超过窗口会永久丢数据
5. **`TokenAuthReadOnly`**：用量/日志接口用宽松鉴权，key 过期 / 额度耗尽仍可查询；**显式禁用会被 401 拒绝**
6. **`DisplayTokenStatEnabled` 已开启**：billing 接口返回 token 级额度
