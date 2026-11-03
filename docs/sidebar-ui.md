# Crew Sidebar UI 设计

## 背景与结论

OpenCode 会话页右侧在没有 Todo、MCP 或其他扩展内容时较空。Crew 的实际工作大多走原生 subagent，派给 architect、engineer、explorer、reviewer；`crew_task` 很少触发。原生主区域已经显示权限、完成/失败通知和模型，但看不到“现在谁在跑、跑到哪一步、哪个角色用量异常”。侧栏补的就是这些，不替换成独立的 Crew 控制台。

设计结论：**Crew 通过一个 `prepend: "sidebar.content"` claim 插入提醒区（条件显示）、Delegations 和 Subagents 三块，保留原生会话标题、Todo、Context 和 footer。** 不 `replace` 整个 `sidebar.content`，也不接管 `sidebar.footer`。侧栏不展示 Crew 角色列表，也不显示模型名。

基线：

- Crew Server 插件：`@opencode/plugin` 2.2.3。
- 宿主参考实现：OpenCode v2.2.5。
- 原型中的角色、任务、步数、tokens、费用和时间均为示意数据，不代表真实宿主状态。

## 原型文件

- [HTML 原型](sidebar-prototype.html)：单文件，无外部依赖，一份示例数据加一个渲染函数生成侧栏。
- [运行态截图](sidebar-prototype.png)：`active`，1024×720。
- [空闲态截图](sidebar-prototype-idle.png)：`idle`，1024×720。

HTML 可直接在浏览器打开，用 `?state=<name>` 或页面顶部切换栏选择状态。切换栏和左侧简化的聊天区只用于原型演示，不属于目标 TUI 界面。

| 状态 | 演示内容 |
| --- | --- |
| `active`（默认） | 日常情况：engineer 运行中，下面嵌套一个 explorer；Subagents 4 个角色；无 `crew_task`，提醒区为空 |
| `idle` | 无运行中的 delegation，Delegations 隐藏；Subagents 显示本次汇总；Todo 全部完成 |
| `blocked` | 两个 `crew_task`（blocked、failed）和对应提醒，作为 `crew_task` 两行样式示例；engineer 因一次用满 `~80/80` 在 Subagents 中标黄 |
| `stall` | 一个普通子代理长时间无输出，活动列为 `无输出 6m`，整行 warning |
| `overflow` | 4 个运行中的子代理（含嵌套）、1 个 waiting 的 `crew_task`、1 条权限提醒、8 条 Todo；内容超高，`sidebar.content` 垂直滚动，标题和 footer 固定 |
| `long` | 超长会话标题、任务 ID、自定义角色名（三层嵌套）、活动、check 命令、路径和分支名，验证省略号截断 |
| `anomaly` | explorer 9 个子会话、640k tokens、$1.41，其中一次用满 `~30/30`；Delegations 中的 explorer 行和 Subagents 中的 explorer 行都为 warning |

## 宿主约束与参考

OpenCode v2.2.5 的原生侧栏结构为：

1. 会话标题；
2. 可垂直滚动的 `sidebar.content`；
3. 固定 `sidebar.footer`。

参考实现：

- [会话侧栏](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/routes/session/sidebar.tsx)
- [原生 Todo](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/feature-plugins/sidebar/todo.tsx) / [Todo 条目](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/component/todo-item.tsx)
- [原生 Context](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/feature-plugins/sidebar/context.tsx)
- [原生 footer](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/feature-plugins/sidebar/footer.tsx) / [路径截断](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/ui/file-path.tsx)
- [原生 MCP 列表](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/feature-plugins/sidebar/mcp.tsx)

侧栏宽 42 列，上下内边距各 1 行、左右各 2 列；`sidebar.content` 内部再留 1 列给滚动条，可用宽度 37 列，区块之间空 1 行。实现时使用宿主主题和 OpenTUI 布局，HTML 原型只用 `ch` 和行高模拟这套字符网格。

## 原生已覆盖与 Crew 补充

主区域原生已经显示的内容，侧栏不再重复（均在 v2.2.5 `packages/tui/src/routes/session/` 下）：

- Root 会话把整个会话族的权限请求和表单汇总，在输入框位置弹出：[`index.tsx` 203–220](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/routes/session/index.tsx#L203-L220)、[1602–1607](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/routes/session/index.tsx#L1602-L1607)；
- 子代理完成、失败、取消时有通知行：`index.tsx` 中的 `SessionNoticeMessageV2`；
- 运行中的子代理在工具行显示 busyLabel 和活动摘要：[`activity-summary.ts`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/routes/session/activity-summary.ts)；
- 输入框的 Subagents 页签默认收起、最多 5 行：[`composer/subagents-tab.tsx`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/tui/src/routes/session/composer/subagents-tab.tsx)；
- 每轮回复末尾显示 agent、模型和耗时：`index.tsx` 中的 `AssistantFooter`。

原生缺、Crew 要补的：

- 正在运行的 delegation 一直可见，包括后台运行和嵌套的子代理；
- 步数预算（已用 / 上限）；
- 每个子代理当前的活动和卡住提示；
- 各角色本次的子会话数、`crew_task` 数、tokens 和费用，用来发现异常。

`crew_task` 的工程师会话由 [`src/tasks.ts:158`](../src/tasks.ts#L158) 的 `ctx.session.create` 创建，没有 parentID，不在 Root 会话族里，原生的权限汇总、通知和页签都覆盖不到它，所以它的权限、blocked、failed 进入提醒区。由于 `crew_task` 很少触发，侧栏以普通子代理为主体，`crew_task` 只是 Delegations 里的一种条目。

## 信息结构

从上到下依次为：

### 1. 会话标题

沿用宿主标题与重命名状态，例如 `change-closeout`，超长时截断。Crew 不增加第二套大标题或会话名称。

### 2. 提醒区，条件显示

只放 `crew_task` 会话中需要人处理的事：待处理权限、blocked、failed。例如（`blocked` 状态）：

```text
! ct_fixture    blocked 缺少 fixture
! ct_migrate    failed bun test 退出…
```

- 列宽：`!` 1 列，任务 ID 13 列，其余为说明，列间空 1 列，超长用省略号截断。
- 颜色：`!` 和 `权限` / `blocked` 用 warning，failed 的 `!` 和 `failed` 用 error；任务 ID 用 text.base，说明用 muted。权限条目写成 `权限 edit src/api.ts`。
- 整行可点击，悬停时加下划线；点击用 `ui.router.navigate` 跳转到对应任务会话，在那里走宿主已有的权限处理流程。侧栏内不直接授权。
- 无内容时整块隐藏，不保留空行。

### 3. Delegations，条件显示

只列当前 Root 会话族里正在运行的 delegation，外加 Root 拥有的 `crew_task` 会话。标题 `Delegations (N running)`：`Delegations` 粗体 text.base，括号部分 muted；N 为运行中的普通子代理数加 progress / waiting 的 `crew_task` 数。

普通子代理每个占一行，三列：角色名 10 列、活动、右对齐的步数（通常 6 列，步数超长时最多扩到 12 列并压缩活动列），列间空 1 列，合计 37 列。嵌套的每层在角色名前多缩进 2 列（例如 engineer 派出的 explorer），缩进计入 10 列。`active` 状态：

```text
Delegations (2 running)
engineer   Running command…    ~41/80
  explorer Running read…        ~8/30
```

- 活动文案照搬原生 `busyLabel`：思考中为 `Thinking…`；工具运行中为 `Running <noun>…`，工具输入仍在流式生成时为 `Preparing <noun>…`；noun 为工具名，`shell` 写作 `command`，`execute` 写作 `code`（如 `Running read…`、`Running edit…`、`Preparing write…`）。
- 步数写成 `~已用/上限`，因为已用步数是近似值（见“数据来源与口径”）。
- 颜色：角色名 text.base，活动 info，步数 faint。
- 异常时整行 warning：已用步数达到上限的 80% 及以上，或长时间无输出（活动列改为 `无输出 6m`）：

```text
engineer   无输出 6m           ~41/80
```

`crew_task` 每个占两行。第 1 行：任务 ID（text.base）、Report 状态、步数（faint）；第 2 行：progress / waiting 为 `check <命令>`，ready 为 `next Root 验收证据`，blocked / failed 为 `next <原因或下一步>`，键名 faint，值 muted。`blocked` 状态：

```text
Delegations (1 running)
reviewer   Running read…        ~6/30
ct_fixture             blocked ~17/80
next 补充 ledger fixture
ct_migrate              failed ~80/80
next 查看失败日志
```

- Report 状态颜色：`progress` 为 info，`waiting` / `ready` 为 warning，`blocked` / `failed` 为 error；`dropped` 不展示。
- `crew_task` 步数达到 80% 时，任务 ID 和步数改为 warning，状态保留原色，failed / blocked 仍为红色。

没有运行中的 delegation、也没有 `crew_task` 时，整块隐藏。条目不设数量上限，超高时随 `sidebar.content` 垂直滚动。

### 4. Subagents

本次 Root 会话族里各角色的用量汇总，`idle` 时也显示，方便事后回看。标题 `Subagents (N sessions · $X.XX)`（N 为 1 时写 `1 session`），括号部分 muted，N 为各角色子会话数之和；下面一行 faint 列头，然后每个角色一行：角色名 10 列，`sess` 6 列 + 1 列间隔、`tok+cache` 10 列、`cost` 10 列，后三列右对齐，合计 37 列。`active` 状态：

```text
Subagents (7 sessions · $1.33)
            sess  tok+cache      cost
architect      1   38k+120k     $0.15
engineer       2  412k+1.2M     $0.62
explorer       3  161k+800k     $0.35
reviewer       1   52k+210k     $0.21
```

- 只列有会话或有 crew_task 用量的角色；`crew_task` 不单独占一行，其 tokens / cost 并入 engineer，但不增加 `sess`。
- `sess` 是会话族里该角色的原生子会话数；复用同一 session 的多次 `subagent` 调用不计数，tokens / cost 仍按子会话去重后的累计，不要用 `cost ÷ sess` 对账。
- Subagents 是本次 Root 会话族的累计口径（包含之前轮次创建的会话）；Delegations 只显示当前运行中的 delegation 和 `crew_task`。
- `tok+cache` = 工作 token（input + output + reasoning + cache.write）+ cache.read；cache.read 只展示，不参与异常阈值。cost 由宿主按实际模型和分项价格计算，所以 `$ / M` 本来就不会等于单一模型单价。
- 不同角色可以在 `options.models` 配置不同模型；同一角色也可能因缓存命中率不同而出现不同的 `$ / M`。
- `tok+cache` 用 k / M 缩写（`38k+120k`、`1.2M+5M`）；超过 10 列时只显示工作 token，避免撑破布局。费用保留两位小数（`$0.42`、`$12.30`）。
- 颜色：角色名 text.base，数字 muted。
- 异常角色整行 warning。示意规则，满足任一条即可：
  1. 有某次调用用满了步数上限；
  2. `sess` ≥ 5，且 ≥ 其他角色最高值的 2 倍；
  3. tokens ≥ 500k，且 ≥ 其他角色最高值的 2 倍；
  4. cost ≥ $1.00，且 ≥ 其他角色最高值的 2 倍。

  绝对下限用来避免小会话或 engineer 正常的高用量被误报。阈值是示意值，待实测后调整。

`anomaly` 状态：explorer 一行为 warning，对应的 Delegations 行因 `~26/30` 超过 80% 也为 warning：

```text
Delegations (2 running)
engineer   Running edit…       ~33/80
  explorer Running grep…       ~26/30

Subagents (11 sessions · $2.00)
            sess  tok+cache      cost
architect      1        38k     $0.15
engineer       1       290k     $0.44
explorer       9       640k     $1.41
```

### 5. Todo / Context

继续使用宿主原生实现，Crew 不复制、不替换：

- Todo 是 Root 自己的计划（例如 `[✓] 拆分侧栏改动`、`[•] 验收 engineer 证据`、`[ ] 整合并更新文档`）；Delegations 是已经派出去的执行。两者在数据上没有关联，原型的 Todo 示意数据也不复述 delegation 内容。
- Context 展示 tokens、使用百分比和费用。Root 的费用包含整个会话族，所以 `$ spent` 不低于 Subagents 合计。

### 6. Footer

保留原生 `path:branch`，超长时按原生 `truncateFilePath` 截断，例如：

```text
~/opencode/opencode-crew:main
```

主 worktree 的 clean 状态和 commit 不属于原生 footer 契约，不在第一版额外加入。

## 数据来源与口径

类型依据：`node_modules/@opencode/plugin/dist/tui/context.d.ts`（TUI `Data` / `UI`）和 `node_modules/@opencode/client/dist/promise/generated/types.d.ts`（`SessionInfo`、`SessionMessageAssistant`、`TokenUsageInfo`、`AgentInfo`）。

| 内容 | 来源 | 口径与边界 |
| --- | --- | --- |
| 会话族、agent、嵌套关系 | 宿主 `data.session.family` + 事件；`active()` 校准；`session.get` 补 parentID | Delegations 的 running 由 `/active` 快照校准：有运行中成员时每 15s，空闲时每 60s 只探测 active；`session.created` / `session.execution.*` 事件立即更新，没有事件的成员由校准发现。宿主的 `family` 缓存不保证包含本轮新派出的嵌套子会话，因此未知 session 只做一次 `session.get` 归属核对并缓存。快照首次返回前退回 `time.busy`/`idle` 水位，再退回 `status` |
| 步数上限 | `data.location.agent` 的 `AgentInfo.steps` | 来自 `agents/*.md` 的 `steps` 和配置 `options.steps`，由 [`src/index.ts:88`](../src/index.ts#L88) 写入；当前 architect 40、engineer 80、explorer 30、reviewer 30 |
| 已用步数 | 运行中会话 `client.message.list({ type: "assistant", limit: 100 })` | OpenCode 按 runner 的逻辑 step 计数（[`runner/llm.ts`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/session/runner/llm.ts)），重试、压缩、截断续写会让一个 step 对应多条消息，TUI 只能用子会话 assistant 消息数近似，显示为 `~N/M`；同一会话跨轮复用时消息数继续累计，因此可能长期超过单轮上限；80% 与用满的判定也基于该近似值 |
| 子会话数 | 会话族里的 `SessionInfo.agent` | 按会话去重，不数工具调用；标题的 N 为各角色合计。`crew_task` 的 tokens / cost 并入 engineer，但不计入子会话数 |
| tokens | `SessionInfo.tokens`；`crew_task` 快照的消息 tokens | Subagents 显示 `工作 + cache.read`；工作 token = input + output + reasoning + cache.write，缺失的消息跳过；异常阈值只用工作 token |
| 费用 | `data.session.cost(childID)`；运行中会话用 `SessionInfo.cost` | 只算该子会话；传 Root ID 时会累加会话族中已知的会话，因此 Context 的 `$ spent` 不低于 Subagents 合计 |
| 当前活动 | 运行中会话最新 assistant 消息的 `content` | 取状态为 `streaming` / `running` 的 tool，或尚未完成的 reasoning，按 `busyLabel` 规则生成文案 |
| 卡住 | 运行中会话的 `SessionInfo.time.updated` | 运行中但长时间未更新时提示，是启发式判断，不是宿主给出的确定结论 |
| 提醒区权限 | `data.session.permission.list(taskSessionID)` | 任务会话 ID 来自 Server 快照；只用于提示和跳转，不直接授权 |
| VCS 分支、路径 | 原生 footer / `data.location.vcs` | Crew 不替换 footer |
| Todo、Context | 宿主原生功能 | 不重复实现 |
| `crew_task` 受管任务 | Server 提供的只读快照 | 不直接读取 ledger，不调用模型工具冒充 UI 查询 |

`crew_task` 快照应由 Server 按当前 `ownerSessionID` 隔离，并显式白名单输出 `taskID`、任务会话 ID、directory、scope 数量、state、lifecycle、观察到的会话状态、check 和展示用 next action。不要把完整 registry、其他 Root 的任务或内部锁状态传给 TUI；TUI 不读 ledger。

工程师的 Report 六态仍需遵守现有语义：`progress` / `waiting` 不是完成，`ready` 需要证据，`blocked` / `failed` 需要人介入，`dropped` 不进入验收。`ready` 仅表示工程师声明可以验收，不等于测试通过、Root 已验收或可以整合，不使用绿色。

## 视觉与交互

- 字符网格：侧栏 42 列，左右内边距 2 列，内容区 37 列；单一字号，层级只靠粗体和颜色区分。
- 使用宿主 `background.raised.base`、`text.base` / `text.muted` / `text.faint` 和 feedback 的 info / warning / error，不定义第二套主题系统，不用绿色。
- 无卡片、无渐变、无 chip、无大标题；分区依靠空行和粗体标签，标题括号内的计数用 muted。
- 超长内容用省略号截断；内容超高时只垂直滚动，不出现横向滚动，标题和 footer 固定。
- 第一版只读：提醒区只提供跳转，不增加 start / stop / approve / merge 等侧栏操作。

## 工程边界

当前不拆第二个 `opencode-crew-ui` 插件。建议在同一个包和版本中增加独立 TUI 入口：

```text
src/index.ts              Server：角色、命令、任务、ledger
src/tui/index.tsx         TUI：注册 sidebar.content prepend
src/tui/alerts.tsx        提醒区
src/tui/delegations.tsx   Delegations 区块
src/tui/subagents.tsx     Subagents 区块
src/tui/view-model.ts     只读展示类型、统计口径与异常规则（便于单测）
```

Server 不依赖 Solid / OpenTUI；TUI 不导入 ledger 实现或直接访问任务文件。只有 UI 未来需要支持非 Crew 任务、多个前端或独立发布时，才基于稳定的公共只读 API 拆成伴随插件。

## 第一版验收标准

1. Crew 内容插入后，原生标题、Todo、Context 和 footer 仍存在，顺序不变。
2. `active`、`idle`、`blocked`、`stall`、`overflow`、`long`、`anomaly` 七个状态都有明确布局：无内容的提醒区和 Delegations 整块隐藏，Subagents 在 `idle` 时仍显示，超高时只垂直滚动，超长内容截断。
3. 角色用量按 `sess`（原生子会话数，按会话去重）计数；Subagents 的 tokens 显示工作 token + cache.read（工作 token = input + output + reasoning + cache.write），异常阈值只用工作 token；费用按子会话 `data.session.cost` 计算；异常规则集中在 `view-model.ts` 并有单测。
4. 步数显示为 `~N/M` 近似值，上限取自 agent 的 `steps`；80% 与用满时显示 warning。
5. `crew_task` 的任务数据只来自 Server 按 `ownerSessionID` 隔离的快照，TUI 不直接读取或修改 ledger。
6. `ready` 不被呈现为测试通过或验收完成，界面不使用绿色。
7. 侧栏不提供授权、调度、worktree 清理或整合操作。

## 未决事项

- ~~插件首次渲染时会话族数据可能不完整~~ 已绕开：Delegations 不再依赖宿主的 `family` / `message` 缓存渲染运行中的会话。运行中的会话由 step/tool/usage 等事件在本地 250ms 窗口内合并更新（不逐 delta 发请求），另有 15s 校准从 `/active` 取 liveness、`message.list` 补齐漏掉的事件；空闲时 60s 只探测 `/active`，不拉消息。宿主的 `session.sync(rootID, {children:true})` 仍保留为冷启动补齐（只在其缓存 miss 时生效）。
- 宿主的 `session.created` 会把 `session.message:<id>` 标记为已完成但不拉取历史，之后 `message.sync` 直接 no-op；因此本轮新建的子会话在宿主 store 里可能只有零散事件行。侧栏对缺失基线只做一次定向 `message.list` 补取，按消息 id 合并，失败留到下一次校准重试；非运行会话仍读宿主 store。
- 服务端 `/session/active` 快照本身可能短暂包含刚结束的会话（重连时尤其明显），客户端也可能漏收终止事件；sidebar 在 15s（空闲 60s）校准中发现 active 消失时补取最终快照并保留，失败则保留待校准标记重试，不退回旧 host 缓存。若上游能保证 active 快照与终止事件一致，可去掉 busy/idle 兜底。注意 `server.connected` 是用 `reconcile` 覆盖 active 表（会删除快照外的 key），问题在快照内容或事件丢失，而非“只增不减”。
- `crew_task` 会话不在 Root 会话族里，尚未核实 `data.session.get` / `message.list` / `permission.list` / `cost` 能否直接读到它，是否需要先 `sync(taskSessionID)`。
- 精确步数需要 Server 另外按 runner step 计数并提供；在此之前只显示近似值。
- 异常阈值（80% 步数、无输出时长、sessions / tokens / cost 的倍数和下限）待实测调整。
