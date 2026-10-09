# usage_logs 表字段设计

> 数据模型第二张表：调用日志明细——增量同步的落点，本项目「任意时间范围用量」的唯一数据来源。字段清单依据 `/api/log/token` 实测响应（1000 条样本）与上游源码（`model/log.go`）双重校对；上游只有 1000 条滚动窗口，**错过即永久丢失**。

| 项目 | 内容 |
|------|------|
| 状态 | 定稿（2026-10-01） |
| 关联 | `docs/references/NewAPI-接口范围.md` §2.⑨（`/api/log/token` 字段与限制依据）· `docs/design/api_keys表字段设计.md`（`api_key_id` 外键指向） |
| 定稿范围 | 列结构 + 去重与写入策略；同步引擎细节（调度、401 处理）不在此文；方言映射归数据访问层设计 |
| 字段数 | 25 = 3 系统字段 + 2 来源提列 + 20 上游字段（上游响应共 21 个字段，其中展示序号 `id` 不落表，见 3.2） |

---

## 1. 表定位

- **一行 = 一次上游调用记录**（消费 / 错误等类型全覆盖）
- 它是本项目最核心的数据资产：上游 `/api/log/token` 只保留最近 1000 条（实测当前速率下 ≈ 3 天），**错过即永久丢失**——本地全量累积是"任意时间范围用量"的唯一实现路径
- 与 `api_keys` 多对一：每条日志经 `api_key_id` 指向其所属 key
- 计费来源（`billing_source` / `subscription_id`）是**一等维度**：按来源统计、日志与支付记录的 `subscription_id` 直连（见 3.6）
- 数据规模：实测约 300+ 条/天，量级为数十万行/年——单表 + 时间索引完全够用，无需分区或预聚合

## 2. 字段清单

### 2.1 系统字段（3 个，本系统产生）

| 列 | 类型 | 值来源 | 说明 |
|----|------|--------|------|
| `id` | bigserial PK | 自增 | 本地主键（与上游的展示序号 `id` 无关） |
| `api_key_id` | bigint FK | 同步引擎 | → `api_keys.id`；日志归属与索引锚点 |
| `dedupe_key` | text UNIQUE | 写入前生成 | **去重唯一键**，规则见 3.1 |

### 2.2 来源提列字段（2 个，解析自 `other`、提升为独立列）

| 列 | 类型 | 上游来源 | 说明 |
|----|------|---------|------|
| `billing_source` | text | `other.billing_source` | 计费来源：`subscription`（订阅）/ `wallet`（充值）——按来源统计的维度 |
| `subscription_id` | bigint NULL | `other.subscription_id` | 该次消耗所属的上游订阅实例 ID——与 `subscriptions.subscription_id` 直连；缺失时 NULL（归「未关联」分组，见 3.6） |

### 2.3 上游字段（20 个，`/api/log/token` 响应照收）

| 列 | 类型 | 上游字段 | 说明 |
|----|------|---------|------|
| `user_id` | bigint | `user_id` | 账号 ID（同一实例内恒定） |
| `created_at` | timestamptz | `created_at` | 上游 UTC Unix 秒，入库转换；范围查询主维度 |
| `type` | smallint | `type` | 日志类型 0-7 枚举（完整表见接口文档）；照存不过滤 |
| `content` | text | `content` | 消费记录为空串；错误记录为错误详情 |
| `username` | text | `username` | 账号用户名 |
| `token_name` | text | `token_name` | 快照存储（保真；展示取当前名口径由 API 契约（待立）另定） |
| `model_name` | text | `model_name` | |
| `quota` | bigint | `quota` | 原始 quota |
| `prompt_tokens` | int | `prompt_tokens` | |
| `completion_tokens` | int | `completion_tokens` | |
| `use_time` | int | `use_time` | 秒 |
| `is_stream` | bool | `is_stream` | |
| `channel` | int | `channel` | 渠道 ID |
| `channel_name` | text | `channel_name` | 普通用户视角为空串 |
| `token_id` | bigint | `token_id` | 上游 token ID（对账用） |
| `group_name` | text | `group` | PG 保留字改名 |
| `ip` | text | `ip` | 普通用户视角为空串 |
| `request_id` | text | `request_id` | 原值保留；JSON tag 为 `omitempty`，源码写入时有兜底 |
| `upstream_request_id` | text NULL | `upstream_request_id` | **可选字段**：`omitempty`——空值时不出现、有值才出现（实测样本中缺席） |
| `other` | jsonb | `other` | JSON 字符串解析入库（可查询；含缓存/倍率/延迟等扩展信息） |

> 上游响应中的展示序号 `id`（每次从 1 重编）不落表——见 3.2。

### 2.3 索引

| 索引 | 列 | 用途 |
|------|-----|------|
| PRIMARY KEY | `id` | |
| UNIQUE | `dedupe_key` | 去重（`ON CONFLICT` 的落点） |
| 普通 | `(api_key_id, created_at DESC)` | 明细页 + 按 key 聚合 |
| 普通 | `(created_at DESC)` | 跨 key 合计与统计 |

## 3. 决策记录（含理由）

### 3.1 去重：单列 `dedupe_key`，按类型分规则

- `request_id` 是去重依据（上游为每次请求生成的编号）；但**错误行上不唯一**——实测样本中同一 `request_id` 可对应多条 `type=5` 错误记录（同一请求的多次失败 / 重试，`content` 的 `status_code` 可不同）。按 `request_id` 一律去重会把它们合并——**失败次数被少算，事实被丢**。规则按类型分：

  - **消费行（`type = 2`）**：`dedupe_key = ${api_key_id}:${request_id}`（实测未观察到消费行 `request_id` 重复；重复拉取幂等合并）
  - **非消费行（`type ≠ 2`，如实测的错误行）**：`dedupe_key = ${api_key_id}:${request_id}:${content指纹}`，指纹 = `sha256(api_key_id, created_at, type, model_name, quota, prompt_tokens, completion_tokens, use_time, content)`——把 `content` 纳入：同一请求多次失败、错误详情不同即指纹不同，**各自保留**；全部字段完全一致的两行在「无法区分」的意义上视作重复拉取，合并无害
  - `request_id` 为空时：退化为纯内容指纹（同上字段集，消费行不含 `content`）

- **为什么不把 UNIQUE 直接挂在 `request_id` 列上**：空值语义两难——`NULL` 在唯一索引中互不冲突（空值行会重复入库）；转空串则过度冲突（第二条空值记录被静默丢弃）。单列 `dedupe_key` + 指纹兜底从根上规避
- `api_key_id:` 前缀：跨 key 隔离的零成本保险
- `request_id` 原值仍单独成列——两者并行，互不替代
- **为什么它不做主键**：主键是「行身份」（短、稳定、永不变化），`dedupe_key` 是「防重签名」（长、由业务规则拼接、可能随上游演化）——让可变规则决定行身份是耦合隐患；代理键（自增 `id`）+ 独立唯一约束是标准做法

### 3.2 上游展示序号 `id` 不落表

它是每次响应从 1 重编的展示序号（源码 `assignDisplayLogIds`），跨请求无意义——绝不能用于去重，也没有存储价值。

### 3.3 `other` 用 jsonb

- 原样保真（解析后完整存储）+ 查询能力（`other->>'cache_tokens'`）；jsonb 是 PostgreSQL 内置类型
- 普通用户视角的 `other` 已由服务端做过一层「可见性过滤」——我们存的就是用户实际可见的部分

### 3.4 `raw` 兜底列：不加

21 个候选字段（响应理论全集）已由实测 + 源码双重校对齐全，且 `other` 已单独 jsonb 保真（信息富集区）；字段集变化的风险由「同步持续运行 + 代码随上游更新」覆盖，接受历史缺值的可能性。

### 3.5 命名与类型

- 上游字段采用原名；例外：`group` → `group_name`（PG 保留字）
- 时间列统一 `timestamptz`（应用层做 UTC ↔ 北京时间转换）；`quota` 用 `bigint`
- `type` 用 `smallint` 存原值（0-7 为稳定枚举），展示层翻译（未知值原样显示数字）

### 3.6 来源提列：`billing_source` 与 `subscription_id` 升为独立列

- **为什么提列**：两者是按来源统计与日志-支付记录直连的核心维度——`other` jsonb 的键查询无法走索引（SQLite/D1 的 `json_extract` 同理），高频过滤维度应独立成列
- **`subscription_id` 直连语义**（事实关联，非推算）：日志按 `subscription_id = subscriptions.subscription_id` 关联订阅登记；**不做期间推定**——订阅来源但该列缺失（NULL）的行归「未关联订阅」分组，统计中透明显示（正常应恒为零，非零即「缺登记」或「上游行为变化」的异常信号）
- `billing_source = wallet`（充值）的日志不挂订阅（余额扣款与订阅实例无关），`subscription_id` 为 NULL 是**正常状态**而非异常——按来源统计时它们在「充值」分组，不进「未关联订阅」分组
- **其他键留在 `other`**：提列只针对这两个一等维度；`cache_tokens`、倍率等仍留在 jsonb，出现真实分析需求再评估（见 §5）

### 3.7 行级归属

- key 的成员归属是**管理面可变的**（key 中途转给另一个成员），日志行不复制归属——统计时经 `api_key_id → api_keys.member_id` 联查取**当前归属**
- 归属变更不重写历史：变更后的统计自然反映新归属；「变更前谁用了多少」不是平台的账目职责（分账是社交层问题——平台只保证当前事实的正确）

## 4. 写入时机与策略

| 时机 | 动作 |
|------|------|
| 登记首轮同步 | 拉最近 1000 条 → 逐条入库 |
| 每轮轮询 | 同上；`INSERT ... ON CONFLICT (dedupe_key) DO NOTHING`——幂等，只落新行 |

- 写入者唯一：同步引擎（不存在其他写入路径）
- 日志不可变：已入库的行不做 UPDATE
- 与本表相关的读取链：从 `api_keys` 取密文 → 解密 → 调上游 → 新日志写本表

## 5. 待定事项（关联后续环节）

| 事项 | 归属 |
|------|------|
| 明细/统计的查询口径（`type` 过滤策略） | API 契约（待立） |
| `other` 内其余高频键是否提为独立列（如 `cache_tokens`） | 出现真实分析需求时再评估（`billing_source` / `subscription_id` 已提列，见 3.6） |
| 数据保留策略（是否清理旧数据） | 后议 |
