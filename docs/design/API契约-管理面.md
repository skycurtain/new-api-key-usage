# API契约-管理面

> 管理面（作者，会话档）全部端点：引导与会话、引擎状态、全员总览、key 管理、日志明细（下钻）、支付记录、成员管理、审计日志。《API契约-公共约定》（定稿）全部条款在此适用不再重述——前缀 `/api/admin`、会话 cookie 鉴权、错误信封、ISO 8601 UTC 左闭右开、`quota_usd` 后端换算、snake_case 同构。

| 项目 | 内容 |
|------|------|
| 状态 | 定稿（2026-10-02） |
| 关联 | 《API契约-公共约定》（定稿——总纲）· 八篇交互设计（定稿）· `api_keys` / `usage_logs` / `payments` / `qpu_history` / `members` 表字段设计（DTO 字段权威）· `需求清单.md` §9（访问主体模型） |
| 产出 | 端点清单、请求 / 响应字段、错误码、本稿裁定项（§10）与遗留项（§11） |

---

## 1. 端点总览

| # | 端点 | 方法 | 用途 |
|---|------|------|------|
| 1 | `/api/admin/setup-state` | GET | 入口三态判定（登录页 / 引导页分流） |
| 2 | `/api/admin/setup` | POST | 引导页落库（一次性） |
| 3 | `/api/admin/session` | POST / GET / DELETE | 登录 / 当前会话 / 登出 |
| 4 | `/api/admin/password` | PUT | 改密（删其他会话） |
| 5 | `/api/admin/engine` | GET | 引擎状态（最近轮次摘要） |
| 6 | `/api/admin/overview` | GET | 全员总览（健康带数据 + 三维聚合） |
| 7 | `/api/admin/keys` | GET / POST | key 清单 / 登记 |
| 8 | `/api/admin/keys/:id` | PATCH | 启停 / 归属变更 |
| 9 | `/api/admin/logs` | GET | 日志明细（下钻，分页） |
| 10 | `/api/admin/payments` | GET / POST | 支付记录清单 / 登记 |
| 11 | `/api/admin/payments/:id` | PUT / DELETE | 编辑 / 删除 |
| 12 | `/api/admin/qpu/latest` | GET | 当前换算率（表单美元双输入用） |
| 13 | `/api/admin/members` | GET / POST | 成员清单 / 开户（令牌明文仅一次） |
| 14 | `/api/admin/members/:id` | PATCH | 停用 / 启用 |
| 15 | `/api/admin/members/:id/token` | POST | 令牌重发（明文仅一次） |
| 16 | `/api/admin/audit-logs` | GET | 审计日志（分页） |

## 2. 引导与会话

### GET `/api/admin/setup-state` → 200

`{ "initialized": true }`——入口三态判定端点（幂等）：

- `users` 非空 → `true`（登录页）；空库 + env 凭证在 → **静默落库**后 `true`；空库 + 无凭证 → `false`（引导页）
- 「永不复现」保证：`initialized` 恒以库内事实为准

### POST `/api/admin/setup` → 200 `{username}` + Set-Cookie

引导页提交 `{username, password}`（确认密码为前端校验）——落库 + 直接建立会话（免二次登录）。仅空库 + 无 env 凭证时有效，否则 `409 already_initialized`（与三态判定构成双保险）。

### POST `/api/admin/session` → 200 `{username}` + Set-Cookie

登录 `{username, password}`。失败 `401 invalid_credentials`（通用文案，不区分用户名 / 密码错）；连续失败触发 `429`（节流最小实现——失败延迟 / 计数，参数实现期定）。cookie 名 `admin_session`，形态见公共约定 §2。

### GET `/api/admin/session` → 200 `{username}`

当前会话（刷新后恢复侧边栏用户名）；无有效会话 → `401`。

### DELETE `/api/admin/session` → 204

登出（删会话行）。

### PUT `/api/admin/password` → 204

`{old_password, new_password}`——成功后**删除其他会话、保留当前**。旧密码不正确 → `422`（`fields: {old_password: "旧密码不正确"}`）。

## 3. 引擎状态

### GET `/api/admin/engine` → 200

```json
{
  "running": true,
  "sync_interval_ms": 300000,
  "last_round": {
    "started_at": "2026-10-02T08:00:00Z",
    "keys_total": 18, "succeeded": 16, "failed": 2,
    "failed_api_key_ids": [3, 7]
  }
}
```

`sync_interval_ms`：当前同步周期（毫秒），**只读观测**，经 env 配置、无修改接口。  
`failed_api_key_ids` 支撑 Key 管理「最近轮次失败」筛选与健康带失败数跳转；`last_round` 为 `null`（引擎尚未跑过）合法。状态存储为 `engine_status` 单行快照（《同步引擎设计》§5）。

## 4. 全员总览

### GET `/api/admin/overview?from&to` → 200

`from/to` **必填**（杜绝无口径数字；快捷项为前端预置）。聚合仅 `type = 2`（消费行，§10 裁定 1）。

```json
{
  "data_cutoff": "2026-10-02T08:00:00Z",
  "unassigned_subscription": { "count": 0, "quota": 0, "quota_usd": "0.00" },
  "by_source": [
    { "billing_source": "subscription", "count": 420, "quota": 2100000, "quota_usd": "4.20" },
    { "billing_source": "wallet", "count": 80, "quota": 400000, "quota_usd": "0.80" }
  ],
  "by_member": [
    { "member_id": 1, "member_name": "小张", "key_count": 3,
      "data_cutoff": "2026-10-02T08:00:00Z",
      "usage": { "count": 300, "quota": 1500000, "quota_usd": "3.00" } },
    { "member_id": null, "member_name": null, "key_count": 2,
      "data_cutoff": "2026-10-01T06:00:00Z",
      "usage": { "count": 200, "quota": 1000000, "quota_usd": "2.00" } }
  ],
  "by_key": [
    { "key_id": 5, "token_name": "小张-01", "member_id": 1, "status": "active",
      "data_cutoff": "2026-10-02T08:00:00Z",
      "usage": { "count": 120, "quota": 600000, "quota_usd": "1.20" } }
  ]
}
```

- `data_cutoff`：全池 `log_synced_at` 最慢；`by_member` 行为名下最慢、`member_id: null` 行为「未归属（归作者）」固定卡
- `unassigned_subscription`：该时段 `billing_source = subscription` 且 `subscription_id` 缺失的量——正常恒为零（健康指示器，非零即异常信号）；`billing_source = wallet` 的缺失属正常、不进此分组
- 占全员比例条由前端现算（公共约定 §5）

## 5. Key 管理

### GET `/api/admin/keys` → 200 `[key]`

全量直返（基数 10–25，不分页——§10 裁定 3）。筛选参数：`member_id`（id 或 `unassigned`）、`status`、`recent_failed=true`（引擎最近轮次失败）。排序默认数据截止降序（前端事）。

```json
{
  "id": 5, "token_name": "小张-01", "status": "active",
  "member_id": 1, "member_name": "小张",
  "registered_at": "2026-09-20T10:00:00Z",
  "log_synced_at": "2026-10-02T08:00:00Z", "usage_synced_at": "2026-10-02T08:00:00Z",
  "total_used": 600000, "total_available": 940000, "total_granted": 1540000,
  "unlimited_quota": false, "expires_at": null
}
```

`key_hash` / `key_ciphertext` 永不出 API（凭证形态）；`model_limits` / `model_limits_enabled` 已入库暂无 UI 消费方，不出（随表设计 3.4 待 UI 稳定回审）。

### POST `/api/admin/keys` → 201 `key`

`{ "sk_key": "sk-…", "member_id": null }`——登记四态：

| 结果 | 响应 |
|------|------|
| 成功 | `201` + key 实体（首轮日志同步异步补，不阻塞响应——表设计 §4） |
| 已登记（hash 命中，查库优先、先于上游验证） | `409 key_already_registered`，信封附注 `key_id` 定位既有行 |
| 上游拒绝（401） | `422`（`fields: {sk_key: "上游拒绝了这枚 key——可能不存在或已被禁用"}`） |
| 上游暂不可达 | `502 upstream_unreachable`（「上游站点暂时不可达，请稍后重试」） |

### PATCH `/api/admin/keys/:id` → 200 `key`

`{ "status": "disabled" }`（启用 / 停用）或 `{ "member_id": 3 }`（归属变更；`null` = 归还未归属）——部分更新，单字段或并存均可，审计按实际变更字段各落一行（§9 枚举）。非法值 `422`；key 不存在 `404`；`member_id` 引用不存在成员 `422`（`fields`）。

## 6. 日志明细（管理面下钻）

### GET `/api/admin/logs?from&to` → 200 `{items, total}`

分页（`page/page_size`，公共约定 §6）。过滤：`from/to`（必填）、`api_key_id`、`member_id`（经 `api_key_id → api_keys.member_id` 联查**当前归属**——行级归属语义）、`billing_source`、`subscription_id`、`type`。默认全类型（错误行排查入口——§10 裁定 1 的另一半）。

```json
{
  "id": 12345, "api_key_id": 5, "created_at": "2026-10-01T14:22:05Z",
  "token_name": "小张-01", "model_name": "gpt-5", "type": 2, "content": "",
  "quota": 250000, "quota_usd": "0.50",
  "prompt_tokens": 1200, "completion_tokens": 800,
  "use_time": 3, "is_stream": true,
  "billing_source": "subscription", "subscription_id": 3
}
```

`token_name` 取**当前名**（联查 `api_keys`，与「展示名以当前为准」对齐——§10 裁定 2）；`username` / `channel` / `ip` / `token_id` / `request_id` / `other` 等其余表字段暂不出 API，界面需要时再扩。

> **界面落点**：《交互设计-调用日志》——管理面独立查询页；总览/Key/成员筛选深链 + 行内回跳。

## 7. 支付记录

### GET `/api/admin/payments` → 200 `[payment]`

全量直返（年十位数，不分页），时间倒序（后端排序）。

```json
{
  "id": 3, "kind": "subscription", "paid_at": "2026-09-01T00:00:00Z",
  "paid_amount": 170, "remark": "九月拼车",
  "period_start": "2026-09-01T00:00:00Z", "period_end": "2026-10-01T00:00:00Z",
  "subscription_id": 3, "quota_granted": 12500000, "quota_usd": "25.00"
}
```

`quota_usd` 按支付时刻（`paid_at`）QPU 换算（§10 裁定 4）；`kind = topup` 行 `period_*` / `subscription_id` 为 `null`。

### POST `/api/admin/payments` → 201 `payment`

`kind` 分形态必填校验（`422`）：公共 `{kind, paid_at, paid_amount, remark?}`；`subscription` 追加必填 `period_start` / `subscription_id` / `quota_granted`（`period_end` 可空 = 进行中）；`topup` 追加必填 `quota_granted`。表单美元双输入为前端换算（按 `qpu/latest` 预览），落库恒原始 quota（表设计 3.6）。

### PUT `/api/admin/payments/:id` → 200 `payment` / DELETE → 204

编辑全字段、删除有确认（前端）；改错即修，均落审计。

### GET `/api/admin/qpu/latest` → 200

`{ "qpu": 500000, "effective_from": "2026-09-01T00:00:00Z" }`——当前换算率（支付表单美元 ↔ quota 双输入换算用）。

## 8. 成员管理

### GET `/api/admin/members` → 200 `[member]`

全量直返（个位数，不分页）。

```json
{
  "id": 1, "name": "小张", "remark": "同事", "status": "active",
  "token_issued_at": "2026-09-18T10:00:00Z", "created_at": "2026-09-18T10:00:00Z",
  "key_count": 3
}
```

`key_count` 为派生聚合计数（当前归属名下 key 数）；`token_hash` 永不出 API。名称唯一冲突 `409 member_name_taken`。

### POST `/api/admin/members` → 201

`{name, remark?}`——开户即自动签发令牌，**响应附明文（仅此一次）**：

```json
{ "member": { "…": "如上实体" }, "token": "（明文令牌——关闭后不可再得，库里只有哈希）" }
```

### PATCH `/api/admin/members/:id` → 200 `member`

`{ "status": "disabled" }` / `active`——停用即成员视图访问立即失效（令牌校验含状态判断）。

### POST `/api/admin/members/:id/token` → 201

`{ "token": "…" }`——重发：旧令牌即刻失效（旧令牌的成员侧下一请求 `401`）。明文仅此响应一次。

## 9. 审计日志

### GET `/api/admin/audit-logs` → 200 `{items, total}`

分页；时间倒序；过滤 `domain`（`key` / `payment` / `member` / `account`）。

```json
{
  "id": 99, "created_at": "2026-10-02T09:15:00Z",
  "operator": "aaron", "domain": "key", "action": "key.disable",
  "summary": "key 小张-01 · 停用"
}
```

`operator` 为用户名；**系统触发事件为 `null`**（如空库静默重建 `account.init`）。操作类型枚举（审计域全集）：

| 域 | action 枚举 |
|----|------------|
| key | `key.register` / `key.enable` / `key.disable` / `key.reassign`（归属变更） |
| payment | `payment.create` / `payment.update` / `payment.delete` |
| member | `member.create` / `member.enable` / `member.disable` / `member.token_issue`（开户自动签发）/ `member.token_reissue` |
| account | `account.password_change` / `account.init`（系统，operator null） |

每个管理面写操作各落一行；查询类与成员侧动作不留痕。**表结构归技术稿（members / api_keys 表设计既有标注），立稿时以本文 DTO 字段为对齐锚点**（§11 遗留 2）。

## 10. 本稿裁定项（表设计 / 公共约定的待定落定，请作者重点审）

1. **用量聚合口径仅 `type = 2`（消费行）**——usage_logs §5 待定「type 过滤策略」落定：聚合与统计只计消费行（错误行入聚合即失真）；明细查询默认全类型、可按 `type` 筛（错误排查入口）；
2. **日志明细 `token_name` 取当前名**（联查 `api_keys`；快照名存库不出 API）——表设计 2.3 待定「展示口径」落定；
3. **有限基数清单不分页**：`keys` / `members` / `payments` 直返全量数组；公共约定 §6 的「列表类分页」指无界列表（`logs` / `audit-logs`）；
4. **支付记录 `quota_usd` 按支付时刻（`paid_at`）QPU 换算**——对齐「按日志时刻取值」的历史正确性原则；
5. **公共约定随本稿与审阅增补四处**：状态表加 `429`（登录节流）、错误信封允许端点附机器可读附注字段（`409 key_already_registered` 附 `key_id`）、`/api` 命名空间专属接口（页面路由永不进入）、端点面向交互设计不与数据表对齐。

## 11. 遗留项（归后续立稿或作者裁决）

1. **管理面日志明细的界面落点**——**已裁决：实现期定**（先做「跳 Key 管理定位到该行」，详情视图待真实数据再定）；
2. **审计日志表结构**——归技术稿，以本文 §9 DTO 字段为对齐锚点；
3. **`GET /api/admin/engine` 的状态存储**——已对齐《同步引擎设计》§5（`engine_status` 单行快照 + 只读 `sync_interval_ms`）；
4. **令牌生成细节**（随机源 / 长度 / 前缀）——归技术稿。
