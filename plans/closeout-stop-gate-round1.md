# Close stop 门禁：首轮矩阵与最小红灯契约

状态：ready / context-only。日期：2026-11-02。上游给定基线：HEAD `27d12c3`（本轮未执行 Git 核验）。

## 1. 背景、授权与边界

真实 host2 以 `submitted`、无 `interruptResult` 结案，暴露出“字段相等”不能替代“经过 stop 流程”的缺口。历史事实和偏差记录继续冻结，不能通过本轮测试追溯改判合规。

用户批准首轮仅契约矩阵与私有 fixture 红灯；本 Assignment 只交付本文，不写测试、不修生产、不执行测试、不碰真实 ledger。Root 须另开 engineer Assignment 才能执行下述私有测试。本文件不扩大 Mandate/Scope，不授权真实 maintenance plan/apply、停止宿主或清理 worktree。已有 `plans/worktree-stage1-closeout-spec.md` 原样保留。

## 2. 核实依据与纠正

- `plans/worktree-stage2-s0-contract.md` §5.5：`stop.stopState` 必须来自既有 stop 流程；缺失 `interruptResult` 按 `stop_unconfirmed` 处理；无法取得必要证据则 BLOCKED、保留预留。此句不是把 `submitted` 改写成 stop 状态的授权。
- `plans/worktree-stage1-closeout-spec.md` §4 D1、§5：记录真实偏差及历史冻结边界；本文未重新核验其历史摘要，也不改写该文。
- `src/tasks-maintenance.ts`：`parseBundle` 接受全部八种 `TaskState`；`verifyClose` 当前仅比较 stopState、sessionID、interruptResult 与账本相等，没有 stop 阶段准入门禁。`buildPlan` 和锁内 `applyClose` 均调用 `verifyClose`；后者在 `writeBackup`、`writeArchive` 和 `tx.write` 之前校验。`evidence()` 已抛 `MAINTENANCE_EVIDENCE_INSUFFICIENT`。
- `src/tasks-state.ts`：`TaskState`、`edges`、`Ledger.reserve`、`Ledger.transition`、`decodeRecord` 是 fixture 的真实 API。**不存在 `created` 状态**。`reserved → session_create_requested → session_bound → prompt_requested → submitted` 是合法路径；进入 `session_bound` 必须提供 sessionID。`submitted` 无 sessionID 会被 decoder 拒绝，不能拿这种非法输入复现目标缺口。
- `src/tasks.ts` 的 `stop`：通过 session 身份检查后，非 stop 状态进入 `stop_requested → stop_unconfirmed`；无 session 为 `{interrupted:'unknown',result:'not_requested'}`；有 session 中断返回为 `request_completed`，异常为 `error` + `errorCode:'HOST_ERROR'`。已有 `stop_requested` / `stop_unconfirmed` 直接返回，不重复中断；session 查询/身份失败可在转换之前拒绝。
- `test/tasks-maintenance.test.ts`：`start` 只调用 `Ledger.reserve`，实际为 **reserved，不是 submitted**（纠正 explorer 摘要）。`prepared` 经 `migrated` 和测试 helper `stop` 到无 session、`stop_unconfirmed/not_requested`；该 helper 只支持从 reserved 开始。`bundle` 默认复制 record 的 stop 字段，因此可暴露“两端一致但非 stop”的缺口。`setup` 已将 Git/ledger/worktree 隔离在 `test/.work/tasks-maintenance/`。

## 3. 首轮门禁矩阵

本矩阵面向未提交的首次 close；合法已提交 operationID 的幂等重放仍遵循既有顺序，不借此重验/改写历史 closed 记录。所有行均不证明进程停止。表中“一致”指 bundle 与权威 record 对应字段严格一致。

| 权威状态 / stop 数据 | 分类 | 首轮契约或保留事项 |
|---|---|---|
| `submitted`，有 sessionID，无 interruptResult，bundle 一致 | **明确拒绝，最小红灯** | 缺少既有 stop 阶段；完整 listing、drain 等不能替代该条件。plan/apply 都不得释放名额 |
| `reserved`、`session_create_requested`、`session_bound`、`prompt_requested`、`start_unconfirmed`，bundle 一致 | **明确拒绝** | 均不属于 stop 阶段；其中无 session 也不是安全证据。首轮不扩展成全参数化红灯 |
| bundle 与 record 的 state / sessionID / interruptResult 不一致，或证据结构不合法 | **明确拒绝，已有行为** | 保留 `verifyClose` / parser 的现有一致性检查，不用新增门禁替代它 |
| `stop_unconfirmed`，有 sessionID，`unknown/request_completed`，一致且确实来自 stop | **满足停止阶段，仍需全证据** | 只说明中断调用返回；入口、在途、外部 writer、quiescence、listing、授权和摘要绑定仍必需 |
| `stop_unconfirmed`，无 sessionID，`unknown/not_requested`，一致且来自 stop | **满足停止阶段，仍需全证据** | 保留现有 prepared 正向 fixture 作为兼容控制；真实场景仍须核实 orphan/外部副作用，不能凭无 session 放行 |
| `stop_unconfirmed`，有 sessionID，`unknown/error/HOST_ERROR`，一致 | **停止阶段事实成立，异常结案政策待决策** | 不把中断错误当停止成功；首轮不决定仅靠其余证据能否放行，也不写该组合正/负断言 |
| `stop_requested`（可能停在在途/崩溃边界），或 stop 状态缺 interruptResult | **待决策** | 缺失按 unconfirmed 认知，不补造结果；不能据此推导绝对允许或绝对拒绝。须厘清 stop 来源、在途排空和外写核实如何举证 |
| stop 状态下 sessionID 与结果语义反常，例如有 session + not_requested、无 session + request_completed/error | **待决策** | schema 可表达不等于常规 stop 可产生；首轮不擅定完整异常交叉矩阵政策 |

共同边界：`processSafety` 仍未确认；close 仅释放账本名额，不授予 cleanup/integrate 权限。状态字符串和静态 fixture 本身不能证明 stop 历史来源或真实进程安全。

## 4. 最小私有红灯测试契约（依赖顺序）

建议在既有 `test/tasks-maintenance.test.ts` 中复用本地 helper，避免为测试增加生产导出。以下测试名为拟新增标识，不是现有符号。工程实施仅写测试并跑红灯，之后停止；不得在本轮接着修实现。

### 4.1 建立合法 submitted fixture

1. `setup()`、`start(f)`；显式断言初始 `state === 'reserved'`。
2. `migrated(f)`；使用 `f.ledger.transition('owner', task.taskID, expected, next, options)` 依次走 `reserved → session_create_requested → session_bound → prompt_requested → submitted`，仅进入 `session_bound` 时传 `{sessionID:'fixture-session'}`。
3. 用 `record(f, task.taskID)` 重新读权威记录，断言 v2 active、submitted、有 fixture sessionID、无 interruptResult。不要调用现有 reserved 专用 `stop` helper，不调用真实宿主。
4. `bundle(f, rec)` 生成其余字段完整的证据，`closeRequest(f, rec)` 使用未提交的 operationID。这是状态语义模拟，不复制真实 host2 ledger 或历史 evidence。

### 4.2 R1：`round1 stop gate plan rejects submitted without interrupt`

- 调用 `planMaintenance(closeRequest(f, rec))`，期望异常 `.code === 'MAINTENANCE_EVIDENCE_INSUFFICIENT'`。
- 建议复用 `evidence()` 的错误码属于实现选择，不新增公共错误码或请求字段；本轮只锁定此明确拒绝场景，不决定多错误优先级。
- **预计当前红灯**：其余证据合法时函数返回 `ok:true` 而不抛异常；不是 `REGISTRY_INVALID`、导入错误或 Git fixture 失败。

### 4.3 R2：`round1 stop gate apply rejects submitted without interrupt`

- 使用独立的同构 fixture，先利用当前缺陷调用 `planMaintenance` 得到完整合法 plan，显式确认 plan 成功，再将其直接交给 `applyMaintenance`，期待同一证据不足异常。
- plan 与 apply 之间不改变 registry、generation、证据文件或 operationID，避免把红灯替换成 stale/digest 拒绝；不得 mock `verifyClose`、篡改真实 ledger 或禁用摘要校验。
- **预计当前红灯**：apply 实际成功，active→closed、generation+1，并写备份归档，因此拒绝及无副作用断言失败。只允许发生于新建私有 fixture。
- 此设计适合本轮缺陷取证；将来 plan 修复后会在准备阶段被拒绝，不能把该结果误记为 apply 门禁绿灯。后续修复 Assignment 必须另行设计可达的、摘要自洽的旧缺陷 plan 输入或专用测试 builder；本轮不新增此接口/序列化实现。

### 4.4 两入口的拒绝后无持久副作用断言

在证据准备完成、待测调用之前取快照；R2 在 plan 生成后再取快照。捕获实际返回/异常后先检查副作用，再独立检查错误码，避免“未抛异常”提前终止而漏查副作用。

- `registry.json` 字节完全不变；active/closed、generation、原 record（含 submitted 与缺失 interruptResult）不变。
- backups/archives 的存在性、文件名集合及已有文件字节不变，不能只断言不存在某个固定文件；fixture 迁移 helper 不生成维护归档，但测试不依赖该偶然性。
- evidence 文件与目标 `a.txt` 字节不变，worktree 仍存在；待测调用结束后不遗留 `.lock` 或提交临时文件。
- “无副作用”限定拒绝不留下持久业务变更；apply 合法获取/释放事务锁不算违反，不要求系统调用级零写入。
- R1 当前可能无副作用断言通过而拒绝断言失败；R2 当前两类断言均应显示缺口。报告保留实际观察，不伪造失败输出。

### 4.5 控制组（当前应通过）

- 复用现有 `plan is read-only and binds generation, registry digest, changes, and evidence` 与 `close apply moves the record to closed, writes evidence-bound closeout, backup, archive, and +1 generation`：`prepared` 的无 session stop_unconfirmed/not_requested + 全证据路径继续可用，不将“无 session”本身作为拒绝条件。
- 复用 `missing, mismatched, and unresolved evidence is refused`：已有证据拒绝仍工作，说明红灯不是全面证据解析故障。
- 若增加一条对照，仅令 submitted 记录经合法 `submitted → stop_requested → stop_unconfirmed` 并带 `unknown/request_completed`，重新读 record、重新生成 bundle 后 plan/apply 应可通过现有检查；仅为私有模拟，不意味着已执行宿主 stop。此对照非最小必需项。

## 5. 验证方式与首轮成功标准

以下命令交给另获授权的 engineer；本轮架构交付未执行。拟新增测试应采用上述 `round1 stop gate` 前缀以便定向执行：

```sh
TMPDIR="$PWD/test/.work/tasks-maintenance/tmp" bun test test/tasks-maintenance.test.ts -t 'round1 stop gate'
TMPDIR="$PWD/test/.work/tasks-maintenance/tmp" bun test test/tasks-maintenance.test.ts -t 'plan is read-only|close apply moves|missing, mismatched, and unresolved'
git diff --check
```

执行前确保项目内 TMPDIR 存在，禁止 `/tmp`；若预计超过一分钟、2G 内存或大量读取 `/data_0`，先读 slot 规则，`slot audit` / `slot status` 写项目日志，再通过 slot 提交，不能直接起重活。不要默认运行全套长测试。

首轮测试验收：两项定向拒绝测试产生可解释的行为红灯；控制组通过；报告含命令、退出码、实际失败输出、私有路径及副作用观察；失败必须来自缺少 stop 门禁，而非 fixture/schema/环境错误。生产源码、真实 ledger、历史证据零修改；不要求也不允许本轮修到全绿。本文件交付验收则是矩阵与可执行测试契约完整，仅新增本文。

## 6. 风险与未决项

- 未决的 stop_requested、缺 interruptResult、HOST_ERROR 和语义反常组合不阻塞本轮 submitted 红灯，但阻塞相应全面政策落地。可选方向是要求明确的 stop 完成记录，或允许 unconfirmed 进入人工核实路径；需用户确定证据门槛后再形成具体拒绝/放行测试，不在此替用户选择。
- 现有接口不能仅凭字段相等验证历史来源；本轮不发明“停止进程保证”或新增证明字段。
- 正向 fixture 的文本 evidence 仅覆盖程序结构契约，不能证明真实维护窗口合规；真实历史继续保持原偏差结论。
- R2 借当前缺陷建 plan 是刻意的首轮取证限制，不是可直接沿用到修复完成的永久回归结构。
- 本文没有授予实施或真实操作权限；Root 的下一份 Assignment 应明确仅测试、红灯后停止，不进入修复。
