# Worktree 阶段 2 · S0 决策记录与精简接口冻结

日期：2026-10-31。状态：**S0-D 已通过（D1–D6 用户决策已签字）；S0 的另一半「停止证据可实际取得」尚未验证，维护实现因此仍按 Spec 第 8 节 BLOCKED。本文冻结的是接口契约，不是实现承诺。**

起点 HEAD `e22da8407d6bd7195e4000b9575e6d13fe3d5e09`，工作区 clean（Root 实际 Git 检查）。本文与 [阶段 2 Spec](worktree-stage2-spec.md) 配套；接口细节冲突时以本文为准，但 Spec 第 8 节的 S0 取证门槛与安全底线不由本文改写（本文与源码事实冲突时以源码为准并回改本文）。

## 1. 本轮授权范围

用户于 2026-10-31 明确选择「先做 S0：确认 D1–D6」并「全部采纳文档第 4 节技术建议」。由此本轮授权仅包含：

- 记录 D1–D6 决策结果与生效约束；
- 冻结后续 S1/S2/S3 共用的精简接口（数据模型、操作、输出、错误码、证据、权限边界）；
- 局部更新 Spec 的状态与决策表。

明确**不在**本轮授权内：

- 修改 `src/`、新增生产代码或测试、注册任何在线工具；
- 运行行为测试、构建、服务、模型或真实 host 试运行；
- 读写真实 `opencode-crew-stage1/registry.json`、迁移真实 ledger、结案任何真实任务、释放任何名额；
- 备份/归档真实项目、清理 worktree、merge/commit 受管成果。

副本提交与推送按既有约定由 Root 在用户确认后执行。S0-D（决策部分）通过不等于 S1/S2/S3 实施授权，更不等于 S4 真实周转授权；S0 整体仍缺取证可行性验证。

## 2. D1–D6 决策结果

| 决策 | 结果 | 生效约束 | 违反/未取证时 |
|---|---|---|---|
| D1 离线入口与操作者 | 采纳：独立本地维护入口，显式 plan/apply 两阶段，受控维护操作者；不注册在线工具 | 入口只读取本地 registry 与私有证据文件，不提供模型工具、不接受任意 shell 命令 | 无显式维护授权或非受控操作者：只允许 `plan` 的只读推演，拒绝 `apply` |
| D2 停止核实证据 | 采纳：具名操作者、时间、受影响 host/任务范围、关闭新请求及续跑入口、在途调用排空依据、外部写入者核实、证据引用；不接受 `stopped:true` 勾选 | 证据按第 5.5 节结构逐项提供；缺项即 `MAINTENANCE_EVIDENCE_INSUFFICIENT` | BLOCKED，保留预留与 worktree |
| D3 最低成果保全 | 采纳：原 worktree 留存 + 完整性状态明确的最小清单 + 人工审阅/测试证据索引；不实现完整保全包 | 清单只是私有审阅索引，`complete` 仅指本次有限枚举成功；结案不删除、不修改 worktree | 无法给出清单或清单为 `incomplete/changed` 未人工解决：不结案 |
| D4 故障/orphan 结案 | 采纳：仅独立核实所有可能副作用及 orphan 后人工结案；无法核实一律保留 | 无 sessionID 不是安全证据；`start_unconfirmed`/`stop_unconfirmed` 同样需要外侧核实 | 一律 BLOCKED，不得以「无 sessionID」或「单次 PID 缺失」放行 |
| D5 baseline 切换 | 采纳：`active=0` 后显式开新 period；不得由 `start` 隐式改 baseline；旧 period/摘要不变 | 切换校验主 HEAD clean 且新 baseline 为完整 commit；新 period 内 `start` 仍要求目标 clean/detached/同 baseline | `active>0` 或校验不通过：`PERIOD_NOT_EMPTY`/`BASELINE_MISMATCH`，不切周期 |
| D6 历史目录复用 | 采纳：首版永不复用历史规范 cwd，包括换 key、别名、删除后重建 | 目录唯一性在 active+closed 全历史生效；拒绝时不给可绕过的别名建议 | 拒绝，`DIRECTORY_REUSED`；不接受「先删记录再复用」的运维做法 |

技术建议被采纳为业务决策，但其证明强度不变：结案只释放账本名额，不证明进程已停、成果已被外部保存或可以清理。

## 3. 冻结的数据模型（RegistryV2）

唯一权威仍是 `<commonDir>/opencode-crew-stage1/registry.json`，沿用现有目录 0700、文件 0600、1 MiB 上限与 `AtomicRegistry` 原子替换。不新增第二权威路径。

```text
RegistryV2 = {
  schemaVersion: 2,
  project: { primaryDirectory, commonDir },
  generation: number,            // 整数 >= 1，每次成功提交 +1
  migration: { operationID, paramsDigest, appliedAt },   // 唯一一次 v1→v2 迁移凭据
  currentPeriodID: PeriodID,
  periods: [{ periodID, baseline, openedAt, openedBy, openedParamsDigest, sealedAt? }],
  active:  [{ periodID, record: TaskRecord }],
  closed:  [{ periodID, record: TaskRecord, closeout: Closeout }]
}

Closeout = {
  operationID, paramsDigest, closedAt, operatorRef, authorizationRef,
  disposition: "preserved" | "abandoned" | "integrated",
  stopEvidenceRef, quiescenceEvidenceRef, reviewEvidenceRef, evidenceDigest,
  archiveRef, archiveDigest,
  integrationCommit?            // 仅 disposition=integrated
}
```

| 字段 | 冻结规则 |
|---|---|
| `PeriodID` | `/^pd_[1-9][0-9]{0,5}$/`，按 `periods` 顺序从 `pd_1` 起连续编号；period 只增不删，编号不复用 |
| `generation` | 整数且 `>=1`；迁移首个 v2 写为 `1`，此后每次 `reserve`/`transition`/维护提交各 +1。不要求跨崩溃严格连续，但必须单调不减 |
| `migration` | 必填且只出现一次；`{operationID, paramsDigest, appliedAt}` 记录 v1→v2 迁移；v2 不得二次迁移，缺失或重复即 `REGISTRY_INVALID` |
| `periods` | 至少 1 项；`periods[0].periodID === "pd_1"`，其 `openedBy`/`openedParamsDigest` 必须等于 `migration.operationID`/`migration.paramsDigest`，且**视为迁移凭据的派生别名，不登记为独立 `open-period` 操作**；全局唯一校验与操作索引显式排除该别名。其余 period 才登记独立 `open-period` 凭据。除 `currentPeriodID` 外的 period 必须带 `sealedAt`，当前 period 不得带 `sealedAt` |
| `active` | 长度 `0..2`；每项 `periodID === currentPeriodID` 且 `record.input.baseline === 当前 period.baseline`；`record` 与 v1 `TaskRecord` 字段完全相同（必填 7：`taskID`/`input`/`ownerSessionID`/`requestDigest`/`state`/`createdAt`/`updatedAt`；可选 3：`sessionID`/`lastErrorCode`/`interruptResult`），不新增生命周期字段 |
| `closed` | 顺序即结案顺序；每项 `record` 仍是完整 `TaskRecord`，作为永久幂等墓碑；`closeout` 字段集如上有 `exact` 语义（未知键拒绝） |
| `operationID` + `paramsDigest` | `operationID` 形如 `/^op_[0-9a-f]{32}$/`（128 bit），在 `migration`、`periods[].openedBy`、`closed[].closeout` 三类凭据间**全局唯一**；`paramsDigest = SHA-256(规范化 request 全字段)`。三种操作各自持久化两者：`close`→`closeout.{operationID,paramsDigest}`，`open-period`→`periods[].{openedBy,openedParamsDigest}`，`migrate`→`migration.{operationID,paramsDigest}`。`apply` 以二者判定重放，不依赖重建历史输入 |
| 证据类 `*Ref` | `stopEvidenceRef`/`quiescenceEvidenceRef`/`reviewEvidenceRef`/`archiveRef` 是管理目录下的普通文件路径：禁止绝对路径、`..`、symlink 与目录逃逸；`archiveDigest` 为归档文件 SHA-256 小写十六进制 |
| `operatorRef`/`authorizationRef` | **不适用**上一条路径规则：它们是 1..512 字符、无控制字符的不透明标签，指向私有授权记录，按提供值原样记录；不得由 shell 用户自报身份推导，也不得替换历史 `ownerSessionID` |

不变量（S2/S3 测试须逐条断言）：

1. `key`/`taskID` 在 `active + closed` 全局唯一；`ownerSessionID`、规范 `cwd`、`requestDigest`、`input.baseline` 永久不变；`taskID` 仍恒为 `ct_${key}`。
2. 规范 `cwd` 在 `active + closed` 全局唯一（D6），period 切换不解除。
3. 容量只计 `active`，上限 2；`start_unconfirmed`、`stop_unconfirmed`、idle 在结案前照常计数。
4. 旧 key 查找先于容量/当前 baseline/目标 clean 校验；不同 digest（含不同 owner）仍 `IDEMPOTENCY_CONFLICT`。
5. 迁移把 v1 全部 tasks 原样放入 `pd_1` 的 `active`，不释放名额、不重算 digest、不丢 `sessionID`/错误/时间字段。
6. `closed` 增长导致 registry 超过 1 MiB 时拒绝写入与新启动，不删墓碑、不自动分片。

## 4. 冻结的三工具兼容行为

输入 schema 与现有错误码不变。新增仅限只读视图字段：

| 场景 | 冻结行为 |
|---|---|
| `start` 重放 closed key（同 owner、同 input） | 返回 `ok:true`，`task` 为原记录的 closed 视图（`state` 不变），附 `lifecycle:"closed"`、`periodID`、最小 `closeout` 摘要；**零 create/prompt/interrupt**，warning 保留「重放不会重新投递。」 |
| `start` 同 key 不同 digest/owner | `IDEMPOTENCY_CONFLICT`，不查容量、不改账本 |
| `status` 无 `taskID` | 仍只返回当前 owner 的 active 集，避免无界历史输出 |
| `status` 指定 `taskID` | 先查 active 再查 closed，只返回该 owner 的记录；closed 视图带 `lifecycle`/`periodID`/`closeout` 摘要 |
| `stop` 命中 closed | 返回记录与 `ok:true`，warning「已结案，不会重复中断。」；零 interrupt |
| 任何工具对 closed 记录 | 不得进入 `transition`；closed 不是可继续执行的状态机状态 |
| `retry` hook | 必须能查 active 与 closed 的旧绑定，历史绑定仍置 `retry:false` |
| 旧插件读 v2 | `Ledger.decode` 拒绝并 fail closed，不回退空库；维护前须盘点并隔离旧 reader/writer，不得让旧实例承载 v2 受管任务 |

`taskView` 对 closed 仍输出 `processSafety:"unconfirmed"`、`canCleanup:false`、`canIntegrate:false`；`disposition:"integrated"` 只是历史事实记录，不触发 commit/merge。

## 5. 冻结的离线入口

### 5.1 命令表面

```sh
bun src/maintenance-cli.ts plan  <operation.json>   # 只读推演，不写 registry
bun src/maintenance-cli.ts apply <plan.json>        # 提交，需 plan 内绑定的授权与证据
```

- stdout 只输出机器 JSON（单个对象），stderr 只输出简短中文摘要；两者都不得含 goal/check/正文、diff 正文、环境、异常 body、DB/cache 或认证数据。
- 退出码：`0` 成功；`1` 拒绝/BLOCKED（`ok:false`，带 `error.code`）；`2` 用法或输入结构非法。
- 不接受任意 shell 命令、任意 sessionID、任意外部输出目录；不注册在线工具，不进 `dist/index.js` 的导出面。
- 三个逻辑操作冻结为 `migrate`、`close`、`open-period`；`review`（S1 清单）是独立只读入口，不属于 `apply` 的一部分。

### 5.2 operation.json（plan 输入）

```text
{ v: 1, operation: "migrate" | "close" | "open-period",
  operationID, operatorRef, authorizationRef, project: { primaryDirectory, commonDir },
  ...按 operation 追加：
  migrate:      {}
  close:        { taskID, disposition, evidence: <EvidenceBundle 路径>, integrationCommit? }
  open-period:  { baseline } }
```

字段集按 `exact` 语义校验（未知键拒绝）。`close` 的 `disposition` 不含「释放名额」语义；`abandoned` 同样保留 worktree。规范化后的 `request` 全字段（含 `operatorRef`/`authorizationRef` 与操作参数）参与 `paramsDigest` 与 `planDigest`，不允许在 `apply` 阶段从 CLI 参数或环境临时补齐。

**S3 实现评审修订（2026-10-31）。** 上文冻结的 closeout 已含 `integrationCommit?`，但原 close 请求没有该字段来源，导致 `disposition:"integrated"` 无法同时满足「closeout 必填」与「请求 exact 字段」两条规则。现显式补入可选 `integrationCommit`，规则为：

- 仅 `disposition:"integrated"` 允许出现，且必须是当前仓库对象格式下合法的完整 commit OID（40 或 64 位小写十六进制）；格式非法或出现在其他 disposition 上均为 `INVALID_INPUT`。
- `integrated` 缺失该字段判 `MAINTENANCE_EVIDENCE_INSUFFICIENT`，不得以占位值或空字符串提交。
- 它只记录另行授权并已验证的整合事实，不触发 commit/merge；字段参与 `paramsDigest` 与归档，历史记录不可改写。

### 5.3 plan.json（plan 输出 / apply 输入）

```text
{ v: 1, ok: true,
  plan: {
    request: { v, operation, operationID, operatorRef, authorizationRef,
               project: { primaryDirectory, commonDir }, ...操作参数 },
    paramsDigest,
    generation, registryDigest,
    changes: [{ taskID, ownerSessionID, lifecycle: "active" | "closed",
                from: { periodID, state, closeout? },
                to:   { periodID, state, closeout? },
                evidenceRefs: [] }],
    expectedActive,
    evidence: [{ ref, kind: "bundle" | "listing" | "drain" | "external-writer" | "quiescence" | "resolution",
                 digest }],
    warnings: [] },
  planDigest }
```

**证据闭包（不可由调用方裁剪）。** `plan` 必须从 `request` 自动构建闭包：`close` 的 EvidenceBundle 本体、`review.listingRef`、`drain.inFlightEvidenceRefs[]`、`externalWriters.evidenceRefs[]`、`quiescence.evidenceRefs[]`、`review.resolutions[].ref`；递归深度 ≤ 2、文件数 ≤ 32、单文件 ≤ 2 MiB、累计读取 ≤ 16 MiB、闭包读取与散列总时长 ≤ 10 s；任一超限即 `MAINTENANCE_EVIDENCE_TOO_LARGE`。这些限额外加于 registry 的 1 MiB 上限，不是同一约束。调用方只能提供 `request`，不能增删 `evidence[]`；`apply` 重算闭包并与 `plan.evidence` 逐项比对 `ref`/`kind`/`digest`，缺项或多出项一律 `MAINTENANCE_EVIDENCE_INSUFFICIENT`。

`apply` 的处理顺序被冻结为：

1. 重新计算 `planDigest`、`paramsDigest` 并覆盖全部 `request` 字段；不符即 `MAINTENANCE_PLAN_STALE`。
2. 按 `operationID` 查 registry 中已提交凭据：同 ID 同 `paramsDigest` → 返回该操作的原结果（见下），`ok:true` + `replayed:true`，**零写入**；同 ID 异参数或跨操作类型复用（`pd_1` 的派生别名除外）→ `OPERATION_CONFLICT`。此步先于 stale 校验，保证响应丢失后的重放幂等。
3. 未命中才校验 `generation` 与 `registryDigest`；任一变化即 `MAINTENANCE_PLAN_STALE`，不写入，也不得「自动重算后直接执行」。
4. 重新读取并逐项核验证据闭包：路径规则、`digest` 必须与计划一致；任何证据文件缺失或被改写即 `MAINTENANCE_EVIDENCE_INSUFFICIENT`。
5. 交叉校验放行依据：`bundle.taskID === request.taskID`；`review.listingRef`/`listingDigest` 与清单文件一致且其 taskID/baseline/观测时段与 bundle 记录相符；`incomplete`/`changed` 项须被 `resolutions` 全覆盖；`operatorRef`/`authorizationRef` 在 request、bundle、closeout 间一致；不一致即 `MAINTENANCE_EVIDENCE_INSUFFICIENT`。
6. 复核维护窗口仍有效（入口仍关闭、在途已排空、外写核实未被撤回）；失效即 `MAINTENANCE_NOT_DRAINED`。
7. 进入 §5.4 的锁内复核与唯一提交点流程。

重放与首次成功的**结果形状一致**，且不读取可变字段冒充原结果：`migrate` → `{schemaVersion:2, generation:1, currentPeriodID:"pd_1"}`（迁移提交时的固定值，不随后续 generation/period 变化）；`open-period` → 该 period 记录中的 `{periodID, baseline, openedAt}`；`close` → 该 closeout 记录中的 `{taskID, periodID, closedAt, disposition}`。响应含 `replayed:true`，不含 goal/check/正文。

### 5.4 提交与故障语义

- 备份：`backups/registry-<generation>-<ISO8601>.json`；归档：`archives/<operationID>.json`；均在管理目录子目录，0700/0600，独占临时文件 + fsync + 原子 rename + 目录 fsync，临时文件不落 `/tmp`。
- **锁内复核**：上述第 1–6 步可在锁外做昂贵预检，但**不得**用锁外结果直接授权写入；锁内必须对同一份权威状态按固定算法重做，全部通过后才提交：
  1. 读 registry 并通过结构校验；
  2. 匹配已提交凭据：同操作同 `paramsDigest` → 立即零写返回重放结果（合法重放不受后续 stale 判定影响）；异参数 → `OPERATION_CONFLICT`；
  3. 未命中者才校验 `generation` 与 `registryDigest`；不符 → `MAINTENANCE_PLAN_STALE`；
  4. 重算并核验证据闭包（路径、摘要、限额、交叉校验）；
  5. 复核维护窗口仍有效；失效 → `MAINTENANCE_NOT_DRAINED`；
  6. 备份 → 归档 → 一次原子替换。
- 唯一提交点：持锁期间生成并校验备份与不可变归档后，用**一次** registry 原子替换完成 active→closed 与 `generation+1`。备份/归档在提交期生成，其摘要随 closeout/归档写入权威记录，不属于 `plan.evidence` 输入闭包。
- 替换前失败：registry 保持旧 active；替换后即使响应丢失，也以「读回 registry 中是否存在该 `operationID`」判断，不得二次释放。
- `rename` 后 `fsync` 报错：报告「结果未确认」并停止后续操作，不追加写入。
- 未引用档案残件不得触发自动恢复/释放，也不自动删除；遗留 `.lock` 照旧拒绝，不按 PID/TTL 抢占。
- 恢复须在维护窗口内校验备份/档案/权威记录三者；损坏或缺引用时停止所有写入，不得挑选「看起来能用」的旧库继续 `start`。

### 5.5 EvidenceBundle（D2/D4 取证结构）

私有 JSON，与被结案任务同目录树，不进入工具输出；字段同样 `exact` 校验：

```text
{ v: 1, taskID, operatorRef, authorizationRef,
  host, taskScope: [taskID], recordedAt,
  entrypoints: { closedAt, closed: [...], retryDisabled: true },
  stop: { sessionID?, stopState, interruptResult?, observedAt },
  drain: { completedAt, inFlightEvidenceRefs: [] },
  externalWriters: { verifiedAt, method, evidenceRefs: [] },
  quiescence: { verifiedAt, evidenceRefs: [] },
  review: { listingRef, listingDigest, completeness: "complete" | "incomplete" | "changed",
            observedFrom, observedTo, resolvedAt?, resolutions: [{ ref, resolvedAt, approvedBy }] } }
```

- `entrypoints.closed` 必须列出实际关闭的 start/stop/维护写入口与续跑入口；`retryDisabled:true` 需与实际配置一致。
- `stop.stopState` 必须来自既有 `stop` 流程的记录；`interruptResult` 缺失时按 `stop_unconfirmed` 处理。
- `externalWriters.method` 必须描述核实手段（终端、原生会话、进程与文件所有权等），不能写「未发现」而无依据。
- `review.listingRef` 即 S1 清单文件的受保护路径，`listingDigest` 为其 SHA-256；清单为 `incomplete`/`changed` 时必须有覆盖全部条目的 `resolutions`（人工核对方、时间、复核依据），否则 `MAINTENANCE_EVIDENCE_INSUFFICIENT`。
- `closeout.reviewEvidenceRef` 必须等于 `review.listingRef`，`closeout.stopEvidenceRef`/`quiescenceEvidenceRef` 等于本 bundle 路径；`closeout.evidenceDigest` 记录本 bundle 的 SHA-256。三者任一不一致即拒绝。
- 无法取得的项：不写占位值，直接判 BLOCKED，保留预留；`apply` 前必须在维护窗口内重新核验清单与成果，不得凭旧清单释放。

### 5.6 S1 只读成果清单契约

入口为独立只读模块（建议 `src/tasks-review.ts`，名称待实现评审），不写 registry、不改 worktree、不改 index：

```text
{ v: 1, taskID, periodID?, baseline,
  observedFrom, observedTo,
  head: { from: string|null, to: string|null, drifted: boolean|null } | null,
  completeness: "complete" | "incomplete" | "changed",
  counts: { tracked, staged, unstaged, untracked, deleted, renamed, binary, unknown, excluded, outsideScope },
  entries: [{ path, changeType, source: "index" | "worktree" | "head",
              bytes?, sha256?, status }],
  failures: [{ code, count }], warnings: [],
  limits: { maxPaths, maxFileBytes, maxTotalBytes, timeoutMs } }
```

- `entries[].status ∈ { hashed, unreadable, missing, changed, excluded, refused }`；排序按路径字节序，控制字符转义展示。
- `head` 必须是「实际观测到的值」或 `null`，不得用请求里的 `baseline` 冒充观测结果。观测前就因超时/失败中止时整个 `head` 为 `null`；只观测到起点时 `to` 与 `drifted` 为 `null`。`drifted` 只在 `from`/`to` 都有值时才可判定，`null` 表示未观测，不表示「未漂移」。
- 观测前的超时是**结果**不是异常：返回 `completeness:"incomplete"` + `failures:[{code:"REVIEW_LIMIT_EXCEEDED"}]`，保留已观测计数，不抛异常、不伪造 HEAD。
- 路径身份必须先于删除/排除分类：解码后含 `\uFFFD` 的路径一律先判 `refused`（不论它是否删除），再做后续分类。
- 删除事实优先于排除分类：`changeType:"deleted"` 的条目一律 `status:"missing"`、不打开不散列；若同名文件仍存在，它是另一条独立事实（如 `??` 条目），不许把它的哈希挂到删除条目上。被删除的排除类路径只计 `deleted`，不计 `excluded`（没有可读正文）。
- 排除名单（命中即 `excluded`、不打开、不散列、只计数）：路径分量为 `.git`、`.env`（`.env.example` 除外）及 `.env.*`、`.ssh`、`.gnupg`、`node_modules`、`.cache`、`.venv`、`.opencode`、`secrets`；文件名后缀（大小写不敏感）`.sqlite`、`.sqlite3`、`.db`、`.db-wal`、`.db-shm`、`.pem`、`.key`。扩展名单须回改本节。
- `counts.tracked` 与 `counts.outsideScope` 按**唯一路径**计数，且只在对应条目实际纳入清单时更新（截断/去重未纳入则不计）。其余分类计数口径另定：`untracked`/`staged`/`unstaged`/`deleted`/`renamed`/`unknown` 按**已消费的 status/HEAD 记录事实**计数，可能包含最终因额度、deadline 或去重未纳入条目的记录（例如 rename 被截断时 `renamed=1` 但无 renamed 条目）；`excluded` 只数已纳入且命中排除名单的条目；`binary` 只数散列成功且最终记为 `binary` 的条目。不得把 `counts` 求和当作路径总数，也不得要求所有 counts 与 entries 数量一致。
- 同一路径可同时有 status 与 head 两条 `(path, source)` 条目，但路径计数不得重复累加。porcelain 的 unmerged 组合 `DD/AU/UD/UA/DU/AA/UU` 一律 `changeType:"unknown"`（即使内容含 NUL 也不改记为 `binary`）。
- 无法按 UTF-8 无损表示的路径（解码后含 `\uFFFD`）必须 `status:"refused"`、不打开、记 `REVIEW_REFUSED` 并使清单 `incomplete`，不得静默按替换字符去散列另一个文件。
- 限额是结果不是异常：路径数、单文件字节、累计字节、总时长任一超限都返回 `incomplete` + `REVIEW_LIMIT_EXCEEDED`；达到路径上限后停止消费剩余记录；读取中途超限时已读字节计入累计。
- 已知限制（不得声称已消除）：`inspectProject` 的内部 Git 超时不接受 `timeoutMs`，只能在返回后检查预算；该预检的 Git 输出若超出 1 MiB 缓冲，会按其原有语义抛 `PROJECT_MISMATCH`，本阶段不改 `tasks-registry` 的该行为，属已披露例外；逐层 `lstat` + `realpath` + 打开前后 `inode/dev/size/mtime` 比对只能发现部分目录链替换，不构成并发写入已停止或稳定快照的证明。
- 非法 UTF-8 路径只保留「每条原始记录一条 `refused`」的拒绝事实，不还原原始字节；解码碰撞可能使多条条目的 `path` 字符串相同，因此清单不承诺对这类路径做逐路径区分或字节序排序。
- `complete` 仅表示本次有限枚举成功；超限、失败、读取中变动一律 `incomplete`/`changed`，不得截断后报成功。
- symlink 只 `lstat` 分类，不读目标正文；设备/FIFO/socket 不打开；路径逃逸与目录链替换拒绝并计入 `refused`。
- 清单是私有审阅资料，不是秘密扫描、稳定快照、沙箱或停止证明。

## 6. 冻结的错误码

三工具现有公开 code 全部保留，分三类陈述，避免把三者混成同一个联合类型：

- registry 异常（`TaskRegistryErrorCode`）：`INVALID_INPUT`、`IDEMPOTENCY_CONFLICT`、`WRITER_RESERVED`、`CAPACITY_RESERVED`、`INVALID_SCOPE`、`PROJECT_MISMATCH`、`DIRTY_PRIMARY`、`DIRTY_WORKTREE`、`BASELINE_MISMATCH`、`HOST_ERROR`、`REGISTRY_LOCKED`、`REGISTRY_INVALID`。
- 工具直接输出的既有 code（不经 `TaskRegistryError`）：`FORBIDDEN_CALLER`、`SESSION_MISMATCH`、`START_UNCONFIRMED`；连同 `taskView.lastErrorCode` 的 `HOST_ERROR`/`SESSION_MISMATCH`/`START_UNCONFIRMED` 语义不变。
- 新增（S2/S3 实现时加入 `TaskRegistryErrorCode`）：

| 代码 | 触发 |
|---|---|
| `MAINTENANCE_EVIDENCE_INSUFFICIENT` | 证据缺项、字段不一致、清单/成果未复核或无法取得（含 D4 orphan 未核实、证据闭包被裁剪） |
| `MAINTENANCE_EVIDENCE_TOO_LARGE` | 证据闭包超出深度/文件数/单文件字节/累计字节/读取时长限额 |
| `MAINTENANCE_AUTHORIZATION_MISMATCH` | `operatorRef`/`authorizationRef` 与计划不符、缺失或越权 |
| `MAINTENANCE_NOT_DRAINED` | 入口未关闭、在途调用未排空、维护窗口已失效 |
| `MAINTENANCE_PLAN_STALE` | 计划绑定的 `generation`/`registryDigest`/`planDigest`/`paramsDigest` 与当前不符 |
| `OPERATION_CONFLICT` | 同一 `operationID` 已提交但规范化参数摘要不同 |
| `PERIOD_NOT_EMPTY` | `active>0` 时请求封存 period 或切换 baseline |
| `DIRECTORY_REUSED` | 目标规范 cwd 已出现在历史（D6） |
| `ARCHIVE_INVALID` | 归档缺失、hash 不符、symlink 或 schema 未知 |
| `REVIEW_INCOMPLETE` / `REVIEW_DRIFTED` / `REVIEW_LIMIT_EXCEEDED` | 清单不完整、观测期漂移、超出路径/字节/时间限额 |

所有错误只输出分类与必要上下文；`permission` 拒绝仍原样传播，不得转换为成功。

## 7. S0 验收与后续门禁

S0-D（决策部分）通过条件——本次已满足：

- D1–D6 均给出显式选择，无沉默默认；
- 冻结项覆盖：数据模型字段与不变量、三工具 closed 行为、离线命令表面与 plan/apply 绑定、证据结构、清单输出、错误码、权限边界；
- 明确未授权清单，且未修改任何源码或真实账本。

S0 尚未满足、不得宣称 S0 整体通过的部分：

- Spec 第 8 节 S0 行还要求「停止证据能实际取得」。这只能在真实维护窗口内验证；本轮无真实窗口、无取证执行，故**该项 NOT_VERIFIED**。S1–S3 实现与本地测试已完成，但任何真实 `apply` 仍须在能取得该证据的维护窗口内逐次授权，否则为 BLOCKED。本文不改写该门槛，也不以「冲突时以本文为准」的优先级条款免除它。
- 接口冻结不替代实现评审：函数分解、内部命名、测试文件划分仍按 S1/S2/S3 各自评审；
- CLI 拼写按本表执行；若实现评审发现平台限制需改动，必须回改本文并重新冻结，不得在代码里私自漂移。

后续门禁不变：S1 只读清单 → S2 v2 reader/writer 与迁移 → S3 离线 plan/apply → S4 私有 2.2.5 最小周转 → S5 另授权整合。每个行为变更先写测试并跑出有效红灯（失败原因须是缺少该行为），再实现并贴绿灯；缺红灯不验收。
