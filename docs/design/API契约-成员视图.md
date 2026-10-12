# API契约-成员视图

> 成员视图（令牌档）全部端点：令牌验证与页头、总览/支付参数聚合、日志明细。《API契约-公共约定》（定稿）全部条款在此适用不再重述——前缀 `/api/member`、Bearer 鉴权、ISO 8601 UTC 左闭右开、`quota_usd` 后端换算、snake_case 同构；管理面草案 §10 的裁定 1（聚合仅 `type = 2`）与裁定 2（`token_name` 取当前名）在此沿用。成员世界**无**审计、无健康带、无改密（定位边界，《交互设计-成员视图》§2）。

| 项目 | 内容 |
|------|------|
| 状态 | 定稿（2026-10-12，作者认可实现） |
| 关联 | 《API契约-公共约定》（定稿——总纲）·《API契约-管理面》·《交互设计-成员视图》·《交互设计-登录与会话》§4（登录壳）· `members` / `usage_logs` / `subscriptions` / `topups` 表字段设计（DTO 字段权威） |
| 产出 | 端点清单（3 个）、请求 / 响应字段、裁定项（§5）、遗留项（§6） |

---

## 1. 端点总览

| # | 端点 | 方法 | 用途 |
|---|------|------|------|
| 1 | `/api/member/me` | GET | 令牌验证 + 页头（登录壳提交的落点） |
| 2 | `/api/member/overview` | GET | 总览与支付参数聚合：总用量、按来源分解、我的 key、支付参数列表 |
| 3 | `/api/member/logs` | GET | 日志明细（名下 key，分页） |

## 2. 令牌验证与页头

### GET `/api/member/me` → 200

`{ "id": 1, "name": "小张" }`

- 登录壳提交 = 前端将令牌存 sessionStorage 后调本端点（`Authorization: Bearer`）：验证通过（哈希命中 + `status = active`）→ 进入成员视图；`401` → 登录壳（前端固定文案「令牌无效或已停用」，不区分停用与无效——公共约定 §2）
- **不建会话**：令牌即长期凭证（`members` 表设计 3.2——无会话语义、无登出端点）；旧令牌在作者重发后于下一请求自然 `401`

## 3. 总览与支付参数聚合

### GET `/api/member/overview?from&to` → 200

`from/to` 必填（快捷项为前端预置）；聚合仅名下 key（经 `api_key_id → api_keys.member_id` 当前归属联查）的 `type = 2` 日志。

```json
{
  "member": { "id": 1, "name": "小张" },
  "usage": { "count": 300, "quota": 1500000, "quota_usd": "3.00" },
  "by_source": [
    { "billing_source": "subscription", "count": 280, "quota": 1400000, "quota_usd": "2.80" },
    { "billing_source": "wallet", "count": 20, "quota": 100000, "quota_usd": "0.20" }
  ],
  "keys": [
    { "key_id": 5, "token_name": "小张-01", "log_synced_at": "2026-10-02T08:00:00Z",
      "usage": { "count": 300, "quota": 1500000, "quota_usd": "3.00" } }
  ],
  "subscriptions": [
    { "id": 3, "subscription_id": 44, "period_start": "2026-09-01T00:00:00Z",
      "period_end": "2026-10-01T00:00:00Z", "quota_granted": 12500000, "quota_usd": "25.00",
      "paid_amount": 170, "paid_at": "2026-08-28T10:00:00Z", "remark": "九月拼车",
      "created_at": "2026-09-02T12:00:00Z" }
  ],
  "topups": [
    { "id": 1, "upstream_id": 17, "amount": 1, "money": 2.04,
      "trade_no": "USR6…", "payment_method": "alipay", "payment_provider": "epay",
      "status": "success", "paid_at": "…",
      "quota_derived": 500000, "quota_usd": "1.00",
      "remark": "", "created_at": "…" }
  ]
}
```

- `usage`：该时段总用量（总览摘要条）；`by_source`：订阅 / 充值分解（分段条）；`keys`：我的 Key 表（`log_synced_at` 支撑停滞标注）
- `subscriptions` / `topups`：**支付参数页 + 订阅徽章弹窗 + 「本订阅期间」快捷项**的数据源，判定见 §5 裁定 2；对成员**全字段可见**（含 `remark`）；两集皆空 = 纯用量模式中性空态
- 订阅徽章弹窗仅限「订阅 #N」（查 `subscriptions`）：「充值」不弹窗（余额池无逐笔）、「未关联」不可点；降级「该订阅无登记信息」

## 4. 日志明细

### GET `/api/member/logs?from&to` → 200 `{items, total}`

分页（公共约定 §6）；过滤 `from/to`（必填）；范围恒为名下 key；**默认全类型**（消费 + 错误，可 `type` 筛——2 / `error`）。

可选筛选（调用日志页，与管理面 `GET /api/admin/logs` 同名同义）：`api_key_id` · `billing_source`（`subscription` / `wallet` / `none`）· `subscription_id` · `type`（2 / `error`）。

明细行 DTO 与管理面 `GET /api/admin/logs` **同构**（公共约定 §7——一份 DTO 类型两处复用）：

```json
{
  "id": 12345, "api_key_id": 5, "created_at": "2026-10-01T14:22:05Z",
  "token_name": "小张-01", "model_name": "gpt-5", "type": 2, "content": "",
  "quota": 250000, "quota_usd": "0.50",
  "prompt_tokens": 1200, "completion_tokens": 800,
  "use_time": 3, "is_stream": true,
  "billing_source": "subscription", "subscription_id": 3,
  "raw": { "id": 12345, "request_id": "…", "other": {}, "channel": 1 }
}
```

`token_name` 取当前名（管理面裁定 2 沿用）。`raw` 为**完整落库行**（上游字段原貌 + 系统字段，`created_at` 为 Unix 秒）——界面「原始数据」视图的数据源；管理面 `GET /api/admin/logs` 同构带出。

## 5. 本稿裁定项（请作者重点审）

1. **成员视图明细默认全类型**（消费 + 错误）——对齐「事实可查」；聚合仍仅 `type = 2`（用量口径不变）；`type` 可筛 2 / `error`；
2. **「该时段涉及」登记的判定**：订阅 = 该时段日志（`type = 2`）出现过的 `subscription_id` 对应 `subscriptions` 行 **∪ 进行中的订阅**（`period_end` 为空或未来——支撑「本订阅期间」快捷项）；充值 = `paid_at ∈ [from, to)`（入账事件按付费时刻锚定）；补录审计看各表 `created_at`（不进本判定）；
3. **明细行 DTO 与管理面同构**：同一 `LogItem` 类型，成员端经归属与 `type` 恒定过滤；
4. **「充值」徽章不弹窗**——余额池扣款与具体充值记录无逐笔关联，弹窗回答不了「这笔花在哪」（《交互设计-成员视图》§4.2：订阅徽章才开支付参数弹窗，「充值」为纯标识；行展开只放模型调用详情）。

## 6. 遗留项

1. **订阅编号同一性核查**（日志 `subscription_id` ↔ 支付记录是否同一体系）——需求清单既有标注，实现期真实数据核查后再终验（徽章文案预留「未关联」正常位）。
