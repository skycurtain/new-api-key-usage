# AGENTS.md

给 AI 协作者的仓库指引。**开始任何工作前，先读 [`README.md`](README.md)**——它是全景入口：项目是什么、为什么长这样、走到哪了。

## 协作约定（长期有效）

- **Git**：仅当项目作者明确说"提交 / commit"时才执行提交；`git push` 永远由项目作者手工执行，AI 绝不推送
- **命名**：需求 / 设计 / 交互 / 技术 / 计划等**文档名**用中文（`README` / `AGENTS` / `LICENSE` 等约定俗成除外）、**目录**用英文；新文档按性质放入 `docs/design/`（我们定的方案与决策）或 `docs/references/`（平台可用接口参考——实证事实，不做设计决策），并同步更新 README 的「文档地图」；`docs/deprecated/` 只归档已废弃文档——**勿引用、勿作依据**（本分支暂无此目录，需要时再建）
- **代码文件命名**：所有**目录名与文件名**一律 kebab-case（如 `time-range-picker.vue` · `admin-session.ts`）；**组件在模板中引用时用大驼峰**（`<TimeRangePicker />`）——文件名 kebab、模板标签 PascalCase
- **文档状态**：头部表格标「状态」（草案 → 讨论中 → 待审阅 → 定稿(日期) → 已实现）；设计文档定稿后不搬家、只改状态；被取代时删除（git 历史即考古）
- **部署**：交付物必须保证「一条命令链」可部署；**双形态并行已裁决**——完整前后端（运营方服务器）先行，Cloudflare Workers 抽取版（作者自部署）后续（见 `docs/design/需求清单.md` R13）
- **不引入版本叙事**：不使用 v1/v2/v3 之类版本编号，不以「MVP」等标签或指称显式描述任何历史阶段；文档内容必须**自立**——不得引用、描述任何当前分支之外、可能被删除的分支内容
- **本地不入库也不 ignore 的物料**（AI 提交时务必避开）：`api*.json`（上游实测快照）、`session-archive/`（作者主动备份的会话记录，如 `v1-设计-*.md`）——不加入 git、不写 `.gitignore`，靠提交时人工/执行者目视把关；`v1-设计-1.md` 为历史对话原档，允许保留旧术语，不作现行依据

## 项目速览（速记）

- **`v1`（本分支）= 设计文档中心 + 实现主线**：实现代码与文档同分支演进（代码落点已定案），monorepo 结构（`apps/server` · `apps/web` · `packages/core` · `packages/db`）见 `docs/design/技术选型.md` §4
- 数据模型：四张基线表（`api_keys` · `usage_logs` · `payments` · `qpu_history`）+ 三张访问主体表（`members` · `users` · `sessions`）设计见本目录，**七篇已定稿（2026-10-01，经作者逐篇审阅）**；同步架构（轮询 + `request_id` 去重 + 攒库）的动因由上游物理约束决定，架构结论不变
- 需求总集与待裁决项（平台身份体系、费用分摊与账单、充值折算、多订阅、数据资产保护）见 `docs/design/需求清单.md`；交付形态已裁决（双形态并行，完整形态先行）
- 上游约束速记：只有 sk-key、无时间过滤接口 → 轮询攒库是唯一路径（README「架构的根本动因」）

## 命令

Bun 工具链（选型见 `docs/design/技术选型.md`）。**Windows 上 `bun` 需在 PowerShell 7（`pwsh`）里跑**——mise shim 由 pwsh profile 激活；Windows PowerShell 5.1 会报 command not found，改用 `pwsh -c "…"` 或绝对路径。

| 命令 | 用途 |
|------|------|
| `bun install` | 安装 / 链接 workspace 依赖（在仓库根） |
| `bun test` | 全部测试（core 契约 + server HTTP + **集成**）；集成需 `DATABASE_URL`（compose 中的 PG），无库时自动跳过 |
| `bun --env-file=.env scripts/seed-from-samples.ts` | 从根目录 `api*.json` 实测快照灌开发库（幂等）；验收接口口径用 |
| `bun run typecheck` | 根 tsconfig 类型检查（不含 web `.vue`） |
| `bun run dev:server` | 开发跑母体后端（hot reload） |
| `bun run dev:engine` | 开发跑同步引擎（独立进程，读 `SYNC_*` env） |
| `bun run dev:web` | 开发跑前端 Vite |
| `docker compose up -d` | 起开发用 PostgreSQL |
| `bun run --filter @new-api-key-usage/db db:generate` | 生成 SQL 迁移（`packages/db/drizzle/`） |
| `bun run --filter @new-api-key-usage/db db:push` | 推送到本地库（开发期） |

环境变量见 `.env.example`（复制为 `.env` 后填写）。

**默认端口 `18456`**（避开 3000/3001 等本机占用）；`NEWAPI_BASE` 是上游 NewAPI 地址，与本服务端口无关。在线文档：`http://127.0.0.1:18456/api/docs`。
