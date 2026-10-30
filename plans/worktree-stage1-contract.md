# 受限阶段 1：手工 worktree 绑定与一次性任务启动契约

日期：2026-10-31。状态：按本次已批准的受限阶段 1 冻结实现范围；本文是单 engineer 的一个交付，不是实现完成报告。

## 1. 背景、优先级与边界

已读全局 `/home/tcuni-claw/.config/agents/AGENTS.md`、两份阶段方案、`src/index.ts`、`test/crew.test.ts`、`package.json` 和下面列出的安装类型。cwd 及其项目祖先未发现额外 AGENTS.md；本次没有单独 explorer 摘要，以委派摘要及阶段 0 报告作为调查输入。本次只新增本文，不执行代码、测试或服务操作。

用户最新授权优先于 `worktree-task-isolation.md`、`worktree-stage0-results.md` 中旧的“阶段 1 待批准”字样；阶段 0 的 FAIL / NOT_TESTED 不因此变成 PASS。保留现场六个 tracked 修改（`.gitignore` 与之前五个权限修复文件）、既有 plans 和证据；不 stash、不提交、不 push、不 reload 共享服务。**主 workspace 脏是实际启动拒绝条件，不是开发本交付的阻塞。**

### 冻结选择：仅 bind，不自动 create worktree

第一版提供“绑定已经由 Root 手工准备的干净 detached worktree，并创建独立 engineer session、投递一次任务”的薄层。**不实现 worktree.create，也不绑定任意已有 session**；session 由插件新建并记录所有权。理由：worktree 策略可以改变目标目录、执行初始化，且停止安全与失败回收没有足够证据；手工准备后验证身份，可删除整个自动创建资源的恢复分支，保留真正有用的启动、查询、请求停止。

只有三个新工具：`crew_task_start`、`crew_task_status`、`crew_task_stop`。没有 cleanup、release、resume、retry、merge、export、snapshot 或自动提交工具；没有后台 watcher、队列、DAG、进程管理器。工具不调用 `session.shell`，不运行初始化脚本、不装依赖、不复制 `.env`、不建立可写共享依赖链接。Root 手工准备不等于插件替 Root 执行 shell。

工具是插件管理独立会话，不能宣传成原生 subagent 的 directory 参数、父子通知或连带取消。`parentID` 不设置；Root 的 session ID 只作为 ledger 所有者与 metadata 关联。Root 自己取消不会自动停止任务，必须明确请求 stop。

## 2. 真实能力与代码落点

当前实现真实符号：`src/index.ts` 的 `Plugin.define` / `setup`、`options`、`loadRole`；通过 `ctx.agent.transform` 注册角色，通过 `ctx.command.transform` 注册 `/crew`。engineer 使用 `agent.permissions = [...agent.permissions, ...role.permissions.map(...)]` 保留宿主权限，此修复及现有回归必须保留，不改成覆盖宿主规则，不另造第二套 engineer。`options` 当前只接受 models/steps，本版不增加配置项。

安装证据（不是在线文档推断）：

| 文件 | 真实类型/能力与约束 |
|---|---|
| `node_modules/@opencode/plugin/package.json` | 2.2.3；默认导出走 `dist/promise/index.js`，不要把 effect API 当 Promise API 使用 |
| `.../plugin/dist/promise/plugin.d.ts` | `Context` 有 location、tool、session、permission、storage、worktree；setup 可返回 Cleanup |
| `.../plugin/dist/promise/tool.d.ts` | `ToolEditor.add`、`Info.execute(input, ToolContext)`；context 含可信 sessionID/agent/messageID/id/signal，返回 `Tool.Result` |
| `.../plugin/dist/promise/permission.d.ts` 和 `.../plugin/dist/permission.d.ts` | `permission.assert` 接受 sessionID、agent、action、resources、source；拒绝应原样抛出，不能吞掉再继续 |
| `.../plugin/dist/promise/storage.d.ts` | `StorageDomain.get/set/remove/scan`，**没有 CAS、事务或锁接口**；scan 有分页，类型也没有承诺跨 location 命名空间共享 |
| `.../plugin/dist/promise/session.d.ts` | `SessionDomain` 有 create/get/list/prompt/interrupt/wait/hook；本类型不提供 active、shell；不凭空调用这些 ctx 方法 |
| `.../client/dist/promise/generated/types.d.ts` | `SessionCreateInput` 有 id/location/agent/model/metadata/permissions；`SessionPromptInput` 有 id/text/metadata/delivery/resume；类型允许传 ID 不证明重试幂等 |
| 同上 | `SessionInfo` 有 id/agent/model/location/metadata/outcome/time；`SessionInterruptInput` 有 sessionID/resume；`SessionListInput` 有 directory/cursor，不把不可靠的搜索过滤当资源不存在证明 |
| `.../plugin/dist/promise/session.d.ts` | `SessionHooks.retry` 的 decision 可设 `{retry:false}`；experimental.idle.background 不是任意 OS 进程清单 |
| `.../plugin/dist/worktree.d.ts` | `WorktreeResult.directory` 可以不同于建议目录；本版不走创建策略 |

建议新增 `src/tasks.ts` 集中三个工具、ledger 与 Git 校验，在 `src/index.ts` 的 setup 最后注册；新增 `test/tasks.test.ts`。可在 tasks 模块内部拆小函数，不引入通用调度框架或运行时依赖。测试扩展现有 fixture 来支持 tool/permission/session，不能因旧 mock 缺少新字段而在生产代码静默跳过注册。打包继续现有 `bun build`，包 exports 仍为 `dist/index.js`。

## 3. 对外接口与授权

以下均为**本版拟新增接口**。输入 JSON schema 禁止额外字段，运行时也验证；不接受调用者传 owner、project、agent、model、permissions、sessionID 或任意 Git 命令。

### `crew_task_start`

```text
{
  key: string,                 // ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$
  directory: string,           // 已存在 worktree 的绝对路径
  baseline: string,            // 完整 commit OID，支持仓库实际 SHA-1 / SHA-256 格式
  scope: string[],             // 1..32 个精确文件或以 / 结尾的目录前缀，不是 glob
  goal: string,
  acceptance: string,
  check: string                // 各 1..8000 字符，总任务输入 <=32 KiB
}
```

key 在同一 Git common dir 中唯一，不限于单 session。taskID 为 `ct_` 加 key。scope 排序去重后，结合规范化 directory、baseline、goal/acceptance/check、可信 owner sessionID 计算 requestDigest。同 key 同 digest 仅返回已有记录，**永不再次 create/prompt**，即使失败、重启或原任务无结果；同 key 不同 digest 返回 `IDEMPOTENCY_CONFLICT`。幂等重放仍需通过身份和权限检查，但不因目标已产生修改而误作新启动。

### `crew_task_status`

`{ taskID?: string }`：只查询当前项目中当前 owner 的一条或全部记录（最多两个占位任务；可有人工归档历史）。不接受跨项目路径。读取 ledger 后对已有 sessionID 做 get 获取有限观测；不得枚举并返回其他会话正文。查询失败显示 unknown/error，不当作 idle 或资源已删除；查询不驱动状态机、不补跑步骤。

### `crew_task_stop`

`{ taskID: string }`：仅操作 ledger 中当前 owner 的已知会话，不接受自由 sessionID。先 get 核对 location、engineer agent 与 ledger metadata；不符或查询失败则拒绝 interrupt，保持预留并报错。核验成功后持久化 stop_requested，最多调用一次 `session.interrupt({sessionID, resume:false})`，记录响应或错误，再置 stop_unconfirmed。重复 stop 只返回记录，不再发送请求。没有已知 sessionID 时记 stop_unconfirmed，提示人工调查潜在 orphan；不能猜测或扩大中断范围。

### 公共输出与错误

返回 `Tool.Result.output` 的结构化 JSON，并附简短中文 content：

```text
{ ok, task?: TaskView, tasks?: TaskView[], error?: {code,message}, warnings: string[] }
TaskView = {taskID, directory, baseline, scope, state, sessionID?,
            observed?: {agent?, outcome?, busyAt?, idleAt?, checkedAt, errorCode?},
            processSafety:"unconfirmed", canCleanup:false, canIntegrate:false,
            nextAction, createdAt, updatedAt}
```

`ok:true` 对 start 只表示投递 API 已确认或幂等查询成功，不表示模型完成、测试通过或进程已停。task state 必须同时返回；不把 replay 当本次重新启动。错误 code 固定包含 `INVALID_INPUT`、`FORBIDDEN_CALLER`、`PROJECT_MISMATCH`、`DIRTY_PRIMARY`、`DIRTY_WORKTREE`、`BASELINE_MISMATCH`、`INVALID_SCOPE`、`IDEMPOTENCY_CONFLICT`、`WRITER_RESERVED`、`CAPACITY_RESERVED`、`REGISTRY_LOCKED`、`REGISTRY_INVALID`、`SESSION_MISMATCH`、`START_UNCONFIRMED`、`HOST_ERROR`。错误仅输出分类和操作上下文，不原样输出异常 body、模型消息、认证值、环境或任意文件内容。

### 必须在副作用前检查的权限

1. 从 ToolContext 取 caller 身份，要求 `agent === "root"`；用 `session.get` 校验调用会话的 agent/location 与当前 ctx.location 一致。三个工具均要求 Root；不接受输入自称 Root。engineer 即使看到新工具也不能用它递归派发任务。
2. 每次调用 `permission.assert` 检查对应 action（工具全名），资源为规范项目根目录；保留宿主 deny/ask，不新增全局 allow。start 另 assert `subagent` 资源 `engineer` 及 `edit` 资源（全部规范化 scope 的绝对路径、registry 路径）；stop 另 assert `subagent`/`engineer`。携带真实 tool source。权限拒绝原样传播，不转成“已失败可继续”的普通输出。
3. 任务 session 不传自造 permissions 覆盖，不提高权限；目标 location 的既有配置与 Crew engineer 规则继续生效。模型选择固定为 `config.models.engineer ?? ownerSession.model`，二者都无值则拒绝，不选默认陌生模型。目标 location 若未加载 Crew engineer，create/get 或 host 集成检查必须报错，不能回退 build。
4. scope 是任务范围契约而非 OS 沙箱。拒绝空值、绝对路径、`..`/`.` 路径段、反斜杠、NUL、glob 元字符、`.git` 路径段；对存在的路径和最近存在父目录 realpath 检查仍在 worktree 内，拒绝 scope 经过符号链接。直接 scope 路径的任一路径段匹配 `.env`/`.env.*`（仅 `.env.example` 例外）、`.ssh`、`.gnupg`、`node_modules`、`.cache`、`.venv` 时拒绝；这一最小拒绝列表不是秘密识别器，也不授权通过父目录前缀访问这些内容。实际 shell 可以绕过路径规则，**本版不声称 scope 可强制隔离任意命令**；Root 只能派发可信、无外部副作用的受控任务，后续实际差异仍须人工审查。

## 4. Git 前置条件与项目身份

所有路径使用 realpath 和路径边界比较，不能字符串 startsWith 判断包含关系。内部只运行有界、无 shell 拼接的只读 Git argv，设置 `GIT_OPTIONAL_LOCKS=0`、禁用 fsmonitor，规定超时与输出大小上限；超过上限拒绝，不截断后判 clean。

- 项目 identity 为 `git rev-parse --git-common-dir` 的规范绝对路径；通过 `git worktree list --porcelain -z` 验证主工作区和目标登记。仅支持有正常主工作区的非 bare repo，拒绝子模块/嵌套仓库目标及未登记目录。
- ctx.location 必须是主工作区根目录（非子目录、非任务 worktree）；工具不会从任务目录发起下一层任务。主工作区与目标不得相同或相互包含，目标也不得包含 registry。
- 新启动前：主工作区 `status --porcelain=v1 -z --untracked-files=all` 为空；tracked、staged、删除、untracked 任一存在均拒绝。忽略文件不代表不存在秘密；不得复制它们。目标同样 clean 且 detached HEAD。必要的忽略缓存由 Root 明确准备，不由插件执行初始化。
- 输入 baseline 必须解析为完整 commit，主工作区 HEAD 与目标 HEAD 均等于它；有占位记录时必须与已有固定基线一致。不同 key 不能通过不同路径别名占用同一 cwd。
- start 在申请权限前可读预检；拿到 registry 锁后重做 Git、目录和容量检查；session 创建后、prompt 前再核对目录/HEAD/clean。外部操作者在最后检查后改动是本版无法消除的竞态，Root 须遵守每 cwd 单写者及基线冻结，不宣称 Git 检查是文件系统事务。
- 最多两个**未人工结案的写任务预留**，包含准备中、异常、idle 和 stop_unconfirmed；一次普通完成不释放名额。其他原生会话/终端不受本 ledger 锁控制，Root 必须确保没有外部写入者。不能把 session.list 没找到会话当作无外部写者证据。

## 5. 持久化、锁与恢复（安全优先于自动推进）

### 存储选择

不用 SDK storage 做互斥或跨 location 计数。首版唯一权威 ledger 为 `<real-git-common-dir>/opencode-crew-stage1/registry.json`，同目录 `.lock/` 为排他锁；这样不使工作区变脏，也能让两个独立服务访问同一 ledger。目录 0700、文件 0600，不跟随 registry/lock 文件的符号链接；不读凭据。registry 内含 schemaVersion=1、规范 project/primaryDirectory、固定 baseline、tasks。每个 task 保存输入摘要与任务包、ownerSessionID、sessionID、创建/更新时刻、阶段、有限错误与 interrupt 响应摘要；不保存模型原生载荷或环境。

通过原子 mkdir 创建 `.lock/`，在锁内读-校验-写；写入同目录独占临时文件、fsync、rename、fsync 目录，成功后释放锁。禁止临时文件放 `/tmp`。不使用仅 JS Map 的互斥、不使用 set/get 模拟 CAS。正常冲突立即返回 REGISTRY_LOCKED，不启动后台重试；本次进程自己持有的锁在 finally 中释放。崩溃遗留锁**永不按 PID、时间戳、TTL 自动抢占**，只读 status 可读取最后完整 ledger，其他操作保守拒绝，Root 外部核实后人工解锁。

边界：保证同一主机、同一真实 common dir、支持原子 mkdir/rename 的本地文件系统上合作插件实例互斥；不同仓库 clone、被人为删除的锁/ledger、非合作进程、远端文件系统与多机部署不保证。遇不支持环境应拒绝启用，不宣称分布式锁。SDK storage 可不用，不双写两个权威来源。

### 状态和崩溃窗口

状态固定：`reserved → session_create_requested → session_bound → prompt_requested → submitted`；另有 `start_unconfirmed`、`stop_requested`、`stop_unconfirmed`。每一步 intent 必须先持久化成功才调用宿主；包括 known error 在内，进入不确定分支仍保留预留。任务观测与这些 durable 阶段分开存储/输出。

| 崩溃/失败位置 | 恢复行为 |
|---|---|
| 手工 worktree 创建后、start 前 | 插件没有 create 调用；目录归 Root，start 无记录不会自动枚举或删除它 |
| reserve 前 | 无会话副作用，调用者可重新发起；临时 registry 写入若有损坏则拒绝而非当空库 |
| reserved / session_create_requested | 不自动继续创建。可能存在已建但 ID 未落盘的 orphan；key 保留、容量保留、提示 Root 用 metadata 调查，不因 list 空结果再 create |
| create 成功，ID 落盘前 | 同上；session metadata 中预先写入 namespace/taskID/requestDigest/project identity 摘要/ownerSessionID 便于人工定位。metadata 不是自动认领授权 |
| session_bound，prompt 前 | 保留空 session，不补发。相同 key 重放只查询 |
| prompt_requested，响应前/落盘前 | 请求可能已执行，禁止重发、重新 create、改用新 key 绕过 cwd 预留；返回 start_unconfirmed 语义 |
| submitted | 只读 get 恢复关联，绝不 resume/prompt；宿主重启是否续跑不作为插件保证 |
| stop_requested / stop_unconfirmed | 不自动重发 interrupt，不释放 cwd/名额，不提供 cleanup |

create 使用 `{agent:"engineer", location:{directory}, model, metadata}`。返回后立即持久化 sessionID，再用 get 核验 location、agent 与 metadata 关联；不匹配则禁止 prompt，保留已创建资源。prompt 使用 text 任务包、metadata 标记、`delivery:"queue"`；首次投递是唯一有意启动模型的动作，不声称 `resume:false` 能首次运行，故不把该字段当去重机制。SDK optional id 不用作“恰好一次”保证。本契约保证插件侧 at-most-once 尝试，接受“执行零次但占位”的安全损失。

任务包由固定模板合成 Goal / Scope / Decided / Approach / Acceptance / Check，明确绝对 cwd、baseline、key、禁止 commit/push/merge、禁止后台/脱离进程组/服务、禁止任意外部写入、先测试红灯再实现绿灯、禁止 `/tmp`、重活 slot preflight 与提交规则。goals/check 仅作为任务文本，不作为插件 shell 命令执行。所有目标 location 都注册 retry hook：仅对 metadata 标识的本插件受管任务将 decision 设 `{retry:false}`，其他 session 不受影响；不添加自动续跑/补提示/轮询触发模型。此 hook 不等于阻止第三方或宿主在插件之外主动发消息，外部操作者必须遵守不手工续跑约定。

## 6. 停止、成果与人工结案

**全部任务的 processSafety 恒为 unconfirmed。** `interrupt:true`、session outcome=succeeded/failed/interrupted、time.idle、idle hook、后台清单为空、agent 自报已停、单次查不到 PID，均不能升级为 safe。stop_unconfirmed 是本工具终止推进的状态，不是进程终止证据。未解决进程所有权前，工具永远不清理或整合。

第一版不生成成果快照、不导出文件或日志、不读取成果正文作为 status。Root 在外部人工确认执行停止及所有权、关闭继续写入入口后，审查实际修改与测试证据；无法证明则保留工作区及预留，不整合。若 Root 另行制作成果包，须覆盖 untracked/修改/删除/binary、拒绝路径逃逸/符号链接外读，排除 secrets、依赖、缓存、私有 DB/模型原始载荷；普通 `git diff` 或“秘密扫描未命中”不足以验收。本交付不实现这一包格式，避免以不完整快照冒充完整交付。

人工外部结案是明确的运维边界：Root 记录停止核实依据、成果保存位置和决定；在确认没有合作插件操作/写入者后，备份 ledger，在人工维护窗口归档对应 task 并解除预留。首版无在线释放接口、无 PID 推断解锁、无 force remove；若不能可靠维护，就保留两个占位并停止新启动。这是试运行容量限制，不是自动调度平台。不得将人工修改 registry 当日常自动步骤或只凭用户勾选“已停”开放危险工具。

## 7. 按依赖顺序实施与测试先行

1. 单 engineer 核对六个 tracked 现场差异与 plans，保存基线清单/哈希（不含秘密）。先只加行为测试并运行，入口使用现有 `test/crew.test.ts` 的 plugin/fixture 模式捕获工具，缺失注册应产生语义断言红灯，不以不存在的新模块 import 失败充数。贴出真实失败输出后才能实现。
2. 实现 input/caller/permission/Git 只读预检与 registry 原子锁；用项目内独立 fixture 验证，不以当前脏 workspace 作为成功启动 fixture。先完成持久化与竞态测试，再接 session 副作用。
3. 实现一次性 create/prompt、所有 intent checkpoint、保守错误与幂等 replay；再做 status/stop、受管 retry hook，最后接入 setup。保留 `/crew` 与 engineer 权限继承回归。
4. 运行全部测试、构建、包检；最后在私有 host fixture 做少量真实调用。mock 绿灯不能代替 host 验证。文档/README 只按真实通过范围更新，不宣称双 engineer 或任意进程树中断已验证。

### 必测矩阵（红灯目标 → 绿灯成功标准）

| 类别 | 成功标准 |
|---|---|
| 接口与权限 | 三工具注册；未知字段/非法 key 拒绝；伪 owner 无入口；非 root、跨项目、权限 deny/ask 拒绝时 create/prompt/interrupt 均为零；不吞 permission rejection |
| Git/路径 | 主目录 staged/unstaged/untracked/delete 分别拒绝；dirty target、非 detached、baseline 不符、同目录/包含目录、路径别名、外链、scope 逃逸拒绝；当前主现场脏启动拒绝且 diff 不变 |
| 容量和固定基线 | 两个不同 cwd 同基线成功；第三个、同 cwd 不同 key、不同基线拒绝；idle/stop 后仍不能复用预留 |
| 幂等 | 同 key 同输入重复/并发只一次 create 与一次 prompt；不同输入冲突；失败/重启重放不再执行；不得用变换 owner 绕过 key |
| 锁 | 两个独立进程争用同 common dir，最多一方持锁；两个实例同时申请第三位无超额；崩溃锁不自动抢占；损坏/版本未知/符号链接 registry fail closed |
| 每步故障注入 | reserve 写失败零宿主调用；create 响应丢失保留 orphan intent；ID 写失败不 prompt；prompt 响应丢失不重投；重建插件实例后相同 key 仍不执行 |
| 状态与 stop | get 失败/404/idle 均不释放；get location/agent/metadata 不符拒绝 prompt/interrupt；stop 先落 intent，最多一次 interrupt；true/false/error 全为 unconfirmed；不出现 cleanup/merge 调用 |
| 角色与重试 | 现有 root/strict roles/engineer host ask-deny 顺序回归全通过；模型沿用明确配置或 owner；缺模型拒绝；受管任务 retry=false，非受管不变 |
| 数据最小化 | 输出不含任务正文、模型原始消息、异常 body/认证/文件内容；不导出 .env、不快照、不删除 untracked/binary/删除标记成果；所有新增临时路径在 fixture 子目录 |
| 打包/宿主 | archive 内 agents 与 dist 齐全、从解包包的 exports setup 可注册工具；实际 host engineer location/metadata/权限规则与一次投递、查询、重复 key、stop-unconfirmed 可验证 |

红灯至少覆盖缺少三工具注册与关键安全行为；实现期间新增安全行为也先补测试见红。报告列出失败断言、运行命令、退出码和实现后的对应通过输出；语法/导入/认证/服务未就绪错误不得计有效红灯。现有测试不得删弱以过关。

## 8. 验证命令、fixture 与交付口径

以下是 engineer 将执行的命令，不是本轮已运行记录：

```text
bun test test/tasks.test.ts
bun test
bun run build
npm pack --dry-run --json
npm pack --pack-destination plans/evidence/worktree-stage1/package
```

pack/解包/测试 runner 设置 TMPDIR 为对应项目内目录，npm 缓存也放 evidence 子目录；包清单不得包含 registry、evidence、plans 私有现场或 node_modules。`npm pack` 会触发现有 prepack build；从解包目录验证 package exports 和角色相对路径，不只 import 工作仓库源码。可增加 `test/package.test.ts` 自动检查，不能直接发布 npm。

**host 最小 fixture 不 commit/push：**在 `plans/evidence/worktree-stage1/` 下从现有仓库 HEAD 创建独立本地 clone（复制对象而非复制工作区；用 `git clone --no-local --no-checkout <source> <fixture>` 后 detached checkout 已有 OID），从该 fixture 用 `git worktree add --detach <wt-a> <OID>`、wt-b、wt-c 准备已有提交的干净工作区。这不会纳入或提交当前六个修改。私有 host 的配置/DB/cache/state/TMPDIR 放 fixture 仓库之外的兄弟 evidence 子目录；通过配置引用本次打包/构建插件，不复制密钥、不给 fixture 增加未跟踪配置来破坏 clean 条件。真实模型选择沿用已授权可用配置，不输出认证值。

私有 loopback host 使用独立端口/数据库，不 reload 或重启共享服务。启动前读 `~/.config/agents/slot.md`，`slot audit`、`slot status` 留项目日志，整段可能超过一分钟的 host runner 经 `slot cpu -- <runner>`。runner 前台受控，结束保留成果；不做本版后台管理。先确认 host paths.tmp 及子进程 TMPDIR 不在 `/tmp`。

最小真实验证：Root 会话通过注册工具启动两个非常小的 engineer 任务（只读 cwd/基线、各 patch 一个 scope 内 marker；不跑 shell/后台任务），核验各 marker 与主目录不串写；重复 key 不产生新 session/prompt；第三目标被容量拒绝；status 能关联真实 session；stop 返回 unconfirmed 并保留 marker。受控私有 host 重启恢复测试可做，但禁止重启共享 host；恢复后同 key 不重新派发。若真实工具调用/权限执行、包加载或恢复未完成，报告 NOT_TESTED，不以 API 直接 session.create 替代工具链验收。

交付成功条件：有效红灯和绿灯齐全；上述单元/本地并发/包检通过；host 最小链路有真实证据，缺项逐项明列；六个既有修改未被回滚/吞掉，现场没有 commit/push/stash，原阶段 0 证据不变。有界 smoke 无法覆盖的任意进程树、后台/脱离组、跨机锁、原生 subagent 语义与完整成果整合一律仍 NOT_TESTED/OUT_OF_SCOPE。

## 9. 风险、限制及交回 Root

- 这是 fail-closed 的一次性任务薄层，不保证 exactly-once 执行或自动恢复进度。崩溃可能遗留 session/空预留，需人工调查；不以“可用性”理由偷偷重试。
- Git common dir ledger 需要写权限且只支持合作实例；scope、worktree、模型提示都不是安全沙箱。Root 不得派发不可信代码或共享外部状态任务。
- stop 只是请求，所有任务一直处于进程安全未确认；第一版没有自动成果整合/清理。若业务必须在线释放名额、自动清理或无人值守多批调度，**BLOCKED：超出本版批准范围**，选择保留人工维护（本版）或另立进程所有权与快照契约，不由 engineer 擅自扩展。
- 本契约未执行测试、打包、host 验证；阶段 0 只证明 build 双 worktree 隔离、engineer 前台 shell 单例中断，不证明后台/任意树或当前新工具行为。
- 没有待 engineer 决定的 create/bind、存储、停止或导出业务问题。Root 只需核对最新授权确实接受本委派明确允许的“bind + 无清理 + 人工结案”安全降级；若与用户另有要求冲突，暂停该冲突部分并回问，不更改既有两份计划来制造一致性。
