# 审查门禁（Review Gate）方案契约

状态：**ready / context-only**。日期：2026-11-24。依据：已读 `src/index.ts`、`src/tasks.ts`、`src/tasks-review.ts`、`src/config.ts`、`src/role-guard.ts`、`src/report-status.ts`、`src/tasks-snapshot.ts`、`agents/root.md`、`agents/engineer.md`、`docs/issue-10-host-probes.md`、`probes/issue-10/index.ts`、`test/crew.test.ts`、`test/config.test.ts`，以及 `node_modules/@opencode/plugin`（2.3.0）和 `@opencode/client` 的类型声明。仓库内无 AGENTS.md，只适用全局指令。本文不执行任何命令，不扩大 Mandate/Scope；实施需 Root 另开 Assignment。

## 0. 用户决定（2026-11-24，覆盖下文对应未决项）

- §11 拒绝范围：非 Root 一律拒绝（按 `agent !== "root"`），不限于 primary。
- §11 不留白名单逃生口 option。
- 门禁 `sensitiveGlobs`：默认只含通用项（`**/AGENTS.md`），本仓库特有路径（`agents/**`、`**/role-guard.*`）通过本机插件 options 覆盖，不进默认值。
- 实施顺序：先做 §11 R1–R3；门禁 S0 与 §11 R0 两个真机探针在隔离源码副本中并行；探针结果出来后再决定门禁走完整方案还是降级方案。主仓库 dist 不重建、共享服务不重启。

## 1. 背景与边界

- 目标：把"何时必须派 reviewer"从纯提示词判断，改成插件能确定算出的检查。参照 Claude Code 的 Stop / TaskCompleted hook：Root 要结束一轮时，由宿主侧代码检查，不通过就回到代理。
- 现状：触发 reviewer 只靠 `agents/root.md` §1 委派表，没有代码强制。
- 范围内：新增门禁模块、`reviewGate` 插件 option、Root 一行提示词、文档。
- 范围外：不改 `crew_task_*` 的状态机、ledger、maintenance close 流程；不自动派 reviewer（派不派仍由 Root 决定）；不判断 reviewer 的结论是否通过。审查门禁本身（§2～§10）不改权限 guard。
- 同批实施的独立事项：**§11 限制非 Root 主代理派原生 subagent `engineer`**（用户已确认；已按更正修订），只扩展现有权限 guard，与 §3～§10 无代码依赖，步骤独立（R0～R4）。`crew_task_*` 的执行层限制已存在，不是必做项，权限层 deny 仅作可选评估（§11.4.2）。二者共用一次 dist 重建；重建与服务重启由用户另定时机，不在任何实施步骤内执行。
- 安全边界：门禁对 Ledger 只读；不写任何业务文件；不中断、不干预 engineer。

## 2. 宿主挂点核查

依据是 `@opencode/plugin` 2.3.0 的 `.d.ts`。`package.json` 依赖固定为 2.3.0，宿主是 2.4.1，**2.4.1 上的行为未实测**，见 §9。

| 挂点 | 真实存在 | 对门禁的用处 |
|---|---|---|
| `ctx.session.hook("experimental.idle")`，输入 `{sessionID, background[]}` | 是，`promise/session.d.ts` 的 `SessionIdle`；仓库的 `probes/issue-10` 注册过，但真机复核（R2）未执行 | 最接近 Stop hook：会话完成模型工作、无待处理输入、即将 idle 时运行。文档说明 hook 内 admit 的 synthetic 消息会在同一次 execution 里继续跑，而不是进入 idle。中断、失败、纯控制操作后不触发。`background` 列出仍在跑的 shell/subagent/image |
| `ctx.session.synthetic({sessionID,text,description,metadata,delivery,resume})` | 是，`SessionSyntheticInput` | 注入提醒。`delivery` 为 `steer\|queue` |
| `ctx.session.get / list({parentID}) / context({sessionID})` | 是，`SessionInfo` 含 `parentID`、`agent`、`outcome`、`time.{created,busy,idle}`、`metadata` | 判断 Root、查 reviewer 子会话、读 Root 最近文本 |
| `ctx.session.hook("prompt")`，输入含 `sessionID` | 是 | 记录会话基线 |
| `ctx.session.hook("context")`，可改 `system` / `messages` | 是 | 每次请求注入，侵入大、会改请求前缀，仅作降级备选 |
| `ctx.tool.hook("execute.before"/"execute.after")` | 是，`ToolHooks` | `before` 只有可改的 `input`，**类型上没有否决字段**，不能做阻塞；`after` 可观察 |
| `ctx.event.subscribe({types})` | 是，事件含 `session.idle`、`session.execution.succeeded`、`session.created`、`session.tool.*`、`session.status` | 旁路观察；订阅到的事件只能事后 `prompt`/`synthetic`，不能拦住"结束" |
| `ctx.vcs.status({location:{directory}})` / `diff` | 是，返回 `{file,additions,deletions,status}` | 备选；untracked 语义未知 |
| `ctx.permission.hook("evaluate")` | 是，已用于 role-guard | 只能改 effect，不适合表达"完成" |
| `ctx.tool.transform` | 是，`registerTasks` 已用 | 注册只读 `crew_review_gate` 工具 |
| 名为 Stop / TaskCompleted / SubagentStop 的 hook | **不存在** | 以 `experimental.idle` 代替 |

结论：没有原生的"完成门"，唯一等价物是 `experimental.idle` + `session.synthetic`，而它是 `experimental` 且未真机验证。

## 3. 已决定事项

1. 门禁挂在 Root 会话的 `experimental.idle` 上。会话判定为 Root：`session.get` 返回 `agent==='root'` 且无 `parentID`。其余会话一律忽略。
2. `background` 非空时直接返回，不判定：work 还在跑，宿主会在其结束后再次触发 idle。这也满足 `agents/root.md` §3，同 cwd 有 engineer 在写时 Root 不动。
3. 默认非阻塞：命中后用 `ctx.session.synthetic` 向 Root 注入一条提醒。要求二选一：派 reviewer，或回复一行 `Review-Skip: <具体理由>`。
4. 阻塞方式（软阻塞，`mode:"enforce"`）：同一 fingerprint 下，Root 既没派 reviewer、也没写 `Review-Skip:` 时，在 idle 再次注入，最多 `maxReminders` 次后放行（fail-open）。不提供硬阻塞，理由见 §5。
5. 只从 Root 当前会话**可观测的客观量**判定：改动清单、文件路径、reviewer 子会话是否存在及时间。不解析自然语言来决定"是否高风险"。
6. 任何采集或求值异常一律 fail-open（不提醒，不抛出），门禁不能让 Root 无法结束，也不能让插件加载失败。注册 hook 失败只降级，不抛错。
7. 配置只放插件 options（`reviewGate`），不进 profile 文件（`parseCrewConfig` 的严格键集不动）。

## 4. 触发条件（客观可算）

规则对一个 `ChangeSet`（一个目录的改动清单）求值，命中任意一条即 hit，并记录命中原因。

| 规则 | 条件 | 默认 |
|---|---|---|
| `fileCount` | 去掉 `ignoreGlobs` 后改动文件数 > `maxFiles` | 5 |
| `deletedTest` | 存在被删除（含 rename 的旧路径）且匹配 `testGlobs` 的文件 | 见 §6 |
| `sensitivePath` | 任一改动路径匹配 `sensitiveGlobs` | 见 §6 |
| `planMultiFile` | 该 Root 派出的 engineer 任务提示引用了 `plans/*.md`，且改动文件数 >= `planMinFiles` | 2，0 关闭 |
| `outsideScope` | 仅 crew_task：`counts.outsideScope > 0` | 开 |
| `incomplete` | 改动清单不完整（超限、读取失败、文件在采集期间变化） | 开 |

`ignoreGlobs` 只影响 `fileCount` 与 `planMultiFile` 的计数；`deletedTest`、`sensitivePath` 看全部路径。删除测试是否属于测试文件只看 `testGlobs`，不看内容。

`planMultiFile` 的"依据 plans/ 方案"取客观信号：crew_task 看 ledger 里 `input.goal/acceptance/check` 是否匹配 `/\bplans\/[\w.\/-]+\.md\b/`；原生 engineer 看子会话（`list({parentID})` 中 `agent==='engineer'`）首条用户消息文本是否匹配同一正则（`session.context` 读取，只取首条，截断 8KB）。

### 4.1 原生委派（Root cwd）

- 不能用 `reviewTask()`：它要求目标是已登记的独立 worktree，主目录会得到 `PROJECT_MISMATCH`，且要求 40/64 位 baseline commit。
- 新增 `collectNativeChanges`，在 `ctx.location.directory` 里运行 git，参数风格对齐 `tasks-review.ts`：去掉 `GIT_*` 环境变量、`GIT_OPTIONAL_LOCKS=0`、`-c core.fsmonitor=false`、有超时（默认 3000ms）和 `maxBuffer`。读取 `status --porcelain=v1 -z --untracked-files=all`；rename 按旧路径 deleted 加新路径 renamed 记录，与 `reviewTask` 口径一致。路径被 `.gitignore` 忽略则天然不计（`test/.work/`、`.scratch/` 已在其中）。
- 基线：在 Root 会话第一次 `prompt` hook 时，用同一采集函数记录 `{head, files: path→token}`，其中 token 为 `size:mtimeMs`（不做哈希）。求值时的改动 = 当前清单中 token 与基线不同或基线没有的路径，加上 `git diff --name-status --no-renames <baseline.head>..HEAD`（HEAD 移动时）。这样排除用户本来就有的脏改动。
- 基线推进：观察到 reviewer 覆盖或检测到 `Review-Skip:` 后，把基线置为当前快照，窗口从此重新累计。
- 基线缺失（插件在会话中途加载或重载）：退化为对 HEAD 求值，提醒文本标注"基线缺失，含既有改动"。
- 非 git 目录、git 失败：返回 unavailable，fail-open。

### 4.2 crew_task worktree

- 对 `new Ledger(project).active(rootSessionID)` 的每个任务（`project = inspectProject(ctx.location.directory)`，与 `tasks.ts` 的 `caller` 同样要求 cwd 是主目录），仅评估 engineer 会话**当前不忙**的任务：`session.get` 后 `time.busy` 为空或 `time.idle >= time.busy`，并要求 `matches()` 式身份校验通过。已结案任务不评估。
- 改动清单直接调用 `reviewTask({primaryDirectory, directory, taskID, baseline, scope, periodID, limits:{timeoutMs:3000}})`，再用适配函数 `fromReviewListing` 转成 `ChangeSet`：忽略 `status==='excluded'` 的条目；`counts.outsideScope`、`completeness` 原样带入。`reviewTask` 对每个文件做哈希，较重，但已有测试和限额，不重写。
- `reviewTask` 抛 `TaskRegistryError` 时：该任务视为 unavailable（fail-open），错误码仅在 `crew_review_gate` 工具输出里可见。

### 4.3 reviewer 覆盖判定

- 取 Root 的子会话：`ctx.session.list({parentID: rootSessionID})`，筛 `agent==='reviewer'`。
- 覆盖条件：存在 reviewer 子会话，`time.created >= latestChangeAt`（`latestChangeAt` 为改动文件 mtime 最大值；纯删除时取该 fingerprint 首次观察时间），且 `outcome` 不是 `failed|interrupted`。
- reviewer 仍在跑：idle 的 `background` 会包含它，直接跳过，因此不用单独处理。
- crew_task 的 reviewer 审的是 worktree 目录，同样按上述条件匹配；不要求 reviewer 任务包写明目录（Root 自己负责）。
- 这只证明"有人在改动之后审过"，**不证明审过且通过**，结论由 Root 在验收时判断。

**时间与列表的实现口径**（2026-11-24 两轮复核后确定）：

- `latestChangeAt` 用 `lstat` 逐路径取 mtime（不跟随符号链接，链接按链接自身时间），只跳过 `type === "deleted"` 的条目；出现任何取不到时间的非删除路径时**不采用部分结果**，整体回落到该 fingerprint 的首次观察时间。理由：`reviewTask` 把符号链接记为 `refused` 但保留在清单里，`stat` 会取到旧目标的时间，把新建链接误判成早已被审。
- 子会话列表按 `cursor.next` 翻页（上限 20 页，重复游标即停）。列表不完整时本轮**不提醒、不确认**，只有「已找到 reviewer」这种正向证据才 ack。已知限制：若列表长期不完整，`enforce` 会一直让路而不消耗提醒次数；这属于 fail-open 的代价，不视为缺陷。
- 显式 `Review-Skip` 是这条规则的唯一例外：它绑定「刚刚展示过的那条提醒」，只确认那一条，**不依赖子会话列表是否完整**；不确认、不放行其它命中。

## 5. 动作与风险

命中且无 reviewer 覆盖、无已确认的 skip 时，注入下列文本（中文，路径最多列 10 条，不含文件内容）：

```
[crew-review-gate] 本轮改动命中审查门禁：
- <规则>：<detail>
改动目录：<dir>（<n> 个文件；<crew_task 时附 taskID>）
请二选一：
1. 派 reviewer；任务包写明 Goal/Scope/Acceptance、plans/ 方案、改动目录和 engineer 证据位置；
2. 回复中写一行 `Review-Skip: <具体理由>`。
这是提醒，不改变 crew_task 的 stop → close 顺序，也不表示已验收。
```

`synthetic` 带 `metadata:{crewReviewGate:{fingerprint,rule[]}}` 与 `description:"crew review gate"`，便于排查。`delivery` 默认 `queue`（与 `tasks.ts` 发 prompt 一致），`steer` 是否更合适见 §9。

**状态**（内存，按 Root sessionID 分组，不落盘）：`baseline`、`lastFingerprint`、`reminders`、`acked:Set<fingerprint>`。fingerprint = `sha256(HEAD + 排序后的 "path\0type\0token" 行)` 前 16 位十六进制。

**mode 语义**
- `off`：不注册 hook，不注册工具。
- `remind`：每个 fingerprint 最多提醒 1 次；会话内总提醒不超过 `maxReminders`（见 §6）的 5 倍上限，防止持续编辑造成的刷屏。
- `enforce`：同一 fingerprint 在 Root 没有 reviewer 覆盖、也没有 `Review-Skip:` 时，每次 idle 重新注入，直到 `maxReminders` 次，之后放行。`Review-Skip:` 的检测：`ctx.session.context` 取 Root 最后一条 assistant 文本，匹配 `/(?:^|\n)\s*Review-Skip:\s*(\S[^\n]{9,})/`（理由至少 10 字符；沿用 `extractReport` 的写法）。命中则写入 `acked` 并推进基线。

**阻塞方式评估**
- 软阻塞（idle 内再注入，`enforce`）：可行，是唯一等价于 Stop hook"回到代理"的机制。风险是循环与 token 成本，由 `maxReminders` 封顶；用户中断后 idle 不触发，所以不会拦住用户。
- 硬阻塞：不采用。`tool.hook("execute.before")` 类型上没有否决字段；对 `crew_task_stop` 做 permission ask 会卡住结案路径，违反"先 stop 再 close"；对 `git commit/push` 做 ask 价值低（Root 默认不提交）。
- 与现有规则的冲突检查：门禁只发消息，不写文件、不改 ledger、不调用 interrupt；`background` 非空即让路，不会促使 Root 在 engineer 运行时写入；提醒文本不建议 close，不会把 `ready` 当结案。

## 6. 配置契约

`plugin options.reviewGate`（缺省即默认；顶层未知键仍按现有规则报错，`reviewGate` 先从 options 剥离，再走 `parseCrewConfig`，与 `modelAliases/modelDisplay` 同方式）：

| 键 | 类型 | 默认 | 校验 |
|---|---|---|---|
| `mode` | `"off"\|"remind"\|"enforce"` | `"off"`，S0 通过后由 Root 改默认（见 §10） | 其他值报错 |
| `maxFiles` | 整数 | 5 | 1..1000 |
| `planMinFiles` | 整数 | 2 | 0..1000，0 关闭 |
| `maxReminders` | 整数 | 2 | 1..5 |
| `testGlobs` | 字符串数组 | `["test/**","tests/**","**/*.test.*","**/*.spec.*","**/__tests__/**"]` | 见下 |
| `sensitiveGlobs` | 字符串数组 | `["agents/**","**/role-guard.*","**/AGENTS.md"]` | 同上 |
| `ignoreGlobs` | 字符串数组 | `["plans/**","dist/**","**/*.lock","bun.lock"]` | 同上 |

glob 数组校验（风格对齐 `parseAliases` / `instructions`）：每项必须是非空字符串，trim 后 ≤200 字符，不含控制字符，不以 `/` 开头，不含 `..` 段；最多 64 项；错误信息写 `options.reviewGate.testGlobs[1] ...` 并带 `[opencode-crew]` 前缀。未知子键报 `未知 options.reviewGate.<key>`。非对象报 `options.reviewGate 必须是对象`。

glob 语义：自写小型 `globToRegExp`（纯函数）：`**` 匹配任意层级（含 `/`），`*` 不跨 `/`，`?` 单字符，其余字面；路径统一为 git 的 `/` 相对路径。不引入新依赖（`minimatch` 只是传递依赖，不在 `package.json` 里）；也不复用 `role-guard.ts` 的 `matches`，因为它的 `*` 会跨 `/`。

## 7. 接口与文件

| 文件 | 内容 | 纯净度 |
|---|---|---|
| `src/config.ts`（改） | `ReviewGateConfig`、`defaultReviewGate`、`parseReviewGate`；`parseCrewOptions` 返回增加 `reviewGate` | 纯，无 `node:*` |
| `src/review-gate.ts`（新） | `globToRegExp`、`evaluateGate(changes, cfg)`、`gateFingerprint`、`renderReminder`、`extractReviewSkip` 与类型 `ChangeSet`/`GateVerdict`/`Reason` | 纯 |
| `src/review-gate-git.ts`（新） | `collectNativeChanges`、`snapshotNative`、`fromReviewListing` | 用 `node:child_process`/`node:fs` |
| `src/review-gate-host.ts`（新） | `registerReviewGate(ctx, cfg)`：idle hook、prompt hook（基线）、可选工具；全部 try/catch 包裹 | 依赖宿主 |
| `src/index.ts`（改） | 取 `parseCrewOptions(...).reviewGate`，在 `registerTasks` 之后调用 `registerReviewGate`；`mode==='off'` 直接返回 | |
| `agents/root.md`（改） | 在 §1 委派表后加一行（见 S6） | |
| `README.md` / `README.zh-CN.md`（改） | `reviewGate` option 表与 `Review-Skip:` 约定 | |

`ChangeSet`：`{source:'native'|'task'; dir:string; taskID?:string; files:{path:string; type:'added'|'modified'|'deleted'|'renamed'|'unknown'}[]; outsideScope?:number; complete:boolean; planRef?:boolean; latestChangeAt?:number; degraded?:boolean}`。`GateVerdict`：`{hit:boolean; reasons:{rule:string; detail:string; paths?:string[]}[]}`。

可选工具 `crew_review_gate`（仅 `mode!=='off'` 时注册；输入 `{}`，只读）：返回当前 Root cwd 和各 active crew_task 的 `{hit, reasons, fileCount, fingerprint, reviewerCovered, degraded, error?}`；`tc.agent !== 'root'` 返回 `FORBIDDEN_CALLER` 风格错误。作用有两个：降级路径下 Root 手动调用；排查门禁为什么命中。权限 assert 是否沿用 `authorize` 见 §9。

异常契约：求值、git、ledger、host 调用的任何异常都被捕获，门禁返回"不提醒"；hook 回调不抛错；注册失败（宿主无该 hook 名）只让门禁降级为仅工具 + 提示词。

## 8. 实施步骤（按依赖排序）

通用：行为变更先红后绿。新测试文件对应的模块必须先建**签名正确、返回中性值的桩**（如 `evaluateGate` 返回 `{hit:false,reasons:[]}`），保证红灯是断言失败，而不是 import 错误；红灯输出须贴进报告，且失败原因是缺少目标行为。测试用仓库放 `test/.work/review-gate/`（沿用 `test/workdir.ts` 的 `WORK`），不用 `/tmp`。以下测试都在 1 分钟内跑完，不需要 `slot`。

**S0 真机探针（独立于 S1～S3，S4 的前置）**
- 内容：在 2.4.1 宿主、隔离测试仓库上，按 `docs/issue-10-host-probes.md` §1 的方式挂一个新探针 `probes/review-gate/index.ts`（log-only，不改 decision，不写 ledger）。记录并回答：
  1. `experimental.idle` 在 Root 一轮结束、无后台时是否触发；`session.get` 是否返回 `agent==='root'`、无 `parentID`；
  2. 原生 `subagent` 子会话的 `parentID`、`agent`（reviewer/engineer）和 `time.created`、`outcome` 是否可由 `ctx.session.list({parentID})` 取到；
  3. 在 idle 回调里调用 `ctx.session.synthetic({delivery:'queue'})` 与 `'steer'`，Root 是否在同一次 execution 继续跑；是否出现重复触发；
  4. idle 回调是否被宿主 await（回调里 sleep 2s 观察）及有无超时；
  5. `background` 对原生 subagent 运行中的取值；
  6. 用户中断后 idle 不触发；
  7. `ctx.session.context` 能否读到 Root 最后的 assistant 文本；
  8. 为只读工具 `crew_review_gate` 同类的自定义工具，在 Root 权限默认下是否弹 ask。
- 产出：`plans/evidence/review-gate-probe/summary.md`，每条给宿主版本、日志摘录、通过/失败/未实测。
- 成功标准：1、2、3 通过才继续 S4；任一失败则只做 S1～S3、S5～S6，S4 改走降级（§9 风险 1）。
- 验证命令：`opencode --version`，`jq -c 'select(.hook=="experimental.idle")' <日志>`。

**S1 配置解析**
- 文件：`src/config.ts`、`test/config.test.ts`（追加）。
- 红灯用例：默认值；`mode` 非法；`maxFiles` 为 0/1001/小数；glob 项为空/含 `..`/以 `/` 开头/超长/超 64 项；未知子键；`reviewGate` 非对象；`parseCrewOptions({reviewGate:{...}})` 不再报"未知 options.reviewGate"；profile 文件里出现 `reviewGate` 仍被 `parseCrewConfig` 拒绝；`parseCrewOptions({}).baseline` 与 `.display` 的现有断言不变。
- 验证：`bun test test/config.test.ts`；`bun run typecheck`。
- 成功：全部通过，且原有 config 用例不改。

**S2 纯求值**
- 文件：`src/review-gate.ts`、`test/review-gate.test.ts`。
- 用例：`globToRegExp`（`**`、`*` 不跨 `/`、`?`、特殊字符转义）；`evaluateGate` 对每条规则的边界（`maxFiles` 恰为 5 不触发、6 触发；ignore 只影响计数；删除测试命中；rename 测试旧路径命中；敏感路径；`planMultiFile` 的 `planMinFiles=0` 关闭；`outsideScope`；`incomplete`）；`gateFingerprint` 对顺序不敏感、对 token 变化敏感；`renderReminder` 路径截断到 10 条且无换行注入（路径中的控制字符转义）；`extractReviewSkip` 接受 ≥10 字符理由、拒绝空和过短。
- 验证：`bun test test/review-gate.test.ts`；`bun run typecheck`。

**S3 git 采集**
- 文件：`src/review-gate-git.ts`、`test/review-gate-git.test.ts`。
- 用例（真实临时 git 仓库）：新增/修改/删除/untracked/rename 的分类；基线之前已有的脏文件不计入；HEAD 移动后 `diff --name-status` 补入；非 git 目录返回 unavailable；超时返回 unavailable（用极小 `timeoutMs` 模拟）；`.gitignore` 路径不出现；`fromReviewListing` 忽略 `excluded`、带出 `outsideScope`/`completeness`；对已有 `tasks-review.test.ts` 的 fixture 复用，不改 `src/tasks-review.ts`。
- 验证：`bun test test/review-gate-git.test.ts test/tasks-review.test.ts`；`bun run typecheck`。
- 成功：新测试通过，`tasks-review.test.ts` 保持全绿。

**S4 宿主接线（依赖 S0、S1～S3）**
- 文件：`src/review-gate-host.ts`、`src/index.ts`、`test/review-gate-host.test.ts`。测试沿用 `test/crew.test.ts` 的 fake `ctx` 写法，捕获 `session.hook` 回调后直接调用。
- 用例：`mode:'off'` 不注册任何 hook/工具；非 Root、有 `parentID`、`background` 非空、无改动、已 reviewer 覆盖、同 fingerprint 已提醒（remind）均不调用 `synthetic`；命中时恰好调用一次 `synthetic`，`metadata.crewReviewGate.fingerprint` 正确；`enforce` 下重复注入直到 `maxReminders`，`Review-Skip:` 文本出现后停止并推进基线；采集或 `synthetic` 抛错时回调不抛出；`session.hook('experimental.idle')` 注册失败时 `setup` 不抛错；`index.ts` 的既有测试（`test/crew.test.ts`）不改且通过；crew_task 路径：busy 的任务不评估，已结案不评估，`reviewTask` 抛 `TaskRegistryError` 时 fail-open。
- 验证：`bun test test/review-gate-host.test.ts test/crew.test.ts test/tasks-tools.test.ts`；`bun run typecheck`。

**S5 只读工具（可选，依赖 S4）**
- 文件同 S4，追加 `crew_review_gate` 测试：非 Root 拒绝；输出字段齐全；`mode:'off'` 不注册。
- 验证：`bun test test/review-gate-host.test.ts`。

**S6 提示词与文档**
- `agents/root.md`：在 §1 委派表后加一条，内容要点：插件可能在你结束一轮前注入 `[crew-review-gate]`，收到后必须派 reviewer 或回复 `Review-Skip: <具体理由>`，不要忽略；此提醒不改变 stop→close 顺序。不要写行号，不要改 GPT/Claude 附录的结构。
- `README.md`、`README.zh-CN.md`：`reviewGate` 选项表、默认值、`Review-Skip:` 约定、降级说明。
- 验证：`bun test test/model-family.test.ts test/crew.test.ts`（提示词拆分相关）；`bun test`；`bun run typecheck`。
- 成功：全套通过；`git diff --stat` 只含 §7 列出的文件。

**S7 真机验收（依赖 S4，由 Root 派 engineer）**
- 隔离仓库，`mode:"remind"` 和 `"enforce"` 各一轮：6 文件改动、删除一个测试、改 `agents/` 下文件、`planMultiFile`、crew_task 超 scope；各验证提醒文本、reviewer 覆盖后不再提醒、`Review-Skip:` 后停止、`maxReminders` 封顶。实际结果见 `plans/evidence/review-gate-probe/s7-real-machine.md`。

## 9. 风险与未决事项

风险
1. `experimental.idle` 是实验接口，类型只在 2.3.0 包里核实，2.4.1 行为未测；插件已固定 `@opencode/plugin` 2.3.0，宿主升级可能改签名。缓解：S0 先测；注册包在 try/catch 里；`mode:'off'` 为默认直到通过。
2. 降级方案（S0 失败或宿主移除该 hook）：保留 S1～S3 与 S5，门禁变成"提示词 + Root 可调用的只读 `crew_review_gate` 改动摘要工具"，由 `root.md` 要求 Root 在最终答复前调用一次。备选的 `session.execution.succeeded` 事件订阅 + `session.prompt` 可在回合结束后另起一轮，但会产生额外一轮，需单独评估；`session.hook("context")` 每次请求都注入、会改请求前缀，不推荐。
3. 循环与成本：`enforce` 的重复注入每次消耗一次模型调用；由 `maxReminders` 和会话总量上限封顶，到上限后放行，因此它不是硬保证。
4. reviewer 覆盖依赖 mtime 和子会话 `time.created`；格式化工具或后台进程改 mtime 会导致误判（多提醒或少提醒）。只提醒不阻断，影响有限。
5. `Review-Skip` 理由无法被校验；它是留痕，不是证明。
6. 基线只在内存；插件重载或 Root 会话中途接入会退化为对 HEAD 求值，可能把用户既有改动算进去。
7. 原生委派的改动按 Root cwd 整体计算，用户手工并发修改会被一并计入。
8. 误报：目录移动会被记为"删除测试"；`planMultiFile` 依赖任务文本里出现 `plans/*.md`，Root 没写路径就不触发。
9. 大仓库 `git status` 耗时；超时即 fail-open，不提醒。
10. 提醒只含路径，不含文件内容；控制字符转义后再入文本。

未决事项（需实测或需用户/Root 决定）
- S0 的 8 个问题，尤其：原生 subagent 子会话是否以 `parentID` 关联 Root；`synthetic` 在 idle 内的 `queue`/`steer` 语义；idle 回调是否被 await 及超时。
- 工具 `crew_review_gate` 是否需要 `ctx.permission.assert`（`tasks.ts` 的 `authorize` 模式）；若宿主对未知 action 默认 ask，会让只读工具反复弹窗。
- 默认 `mode`：建议 S0、S7 通过后改为 `remind`，是否采纳由 Root/用户决定。
- 默认 `sensitiveGlobs`（`agents/**` 等）带有本仓库特征，插件被装到其他项目时可能无意义；是否改成空默认、或仅用通用项，由用户决定。
- `maxFiles` 默认 5 的业务含义（`root.md` 直接做的条件是 1～2 个文件，委派 engineer 的门槛更低）。
- `enforce` 达到 `maxReminders` 后是放行，还是改为提示用户确认（后者要新增交互，本方案不含）。
- `ctx.vcs.status` 能否替代自写 git 采集（untracked 语义、rename 处理未知）；本方案选自写以与 `tasks-review.ts` 口径一致。

## 10. 成功标准汇总

- `bun test` 全套通过，`bun run typecheck` 无错误，`git diff --stat` 只含 §7 与 §11.5 列出的文件。
- 红灯输出已留存，失败原因为缺少目标行为。
- S0 证据文件存在且 1、2、3 通过，或降级方案已明确选用。
- S7 在真机上证明：命中提醒、reviewer 覆盖后停止、`Review-Skip:` 后停止、`maxReminders` 封顶、crew_task 的 stop→close 流程不受影响。
- §11 的成功标准见 §11.7。

## 11. 限制非 Root 主代理派原生 subagent engineer（独立事项，用户已确认；crew_task_* 仅说明现状）

### 11.1 现状核实

- `src/index.ts` 的 `loadRole` 要求非 Root 角色 `mode: "subagent"`，`ctx.agent.transform` 把 architect/engineer/explorer/reviewer 注册为全局 subagent。宿主自带的 build、plan 或用户自定义的 primary，只要自己的 `subagent` 权限不是 deny，就能派出 engineer，从而绕开 `agents/root.md` 的单写入者、验收规则，也绕开 §3～§10 的审查门禁（门禁只看 Root 会话）。
- **crew_task_\* 在执行层已经只认 Root，本批不新增任何限制**：`src/tasks.ts` 的 `caller()`（约 117～122 行）在 `tc.agent !== 'root'` 时抛 `FORBIDDEN_CALLER`，并校验会话 owner：`owner.id===tc.sessionID`、`owner.agent==='root'`、owner 的 location 与 `ctx.location.directory` 都等于主 worktree。`identity()` 在 `authorize()` 以及任何 create/prompt/interrupt 之前执行，`test/tasks-tools.test.ts` 的 `non-root callers get FORBIDDEN_CALLER from all three tools before any side effect` 已覆盖三个工具。`crew_task_*` 的代码、账本、结案流程一律不改。
- `crew_task_start`（约 152 行）与 `crew_task_stop`（约 196 行）内部会 `authorize(tc,'subagent',['engineer'])`，即 `ctx.permission.assert({sessionID, agent: tc.agent, action:'subagent', resources:['engineer'], source:{type:'tool',...}})`。本节新增的 guard 规则会看到这类事件，必须确认不误伤，见 §11.4.3。
- 全局 `guard`（`src/role-guard.ts`）已经作为唯一一个 `permission.hook("evaluate")` 注册（`test/crew-read-role-policy.test.ts` 的 `C exactly one evaluate hook` 钉住了数量），当前只对 architect/explorer/reviewer 介入，其余角色在 `agent` 解析后直接 `return`。

### 11.2 实现位置比较与推荐

| 维度 | A. `ctx.agent.transform` 给非 Crew primary 追加 deny 规则 | B. 在已注册的 `evaluate` guard 内按调用者身份裁决 |
|---|---|---|
| 覆盖范围 | 只覆盖 transform 执行时已存在的代理；其他插件在本插件之后注册的代理、之后新增的用户代理会漏掉 | 每次求值都按事件里的调用者判断，宿主之后新增的任何代理自动覆盖 |
| 用户全局规则（last match wins） | 规则在代理规则表里。`docs/role-permissions-host-checks.md` 记录 S0 实测"最终全局规则尾部注入"，用户全局 `subagent: allow` 会排在后面盖掉我们的 deny；这正是读角色必须用 hook 的原因，`test/crew-read-role-policy.test.ts` 的 `D hostile tail cannot allow` 钉住了该口径 | guard 只升级不放松（`severity` 取严），全局尾部的 allow 无法覆盖 |
| reload 幂等 | `agent.reload()` 会重跑 transform，必须复用 `appendBlock` 式连续块判重，并且对每个宿主代理重复判断 | 无状态，天然幂等 |
| 副作用 | 改写宿主自带代理的权限表，对用户可见、会出现在 UI/配置回读里，属于改动别人的代理 | 不动任何代理配置 |
| 工具可见性 | 若宿主按代理权限从模型工具列表里隐藏被 deny 的工具，则 build 看不到 crew_task_\*（未验证，见 R0；仅与 §11.4.2 的可选项相关） | 不隐藏；模型仍可能尝试调用，会得到带原因的 deny |
| 失败面 | transform 内抛错的影响见 `docs/role-permissions-host-checks.md` 的 setup 失败测试 | 复用已验证的 guard 路径；解析身份失败走既有 fail-closed |

**推荐：B 作为权威实现**。可靠性取决于"能否被用户全局规则覆盖"和"能否覆盖之后新增的代理"，只有 B 两项都满足，并且复用已有 hook，不增加第二个 evaluate hook。A 不作为实现手段。engineer 派发限制只做 B。

### 11.3 权限事件的真实形状（已核实 / 未核实）

- `PermissionEvaluation`（`node_modules/@opencode/plugin/dist/promise/permission.d.ts`）：`{sessionID, agent?, action, resources[], metadata?, source?, effect, message?}`。`agent` 可选；缺失时 guard 现有逻辑回退 `ctx.session.get({sessionID}).agent`。
- `subagent`：`plans/evidence/worktree-stage1/host-permissions/run2.log` 里的 pending 事件为 `{"action":"subagent","resources":["engineer"],"source":{"type":"tool","messageID":...,"id":...}}`，规则文本为 `{"action":"subagent","resource":"engineer"}`。**注意这条来自 `crew_task_start` 内部的 `permission.assert`**；宿主原生 `subagent` 工具发出的事件在仓库里没有原始抓取。`agents/engineer.md`/`role-guard.ts` 的 `hostBlock` 把 `subagent` 当 action 使用，与之一致，但仍需 R0 抓一次原生事件。
- crew_task_\*（仅与可选项 §11.4.2 相关）：插件内部 `authorize()` 以 action=`crew_task_start|crew_task_status|crew_task_stop`、resources=`[primaryDirectory]`、`agent: tc.agent` 调用 `ctx.permission.assert`（见 `src/tasks.ts`）。`plans/worktree-stage1-results.md` 里的真机证据全部是这类内部 assert。**宿主自己是否在执行自定义工具之前按工具 id 做权限求值、action 是否同名，仓库里没有证据**，只有评估可选项时才需要 R0 第 2、4 条。
- Code Mode：同一证据里 Root 通过外层 `execute` 调用嵌套的 `crew_task_start`，嵌套事件的 `source` 指向外层 `execute` 的 message/call ID，调用者仍是 Root 会话。因此规则**只能按调用者身份判断，不能按工具名或 `source` 判断**。

### 11.4 契约

#### 11.4.1 必做：非 Root 派 engineer 被拒

在 `guard` 内、`external_directory` 提前返回之后、解析出 `agent` 之后、读角色早退之前，加一条纯函数判断（新增到 `src/role-guard.ts`，例如 `engineerDispatchDenied(action, resources, agent)`，导出供测试）：

1. 命中集合：`action === "subagent"` 且 `resources` 精确包含 `"engineer"`。`resources` 为空视为不匹配（原生 subagent 调用总会带目标名）。
2. 调用者 `agent !== "root"` 即命中：`event.effect = "deny"`，`event.message = "Crew：engineer 只能由 Root 派发（调用者：<agent>）。请用 /crew 切到 Root，或改派 explorer / architect / reviewer。"`，随后 `return`。
3. 调用者是 `root`：不动 `event.effect`（保留宿主的 allow/ask/deny，不放松也不收紧）。
4. 目标是 explorer / architect / reviewer：不匹配，保持宿主原判决，对所有主代理仍可派。
5. 身份无法解析时沿用既有 fail-closed（整个 `guard` 的 `catch` 分支）；本规则不新增 fail-open 路径。

范围说明：用户要求的是"root 以外的 primary"。实现按"`agent !== root`"裁决，因此也覆盖宿主自带的非 primary 子代理（如 general）。理由：判断是否 primary 需要额外查询代理 mode，多一个失败面；而 Crew 的 architect/explorer/reviewer/engineer 本来就 deny `subagent`（`hostBlock`、`engineer.md`），Root 以外没有应该派 engineer 的角色，结果等价且更严。如果要严格限于 primary，需要在 guard 内查 `ctx.agent` 的 mode，已列入未决。

#### 11.4.2 可选（不作为必做步骤）：对非 Root 的 crew_task_* 再加权限层 deny

现状：执行层 `FORBIDDEN_CALLER` 已保证非 Root 调用零副作用（§11.1）。是否再在权限层对 `crew_task_start|status|stop` 做 deny，仅为"提前拒绝"或"隐藏工具"，利弊如下：

| 方案 | 利 | 弊 |
|---|---|---|
| 不加（默认，本批采用） | 无新增行为与测试面；执行层已有测试；不会误伤 Root 经 Code Mode 的调用 | build 的模型能看到这三个工具，调用后得到 `FORBIDDEN_CALLER` 错误，浪费一次调用 |
| 在 guard 里对 `action ∈ {crew_task_start, crew_task_status, crew_task_stop}` 且 `agent !== root` 设 deny | 复用同一个 hook；全局尾部 allow 盖不掉；与 11.4.1 同代码路径 | 这三个 action 的事件目前只会由工具内部 `authorize()` 发出，而非 Root 调用者在 `identity()` 就被拒，根本到不了 `authorize()`；除非宿主在工具执行前自己按工具 id 评估权限（**未验证**，R0 第 2 条），否则这条规则**永远不会被触发，等于死代码** |
| 用 `agent.transform` 给非 Crew primary 追加 `crew_task_*` deny，期望宿主据此从模型工具列表隐藏 | 若宿主会隐藏被 deny 的工具，则 build 看不到这三个工具，省 token | 需要先由 R0 第 4 条证明宿主确有此行为；会改写宿主自带代理的权限表（§11.2 的 A 方案缺点：被全局尾部覆盖、reload 幂等、新增代理漏掉）；并且需要新的 transform 测试 |

建议：本批不做。如果 R0 第 2 条证明宿主确实在工具执行前按工具 id 评估权限，再由用户决定是否追加第二行方案（只需在 11.4.1 的纯函数里增加一个 action 集合与对应用例，不改执行层）。该选项不影响 R1～R4 的必做内容。

#### 11.4.3 不误伤清单（必须由测试和真机共同确认）

- **Root 与 `crew_task_start`/`crew_task_stop` 的内部 assert**：`authorize(tc,'subagent',['engineer'])` 传入的是 `agent: tc.agent`，而 `caller()` 已保证它是 `'root'` 且 owner 会话 agent 也是 `'root'`；因此事件为 `{agent:'root', action:'subagent', resources:['engineer'], source:{type:'tool',...}}`，命中集合但调用者是 root，按 11.4.1 第 3 条 effect 保持不变，不会被 deny。`crew_task_status` 无此 assert。
- **本批不给 Root 追加任何 `subagent`/`engineer` 规则**：`agents/root.md` 的 `permissions: []` 保持，`index.ts` 里 Root 分支（`role.permissions.length > 0` 才替换）不动。也就是说不引入 Root 侧的 allow/deny 规则，没有任何规则可能与 Root 的内部 assert 或用户全局 `ask` 冲突；Root 对 engineer 的 allow/ask 仍完全由宿主和用户全局规则决定（真机证据里 `subagent`/`engineer` ask 与 deny 对 Root 起作用，本批不改变）。
- **Root 经 Code Mode（外层 `execute`）的嵌套调用**：嵌套事件的调用者仍是 Root 会话（`source` 指向外层 `execute`），规则只按调用者判断。
- **Crew 子代理**：engineer 已有 `subagent`/`execute` deny，本规则再 deny 一次不改变结果；architect/explorer/reviewer 的 `subagent` 本来被 `hostBlock` 禁止。
- **`agent` 字段缺失的事件**：回退 `ctx.session.get({sessionID}).agent`；`authorize()` 总是显式传 `agent`，不依赖回退。

与 §3～§10 的关系：门禁只处理 Root 会话，因此"engineer 只能由 Root 派"是它假设的前提（reviewer 覆盖按 Root 子会话判断）。二者无代码依赖，可单独上线。

### 11.5 涉及文件

| 文件 | 变更 |
|---|---|
| `src/role-guard.ts`（改） | 新增 `engineerDispatchDenied`；`guard` 内调用；`guard` 的签名和既有行为不变 |
| `test/crew-root-only.test.ts`（新） | 本节全部红灯/绿灯用例 |
| `agents/root.md`（改，一行） | §2 补一句：其他主代理不能派 engineer，Root 才是入口；不动附录结构 |
| `README.md`、`README.zh-CN.md`（改） | 在权限一节说明"engineer 仅限 Root 派发"及 deny 提示文案；注明 `crew_task_*` 的执行层 Root 限制是既有行为 |
| `probes/root-only/index.ts`（新，仅 R0 用） | log-only 探针，不改 decision |

`src/index.ts`、`src/tasks.ts` 不改（guard 已注册，仍只有一个 evaluate hook）。

### 11.6 实施步骤（独立于 S0～S7）

通用要求同 §8：先红后绿，红灯须是"缺少目标行为"而不是语法/导入错误；测试用 `fixture` 写法沿用 `test/crew-read-role-policy.test.ts`（`plugin()` 动态导入、收集 `permission.hook` 回调、直接用事件调用）。临时数据放 `test/.work/`，不用 `/tmp`；测试均在 1 分钟内，无需 `slot`。

**R0 真机探针（与 R1 并行；R4 的前置；不阻塞 R1～R3）**
- 新增 `probes/root-only/index.ts`（log-only，沿用 `probes/issue-10/index.ts` 的写法与挂载方式），在 2.4.1 宿主、隔离测试仓库中注册 `permission.hook("evaluate")` 与 `session.hook("context")` 只记录。依次用宿主自带 `build` 和 `root` 各做：
  1. 让代理调用原生 subagent 派 engineer 与 reviewer：记录事件的 `agent`、`action`、`resources`、`source`、`sessionID`；
  2. （仅为评估 §11.4.2 可选项）让 `build` 调用 `crew_task_status`：记录是否出现宿主层（非插件 `authorize`）的 evaluate 事件，action 名是什么；
  3. Root 经 Code Mode（外层 `execute`）调用 `crew_task_start`/`crew_task_stop` 的内部 `subagent`/`engineer` assert：记录事件的 `agent` 是否为 `root`、`source`、以及缺省时 `session.get(...).agent`；
  4. （仅为评估 §11.4.2 可选项）`context` hook 的 `tools` 字段：对 `build` 追加 `{action:"crew_task_start", resource:"*", effect:"deny"}` 前后，模型可见工具列表是否变化；
  5. 宿主 deny 事件的 `message` 是否原样回给模型。
- 产出：`plans/evidence/root-only-probe/summary.md`，每条含宿主版本、日志摘录、通过/失败/未实测。
- 成功标准：第 1、3、5 条与 §11.3/§11.4.1/§11.4.3 假设一致；第 1 条不一致时（例如 resources 带命名空间），在 R2 前由 Root 调整匹配条件。第 2、4 条结果只用于 §11.4.2 的可选决策，不改 R1～R3。
- 验证：`opencode --version`；`jq -c 'select(.hook=="evaluate")' <日志>`。

**R1 红灯（依赖：无）**
- 文件：`test/crew-root-only.test.ts`。**仅写测试并运行**，保存失败输出；红灯原因必须是 deny 断言不成立（期望 `deny`，实际保持宿主给的 `allow`/`ask`），不能是 import 错误。
- 用例（每个都经 `plugin().setup(fixture.ctx)` 后调用 `hooks.filter(h=>h.name==="evaluate")`）：
  1. 调用者 `build`、`plan`、自定义 primary `my-primary` 各一，`{action:"subagent", resources:["engineer"]}`，宿主给 `allow` 和 `ask` 两种初始 effect → 都变 `deny`，且 `message` 非空并含 `Root`；
  2. 同样三个调用者，`resources` 为 `["reviewer"]`、`["explorer"]`、`["architect"]` → effect 保持宿主原值（`allow` 仍 `allow`，`ask` 仍 `ask`）；
  3. 多资源 `["reviewer","engineer"]`（任一为 engineer）→ `deny`；空 resources → 不命中；
  4. 不误伤 crew_task 内部 assert：按 `src/tasks.ts` `authorize()` 的真实形状构造 `{agent:"root", sessionID, action:"subagent", resources:["engineer"], source:{type:"tool",messageID:"m",id:"c"}}`，宿主给 `allow`、`ask`、`deny` 各一 → effect 保持原值；同形状的 `crew_task_start`/`crew_task_status`/`crew_task_stop`（resources 为主目录）事件对 `root`、对任意调用者**都**保持原值（证明本批没有给 crew_task_\* 加权限层规则）；
  5. 调用者 `root`：`subagent`/`engineer` 在宿主 `allow`/`ask`/`deny` 下 effect 都保持原值（不放松也不收紧），`message` 不被写入；
  6. 全局尾部注入：对 `build` 模拟宿主因用户全局 `subagent: allow`（resources 为 `engineer`）而给 `allow` 的事件 → 仍 `deny`（对应 `D hostile tail`）；
  7. `agent` 缺省：`sessions.set("ses_x",{agent:"build"})` → `deny`；`{agent:"root"}` → 保持原值；`session.get` 抛错 → 保持既有 fail-closed `deny`（断言与既有语义一致，不新增行为）；
  8. Code Mode：事件带 `source:{type:"tool",messageID:"m",id:"c"}`、`agent:"root"` → 保持原值；`agent:"build"` 同样带 source → `deny`；
  9. Crew 角色：`engineer`、`reviewer` 调 `subagent`/`engineer` → `deny`（不新增放行；这两项因 `hostBlock` 本来就 deny，预期保持绿灯，用来钉住不回退）；
  10. 数量与幂等：`evaluate` hook 仍恰好 1 个，transform 重放不增加；Root 的 `agents.get("root").permissions` 不含新增的 `subagent`/`engineer` 规则（钉住"不给 Root 加规则"）。
- 验证：`bun test test/crew-root-only.test.ts`。成功标准：用例 1、3、6、7（build 分支）、8（build 分支）为红；2、4、5、9、10 以及其他保持绿灯，说明红灯来自缺失行为而不是夹具错误。

**R2 实现（依赖 R1）**
- 文件：`src/role-guard.ts`。按 §11.4.1 增加纯函数与 `guard` 内的调用，保持 `external_directory` 早退、身份解析、`catch` fail-closed、读角色局部策略不变；不触碰 `src/tasks.ts` 与 `src/index.ts`。
- 验证：`bun test test/crew-root-only.test.ts`（全绿，保存输出）；`bun test test/crew-read-role-policy.test.ts test/crew.test.ts test/tasks-tools.test.ts`（既有用例不改且全绿）；`bun run typecheck`。
- 成功标准：新旧测试全绿，`guard` 签名未变，`git diff --stat` 只含 `src/role-guard.ts` 与测试文件。

**R3 提示词与文档（依赖 R2）**
- `agents/root.md` 一行、两份 README 的权限说明（见 §11.5）。不改 GPT/Claude 附录结构。
- 验证：`bun test test/model-family.test.ts test/crew.test.ts`；`bun test`；`bun run typecheck`。

**R4 真机验收（依赖 R2、R0；由 Root 另派 engineer）**
- 使用隔离源码副本构建（沿用 `docs/role-permissions-host-checks.md` 的方式），**不更新主仓库 `dist`、不重启共享服务**。与 S7 共用同一次隔离构建与同一台测试宿主。
- 场景：`build` 派 engineer → deny 且无子会话；`build` 派 reviewer/explorer/architect → 正常；Root 直接和经 Code Mode 派 engineer 正常；Root 的 `crew_task_start`（含内部 `subagent`/`engineer` assert）与 `crew_task_stop` 照常通过，状态和结案路径不变；`build` 调 `crew_task_*` 仍得到既有的 `FORBIDDEN_CALLER`（证明执行层限制未被改动）；`/crew` 切到 Root 后可用。实际结果见 `plans/evidence/root-only-probe/r4-real-machine.md`。

### 11.7 成功标准

- `bun test test/crew-root-only.test.ts` 红灯输出已留存且原因为缺少目标行为，实现后全绿；`bun test` 全套、`bun run typecheck` 通过；既有 `crew-read-role-policy` 与 `tasks-tools` 用例未改动且通过。
- R0 证据确认了原生 subagent 事件形状和 `crew_task_*` 内部 assert 下的调用者身份；R4 验收证明非 Root 派 engineer 被拒、Root（含 `crew_task_start`/`stop` 内部 assert）与 reviewer 路径不受影响。
- dist 重建和服务重启不在实施步骤内；上线前由用户另定时机。注意宿主加载的是 `dist/index.js`（`package.json` 的 `exports`），源码合入后在重建前不会生效。

### 11.8 风险与未决事项（本节）

风险
1. 强度取决于 guard 是宿主评估链里最后一个改 effect 的插件；`docs/role-permissions-review.md` 已记录"后续插件可再修改 effect"，本规则无法防御恶意或排在后面的其他插件。
2. 过度限制：用户自定义 primary 想合法使用 engineer 也会被拒，且没有开关。若要逃生口，需要新增 option，属于业务决策，本方案不加。
3. 用户在非 Root 会话里用 `@engineer` 显式点名时，若宿主经 `subagent` 权限评估，同样会被拒。
4. 本规则只在权限事件上生效，不隐藏工具；build 的模型仍可能反复尝试并得到 deny，浪费少量 token，提示文案已指向 `/crew`。
5. 原生 `subagent` 事件若 resource 不是裸名（例如带命名空间），匹配会漏；R0 第 1 条核实。
6. 误伤面只有一处：命中集合 `subagent`/`engineer` 与 `crew_task_start`/`stop` 的内部 assert 同形。放行依赖 `agent==='root'`；一旦 `authorize()` 将来不再显式传 `agent` 且会话回退失败，会落到既有 fail-closed 的 deny。R1 用例 4 钉住当前形状。

未决事项
- 是否严格限制到 primary（需在 guard 内查 mode）还是按"非 Root 一律"（本方案默认，更严更简单）。
- 是否需要 option 级逃生口（例如允许名单）。
- 原生 subagent 工具的权限 action 是否确为 `subagent`（R0 第 1 条）。
- 可选项 §11.4.2：是否在权限层对非 Root 的 `crew_task_*` 加 deny 或隐藏。默认不做；仅当 R0 第 2 条证明宿主在工具执行前按工具 id 评估权限、或第 4 条证明宿主会隐藏被 deny 的工具时，才值得评估，由用户决定。
