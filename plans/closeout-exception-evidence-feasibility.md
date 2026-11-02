# 异常 close 取证可行性矩阵

## 结论与边界

D4 已决定：只有独立核实所有可能副作用和 orphan 后才能人工结案；无法核实则 **BLOCKED，保留预留及 worktree**。这不是重新选择 A/B，也不降低 D2。本文只核查源码及既有非敏感材料，未核实任何具体任务现场，不新增政策或实现。只读核查授权不等于停服务、stop、close 或 apply 授权。

无需新代码即可静态检查契约、代码、已有脱敏材料，以及在另获具体授权后由受控操作者只读收集和审阅已有证据；能否满足 D2/D4 取决于现场可观察性与实际控制，不能预先保证。当前没有现场授权，不能验证任何具体任务是否安全或可结案。非 stop 状态首次 close 仍被拒绝；stop 状态的兼容行为不是安全认证。§5.5 缺 interruptResult 按 unconfirmed 认识，**不改写原 state、不补造结果**。

## 事实层级与现有工具边界

1. **机器结构/摘要校验**：[`verifyClose` 和 `parseBundle`](../src/tasks-maintenance.ts) 对首次 close 要求 `stop_requested` 或 `stop_unconfirmed`，核对 task、操作者/授权引用、原 state/session/interruptResult、时间顺序、listing 和证据闭包摘要。plan 与锁内 apply 均调用校验。它只要求 `entrypoints.closed` 非空及 `retryDisabled:true`，不验证真实入口是否隔离；`drain.inFlightEvidenceRefs` 可为空；external-writer 和 quiescence 引用须非空，但引用存在与摘要一致不证明内容真实、完整或现场仍受控。listing 非 complete 时检查 resolution 数量与时间等结构，不自动证明逐项人工审查的实质。摘要、字段一致或锁均不能替代现场核实。
2. **受控夹具或历史材料**：[`stage2 §11`](worktree-stage2-spec.md) 的 S4/S5 是有界夹具结果，不能当作当前现场证明。历史 [`stage1 closeout §4`](worktree-stage1-closeout-spec.md) D1 保留 submitted 未经 stop 的偏差，D2 的入口声明、digest、锁及 cwd 扫描和过期窗口证据不足；不追溯重判或改写历史。历史 [`stage0 中断案例`](worktree-stage0-results.md) 显示 session.shell 中断后 heartbeat 仍增长；同步 shell 个例的终止也不能推广到任意进程树。
3. **未验证现场**：现场调用、宿主副作用、入口控制、外部 writer 和 orphan 的终结情况，本轮均未知；既有材料不是对它们的核验。

[`tasks.stop`](../src/tasks.ts) 先核验已知 session，持久化 `stop_requested`，再最多一次 interrupt，最后写 `stop_unconfirmed` 和结果；已有 stop 状态不重发。崩溃可发生在持久 intent、interrupt 副作用与最终写入之间；`request_completed` 只描述请求结果，`processSafety` 仍为 `unconfirmed`。参见 [`stage1 contract` 的 stop 与安全边界](worktree-stage1-contract.md) 和 [`stage1 results` 的 SIGKILL 窗口](worktree-stage1-results.md)。

## 最低审核门槛

按 [`D2/D4 和 §5.5`](worktree-stage2-s0-contract.md)、[`stage2 §7`](worktree-stage2-spec.md)：绑定具名操作者、授权、任务及所有受影响 host/合作实例范围；实际隔离 start/stop/维护写及 prompt/retry 入口；查明完整在途工具调用和 host 端 create/prompt/interrupt 等副作用终结或可调查的明确故障结局；独立核实外部 writer 和所有可能 orphan。维护窗口从入口关闭持续至 apply 后复核，apply 前重新审阅新鲜清单和成果；受控操作者对证据及未解决项实质审查。失败、延时或范围变化后必须重新核实，不可仅凭旧证据。

checkbox、hash、PID 单次缺失、proc cwd、锁不存在、idle 或 session.list 空均不能替代上述闭环。以下各行的现场授权均指明任务、host/实例、时间窗、可读证据类别和受控操作者；任何超出只读核查的动作须另获明确授权。

## 矩阵

| 情况 | 已有可只读证据（若另获授权） | 需要的最小证据（除共同门槛外） | 现工具不能证明 | BLOCKED 条件 | 所需现场授权 |
|---|---|---|---|---|---|
| `stop_requested`，调用可能在途 | 原记录、已有调用边界及脱敏时间线 | 对该调用从入口到宿主响应/故障的完整链和副作用终结依据 | 持久 intent 不表明 interrupt 已发或已结束 | 任一调用或副作用仍在途、响应丢失无法查明 | 指定任务及涉及 host/服务的只读调用与副作用证据 |
| 崩溃在 intent、interrupt、finalization 之间 | 原 state、已有崩溃前后记录及调用日志 | 定位窗口，独立核实是否曾发送及其后果，排查遗留 writer/orphan | 重放不重发不能判定崩溃前是否发生副作用 | 无法定位或排除未终结副作用 | 指定崩溃实例、相关 host 和时间窗的只读取证 |
| `stop_unconfirmed` 且缺 interruptResult | 原记录及既有时间线；缺字段原样保留 | 核实形成状态的证据与可能调用/副作用，按 unconfirmed 审查 | 缺结果既不证明未发送也不证明停止 | 来源或副作用无法独立核实 | 指定任务相关状态、调用与宿主证据只读权限 |
| 有 session、结果为 `error` / `HOST_ERROR` | 原 session 绑定、脱敏错误摘要、已有调用记录 | 核实错误前后宿主端调用及全部副作用结局 | 错误摘要无法证明请求未生效 | 宿主端结果不明或仍可能写入 | 指定 session 和受影响 host 的只读调用证据；不读私有 payload |
| 无 session、`not_requested` / 潜在 orphan | 原记录、创建意图及已有脱敏日志 | 独立追查创建、绑定与可能 orphan 的全部副作用和写入所有权 | 无 sessionID / 未请求 interrupt 不是无 orphan 证明 | 任一潜在 orphan 或 writer 无法排除 | 指定任务、相关实例与 host 的只读创建和所有权证据 |
| session 找不到/不匹配且仍为非 stop | 原记录、既有身份核验失败摘要 | 确定真实绑定、所有副作用和 orphan；保留原状态 | stop 在转换前拒绝；现首次 close 门禁拒绝非 stop，证据齐全也不能绕过 | 身份/副作用未知，或仍未经过既有 stop 流程 | 指定身份与关联范围的只读证据；不包含中断或状态改写 |

各行均须满足共同门槛；矩阵不是放行清单。即使机器校验接受 stop 状态，也不能推断 D2/D4 已满足。若必要信息不可取得，保持 BLOCKED，不凭假设填充证据。

## 下一阶段

先取得明确的具体任务、host/实例、时间范围、可访问证据和操作者的现场只读核查授权；依可获得性报告证据缺口。若需要隔离入口、停服务、中断、close 或 apply，必须另行授权并遵守既有维护契约；本文不授权这些动作。
