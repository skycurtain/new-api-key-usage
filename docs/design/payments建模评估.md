# payments 建模评估：充值与订阅要不要拆表

> 对「一张 `payments` 同构装下订阅 + 充值」的全面复盘。触发点：`paid_at` 语义在订阅行上更像 `created_at`，按付费时间筛会在**后补录**时丢行。**结论：方案 B 拆表已采纳**（2026-10-09）。

| 项目 | 内容 |
|------|------|
| 状态 | 定稿（2026-10-09，作者采纳方案 B） |
| 关联 | `subscriptions表字段设计.md` · `topups表字段设计.md`（替代原 `payments` 单表）· `NewAPI-接口范围.md` §2.⑨ §4.3 · `需求清单.md` R7/R8/R9 · `usage_logs表字段设计.md` 3.6 |
| 依据 | 上游订阅实体字段（钱包页 / `GET /api/subscription/self`）· 日志 `billing_source` / `subscription_id` · 现行登记与筛选交互 |

---

## 1. 领域里其实有两种东西

NewAPI 侧（接口参考 §4.3、日志 `other`）：

| 上游概念 | 本质 | 时间轴 | 与消耗的关系 |
|----------|------|--------|--------------|
| **订阅**（`all_subscriptions[].id`） | **权益包**：`start_time`/`end_time` 覆盖期 + `amount_total`/`amount_used` 额度预算 + `created_at` | **期间** | 日志 `billing_source=subscription` + `subscription_id` 直连 |
| **充值**（`LogTypeTopup=1`） | **入账事件**：钱 → 钱包额度；账号级、无 token_id | **事件时刻** | 日志 `billing_source=wallet`，**无**逐笔 `subscription_id`（余额池） |

注意：上游**没有**「订阅付款单」——订阅的 `created_at` 是权益创建时刻，不是「作者何时把钱付给组织者」。后者只存在于社交层，正是 `payments` 要手工抄录的「支付事实」。

因此登记行混合了两类事实：

1. **权益事实**（订阅：编号、期间、总额度）——来自钱包页，客观  
2. **金钱事实**（谁付了多少）——来自支付凭证/转账，社交层，**可与权益不同日**（预付、分期、事后补账）

## 2. 现行单表哪里拧着

`payments` 九列里约一半是「订阅专用可空」：

| 列 | 订阅 | 充值 | 问题 |
|----|------|------|------|
| `kind` | `subscription` | `topup` | 判别式列（合法但胖） |
| `paid_at` | 混用：真实付款日 **或** 登记日 | 真实充值日 | **语义分叉**（本次痛点） |
| `paid_amount` | 套餐价（可能与期间不同日） | 充值额 | 尚可 |
| `period_start/end` | 必填 | NULL | 可空列 |
| `subscription_id` | 必填 | NULL | 可空列 |
| `quota_granted` | 套餐总额度 | 充值换得额度 | 语义都是「换得的量」，可共用 |
| `remark` | ✓ | ✓ | |
| （无） | **登记时刻** | **登记时刻** | 补录/审计缺失 |

连带后果：

- **筛选**：按 `paid_at` 筛「这段时间的账」→ 后补录的订阅落在补录日，对不上用量窗口；按期间筛又对不上充值（无期间）。
- **QPU 换算锚点**：契约写「按 `paid_at` 换算 `quota_usd`」——若 `paid_at` 在订阅行上是登记日，换算率锚点也跟着漂。
- **校验**：kind 分支必填（契约已做），但类型系统层仍是「全可空 + 运行时 if」。

## 3. 三个方案

### 方案 A：单表保留，时间语义拆开（小改）

```
payments
  kind, paid_amount, remark, quota_granted     ← 共用
  created_at        timestamptz  NOT NULL      ← 新增：登记入库时刻
  paid_at           timestamptz? NULLABLE      ← 仅「钱出手」时刻；订阅可空
  period_start/end, subscription_id            ← 仅订阅
```

| 筛选口径 | 规则 |
|----------|------|
| 登记时间 | `created_at`（后补录可查） |
| 充值 | `paid_at ∈ [from,to)` |
| 订阅 | 期间重叠：`period_start < to AND (period_end IS NULL OR period_end > from)` |

- **利**：迁移小（加一列 + 语义清洗存量 `paid_at`）；API/DTO 形状基本不动。  
- **弊**：仍是判别式胖行；「订阅的付款日」与「权益期间」继续挤在同一行心智里。

### 方案 B：拆两张表（对齐上游）

```
subscriptions                 topups
  id PK                         id PK
  subscription_id UNIQUE        upstream_id?          ← 上游充值单 id
  period_start NOT NULL         amount NOT NULL       ← 计费单位（美元额度形态）
  period_end NULL               money NOT NULL        ← 实付
  quota_granted NOT NULL        trade_no / payment_*  ← 渠道事实
  paid_amount NULL              paid_at NOT NULL      ← = 上游 complete_time（唯一事件时刻）
  paid_at NULL                  status
  remark                        remark
  created_at NOT NULL           created_at NOT NULL
```

（2026-10-09 实测修正：上游充值单**无 `quota_granted`**——`amount × qpu` 派生；事件时刻**只留一条** `paid_at`=`complete_time`，`create_time` 不入库。）

- **利**：字段全非空（或意义明确）；时间轴各归各；与 NewAPI「权益 vs 入账」同构；筛选规则按表定义，无 if-else。  
- **弊**：登记 UI 两种表单（可仍一页两 Tab）；「统一支付流水」要 UNION 视图；迁移把现表按 `kind` 拆走。

### 方案 C：三张表（金钱流水与权益彻底解耦）——**不建议**

`money_events` + `subscriptions` + 关联。年登记量个位数～十位数，过重。

## 4. 建议

**采用方案 B（拆表），展示层合并流水。**

理由摘要：

1. **领域本来就是两种东西**——上游也是。单表同构是登记方便，不是概念等价。  
2. **时间轴不同**是刚性的：权益用期间、充值用事件、补录用登记时刻；塞进一列必然语义污染。  
3. 规模极小（设计稿：年十行级）——拆表成本几乎只有代码路径，没有分片/联查负担。  
4. `paid_at` 问题在 B 里消失：`topups.paid_at` 恒为事件；`subscriptions.paid_at` 明确为「套餐付款日，可空」；`created_at` 两表都有。

**统一入口**（交互不变感）：

- 管理面「支付记录」页 = 两 Tab（订阅 / 充值）或一张 UNION 列表（按时间轴分别标注「期间 / 付费 / 登记」）。  
- 成员「支付参数」页同源两集，R12 弹窗仍只挂订阅。  
- 「该时段涉及」：订阅看期间重叠 ∪ 进行中；充值看 `paid_at`；补录审计看 `created_at`。

**字段语义钉死（两表通用原则）**：

| 时刻 | 含义 | 谁写 |
|------|------|------|
| `created_at` | 作者按下「登记」的时刻 | 系统 |
| `paid_at` | 钱真实出手时刻（凭证上的时间） | 人工；不知则空 |
| `period_*` | 用量覆盖期 `[start, end)` | 人工（抄钱包页） |

**迁移要点**（若采纳）：

1. 存量 `kind=subscription` 行 → `subscriptions`；`kind=topup` → `topups`。  
2. 存量订阅行的 `paid_at`：若当时填的是登记日 → 迁到 `created_at`，`paid_at` 置空（或作者按凭证补真付款日）。  
3. `quota_usd` 换算锚点：优先 `paid_at`（有则），否则 `created_at` 或 `period_start`——契约里写死优先级。  
4. 日志 `subscription_id` 直连改为指向 `subscriptions.subscription_id`（语义不变）。  
5. 纯用量模式（零登记）不受影响。

**方案 A 的适用情形**：只想先止血筛选/补录、暂不动 CRUD 与 API 形状——则 A 是可接受的过渡；终态仍建议 B。

## 5. 与既有裁决的关系

| 裁决 | 拆表后 |
|------|--------|
| R7 充值与订阅同构（登记形态） | **展示/哲学同构**（只存事实、无分摊）不变；**物理模型分表** |
| R8 `subscription_id` 直连 | 不变，指向订阅表 |
| R9 币种无关、只存事实 | 不变 |
| 「payments」表名 | 订阅表可名 `subscriptions`；充值表 `topups`；若保留对外「支付记录」只作 UI 名 |

---

**已采纳方案 B（2026-10-09）**：表设计见 `subscriptions表字段设计.md` / `topups表字段设计.md`；契约与交互随拆表修订。
