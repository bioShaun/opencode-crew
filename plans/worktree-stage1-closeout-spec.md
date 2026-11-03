# 真实 Stage 1 Ledger 迁移与结案收尾 Spec

日期：2026-11-01。状态：**收尾规范已定义；用户接受偏差收尾后，阶段状态为 `CLOSED_WITH_DEVIATIONS`，不得记为 `FULL_PASS`。**

本文只规定真实 Stage 1 ledger 迁移、两项任务结案后的收尾口径、证据冻结和后续准入。本文不授权修改 registry、补写或替换历史证据、恢复备份、执行 maintenance apply、开启新周期、启动新任务、停止进程、清理或整合 worktree。

## 1. 对象与边界

本收尾仅覆盖：

- 真实 ledger：`plans/evidence/worktree-stage1/primary/.git/opencode-crew-stage1/registry.json`。
- 任务 `ct_host1-marker`、`ct_host2-marker`。
- 对应 worktree `wt-a`、`wt-b`，以及未使用目标 `wt-c`。
- 同管理目录下的 backups、archives、`s1/` 证据和 `test/.work/s1-real-close/` 执行材料。

以下内容不因本文而改变：

- `plans/worktree-stage2-s0-contract.md` 第 5.5 节的 stop 证据要求。
- `plans/worktree-stage2-spec.md` 第 7 节的维护窗口、外部 writer 和 quiescence 要求。
- `processSafety:"unconfirmed"`、`canCleanup:false`、`canIntegrate:false` 的既定边界。

收尾是对已发生操作的事实确认和偏差定级，不是追溯豁免，也不把缺失证据补判为已通过。

## 2. 收尾状态定义

| 维度 | 冻结结论 | 含义 |
|---|---|---|
| `LEDGER_MECHANICS` | `PASS` | v1→v2、两次 active→closed、代际和摘要链成立 |
| `ARTIFACT_PRESERVATION` | `PASS` | 两条原始任务记录、marker 和三个 worktree 保留 |
| `OPERATION_REPLAY_INDEX` | `PASS（plan 级）` | 三个 operationID 唯一，真实只读 plan 均识别为已提交重放 |
| `REAL_MAINTENANCE_COMPLIANCE` | `NOT_PASSED` | 存在第 4 节的 stop 流程与维护窗口证据偏差 |
| `PROCESS_SAFETY` | `UNCONFIRMED` | 结案只释放账本名额，不证明任何进程或进程树安全 |
| `STAGE_CLOSEOUT` | 用户接受本文为 `CLOSED_WITH_DEVIATIONS` | 允许按事实收尾，不等于完全合规验收通过 |

不得将上述状态缩写为“阶段全部通过”“真实维护完全合规”或“进程已安全停止”。如果用户不接受偏差收尾，则保持 `REAL_MAINTENANCE_COMPLIANCE=NOT_PASSED`，不得通过重做或改写历史证据制造通过。

## 3. 已独立核验并冻结的事实

### 3.1 Ledger 与周期

- 当前 registry：3900 字节，SHA-256 `e9460e6f9aa21707be5e289f24037b6476f76f8a3b6c4c1e4f96b9df06d0a79a`。
- 当前结构：`schemaVersion=2`、`generation=3`、`currentPeriodID="pd_1"`、`active=[]`、`closed` 恰有两项。
- 两项 closeout 的 `disposition` 均为 `preserved`；原始 task state 分别保持 `stop_unconfirmed` 和 `submitted`。
- `periods` 仅有 `pd_1`，没有 `pd_2`；本次迁移和结案不需要也不隐式开启新周期。
- 当前无 `.lock`。无锁只描述当前账本状态，不是历史在途调用或进程停止证明。

### 3.2 备份、代际与原始记录

| 代际前备份 | 字节数 | SHA-256 | 已核验用途 |
|---|---:|---|---|
| `registry-0-2026-11-01T02-17-57-180Z.json` | 2003 | `178ccb20aef76d97eadcdbc413a19d98da49a7c4e6ab38cc21856d4f63b0113d` | v1 原始字节、窗口 digest、migrate plan 输入 |
| `registry-1-2026-11-01T02-19-21-968Z.json` | 2508 | `1ba35b96352e294969d5c52a0c4d6d3a0fa764626de0f7e98277d51e61fc715c` | 首次 close plan 输入 |
| `registry-2-2026-11-01T02-19-22-068Z.json` | 3203 | `6c2c18fa4443e84cd4ad0344eb6e5042bafcf1ae98a17605ad00829bdef10ea2` | 第二次 close plan 输入 |

- 迁移后两项 active 记录与 v1 原始 `TaskRecord` 逐字段一致。
- 每次结案后，被结案记录及其余 active 记录均与 v1 原始记录逐字段一致。
- owner、sessionID、requestDigest、input、task state、createdAt、updatedAt、interruptResult 未被重算或改写。
- 三份 plan 的 paramsDigest、planDigest、generation 和 registryDigest 链接均已复算一致。

### 3.3 归档、证据与权限

- backups=3、archives=3。
- 两项 closeout 的 archiveDigest、evidenceDigest、review listingDigest 均与实际文件复算一致。
- 三个 operationID 全局唯一；migrate 和两项 close 的原始请求经真实只读 `plan` 均返回已提交重放计划、`changes=[]`。
- 原执行报告记录首次 apply 均为 `replayed:false`，但未保留完整 apply stdout；该具体返回值不作为独立直接证据，事实依据为代际链和已提交凭据。
- 管理目录及其中现有目录/文件分别为 0700/0600，未发现符号链接权限异常。

### 3.4 成果现场

- `wt-a/stage1-host1-marker.txt` 原始字节为 `HOST1-MARKER\n`，SHA-256 `b481f21510cc261ab9afc86aed473a08e8d7c6371a763785f74d31be18ce2615`。
- `wt-b/stage1-host2-marker.txt` 原始字节为 `HOST2-MARKER\n`，SHA-256 `09fc6d0b39a92132a7412b9d7926491cd5961f5de2b1d7d513eeef7a9a0595fe`。
- 两份 listing 均为 `complete`，各只有一个 scope 内 untracked marker，HEAD 无漂移。
- `complete` 仅表示当次有限枚举成功，不表示稳定快照、秘密扫描或进程停止。
- `wt-a`、`wt-b`、`wt-c` 全部保留。

## 4. 必须永久保留的偏差记录

### S1-CLOSE-D1：host2 缺少既有 stop 流程

`ct_host2-marker` 的 bundle 使用 `stopState:"submitted"`，无 interruptResult，未经过既有 stop 流程即结案。该事实不符合 S0 契约第 5.5 节“stopState 必须来自既有 stop 流程”的要求。

当前 `src/tasks-maintenance.ts` 的 `verifyClose` 只核对 bundle 状态与账本状态一致，未阻止该组合；这是本次真实操作暴露的契约执行缺口。

处置：

- 永久保留 `submitted` 原状态和本偏差，不补造 stop 记录或 interruptResult。
- 不为制造合规外观而恢复备份、重写 registry 或将该任务重新伪造成活动任务。
- host2 的容量释放是事实，但不得作为完全合规 close 的范例。
- 后续真实 close 必须先完成既有 stop 流程并保留记录；实现修复另立变更和测试门禁，不属于本文档修改。

### S1-CLOSE-D2：维护窗口证明强度不足

本次窗口证据包含入口关闭声明、registry digest 稳定、锁缺失和 `/proc` cwd 扫描；历史 host 日志也记录私有宿主进程组退出。这些材料没有发现实际危险 writer，但不足以严格证明每次 apply 时所有入口、在途副作用和外部 writer 仍受控：

- cwd 扫描不能覆盖 cwd 在 fixture 之外但仍持有相关文件、会话或服务入口的进程。
- 入口关闭字段主要由脚本写入，没有对应的运行时核验闭包。
- 首轮 review ENOENT 后续跑复用 `02:17:57` 的 writer/quiescence 证据，两次 close 在 `02:19:21/22` apply，未重新取得同时段证据。

处置：

- 将本次窗口判为证据偏差，不宣称生产级排空，也不反推实际存在 writer。
- 不修改原 evidence 文件、时间或 method 文本以消除偏差。
- 后续维护若发生失败或时间间隔，新的写操作前必须重新核验窗口；响应丢失后的同 operationID 重放按既有幂等规则处理，不生成第二个操作。

### S1-CLOSE-D3：首次 apply 输出未完整留档

`test/.work/s1-real-close/cli/` 保留了 plan/apply 输入材料，但没有完整执行 stdout 日志。因此 `replayed:false` 的直接输出不能独立复核。

处置：保留现有材料和执行报告，不伪造日志；后续维护必须持久化完整、脱敏的 plan/apply 输入、输出和退出码。

## 5. 现场冻结规则

自收尾起，除非用户另行明确授权：

1. registry、backups、archives、`s1/` 和原始宿主证据保持只读；不恢复备份、不编辑归档、不为演示执行 apply。
2. 允许不改变状态的读取、摘要复算和只读 plan；读取结果不得覆盖原始证据。
3. 不清理、删除、重置、checkout、merge 或整合 wt-a/wt-b/wt-c，不删除 marker 或其他成果。
4. 不开启 `pd_2`，不启动新任务。active=0 只表示名额可在一套新的授权与安全门禁下使用，不是本文授予的启动许可。
5. 不停止或重启任何共享服务，不根据本收尾推断 orphan、后台任务或任意进程树已经安全。
6. 私有 ledger、宿主 DB、cache、配置和证据不进入公开交付或提交清单。

## 6. 后续真实操作的准入门槛

后续若另获授权使用已释放容量或开启新周期，至少满足：

1. 盘点并隔离所有 reader/writer；只允许支持 v2 的合作实例，旧 reader 遇 v2 继续 fail closed。
2. 每个有 sessionID 的任务在 close 前完成既有 stop 流程；无 sessionID 或异常状态按 orphan/外部副作用核实门槛处理，不以缺字段代替证据。
3. 在每个新的 apply 前重新核实入口关闭、在途调用结局、外部终端/原生会话/进程与文件所有权，并保存对应时段证据；不得仅凭一次 cwd 扫描、锁缺失或 hash 稳定放行。
4. 在有效窗口内重新取得完整 listing；`incomplete/changed` 必须逐项人工解决。
5. plan/apply 继续绑定 operationID、paramsDigest、generation 和 registryDigest；完整保存脱敏输出及退出码。
6. 历史 cwd 永不复用；新任务使用新的规范 worktree，并满足对应 period 的 baseline 和 clean/detached 校验。
7. 只有需要新 baseline 且 active=0 时才显式申请 open-period；开启周期与启动任务分别授权，均不由本收尾自动触发。

## 7. 收尾验收清单

收尾文档交付必须满足：

- [x] 第 2 节六类状态完整保留，没有缩写成 `FULL_PASS`。
- [x] 第 3 节事实可由现有文件只读复算。
- [x] D1、D2、D3 均未被删除、弱化或追溯改写。
- [x] 本文执行过程中没有 maintenance apply、registry/worktree 写入、pd_2、新任务或服务操作。
- [x] 文档通过 `git diff --check`；私有 fixture 和证据未被加入提交。

用户接受本文即表示接受“带偏差收尾”的口径，不表示放弃上述偏差记录，也不授权后续操作。若要求完全合规验收，本次历史操作仍保持 `NOT_PASSED`；只能在新的独立任务和维护窗口中满足全部门禁，不能追溯改写本次结果。
