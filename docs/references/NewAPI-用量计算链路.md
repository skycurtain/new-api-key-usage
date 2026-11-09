# NewAPI 用量计算链路

> 一次模型调用落下 `logs.quota` 的完整结算路径：日志里能看见哪些参数、哪些参数真正参与运算、四类公式怎么选、取整与兜底在哪一步，以及**哪些情形从 sk-key 视角不可验算**。
>
> 用途：解释 `/api/log/token` 返回的 `quota` 从何而来；为「按模型/按时间聚合后的金额是否可信」提供判据。
>
> 依据：NewAPI 源码（tag `v1.0.0-rc.49`，commit `48a6c87`）逐文件核对；结论经真机日志逐行验算比对（偏差为 0）。

| 项目 | 内容 |
|------|------|
| 状态 | 定稿（2026-11-09） |
| 关联 | [`NewAPI-接口范围.md`](NewAPI-接口范围.md)（上游接口清单与字段语义）· [`usage_logs表字段设计.md`](../design/usage_logs表字段设计.md)（`other` 落库策略）· `packages/core/src/quota-verify/`（验算实现） |
| 取代 | 无 |

---

## 0. 全景

### 0.1 一句话模型

**`quota = 用量 × 单价 × 折扣`。** 其中：

1. **用量**的口径由**协议**决定。OpenAI 系 `prompt_tokens` **含**命中缓存，Anthropic 系 `input_tokens` **不含**——同一个数字在两套协议下含义不同（§3）。
2. **单价**由**模型**的后台配置决定。按次单价 / 表达式 / 倍率三种互斥，按固定顺序判定（§2）。模型名只用来查表，代码里没有按模型名分支的逻辑。
3. **两个维度正交**：协议不改变系数，模型不改变口径。
4. **`quota` 是整数**，取整为四舍五入（half away from zero），上界 `int32`（§4.4）。
5. **日志足以还原算式，但不足以还原算式的可信度** —— 估算路径、金额饱和、实际渠道等信号落在 `admin_info`，sk-key 视角被剥离（§7.3）。

### 0.2 上游调用方式与结算入口

按**结算函数**分，上游只有四类调用。判定依据不是路径，而是日志里的标记：

| 类别 | 日志标记 | 典型入口 | 结算函数 |
|---|---|---|---|
| **文本** | 无标记（默认） | `/v1/chat/completions` · `/v1/messages` · `/v1/responses` · `/v1/embeddings` · `/v1/rerank` | `service.PostTextConsumeQuota` |
| **音频** | `other.audio = true` | `/v1/audio/speech` · `/v1/audio/transcriptions` | `service.PostAudioConsumeQuota`（无音频 token 时退回文本那个） |
| **实时语音** | `other.ws = true` | `/v1/realtime`（WebSocket） | `service.PostWssConsumeQuota` |
| **异步任务** | `other.is_task = true` | `/mj/*` · 视频 / 音乐生成 | `service.LogTaskConsumption`（预扣 + 完成时差额结算） |

- 音频与实时语音共用同一个内部公式 `calculateAudioQuota`；文本与任务各有独立公式。
- 本文只覆盖**文本**这一类，其余三类的处理见 §7.2。
- 「按次固定价」不是一类调用，而是**文本路径内部的一种计价方式**（§2）。

### 0.3 覆盖矩阵

验算逻辑的能力边界，一张表看完：

| 维度 | 覆盖 | 拒绝（`reason`） |
|---|---|---|
| **调用形态** | 文本：chat / embeddings / rerank / responses / responses-compact | 音频 `audio` · 实时语音 `realtime` · 异步任务 `task` · 其它日志构建器 `not_text_path` |
| **计价方式** | 倍率制 · 表达式计费 | 按次固定价 `fixed_price` |
| **计费构成** | 输入 / 输出 token · 缓存读 · 缓存写（含 5m / 1h / 12h 拆分） · 分组倍率 | 图片 token `image_tokens` · 音频输入 `audio_tokens` · 工具附加费 `tool_surcharge` |
| **表达式变量** | `p` `c` `len` `cr` `cc` `cc1h` `cc12h` | 其余变量：`img*` → `image_tokens`、`ai`/`ao` → `audio_tokens`、其它 → `expr_var` |
| **兜底** | — | 字段缺失 / 免费模型 `no_billing_info` |

三条使用前提：

1. 命中任何一条拒绝条件，返回 `{ status: "unsupported", reason, detail }`，**不估算、不给数字**。
2. 只有 `status === "matched"` 才可向用户展示金额；`unmatched` / `unsupported` 只展示原因。
3. 结构性盲区（估算路径、金额饱和、渠道类型等）不在上表里——它们**不影响能否验算，只影响能不能对上**（§7.3）。

---

## 1. 日志里能看见什么

`model/log_other.go` 把侧信道分四层写入，`formatLogOtherJSON` 按角色投影：

| 层 | 写入方式 | 存储形态 | sk-key 可见 |
|---|---|---|---|
| `public` | `SetPublic` | 拍平到 `other` 顶层 | ✅ 全部 |
| `admin_info` | `SetAdmin` | `other.admin_info` | ❌ 整块剥离 |
| `root_info` | `SetRoot` | `other.root_info` | ❌ |
| `audit_info` | `SetAudit` | `other.audit_info` | ❌ |
| 遗留敏感键 | — | — | ❌ `channel_id` / `channel_name` / `channel_type` / `reject_reason` |

`public` 层实际内容（`service/log_info_generate.go` · `GenerateTextOtherInfo` / `GenerateClaudeOtherInfo`）：

| 键 | 写入条件 | 含义 |
|---|---|---|
| `model_ratio` | 恒写 | 模型倍率；按次计费时为 **0** |
| `completion_ratio` | 恒写 | 输出倍率（相对输入价的倍数，不是单价） |
| `cache_ratio` | 恒写 | 缓存命中部分的折扣比例 |
| `cache_tokens` | 恒写 | 缓存**读** token 数 |
| `model_price` | 恒写 | 按次单价；**倍率制为哨兵值 `-1`**（无固定单价），表达式计费为 `0` |
| `group_ratio` | 恒写 | 分组倍率 |
| `user_group_ratio` | 恒写 | 特殊分组倍率；**`-1` 表示无**（不是乘数） |
| `frt` | 恒写 | 首字延迟（毫秒） |
| `cache_creation_tokens` / `_ratio` | Claude 分支或缓存写 > 0 | 缓存**写** token 数 / 倍率 |
| `cache_creation_tokens_5m` / `_1h` / `_12h`（含 ratio） | 对应拆分 > 0 | 长期缓存写的分档 |
| `claude` | 最终上游格式为 Claude Messages | 语义判定的强信号 |
| `usage_semantic` | rc49 起，仅 Anthropic 语义写 `"anthropic"` | 语义判定的权威信号 |
| `billing_mode` / `expr_b64` / `matched_tier` / `billing_unit` | 仅 `tiered_expr` | 表达式计费的验算材料 |
| `image` / `image_ratio` / `image_output` | 输出图片 token ≠ 0 | 图片 token 项（注意 `image_output` 实为**输入**图片 token 数） |
| `audio_input_price` / `audio_input_token_count` | 音频输入单独定价时 | 音频项（单价单位：美元/百万 token） |
| `tool_surcharges` | 有按次计费的工具调用 | 数组，元素为 `{ name, count, price }` |
| `request_path` / `request_conversion` | 恒写 / 有转换时 | 入站路径与格式转换链 |
| `billing_source` / `subscription_*` | 订阅扣费时 | 扣费来源与订阅余额快照 |

> **「没参与的参数在日志里就是 0」** —— `relay/helper/price.go` 的 `ModelPriceHelper` 只在用到某分支的路径上赋值，其余保持零值。因此 `other` 本身就是本次生效参数的清单。

---

## 2. 三步反查

给一条日志，按顺序看三件事即可定位公式。

### 2.1 第一步：看类别

有无 `ws` / `audio` / `is_task` 标记（§0.2）。非文本三类本文不覆盖，到此为止。

### 2.2 第二步：看计价方式

`relay/helper/price.go` · `ModelPriceHelper` **先判定模式再取系数**；`tiered_expr` 是提前 `return`，所以表达式计费的行里所有倍率均为 0。

```
billing_mode === "tiered_expr"             → 表达式计费      （§5）
model_price > 0 且 model_ratio === 0        → 按次固定价      （不覆盖，见 §7.2）
model_ratio > 0                            → 倍率制         （§4）
两者皆 0 且无 billing_mode                   → 免费 / 未配置倍率
```

- **`model_ratio === 0` 不等于免费**：按次计费分支里该变量从未被赋值，恒为 0；判定必须联合看 `model_price`。
- **`model_price` 在倍率制下是哨兵值 `-1`**，不是 0。只有 `> 0` 才是真的按次单价。

模型名的作用仅限于确定**计费身份** `BillingModelName`（`resolveBillingModelName`：剥 reasoning 后缀 → 别名 → 基名，取第一个有价格配置的名字）。渠道映射与上游模型名**不影响**计价。

### 2.3 第三步：看语义

`usage_semantic` / `claude` 标记决定「输入 token 含不含缓存」，进而决定倍率制公式要不要做减法（§3）。

三步走完即可代入：倍率制见 §4（§4.6 有完整代入），表达式计费见 §5（§5.5 有完整代入）。

---

## 3. 语义：输入 token 含不含缓存

这是两条上游协议的根本分歧，也是「Claude 日志输入 token 小得离谱」的唯一原因。

| | OpenAI 系 | Anthropic 系 |
|---|---|---|
| 上游字段 | `prompt_tokens` | `input_tokens` |
| 是否含命中缓存 | **含**（缓存是子集） | **不含**（缓存是并列项） |
| 缓存字段 | `prompt_tokens_details.cached_tokens` | `cache_read_input_tokens` / `cache_creation_input_tokens` |
| NewAPI 归一化 | `PromptTokens = prompt`（含） | `PromptTokens = input`（不含） |

`relaykit/dto/billing_usage.go` 的两个 canonical 函数把差异固化在两个字段上：

```go
// canonicalOpenAIUsage：PromptTokens = prompt（含缓存）
// canonicalClaudeUsage：
canonical := &Usage{
    PromptTokens: claudeUsage.InputTokens,                                            // 不含缓存
    InputTokens:  claudeUsage.InputTokens + claudeUsage.CacheReadInputTokens +
                  claudeUsage.CacheCreationInputTokens,                               // 含缓存
}
canonical.PromptTokensDetails.CachedTokens = claudeUsage.CacheReadInputTokens
```

判定语义的信号（按可靠度）：

| 信号 | 含义 | 可靠度 |
|---|---|---|
| `other.usage_semantic === "anthropic"` | 上游返回 Claude 结构 | ⭐⭐⭐ |
| `other.claude === true` | `FinalRequestRelayFormat == RelayFormatClaude` | ⭐⭐⭐ |
| 以上皆无 | 默认 OpenAI（rc49 不为 openai 写标记） | ⭐⭐ |

> ⚠️ **不要用「`cache_creation_tokens` 键存在」判定 Anthropic 语义**。该键在 OpenAI 语义、缓存写 > 0 时同样会写，用它判定会把这类行误判为 Claude 口径，导致少减一次缓存。

---

## 4. 倍率制（`model_ratio > 0`）

`service/text_quota.go` · `calculateTextQuotaSummary`。

### 4.1 公式

设 `p` = `prompt_tokens`、`c` = `completion_tokens`、`QPU` = `quota_per_unit`（默认 500000）。

**OpenAI 语义**（`prompt` 含缓存）

```
base        = p − cache_tokens
promptPart  = base + cache_tokens × cache_ratio
            + (cache_creation_tokens × cache_creation_ratio)   ← 若存在
quota       = round_half_away( (promptPart + c × completion_ratio) × model_ratio × group_ratio )
```

**Anthropic 语义**（`input` 不含缓存，**不做减法**）

```
promptPart  = p + cache_tokens × cache_ratio
            + cache_creation_tokens × cache_creation_ratio      ← 若存在，按 5m/1h 分档
quota       = round_half_away( (promptPart + c × completion_ratio) × model_ratio × group_ratio )
```

### 4.2 缓存写的分档

| 子项 | 参与条件 | 倍率 |
|---|---|---|
| `cache_creation_ratio` | `cache_creation_tokens > 0`（两种语义都参与） | 运营方配置 |
| `cache_creation_ratio_5m` | Anthropic 语义且 5m 拆分 > 0 | 基率 |
| `cache_creation_ratio_1h` | Anthropic 语义且 1h 拆分 > 0 | 基率 × `6 / 3.75` |
| `cache_creation_ratio_12h` | 非 Anthropic 语义且 12h 写 > 0 | 基率 × `2` |

Anthropic 语义下 `cache_creation_tokens` 需按 5m/1h 拆分（`NormalizeCacheCreationSplit`：未标注 1h 的余量按 5m 计）；**不能同时计入 `cc` 与 `cc1h`**。

另有一条老数据兜底 `isLegacyClaudeDerivedOpenAIUsage`：**无语义标记但带 5m/1h 拆分**的行，按 Anthropic 口径处理（即不做减法）。日志侧只能近似——源码判的是内存里的 `UsageSource` / `UsageSemantic`，日志里没有对应字段。

### 4.3 附加项：不在覆盖范围

下面三类在源码里确实参与计算，但本模块**不实现**——日志里出现对应字段即返回 `unsupported`，不做估算：

| 项 | 日志字段 | 源码里的处理 | 本模块 |
|---|---|---|---|
| 图片 token | `image` / `image_ratio` / `image_output` | 先从基底扣除，再按 `image_ratio` 加回 | ❌ `unsupported/image_tokens` |
| 音频输入 | `audio_input_price` / `audio_input_token_count` | 按 $/百万 token 单独计价，乘 `group_ratio` 但不乘 `model_ratio` | ❌ `unsupported/audio_tokens` |
| 工具附加费 | `tool_surcharges` | 在倍率乘法之外按次累加 | ❌ `unsupported/tool_surcharge` |

> 这里保留源码说明仅为**背景**：验算逻辑中没有任何对应实现，命中即拒。

> 另：倍率制下 `PriceData.otherRatios`（图片 `n` 等）恒为空——它只在按次计费分支填充。这是倍率制主干可以完整验算的关键前提。

### 4.4 取整与兜底

| 步骤 | 规则 |
|---|---|
| 取整前守卫 | `ratio ≠ 0 且 total ≤ 0 → total = 1` |
| 取整 | `decimal.Round(0)`，即 **half away from zero** |
| 饱和 | 上界 `int32`（`2 147 483 647`）；饱和记录写入 `admin_info.quota_saturation`（不可见） |
| 无计费用量 | `hasBillableUsage() == false → quota = 0` |
| 舍入归零 | `ratio ≠ 0 且 quota == 0 → quota = 1` |

`hasBillableUsage()`：`prompt + completion > 0`，**或** Anthropic 语义下 `cache_tokens / cache_creation_tokens / 5m / 1h` 任一 > 0（源码另有一支是「有工具附加费」，但工具费不在本模块覆盖范围）。这解释了「`prompt_tokens = 0` 但 `quota > 0`」的 Claude 行。

### 4.5 扣减顺序（易错点）

`baseTokens` 被缓存与缓存写**逐项扣减**，全部扣完后**才一次性夹零**；各子项在 `baseTokens` 之外独立累加：

```
base = prompt_tokens
     − cache_tokens              （仅 OpenAI 语义）
     − cache_creation_tokens     （仅 OpenAI 语义）
base = max(base, 0)              ← 夹零在这里
promptPart = base + cache_tokens × cache_ratio + cacheCreationPart
```

**先把总和算出来再夹零，会在 `base` 为负时得出偏小的结果**——典型触发条件是 OpenAI 语义下 `cache_tokens > prompt_tokens`（上游报未调整的前缀计数）。

### 4.6 代入一条真实日志

```
prompt_tokens = 2              completion_tokens = 1,477
cache_tokens  = 148,457        cache_creation_tokens = 694（全部为 5m 档）
model_ratio = 2.5  cache_ratio = 0.1  completion_ratio = 5  group_ratio = 1
usage_semantic = "anthropic"
```

**① 类别**：无 `ws` / `audio` / `is_task` → 文本路径。

**② 计价**：无 `billing_mode`、`model_ratio > 0` → 倍率制（`model_price = -1` 是哨兵值，不是按次）。

**③ 语义**：`usage_semantic = "anthropic"` → **`p` 不做减法**（`input_tokens` 本就不含缓存）。

**④ 代入 §4.1 的 Anthropic 公式**

```
缓存读部分 = 148,457 × 0.1              = 14,845.7
缓存写部分 = 694 × 1.25                 = 867.5      （rest = 694 − 694 = 0，全部落 5m 档）
提示部分   = 2 + 14,845.7 + 867.5       = 15,715.2   ← p = 2，不减缓存
输出部分   = 1,477 × 5                  = 7,385

total = (15,715.2 + 7,385) × 2.5 × 1    = 57,750.5
quota = 四舍五入(57,750.5)              = 57,751     ← 与日志 quota 一致
```

> 两处值得注意：
> - **`p = 2` 保持原样**。若照 OpenAI 语义再减一次 `148,457`，`base` 会变成负数并夹零，整条算错。
> - 末位恰好是 `.5`，正落在 half away from zero 的边界上——换成 `floor` 或银行家舍入会得到 57,750。

---

## 5. 表达式计费（`billing_mode = "tiered_expr"`）

`service/tiered_settle.go` · `BuildTieredTokenParams` + `pkg/billingexpr`。

### 5.1 表达式

`other.expr_b64` 为 base64 的表达式文本，变量为：

| 变量 | 含义 | 本模块 |
|---|---|---|
| `p` | **未单独计价**的输入 token | ✅ |
| `c` | 未单独计价的输出 token | ✅ |
| `len` | 总输入上下文长度（选档用） | ✅ |
| `cr` | 缓存**读** token | ✅ |
| `cc` | 缓存**写** token（5m / 无拆分） | ✅ |
| `cc1h` / `cc12h` | 1h / 12h 缓存写 | ✅ |
| `img` / `img_cr` / `img_o` | 图片 token 子类 | ❌ 引用即拒（`image_tokens`） |
| `ai` / `ao` | 音频 token 子类 | ❌ 引用即拒（`audio_tokens`） |

> 表达式一旦引用 ❌ 的变量（或任何本表没有的名字），整行返回 `unsupported`，**不会按 0 参与计算**。原因：`img_cr` / `img_o` / `ao` 在日志里没有对应字段，`img` / `ai` 虽有但属于图片 / 音频附加项，不在覆盖范围（§4.3）。

系数单位是 **$/百万 token**。`tier("name", expr)` 的档名只用于展示与 `matched_tier`，计费取表达式值。

### 5.2 变量归一化（本节的坑全在这里）

```
len = Anthropic ? p + cr + cc + cc1h : prompt_tokens     ← 在归一化之前取
```

**OpenAI 语义**：`prompt_tokens` 含所有子类。

```
if used("cr")  p -= cr        ← 表达式引用了 cr 才减，否则留 p 里按 p 计价
if used("cc")  p -= cc
```

**Anthropic 语义**：`input_tokens` 只含文本。

```
if !used("cr")   p += cr      ← 表达式没引用缓存读 → 并回 p，避免漏计费
if !used("cc1h") cc += cc1h × 1.6 ; cc1h = 0
if !used("cc")   p += cc ; cc = 0
```

> 归一化方向在两种语义下**相反**：OpenAI 是「引用了才减」，Anthropic 是「没引用才并回」。写反会导致数量级错误。

### 5.3 结算

```
quota = round_half_away( eval(expr, vars) / 1e6 × QPU × group_ratio )
```

### 5.4 与 expr-lang v1.17.8 的对齐范围

解析器按 expr-lang v1.17.8 的优先级表**全量**实现（表见 [`计费表达式语法.md`](计费表达式语法.md)）；**求值**只覆盖与 token 量直接相关的构造，其余在编译期就指名拒绝（→ `unsupported`），不做近似、不降级成默认值。

| 类别 | 构造 | 处理 |
|---|---|---|
| 求值 | 数字 / 字符串 / 布尔 / `nil` · `+ - * / % ** ^` · 六种比较 · `and` `or` `not` `&&` `\|\|` `!` · 三元与 Elvis · `??` · 括号 · `tier()` · 7 个 token 变量 · `max` `min` `abs` `ceil` `floor` | 算 |
| 解析但拒绝 | `in` / `not in` / `matches` / `contains` / `startsWith` / `endsWith`；数组、映射、成员访问、下标、切片、区间 | `expr_unsupported` |
| 指名拒绝 | 集合内建、lambda `#`、时间函数、`header` / `param` / `u` / `has()`、`let` / `if` / `;`、管道 `\|`、`$env` | `expr_unsupported` |
| 按次 | `fixed()` | `fixed_expr` |

- 14 种真实表达式（3 267 行）只用三元 · `<=` · `tier()` · 加 · 乘 · 小数 · 变量，全部落在「求值」一行内。
- **数值语义与上游逐位一致**：`run.go` 把 env 全填成 `float64`，`max` / `min` 族直接绑 `math.*`，故 `/` 是浮点除、`%` 取余符号随被除数。
- 对齐范围靠**临时差分脚本**核对（上游 `billingexpr_test.go` + `testdata/` 的 49 条用例：算对 33 · 拒绝 16 · 算错 0），用例**不入库**——与「不保留静态回归」的裁决一致。
- 后果边界：拒绝是可解释的（`detail` 带出具体名字）；万一某构造的理解仍有偏差，得到的是 `unmatched`（`delta ≠ 0`），不会静默给出错数。

### 5.5 代入一条真实日志

```
prompt_tokens = 316,862        completion_tokens = 142
cache_tokens  = 313,472        group_ratio = 1
billing_mode  = "tiered_expr"  model_ratio = 0  model_price = 0
request_conversion = ["Claude Messages", "OpenAI Compatible"]
```

**① 类别**：无 `ws` / `audio` / `is_task` → 文本路径。

**② 计价**：有 `billing_mode` → 表达式计费；无 `claude`、无 `usage_semantic` → OpenAI 语义。

**③ 语义 → 变量**：表达式引用了 `cr`，故

```
p   = 316,862 − 313,472 = 3,390
len = 316,862                     （OpenAI 语义取原始 prompt_tokens）
```

**④ 选档**：`316,862 > 272,000` → 走 `long_context` 档。

**⑤ 求值**

```
表达式值 = p × 4 + c × 15 + cr × 0.2
        = 3,390 × 4 + 142 × 15 + 313,472 × 0.2
        = 13,560 + 2,130 + 62,694.4
        = 78,384.4

quota   = 四舍五入( 78,384.4 / 1,000,000 × 500,000 × 1 )
        = 四舍五入( 39,192.2 )
        = 39,192          ← 与日志 quota 一致
```

> 作为对照：若把这一行误判为 Anthropic 语义（`p` 不减 `cr`），同一条日志会算成 **666,136**——差 17 倍。这就是 §3 那一步不能省的原因。

---

## 6. 预扣与结算

一条日志的 `quota` 是**结算值**，不是预扣值。两段式：

| 阶段 | 输入 | 说明 |
|---|---|---|
| 预扣 | 本地分词器估算的 prompt token | `quotaBeforeGroup = est / 1e6 × QPU × preConsumeMultiplier` |
| 结算 | 上游返回的真实 usage | 差额多退少补 |

订阅扣费时可在日志中直接对账：

```
subscription_post_delta = quota − subscription_pre_consumed
subscription_consumed   = subscription_pre_consumed + subscription_post_delta  （恒等于 quota）
```

预扣与实际差距大的典型原因：**预扣时还不知道缓存命中率**，全部按新输入估算。

---

## 7. 核对与覆盖边界

### 7.1 核对方式

本文的公式从两个方向核对：

1. **源码逐文件对照** —— 每个公式、每次取整、每个守卫都能定位到具体语句（出处见 §9）。
2. **真机日志验算** —— 对存量 `type = 2` 消费日志逐行按本文公式重算，与日志 `quota` 比对，偏差为 0。

验算覆盖四种组合：{倍率制, 表达式计费} × {OpenAI, Anthropic} 语义；含缓存读、缓存写、5m/1h 拆分、选档分支，以及 `quota = 0` 的空调用。

### 7.2 覆盖边界（**刻意不实现**）

本模块只做 **`PostTextConsumeQuota` 这一条结算路径**（chat / embeddings / responses / responses-compact 都汇入它），且只做其中的**倍率制**与**表达式计费**两种计价方式。其余情形一律返回 `unsupported` 并给出原因，**不做估算、不给"尽力而为"的数**。

`unsupported` 共 13 种 `reason`，按 `verifyQuota` 的判定顺序：

| 顺序 | 判据 | `reason` | 出处 |
|---|---|---|---|
| — | `other` 缺失或非对象 | `no_billing_info` | 日志未写入 `other` |
| 1 | `other.is_task === true` | `task` | `service/task_billing.go` · `LogTaskConsumption` / `taskBillingOther` 无条件写该键 |
| 2 | `other.ws === true` | `realtime` | `relay/websocket.go` · `WssHelper` → `PostWssConsumeQuota` |
| 3 | `other.audio === true` | `audio` | `relay/audio_handler.go` · `AudioHelper` → `PostAudioConsumeQuota` |
| 4 | 缺文本日志签名键 | `not_text_path` | `GenerateTextOtherInfo` 无条件写 `cache_tokens` / `cache_ratio` / `completion_ratio` / `user_group_ratio`；`GenerateMjOtherInfo` 与 `taskBillingOther` 不写 |
| 5 | `model_price > 0` | `fixed_price` | `UsePrice` 分支；图片与非图片两种子情形给出不同提示 |
| 6 | 含图片 token 项 | `image_tokens` | `image` / `image_output` 出现，即 §4.3 的附加项 |
| 7 | 含音频输入项 | `audio_tokens` | `audio_input_price` / `audio_input_token_count` 出现 |
| 8 | 含工具附加费 | `tool_surcharge` | `tool_surcharges` 出现 |
| 9 | `tiered_expr` 行缺 `expr_b64`，或 base64 解不开 | `no_billing_info` | 确实没有可用的表达式 |
| 10 | 表达式带 `\|\|\|` 条件倍率，或版本前缀不是 `v1` | `expr_unsupported` | `pkg/billingexpr/compile.go` 的拼接约定；条件依赖请求上下文，日志里没有 |
| 11 | 表达式词法 / 语法不合法 | `expr_grammar` | 上游存进来的表达式都经过编译校验，这条在实践中不应出现 |
| 12 | 表达式用了 `fixed()` | `fixed_expr` | `fixed()` 把档位切到按次（`RunExpr` 里 `BillingUnit = request`），不在覆盖范围 |
| 13 | 构造 / 函数 / 运算符不在求值白名单 | `expr_unsupported` | `detail` 带名字：`param` / `header` / 时间函数 / `u()`、`in` / `matches`、数组映射、`let` 等（§5.4） |
| 14 | 表达式引用不支持的变量 | `image_tokens` / `audio_tokens` / `expr_var` | 变量涉及 `img*` · `image_count` / `ai` · `ao` / 其它未知名（§5.1） |
| 15 | 非 `tiered_expr` 且既无 `model_ratio`、无 `model_price` | `no_billing_info` | 免费模型或字段缺失 |

> 第 4 步只是「这条日志出自 `GenerateTextOtherInfo`」的指纹，**不是「文本对话」的充分条件**：WS / 音频也先经同一个构建器（靠第 2、3 步拦掉）；而**按次的文本请求同样写这四个键**，由第 5 步拦下，不靠签名。

各未覆盖项的**可验算性**（与"本模块是否实现"是两件事）：

| 未覆盖项 | 能否验算 | 本模块 |
|---|---|---|
| 图片 token / 音频输入 / 工具附加费 | ✅ 可以（字段齐备） | ❌ 主动排除，命中即拒（§4.3） |
| MJ / 异步任务 | ❌ **不可能** | ❌ 拒绝 | 
| 按次固定价 · 图片 / 视频倍数 | ❌ **不可能**（缺 `other_ratios`） | ❌ 拒绝 |
| 按次固定价 · 纯文本 | ✅ 可以 | ❌ 未实现（范围外） |
| 实时语音 | ✅ 可以 | ❌ 未实现（范围外） |
| 音频 TTS/STT | ✅ 可以 | ❌ 未实现（范围外） |

> 上表中「❌ **不可能**」只有两条——MJ / 任务（两次记账、另一套求值入口）、带图片 / 视频倍数的按次（缺 `other_ratios`）。其余都是**可算但本模块主动不做**。

### 7.3 结构性盲区（**无法**覆盖）

| 盲区 | 位置 | 后果 |
|---|---|---|
| `usage_billing_path` | `admin_info` | 无法区分上游真实 usage 与本地估算（`*-estimated`） |
| `quota_saturation` | `admin_info` | 撞 `int32` 上限时静默偏低，验算会偏大 |
| `billing_model` / `use_channel` | `admin_info` | 无法还原实际计费模型名与渠道重试轨迹 |
| OpenRouter-Claude 归一化 | 需 `ChannelType`，日志无出口 | 该渠道的 Claude 行会多减一次缓存，验算偏小 |
| 表达式求值失败回退 | 回退值等于预扣额，无标记 | 这类行验算必然对不上且看不出原因 |

### 7.4 实现但零样本（真机未触发过）

以下子项在验算逻辑里确有实现，但现有日志中**没有任何样本**走过它们——未经数据检验：

| 子项 | 真机样本 | 实现依据 |
|---|---|---|
| `cache_creation_tokens_12h` | 0 | `text_quota.go` 非 Claude 分支：12h 缓存写按独立倍率计价 |
| `group_ratio ≠ 1` | 0 | 全库 `group_ratio` 恒为 1、`user_group_ratio` 恒为 -1，特殊分组倍率从未出现 |

已有样本但极少的：`cache_creation_tokens_1h` 仅 3 行、`tiered_expr × anthropic` 仅 6 行。

> 图片 token、音频输入、工具附加费**不在此表**——它们不在覆盖范围，命中即返回 `unsupported`（§4.3、§7.2），代码里没有对应实现。

风险形态：上表两行**不会报错**，只会在第一次遇到时给出一个未经证实的数。判据是「失配率是否从 0 变为非 0」。

**排查顺序**：先怀疑 §7.3 的估算/回退，再怀疑 §7.2 的量级，最后才怀疑公式。

---

## 8. 与 `NewAPI-接口范围.md` §3 的关系

`NewAPI-接口范围.md` §3 记录的 quota 反推式为：

```
quota = ( (prompt_tokens − cache_tokens) + cache_tokens × cache_ratio
          + completion_tokens × completion_ratio ) × model_ratio × group_ratio
```

该式**只对 OpenAI 语义成立**。Anthropic 语义下 `prompt_tokens` 本就不含缓存，照此再减一次即为双重扣减，实测偏差可达 17 倍。两种语义的完整判别与公式以本文 §3–§4 为准。

---

## 9. 源码出处

| 主题 | 文件 |
|---|---|
| 路径 → 计费模式 → 系数 | `relay/helper/price.go`（`ModelPriceHelper`） |
| 归一化与公式 | `service/text_quota.go`（`calculateTextQuotaSummary`） |
| 表达式计费的变量表 | `service/tiered_settle.go`（`BuildTieredTokenParams`） |
| 语义归一化 | `relaykit/dto/billing_usage.go`（`CanonicalUsage`） |
| Claude 响应解析 | `relay/channel/claude/relay-claude.go` |
| 取整与饱和 | `common/quota_math.go`（`QuotaFromDecimalChecked` / `MaxQuota`） |
| 日志字段与可见性 | `service/log_info_generate.go` · `model/log_other.go` · `model/log.go` |
| 常量 | `types/price_data.go`（`ClaudeCacheCreation1hMultiplier = 6/3.75`） |
| 音频 / 语音公式 | `service/quota.go`（`calculateAudioQuota` · `PostWssConsumeQuota` · `PostAudioConsumeQuota`） |
| 音频 / 语音日志字段 | `service/log_info_generate.go`（`GenerateWssOtherInfo` · `GenerateAudioOtherInfo`） |
| 任务计费与日志 | `service/task_billing.go`（`LogTaskConsumption` · `taskBillingOther`）· `relay/helper/price.go`（`ModelPriceHelperPerCall`） |

验算实现见 `packages/core/src/quota-verify/`（`index.ts` 为入口：路径判定与分派；`tiered.ts` / `multiplier.ts` 为两条公式；`expression.ts` 为表达式求值；`math.ts` 为取整饱和；`types.ts` 为公共类型）。本文 §7.1 的日志验算是一次性核对手段：该结论的正确性在线上由「验算结果 vs 日志 `quota`」的持续比对维持，不依赖静态样本。
