# NewAPI 接口范围

> 计费平台在 NewAPI 中可用的接口参考：每个接口的鉴权档位、请求与返回结构、字段语义、实测行为与对平台的用途——**平台所有上游调用都出自这份文档**。
>
> 依据：NewAPI 源码考证 + 接口实测 · 实测环境：NewAPI 实例 · 上游仓库：https://github.com/QuantumNous/new-api

---

## 0. 通用说明

### 认证方式

所有需要凭证的接口均使用 API key 鉴权，在请求头中携带：

```
Authorization: Bearer sk-xxxxxxxxxxxx
```

**不需要**账号登录态（access token / session）——这是仅凭 sk-key 即可查询的关键前提。BaseURL 即 NewAPI 站点地址，路径直接拼接、无多余前缀。

### 关键开关：`DisplayTokenStatEnabled`

- **billing 接口（⑤⑥）受影响**：开启 → 返回 token 级额度；关闭 → 回退账号级额度（会暴露整个账号余额）
- `/api/usage/token`、`/api/log/token` **不受影响**，恒返回 token 级数据
- **实测已确认当前站点开关为开启状态**；开关位于后台设置 → 计费设置（Billing）→ 货币与显示（Currency & Display）→ `Display Token Statistics`，仅管理员可改

### 换算参数：`QuotaPerUnit`

- 默认 `500000`（源码 `common/constants.go`，锚点 `$0.002 / 1K tokens`），**管理员可改且改后立即全站生效**（详见 ④）
- 实现时必须从 `GET /api/status` 实时读取，**不得硬编码**
- 实测交叉验证：`/api/usage/token` 的 `total_used = 673,419,457` ÷ 500000 = **1346.84 美元**；`/v1/dashboard/billing/usage` 的 `total_usage = 134,683.8914` 美分 ÷ 100 = **1346.84 美元**——完全吻合

## 1. 鉴权三态总览

本项目对接的接口按鉴权中间件分三档：

| 鉴权档 | 中间件 | 语义 | 本项目的请求方式 |
|--------|--------|------|----------------|
| **公开**（none） | 无 / `HeaderNavModulePublicOrUserAuth` | 不持有任何凭证即可访问 | 直接请求，无需 key |
| **严格**（strict） | `TokenAuth` | 校验 key 有效、未过期、有剩余额度；无效直接被拒 | 携带 sk-key 请求 |
| **宽松**（lenient） | `TokenAuthReadOnly` | 只验 key 存在且用户未封禁；**过期/额度耗尽仍可查**，但**显式禁用（Disabled）会被 401 拒绝**（`middleware/auth.go` 注释原文：only explicitly disabled tokens are denied） | 携带 sk-key 请求；**本项目主要依赖此档** |

> 失败状态码全集（2026-09-13 源码复核）：**401** = key 不存在（`MsgTokenInvalid`）或 token 被显式禁用（`MsgTokenStatusUnavailable`）；**403** = 账号被封禁；**500** = 数据库错误。→ 摘除计数只认 401；403 / 500 视为其他故障，不计入。宽松档**允许** key 过期（Expired）与额度耗尽（Exhausted）状态查询。

## 2. 接口清单

### 公开接口组（无需 sk-key）

#### ① `GET /api/user/groups` — 用户分组与倍率

- **返回**：站点配置的用户分组（default / vip 等）与倍率；**未启用分组时 `data` 为空对象**（当前站点实测即此状态）
- **用途**：解释「同一模型为什么计费不同」——分组倍率影响同一模型的实际消耗
- **本项目用途**：低优先级；仅当站点启用分组倍率后才有内容

#### ② `GET /api/perf-metrics/summary` — 全站模型服务质量

- **参数**：`hours`（统计窗口小时数，默认 24）
- **返回**：每个模型的 `avg_latency_ms`（平均延迟）、`success_rate`（成功率 %）、`avg_tps`（每秒 token 数）、`recent_success_series`（按小时采样的成功率时间序列）；明细版 `/api/perf-metrics?model=xxx`（model 必填，另支持 group/hours）
- **鉴权细节**：`HeaderNavModulePublicOrUserAuth("pricing")`——默认公开，管理员可为 pricing 模块开启 requireAuth
- **实测**：HTTP 200，含站点真实模型的服务质量数据
- **本项目用途**：**高**——本工具独有视角。单个 sk-key 日志看不到全局服务质量；使用者反馈「慢/报错多」时，此接口能定位是模型问题还是自身问题。技术设计时可作为「模型健康度」功能的数据源

#### ③ `GET /api/rankings` — 全站模型用量排行

- **参数**：`period`（统计周期，默认 week）
- **返回**：每个模型的 `rank`（名次）、`previous_rank`（上期名次）、`total_tokens`（总用量）、`share`（份额）、`growth_pct`（环比增长 %）
- **实测**：HTTP 200，14KB 数据
- **本项目用途**：中——项目作者选「主推模型」（便宜且稳定）的数据依据；配合②的成功率可识别衰退模型

#### ④ `GET /api/status` — 站点配置与计费参数

- **返回**：60+ 字段，与本项目相关的计费字段：`quota_per_unit`（**换算比率当前生效值，管理员可改**）、`quota_display_type`（USD/CNY/TOKENS，影响 billing 接口语义）、`usd_exchange_rate`、`price` 等
- **本项目用途**：**关键**——换算比率的唯一权威来源，实现时必须实时读取、不得硬编码；同时感知 `quota_display_type` 切换（若切到 CNY/TOKENS，billing 接口数字语义会变）。实测当前站点：`quota_per_unit = 500000`、`quota_display_type = USD`、`usd_exchange_rate = 6.8`
- **`quota_per_unit` 的行为事实（2026-09-13 源码评估）**：由全局变量承载，改设置是「先写库、再热更新内存」（`model/option.go` 的 `UpdateOption` → `updateOptionMap`）——改后**立即全站生效、无需重启**。三条关键行为：
  - **无历史**：`options` 表一 key 一行、改即覆盖——任何接口都读不到过去的取值；管理审计只记"键名被改过"、**不记值**
  - **无编辑入口**：后台设置页该字段默认隐藏；当显示类型为 TOKENS 或取值非默认（≠500000）时才显示，且显示时仍为只读（`disabled`）——源码 `web/src/features/system-settings/general/pricing-section.tsx`（2026-09-29 main 分支复核）；修改只能走 API（`PUT /api/option/`，Root 权限，热更新内存立即生效）
  - **解读跟随当前值**：一切对外的金额换算（历史记录解读、billing 接口、界面显示）都在读取时实时使用当前值——改它 = 全站金额表达整体平移（数据库里的 quota 整数不受影响）

### 严格鉴权组（TokenAuth，sk-key）

#### ⑤ `GET /v1/dashboard/billing/subscription` — 总额度上限（美元）

- **返回结构**（源码 `controller/billing.go:13` → `GetSubscription`）：

```json
{
    "object": "billing_subscription",
    "has_payment_method": true,
    "soft_limit_usd": 100000000,
    "hard_limit_usd": 100000000,
    "system_hard_limit_usd": 100000000,
    "access_until": 0
}
```

- **字段**：`hard_limit_usd`（总额度上限，美元；三个 limit 字段同值）、`access_until`（token 过期时间，Unix 秒，0 = 永不过期）
- **注意**：无限额度 key 返回 `100000000`（一亿占位值，**无参考意义**）；受 `DisplayTokenStatEnabled` 与 `quota_display_type` 影响（USD 模式直接是美元，CNY 模式做货币转换，Tokens 模式是原始 token 数）
- **路径变体**：`/dashboard/billing/subscription`（不带 `/v1` 前缀）是同一接口，为兼容不同客户端写法——测一组即可
- **本项目用途**：中——按 key 统计的「累计剩余」列候选数据源；与⑥相减可得剩余额度

#### ⑥ `GET /v1/dashboard/billing/usage` — 累计已用（美分）

- **返回结构**（源码 `controller/billing.go:75` → `GetUsage`）：

```json
{
    "object": "list",
    "total_usage": 134683.8914
}
```

- **字段**：`total_usage`（**累计已用，单位美分**，÷100 = 美元；从 key 创建至今累计，非当月）
- **注意**：受 `DisplayTokenStatEnabled` 与 `quota_display_type` 影响（USD 模式才是美元）；`hard_limit_usd`（⑤）− `total_usage ÷ 100`（⑥）= 剩余额度（仅有限额 key 有意义）；可与⑧的 `total_used ÷ quota_per_unit` 交叉对账（不一致 = 站点改过比率，见④）
- **路径变体**：`/dashboard/billing/usage` 同⑥
- **本项目用途**：中——对账与校验用途

#### ⑦ `GET /v1/models` — 可用模型列表

- **返回**：当前 key 可用的模型列表，OpenAI 兼容格式（`data[].id` 为模型名）
- **变体**（与用量统计无关，列出仅为完整覆盖）：`/v1/models/:model` 单模型详情、`/v1beta/models`（Gemini 格式）、`/v1beta/openai/models`（OpenAI 格式，Gemini 路由下）
- **已知限制**：`/v1/models` 查数据库 `abilities` 表（渠道实际配置），而 `/v1/models/:model` 查代码内硬编码的静态模型列表（`openAIModelsMap`）——渠道配了新模型或自定义模型名但代码未收录时，会出现"列表里有但单查返回 `model_not_found`"的现象；不影响实际模型调用
- **本项目用途**：低——调试期验证渠道配置用

### 宽松鉴权组（TokenAuthReadOnly，sk-key）

#### ⑧ `GET /api/usage/token` — token 级用量汇总（原始 quota）

- **返回结构**（源码 `controller/token.go` → `GetTokenUsage`）：

```json
{
    "code": true,
    "message": "ok",
    "data": {
        "object": "token_usage",
        "name": "令牌名称",
        "total_granted": 6012,
        "total_used": 673419457,
        "total_available": -673413445,
        "unlimited_quota": true,
        "model_limits": {},
        "model_limits_enabled": false,
        "expires_at": 0
    }
}
```

- **字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 令牌名称 |
| `total_granted` | int | 总额度 = RemainQuota + UsedQuota（原始 quota 单位） |
| `total_used` | int | **累计已用**（原始 quota 单位）。从 key 创建以来累计，非当月；换算美元 ÷ `quota_per_unit` |
| `total_available` | int | 剩余 = granted − used。无限额度时为负数，无实际意义 |
| `unlimited_quota` | bool | 是否无限额度。true 时 granted/available 无实际意义 |
| `model_limits` / `model_limits_enabled` | object / bool | 模型限制 |
| `expires_at` | int | 过期时间（Unix 秒），0 = 永不过期 |

- **注意**：额度单位是**原始 quota 整数**，需自行换算美元；禁用再解禁不会重置 `total_used`（源码验证：`Update()` 的 `.Select(...)` 列表不含 `used_quota`）；key 耗尽后仍可查（用完也能对账）
- **本项目用途**：**高**——按 key 统计「全周期累计（已用/剩余）」的直接数据源

#### ⑨ `GET /api/log/token` — 最近 1000 条调用日志

- **返回结构**（源码 `controller/log.go:62` → `GetLogByKey`）：

```json
{
    "success": true,
    "message": "",
    "data": [
        {
            "id": 123456, "user_id": 12, "created_at": 1751328000, "type": 2,
            "content": "模型倍率 1.0，分组倍率 1.0", "username": "用户名", "token_name": "令牌名",
            "model_name": "gpt-4o", "quota": 2500, "prompt_tokens": 1500, "completion_tokens": 500,
            "use_time": 2, "is_stream": true, "channel": 0, "channel_name": "", "token_id": 100,
            "group": "default", "ip": "",
            "request_id": "20260911113652…",
            "other": "{\"billing_source\":\"subscription\",\"cache_tokens\":29056,\"frt\":3931,\"model_ratio\":0.075,\"request_path\":\"/v1/messages\",\"stream_status\":{\"status\":\"ok\"},…}"
        }
    ]
}
```

- **字段说明**（共 21 个字段；按实测响应 + 上游源码校正，2026-09-11）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 展示序号，**每次从 1 重编**——跨请求无意义，绝不能用于去重 |
| `user_id` | int | 账号 ID（同一实例内恒定） |
| `created_at` | int | 调用时间（**UTC Unix 秒**，三字段交叉实测） |
| `type` | int | 日志类型（取值见下）；token 日志实见 2=消费、5=错误 |
| `content` | string | 消费记录为空串；错误记录为错误详情文本 |
| `username` / `token_name` | string | 账号用户名 / 令牌名 |
| `model_name` | string | 调用的模型名 |
| `quota` | int | 本次消耗的 quota（换算美元 ÷ `quota_per_unit`）；错误记录为 0 |
| `prompt_tokens` / `completion_tokens` | int | 输入 / 输出 token 数；错误记录为 0 |
| `use_time` | int | 耗时（秒）；错误记录为 0 |
| `is_stream` | bool | 是否流式 |
| `channel` / `channel_name` | int / string | 渠道 ID / 渠道名（普通用户视角后者为空串） |
| `token_id` | int | 上游 token ID（对账用） |
| `group` | string | 分组名（默认 `default`） |
| `ip` | string | 请求 IP（普通用户视角为空串） |
| `request_id` | string | 请求 ID（`yyyyMMddHHmmss` 前缀 + 随机串）；源码写入有兜底保证非空——**去重唯一依据**。**补充实测（2026-09-15）**：错误场景下**不保证行级唯一**——1000 条实测样本中 8 个 `request_id` 各对应 3 条 `type=5` 错误记录（同一请求的多次失败 / 重试，`content` 的 `status_code` 可不同）；按 `request_id` 去重会把它们合并为 1 条（消费类 `type=2` 样本中未观察到重复） |
| `upstream_request_id` | string | 上游请求 ID；JSON tag 为 `omitempty`——**空值时不出现、有值时才出现**，消费方需按「可选字段」处理 |
| `other` | string | JSON 字符串，扩展信息（结构见下） |

- **`type` 完整取值**（上游源码 `model/log.go`；常量注释明确「刻意不用 iota，以保证枚举值永不改变」）：

| 值 | 常量 | 含义 | 可能出现在 token 日志？ |
|----|------|------|------------------------|
| 0 | `LogTypeUnknown` | 未知 | 兜底值 |
| 1 | `LogTypeTopup` | 充值 | 否（账号级，无 token_id） |
| 2 | `LogTypeConsume` | 消费 | **是**（实测） |
| 3 | `LogTypeManage` | 管理操作 | 否（审计类） |
| 4 | `LogTypeSystem` | 系统 | 否 |
| 5 | `LogTypeError` | 错误 | **是**（实测） |
| 6 | `LogTypeRefund` | 退款 | 可能（任务计费链路带 token_id） |
| 7 | `LogTypeLogin` | 登录 | 否（账号级） |

> 本接口按 `token_id` 过滤、不按 `type` 过滤——凡是「带 token_id 写入」的类型都可能返回。

- **`other` 字段**（JSON 字符串，内容随 `type` 变化，实测 2026-09-11）：
  - 消费记录（`type=2`）：`billing_source`、`cache_ratio`、`cache_tokens`、`completion_ratio`、`frt`、`group_ratio`、`model_price`、`model_ratio`、`reasoning_effort`、`request_conversion`、`request_path`、`stream_status`（对象）、`subscription_*`（订阅维度，共 8 个）、`user_group_ratio`、`wallet_quota_deducted`
  - 错误记录（`type=5`）：`error_code`、`error_type`、`request_path`、`status_code`
  - 注：普通用户视角下，服务端会先对 `other` 做「可见性过滤」再返回——上表为过滤后实际可见的键

- **关键限制**：
  - **硬上限 1000 条**：固定返回最近 1000 条（`Limit(common.MaxRecentItems)`，`MaxRecentItems = 1000`，`common/constants.go`）；**不支持任何请求参数**（源码不读任何 `c.Query()`，无分页 / limit / 时间过滤）；固定按 `id desc` 排序（最新 1000 条）
  - **超过 1000 条的旧记录无法获取**：无法翻页、无法扩大 limit；实测当前站点日志速率下 1000 条 ≈ 3 天窗口
  - **大响应**：pretty-print 后 2~4MB——同步引擎需直面的单次响应体积
- **本项目用途**：**核心**——增量同步引擎的唯一数据源；本地攒全量后，任意时间范围的用量/明细/模型统计都是本地聚合查询

## 3. 换算与 quota 计算

### 核心换算公式

```
原始 quota ÷ quota_per_unit（默认 500000） = 美元
```

### 消费记录的 `quota` 是怎么算出来的（实测反推，2026-09-13）

按 tokens 计费的模型，`quota` 在**请求时**由「倍率 × 用量」算出并固化进日志（此后不再变化）：

```
quota = ( (prompt_tokens − cache_tokens)             ← 提示 tokens（未命中缓存部分）
          + cache_tokens × cache_ratio                ← 缓存命中部分按折扣
          + completion_tokens × completion_ratio )   ← 补全 tokens 按倍率
        × model_ratio                                 ← 模型倍率
        × group_ratio                                 ← 分组倍率
```

- 验证：6/6 条实测日志逐条吻合（差值仅为四舍五入）
- 按次计费模型走 `model_price` 分支：`quota = model_price × QuotaPerUnit × group_ratio`（源码 `relay/helper/price.go`）
- **公式中没有 `QuotaPerUnit`**：倍率与美元的锚定（`model_ratio = 1` ⇔ `$0.002 / 1K tokens`）已隐含它——倍率制下改 `QuotaPerUnit` 等于全站重定标；美元定价路径（`model_price` / 表达式 `$/1M`）才显式乘 `QuotaPerUnit`

## 4. 范围之外（sk-key 不可达）

### 4.1 不存在的接口（404）

| 路径 | 状态 |
|------|------|
| `/v1/usage`、`/v1/quota`、`/api/token/self` | 不存在 |

### 4.2 存在但需要登录态的接口（sk-key 访问 401）

支持时间范围查询与过滤，但**必须用账号登录态**（access token + `New-Api-User` header）：

| 路径 | 鉴权 | 能力 |
|------|------|------|
| `/api/log/self` | `UserAuth()` | 支持 `start_timestamp`、`end_timestamp`、`token_name` 过滤，返回日志明细 |
| `/api/log/self/stat` | `UserAuth()` | **支持时间范围 + token_name，返回 quota 汇总**（调 `SumUsedQuota`）——NewAPI 中最适合算"当月用量"的接口，是「按时间段统计用量」无法纯 sk-key 实现的**核心障碍** |
| `/api/data/self` | `UserAuth()` | 按日聚合的看板数据 |
| `/api/token/` (GET/POST/PUT/DELETE) | `UserAuth()` | token 的增删改查 |
| `/api/user/self` | `UserAuth()` | 用户自身信息 |

### 4.3 订阅信息

- **存在完整列表接口，但鉴权是 `UserAuth()`（账号登录态），不是 sk-key**（源码 `router/api-router.go` · `controller/subscription.go:GetSubscriptionSelf`，2026-10-08 核对）：

  | 路径 | 鉴权 | 能力 |
  |------|------|------|
  | `GET /api/subscription/self` | `UserAuth()` | 返回 `all_subscriptions`（含已过期）：`id`、`start_time`/`end_time`（Unix 秒）、`status`、`amount_total`/`amount_used`、`created_at` 等；另有 `subscriptions`、`billing_preference` |
  | `GET /api/subscription/plans` | `UserAuth()` | 套餐列表 |
  | `/api/subscription/admin/*` | `AdminAuth()` | 管理端绑定/作废等，与本项目无关 |

- **sk-key（`TokenAuth` / `TokenAuthReadOnly`）挂不上这些路由**——钱包页在 F12 里看到的 JSON 即 `GET /api/subscription/self`，需网页登录 Cookie/会话，不是 `Authorization: Bearer sk-…`
- 「没有免 auth 的接口」结论仍成立；**并非漏查**，而是查询面从未对 sk-key 开放。UI 只显示过期时间，是前端展示裁剪，底层数据在上述接口里
- 订阅 `id` 与日志 `other.subscription_id` 同体系（作者 JSON 中 `id: 44/22/6` 可与日志对账）
- 对应设计：订阅信息由购买者手工录入或**辅助登录选用**（`subscriptions表字段设计`；密码不落库、token 会话内）；登记时可粘贴 `all_subscriptions` JSON 预填；**不做后台账号自动同步**

### 4.4 参数被忽略的情况（实测）

| 请求 | 实际行为 |
|------|---------|
| `/api/log/token?p=2` | 参数被忽略，仍返回最近 1000 条 |
| `/api/log/token?limit=5000` | 参数被忽略，仍返回最近 1000 条 |
| `/api/log/token?start_timestamp=1751328000` | 参数被忽略，仍返回最近 1000 条 |
| `/v1/dashboard/billing/usage?start_date=2025-07-01` | 参数被忽略 |

### 4.5 充值记录（2026-10-09 实测）

- **`GET /api/user/topup/self?p=1&page_size=10`**——分页充值单；路径属 `/api/user/*`，**预期 `UserAuth()`**（账号登录态，非 sk-key）
- 响应 `{ data: { page, page_size, total, items }, success }`；单条字段与样本：

| 字段 | 样本 | 含义 |
|------|------|------|
| `id` | `17` | 上游充值单 ID |
| `user_id` | `6` | 账号 |
| `amount` | `1` | **平台计费金额**（充值记账额；与 `money` 之间为管理员约定汇率，不标币种） |
| `money` | `2.04` | **实付金额** |
| `trade_no` | `USR6…` | 交易号 |
| `payment_method` / `payment_provider` | `alipay` / `epay` | 渠道 |
| `create_time` / `complete_time` | Unix 秒 | 发起 / **入账完成** |
| `status` | `success` | 单据状态 |

- **无 `quota_granted` 字段**——换得额度为派生（`amount × quota_per_unit`）；登记不固化该列（`topups表字段设计.md`）
- **展示时刻 = `complete_time`**（平台列表即显示它）；`create_time` 仅发起时刻——设计只存一条事件时间 `paid_at` = `complete_time`
- **辅助登录代拉**（与订阅同模式）：`UserAuth` access_token、密码不落库；**仅 `p` / `page_size` 分页、无时间参数**——前端传统分页、可翻至尽头（不设页数硬上限）；不做后台定时同步

## 5. 行为事实：写权限与 key 生命周期

- **sk-key 没有任何写接口**：没有 POST/PUT/DELETE 能改 token 自身；无法通过 sk-key 重置 `used_quota`（没有"重置用量"接口）
- **禁用 token 只改 `status` 字段**：不重置 `used_quota`、不清零 `remain_quota`、不丢历史日志；解禁后三者原封不动
- **唯一让 `used_quota` 归零的途径**：删除 token 后新建（产生全新 Id/Key，旧日志按旧 token_id 关联，新 token 查不到旧日志）
- **解禁保护**：额度耗尽（`Exhausted`）且 `RemainQuota ≤ 0` 且非无限额度的 token 不能直接解禁，需先充值；已过期的 token 也不能直接解禁，需改过期时间

## 6. 源码参考

| 关注点 | 文件路径 | 关键函数/位置 |
|--------|---------|--------------|
| 路由注册 | `router/api-router.go` | usageRoute、logRoute 组 |
| 路由注册 | `router/dashboard.go:14-23` | billing 路由组 |
| 路由注册 | `router/relay-router.go` | models 路由 |
| API key 鉴权 | `middleware/auth.go:171` | `TokenAuthReadOnly()` |
| API key 鉴权 | `middleware/auth.go` | `TokenAuth()` / `SetupContextForToken` |
| token 用量查询 | `controller/token.go` | `GetTokenUsage` |
| 日志查询 | `controller/log.go:62` | `GetLogByKey` |
| 日志查询(model) | `model/log.go` | `GetLogByTokenId`（Limit 1000） |
| billing 查询 | `controller/billing.go:13 / :75` | `GetSubscription` / `GetUsage` |
| 显示开关 | `common/constants.go` | `DisplayTokenStatEnabled` |
| 日志上限 | `common/constants.go` | `MaxRecentItems = 1000` |
| 配额单位 | `common/constants.go` | `QuotaPerUnit`（默认 500000） |
| token 更新 | `model/token.go` | `Update()`（Select 不含 used_quota） |
| 额度增减 | `model/token.go` | `increaseTokenQuota` / `decreaseTokenQuota` |
| 日志类型常量 | `model/log.go` | `LogTypeConsume = 2`、`LogTypeError = 5` 等（刻意不用 iota） |
