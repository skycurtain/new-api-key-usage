# topups 表字段设计

> 数据模型：**充值入账事件**——一行 = 一次「钱 → 账号额度」的入账。与 `subscriptions`（订阅权益）分表（见 `payments建模评估.md`，方案 B）。字段对齐上游实测 `GET /api/user/topup/self`（2026-10-09 样本）；**无 `quota_granted` 列**（派生），**事件时刻只存一条**（上游 `complete_time`，即平台列表展示的时间）。

| 项目 | 内容 |
|------|------|
| 状态 | 待审阅（2026-10-09 拆表 + 充值接口实测；事件时刻单列） |
| 关联 | `subscriptions表字段设计.md` · `payments建模评估.md` · `NewAPI-接口范围.md` §4.5 · `qpu_history表字段设计.md` |
| 范围 | 列结构 + 语义 + 写入时机 |
| 字段数 | 10 = 1 主键 + 8 上游/业务事实 + 1 登记时刻 |

---

## 1. 表定位

- **一行 = 一次充值入账**（事件）；时间主轴 = **`paid_at`**（上游 `complete_time`，平台展示时刻）
- 与消耗的关系：钱包/账号余额池，**无法**逐笔对应模型日志（`billing_source=wallet` 无 `subscription_id` 是正常态）
- 不存 `quota_granted` 真值列（上游没有；见 §3）

## 2. 字段清单

| 列 | 类型 | 上游字段 | 说明 |
|----|------|----------|------|
| `id` | bigserial PK | — | 本地主键 |
| `upstream_id` | bigint? | `id` | 上游充值单 ID（对账；手工补录可空） |
| `amount` | numeric | `amount` | **计费单位金额**（样本 `1`——美元额度形态，≠ 实付货币） |
| `money` | numeric | `money` | **实付金额**（样本 `2.04`）；币种无关纯数值 |
| `trade_no` | text? | `trade_no` | 交易号 |
| `payment_method` | text? | `payment_method` | 如 `alipay` |
| `payment_provider` | text? | `payment_provider` | 如 `epay` |
| `status` | text? | `status` | 如 `success`；失败单一般不入账本 |
| `paid_at` | timestamptz | **`complete_time`** | **入账时刻（唯一事件时间）**——平台列表展示的就是它；上游 `create_time` 不入库 |
| `remark` | text | — | 人工备注 |
| `created_at` | timestamptz | — | 本系统登记时刻（补录审计） |

> 样本（2026-10-09）：`amount: 1` · `money: 2.04` · `trade_no: "USR6NOLqTPGa1791534153"` · `alipay`/`epay` · `create_time`/`complete_time` Unix 秒 · `status: "success"`。展示与筛选一律用 `complete_time` 落入的 `paid_at`。

## 3. 「换得额度」是派生

上游无 `quota_granted`：派生 `amount × quota_per_unit`（默认 QPU 500000）。

- **只存事实**：`amount` 与 `money` 两真值；比率现算（R6/R9）
- 不在库中固化派生额度

## 4. 时刻语义

| 时刻 | 含义 |
|------|------|
| `paid_at` | 入账（= 上游 `complete_time`）——筛选、排序、QPU 锚点 |
| `created_at` | 登记进本表（补录审计） |

## 5. 写入与维护

| 时机 | 动作 |
|------|------|
| **辅助登录选用**（与订阅选择器同模式） | 控制台登录（密码不落库）→ 分页拉 `/api/user/topup/self` → 选用预填表单 → 确认入库 |
| 纯手工登记 | 抄充值页 / 账单；或粘贴 JSON 预填 |
| 编辑 / 删除 | 改错即修 |
| 后台定时同步 | **不做**（辅助登录仅代拉一次、token 会话内用） |

**分页请求策略**（接口仅 `p` / `page_size`，**无时间过滤**）：

1. **传统分页 UI**：弹层底部「共 N 条 · 页码 / 上一页 / 下一页」；每次请求只取当前页（`page_size=10`）
2. **不设硬上限**——用户可一直翻到 `total` 尽头（找旧账必须靠翻页）
3. **不提供时间范围筛选**（上游收窄不了结果集；本地筛只会误导读不出的更早页）
4. **已登记去重**：按 `upstream_id` 灰显，不可重复选用
5. **401**：清会话 token → 重新登录；token 仅 sessionStorage

## 6. 对外边界

- 成员可见：`amount`、`money`、渠道、`paid_at`、备注；无逐笔与模型日志的连线
- 纯用量模式可不登记

## 7. 迁移说明

- 原 `payments.kind=topup`：`paid_at` 语义本就落在入账日 → 直接迁入本表 `paid_at`
- 若曾手填 `quota_granted`：可反推 `amount = quota_granted / qpu` 填 `amount`，否则按实付与约定补记
