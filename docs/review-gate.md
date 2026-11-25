# 审查门禁当前语义（living document）

日期：2026-11-25。本文描述**当前实现与运维口径**；`plans/review-gate-spec.md`、`plans/run-copy-and-gate-rollout.md` 和 `plans/gate-rollout-decision.md` 保留为设计/上线历史。若本文与历史 plan 冲突，以本文和 `src/review-gate*.ts` 当前实现为准。

## 一句话

审查门禁是**提示型、fail-open** 的 Root 辅助机制：它发现可疑改动后向 Root 注入一条提醒，要求派 reviewer 或显式写 `Review-Skip`；它不阻塞回合、不验收任务、不改变 `crew_task` 的 stop → close 顺序。

当前代码默认 `mode:"off"`。本机全局配置（2026-11-25 复查）为 `mode:"remind"`，并把 `sensitiveGlobs` 覆盖为 `["**/AGENTS.md","agents/**","**/role-guard.*"]`；首次观察期至 2026-12-08。**当前不启用 `enforce`。**

## 配置

配置只放在插件 options 的 `reviewGate` 对象，不进入 crew profile 文件。未知键、非法类型或越界值会在插件加载前报错。

| 键 | 默认值 | 约束 / 含义 |
|---|---|---|
| `mode` | `off` | `off` / `remind` / `enforce` |
| `maxFiles` | `5` | 1..1000；非忽略路径数**大于**该值时命中 `fileCount` |
| `planMinFiles` | `2` | 0..1000；0 关闭 `planMultiFile` 规则 |
| `maxReminders` | `2` | 1..5；`enforce` 每个 fingerprint 的重发上限 |
| `testGlobs` | `test/**`, `tests/**`, `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**` | 判定测试文件；只看路径不看内容 |
| `sensitiveGlobs` | `**/AGENTS.md` | 任一改动路径匹配即命中；不受 `ignoreGlobs` 影响 |
| `ignoreGlobs` | `plans/**`, `dist/**`, `**/*.lock`, `bun.lock` | 只影响 `fileCount` / `planMultiFile` 的计数 |

glob 数组是**整体替换**，不是与默认值合并；最多 64 项，每项 1..200 字符，不能以 `/` 开头，不能含 `..` 路径段或控制字符。

## 评估对象与命中规则

门禁在每个符合条件的 Root idle 回调里评估两类改动：

1. **native**：Root 工作目录本身的未提交改动，以及相对首个 prompt 基线的 HEAD drift；
2. **task**：该 Root 名下 active `crew_task` 的 worktree 改动。忙碌、身份不匹配或账本不可用的任务不会被当作已评估。

命中规则：

| rule | 含义 |
|---|---|
| `fileCount` | 去掉 `ignoreGlobs` 后，改动路径数 > `maxFiles` |
| `deletedTest` | 删除或移走测试文件；git rename 会表现为旧路径删除 + 新路径 renamed |
| `sensitivePath` | 任一改动路径命中 `sensitiveGlobs` |
| `planMultiFile` | 任务文本或 native engineer 首条任务消息引用 `plans/*.md`，且非忽略改动数 ≥ `planMinFiles` |
| `outsideScope` | active `crew_task` 有路径超出任务 Scope |
| `incomplete` | 采集过程中清单不完整或存在读写竞态 |

相同文件内容在不同任务 worktree 中是独立 fingerprint；`crewReviewGate` 消息 metadata 中记录的是不含 task 前缀的纯 fingerprint。

## 提醒、确认与模式差异

命中后，Root 有两条正当处理路径：

1. **派 reviewer**：门禁只检查是否存在 `agent === "reviewer"`、结果不是 `failed`/`interrupted`、创建时间不早于最新改动时间的子会话。它**不判断 reviewer 说了什么，也不证明审查通过**。
2. **写 `Review-Skip: <具体理由>`**：理由至少 10 个字符；它只能回答已经送达的 pending 提醒，必须出现在提醒之后新的 assistant 回复里，不能预先写、也不能一条 skip 同时消掉多条不同提醒。skip 是给人看的留痕，不是机器验收。

模式差异：

- `remind`：同一 fingerprint 只发一次；每个 Root 会话总提醒量上限为 `5 × maxReminders`。
- `enforce`：同一 fingerprint 在每个 Root 回合结束重发，直到该 fingerprint 达到 `maxReminders` 次后放行。它仍是软提醒，不是硬阻断。
- native 基线只在该 native 改动被 reviewer 覆盖或 `Review-Skip` 确认、且本次采集 complete 时推进；task 改动仍以各自任务 baseline/fingerprint 判断。

## `crew_review_gate` 诊断工具

`mode` 非 `off` 时注册只读工具 `crew_review_gate`（输入 `{}`，仅 Root 可调用）。它报告 mode/config、hook 是否可用、baseline 是否存在、native/tasks 的改动与 verdict、fingerprint、`latestChangeAtSource`、`reviewerCovered`、reviewer 列表完整性、state 计数和 notes。它**不推进基线、不确认 skip、不消耗提醒次数、不发送消息**。

`latestChangeAtSource` 用于区分覆盖时间来自现存文件 `mtime`，还是因纯删除/不可读路径回落到门禁首次观察时间（`firstSeen`）。这解释为什么某些“已经审过”的纯删除场景仍会多一条提醒。

## 已知限制（不是故障）

- **fail-open**：idle/prompt 回调外层错误会被吞掉，门禁宁可静默也不阻塞 Root；以 `crew_review_gate` 的 notes/error 为准。
- **reviewer 列表不完整**：若子会话分页缺失或循环，缺少正向覆盖证据时本轮不新提醒，也不会确认覆盖；显式 `Review-Skip` 不依赖列表完整。
- **纯删除/不可读路径**：没有可信 mtime 时覆盖时间回落到首次观察时间；早于首次观察创建的 reviewer 不能证明覆盖，可能多一条提醒，可用 `Review-Skip` 留痕。
- **native 按整个 Root cwd 计算**：用户手工并发修改、构建产物等也会计入；确非模型本轮改动，用 `Review-Skip` 写明。
- **planMultiFile 成本**：native 改动达到 `planMinFiles` 时可能需要读取 engineer 子会话首条上下文；该性能/异常处理属于观察期后的批次 B 事项。
- **不证明质量**：reviewer 覆盖只是时间与角色证据，不代表 reviewer 结论正确；`Review-Skip` 也只是操作者留痕。

## 当前验证状态与 `enforce` 门槛

- `remind` 主流程、任务/native 改动采集、fingerprint、`Review-Skip`、reviewer 覆盖等有单测与隔离宿主证据；精选证据索引见 `plans/evidence/README.md`。
- S8 已在隔离宿主确认真机上「reviewer 覆盖后停止」成立：`plans/evidence/review-gate-probe/s8-enforce.md`。
- `enforce` 的**重复注入分支仍无真机证据**：S8 两次模型都按提醒主动派 reviewer，无法稳定构造“收到提醒但既不派 reviewer 也不写 skip”的会话。该分支目前只有 fake 会话单测。
- 因此当前决策仍是保持 `remind`。只有观察期证明 Root 确实忽略提醒（无响应提醒 ≥3 次且 ≥20%），并且重复注入分支在隔离宿主通过，才重新讨论 `enforce`；不为了验证 `enforce` 修改共享服务配置。

## 运维入口

- 当前配置复查：只读检查 `~/.config/opencode/opencode.json` 中插件 options 的 `reviewGate`。
- 撤销：把 `reviewGate.mode` 改回 `off` 或删除整块，随后 `/reload`；单条误报不需要改配置，写 `Review-Skip` 即可。
- 宿主升级后：按 `docs/role-permissions-host-checks.md` 和 `docs/run-copy-release.md` 复核；版本口径见 `docs/host-versions.md`。
