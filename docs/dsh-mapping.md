# Crew ↔ dsh 对照映射（可借鉴五点）

对照原型：[dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)。  
本文只落地 **可验证、可文档化** 的边界与报告口径；**不**引入 Source / Eval / Policy 全家桶，也不改 stage2 ledger schema。

## 1. Ticket ≠ Session ≠ Assignment

| dsh 概念 | Crew 映射 | 说明 |
|---|---|---|
| Ticket | `taskID` / 输入 `key`（ledger 记录） | 任务身份可跨会话存活；同 key 同 digest 重放仍是同一 Ticket |
| Session | Root 的 `ownerSessionID`；engineer 的 `sessionID` | Root 与 engineer 各有会话；工具授权绑在 **调用方 Root 的 `ownerSessionID`** |
| Assignment | 一次 `crew_task_start` 投递（含同 digest 幂等重放） | 真正「派一次活」；重放返回原记录且 **不再投递**，不是新 Assignment |

要点：

- ledger 里 task 记录可存活，但 **「会话还活着」≠「授权还有效」**。Root 会话死亡、换 owner、或非原 `ownerSessionID` 调用 `status`/`stop`，不能当作同一授权继续操作。
- **retry** = 新 Assignment：新的 `crew_task_start`（新 `key`，或 stage2 结案后再派），意图上可复用同 worktree / 同 scope。
- **同 key + 同 digest 重放** ≠ retry：是幂等重放，不再创建会话、不再 prompt。

## 2. 结构化 Report（六态）

规范词（写入工程师回复的 `Report: <status>`）：

| 状态 | 含义 | Root 怎么用 |
|---|---|---|
| `progress` | 进行中，尚不可验收 | 继续观察；**不**当完成 |
| `waiting` | 等待外部输入/依赖 | 继续观察或补上下文；**不**当完成 |
| `ready` | 声称可验收 | **唯一**可进入验收的完成态；必须附证据 |
| `blocked` | 越界、口径冲突、缺权限等 | **走人介入**；工程师须 hand-back，不得自行扩权 |
| `failed` | 实现/验证失败且无法在本 Assignment 内挽回 | **走人介入** |
| `dropped` | 无需处理（重复、已取消、范围落空） | 记一笔即可，不验收 |

旧词同义（可出现在旧提示/人工习惯中，但规范词用六态）：

- `COMPLETE` ≈ `ready`
- `BLOCKED` ≈ `blocked`
- `INCOMPLETE` ≈ `progress`（未完成，不等于失败）

Root **只认 `ready` + 证据**；`waiting`/`progress` 不得冒充完成。

实现提示：`src/report-status.ts` 导出六态常量、`isReportStatus` / `parseReportStatus` / `extractReportStatus`，以及注入 `crew_task_start` 任务包的 `REPORT_STATUS_PROMPT_HINT`。

## 3. 上下文扇出 ≠ 新授权

- **explorer / architect** 产出默认 **context-only**：丰富 Root 判断，**不**扩大 Mandate / Scope，不自动授权写入或扩范围。
- **engineer** 必须守 scope；超 scope → `Report: blocked` + 证据并 hand-back，**不得**自行扩权或改口径。
- native 委派与 `crew_task_*` 同样遵守：拿到摘要 ≠ 拿到新 Mandate。

## 4. 人唤醒优先 / 热更不杀飞

文档与 Root 提示约定（**不**假装实现新调度器）：

- 排队或容量紧张时，优先保留 **用户打断** 与 Root 的 `crew_task_status` / `crew_task_stop` 容量，而不是再塞满写任务。
- 修改 models / steps 的配置热更 **不得** 砍正在跑的 engineer；热更作用于后续会话/新 Assignment。
- stop 仍是「最多一次 interrupt、进程安全未确认」；人唤醒优先不等于自动杀树。

## 5. Root 要薄

- 重活进 engineer / `crew_task_*`（或明确的 native 委派）；Root 负责拆分、授权边界、验收与答复。
- Root **不同步空等**长跑任务：用 status 观察，用 stop 请求中断；不要把自己做成阻塞式调度器。
- native 委派同样薄：一次一个可独立验收的交付物；简单明确的事可直做，但直做 ≠ 免验收。

## 刻意不抄

- Source / Eval / Policy 管道与全家桶抽象
- 自动 DAG / 全局调度器 / 自动 worktree 生命周期
- stage2 ledger schema 变更、period/closed 维护入口
- 把「会话存活」当成「授权存活」的隐式续权

## 相关代码与角色

- 映射与口径：本文
- 六态工具：`src/report-status.ts`（由 `crew_task_start` 注入提示）
- 角色提示：`agents/root.md`、`engineer.md`、`explorer.md`、`architect.md`、`reviewer.md`
