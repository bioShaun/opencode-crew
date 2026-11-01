# Crew 工具接口提示与环境规则配置化 Spec

日期：2026-11-01。状态：**提议，尚未实施。本文只冻结信息放置、工具说明、错误反馈和 engineer 项目补充规则的设计，不授权修改任务、ledger、worktree 或服务。**

## 1. 背景与目标

`crew_task_*` 的调用契约目前分散在 Root prompt、README 和实现中，而三个工具的实际 description 很短，普通失败又统一返回“请检查状态并人工调查”。模型在调用点看不到完整前提，出错后也得不到具体下一步。

本次调整按“谁需要这条信息”拆分：

- Root prompt 只保留影响调度与授权决策的规则。
- 工具 description 保留调用时需要的参数、前提和效果边界。
- 工具错误响应说明发生了什么、下一步做什么，以及是否禁止重试。
- `docs/dsh-mapping.md` 保留 Ticket / Session / Assignment 等概念和设计原因。
- 机器或团队特有的 slot、临时目录等规则不进入插件默认提示，由使用方显式配置。

目标是让信息靠近使用点并随实现同步演进，**不以减少每轮 token 为承诺**；工具 description 通常同样会进入模型上下文。

## 2. 已核对的现状

- `src/index.ts:90` 调用 `registerTasks()`；三个工具注册于 `src/tasks.ts:133-136`。
- 当前 description 只有一句概要，没有完整说明幂等、容量、owner、closed 记录和 stop 边界。
- `src/tasks.ts:15` 的 `failure()` 丢弃具体错误语义，统一返回通用人工调查提示。
- `agents/root.md:65-70` 已接近目标长度，但“原任务结案后再派”没有明确说仍必须换 key。
- `docs/dsh-mapping.md:17` 同样容易被理解为结案后能够复用旧 key；实现会在 active 与 closed 全历史中查找 key，旧 key 不会重新投递。
- `src/tasks.ts:92` 固定注入“禁止使用 `/tmp`”和 slot audit/status/提交规则。
- `agents/engineer.md:15` 也固定包含 `/tmp` 和“按项目规定提交重活”。因此只修改 `crew_task_start` 任务包不能覆盖原生 engineer 委派。
- 插件没有提供通用 slot 调度器，也不能假定目标机器存在 `slot` 命令。

## 3. 范围与不变量

### 3.1 纳入

1. 扩充三个工具的 description。
2. 为工具失败增加稳定、可执行且脱敏的错误反馈。
3. 修正 Root 与 dsh 文档中的 retry/key 表述。
4. 新增可选 `engineerInstructions` 配置，并移除默认提示中的机器特定规则。
5. 更新 README、测试和构建产物。

### 3.2 不改变

- 三个工具的输入参数、权限检查和权限拒绝传播方式。
- 全局 key 永久唯一、requestDigest 包含 owner、active 容量最多为 2。
- active/closed 查询边界、stop 至多一次 interrupt、closed stop 零 interrupt。
- `processSafety:"unconfirmed"`、`canCleanup:false`、`canIntegrate:false`。
- worktree/scope 不是 OS 沙箱；stop、idle、error 不释放预留。
- 离线维护仍是 plan/apply 两阶段，不新增在线 release/close/cleanup 工具。

### 3.3 非目标

- 不实现 slot 调度器，不检测、安装或自动执行 `slot`。
- 不自动选择临时目录，不修改宿主或子进程环境变量。
- 不引入通用角色配置系统、在线维护、自动重试或进程安全管理。

## 4. 信息放置契约

| 信息 | 权威位置 | 要求 |
|---|---|---|
| 何时使用 `crew_task_*`、授权绑定 Root、retry 必须换 key | `agents/root.md` 第 6 节 | 保持 3～4 条决策规则，不复制完整参数文档 |
| Report 状态、context 不扩大 Scope、热更新不打断 engineer | `agents/root.md` 第 2、4、5 节 | 继续作为通用规则，不移入工具 description |
| 参数、前提、幂等、容量、status/stop 效果 | `src/tasks.ts` 中各工具 description | 与注册及执行代码同文件演进 |
| 错误原因、下一步、重试边界 | `src/tasks.ts` 的结构化错误及简短 content | 不让 Root 预先记住所有异常分支 |
| Ticket / Session / Assignment 对照与设计原因 | `docs/dsh-mapping.md` | 面向人解释，不复制易漂移的字段级错误文案 |
| 安装与配置示例、离线维护入口 | `README.md`、`README.zh-CN.md` | 中英文同步，示例不宣称插件提供 slot |

文档中的操作语义若与代码冲突，以修正文档或另行改约为处理方向，不保留两套不同契约。

## 5. 工具 description 冻结文本

实现使用以下中文文本；仅允许为保持代码格式而调整换行，不得削弱边界。

### 5.1 `crew_task_start`

```text
在手工准备的独立 detached worktree 中启动 engineer 会话并一次性投递任务。
前提：只能从主 worktree 根目录的 Root 会话调用；主、目标 worktree 均干净，目标属于同一仓库且不与主 worktree 嵌套，二者 HEAD 与 baseline 均为同一完整 commit OID。
参数：key 在项目的 active 与 closed 任务历史中全局唯一；directory 为绝对路径；scope 为 1～32 个精确相对文件路径或以 / 结尾的目录前缀，不支持 glob；goal、acceptance、check 是任务文本，不作为插件 shell 命令执行。
幂等：同一 Root 会话中，相同 key、相同输入返回原记录，包括已结案记录，不重新创建会话或投递；不同输入或其他 Root 复用 key 会冲突。重试必须换新的 key。
容量：最多保留 2 个未结案写入预留；idle、出错和 stop 均不释放，只能通过离线维护结案释放。
边界：worktree 和 scope 不是操作系统级隔离。
```

说明：`directory` 可以按现有行为接收规范化前的绝对别名，存储时使用 canonical path；description 不额外声称拒绝所有别名。

### 5.2 `crew_task_status`

```text
查询当前 Root 会话发起的任务，不能查询其他 Root 的任务。
不传 taskID：只列出当前 Root 的未结案任务。传 taskID：可返回当前 Root 发起的对应未结案或已结案记录；任务不存在或不属于当前 Root 时成功返回，但不含 task 字段。
```

### 5.3 `crew_task_stop`

```text
对当前 Root 的未结案任务最多发送一次中断请求；重复调用不会再次中断。已结案记录直接返回，不发送中断。
返回只说明请求结果，不能证明会话或进程树已经停止，processSafety 仍为 unconfirmed，也不会释放预留。任务不存在或不属于当前 Root 时拒绝，不要重试。
```

## 6. 错误响应契约

### 6.1 结构

普通工具拒绝保持 `ok:false`，并将现有 `error.code` 稳定分类扩展为：

```text
error: {
  code: string,
  message: string,
  nextAction: string,
  details?: object
}
```

- `message` 说明失败事实；`nextAction` 必须是调用方可执行的动作或明确的停止动作。
- 工具级 `content` 给出与结构化错误一致的简短摘要和下一步，不与 `output.error` 矛盾。
- 不返回原始异常 body、环境、凭证、任务 goal/acceptance/check 或其他 Root 的任务内容。
- `permission.assert` 的拒绝仍按现有方式向宿主传播，不转换成 `ok:true`，也不吞掉宿主反馈。
- 已预留但启动结果不明的任务继续保留预留。错误文案不得建议通过换 key 来绕过调查，也不得把同 key 幂等重放描述成 retry。

### 6.2 分类与下一步

| code | 必须传达的下一步 |
|---|---|
| `CAPACITY_RESERVED` | 已有 2 个未结案预留；停止继续派发，并告诉用户需按现有维护契约执行离线 close 的 plan/apply。不得删除 registry/锁，不得把 stop 当释放 |
| `IDEMPOTENCY_CONFLICT` | key 已被不同输入或其他 Root 使用；不要原样重试。若确为新 Assignment，使用新 key，并先排除旧任务仍有未确认副作用 |
| `WRITER_RESERVED` | directory 已被历史任务占用，包括 closed 任务；选择新的规范 worktree，不复用、改名绕过或删除历史 |
| `DIRTY_PRIMARY` | 主 worktree 不干净；不要自行 clean/reset，先由用户处理或明确保留现有修改 |
| `DIRTY_WORKTREE` | 目标 worktree 不干净；不要自行清理成果，换干净目标或由用户处理 |
| `BASELINE_MISMATCH` | 不要启动；按 details 核对 baseline、主 HEAD、目标 HEAD 或当前 period baseline，准备一致的新目标。不得缩写 OID 或自动 checkout |
| `PROJECT_MISMATCH` | 核对调用 cwd、Root 身份及目标是否为同仓库的独立 registered detached worktree；不要原样重试 |
| `INVALID_SCOPE` | 修正 scope；使用精确相对文件或 `/` 结尾目录前缀，不用 glob、绝对路径、`..`、symlink 逃逸或禁止路径，不得自行扩大 Scope |
| `INVALID_INPUT` | 按工具 schema 修正参数；不要加入未定义字段 |
| `FORBIDDEN_CALLER` | 只能由 Root 调用；当前调用方不要重试 |
| `TASK_NOT_FOUND`（新增，供显式 stop 未命中使用） | 任务不存在或不属于当前 Root；不要重试，也不要尝试操作其他 Root 的任务 |
| `SESSION_MISMATCH` / `START_UNCONFIRMED` | 保留预留与现场，用 status 获取记录并人工调查；不要换 key 重派，不要声称未创建会话或没有 orphan |
| `REGISTRY_LOCKED` / `REGISTRY_INVALID` | 停止写操作并人工调查；不得删锁、删库或自动抢占 |
| `HOST_ERROR` | 保留现场并人工调查；不要假定失败没有副作用，不要自动重派 |

`status` 显式查询未命中继续按现有兼容行为返回 `ok:true` 且不含 `task`，不新增跨 owner 存在性探测。`stop` 显式未命中由当前笼统的 `HOST_ERROR` 改为 `TASK_NOT_FOUND`，避免把正常所有权边界误报成宿主故障。

### 6.3 Baseline details

`BASELINE_MISMATCH` 不能只给一对含糊的 expected/actual。按实际失败点提供已取得的字段：

```text
details: {
  baseline?: string,
  primaryHead?: string,
  worktreeHead?: string,
  ledgerBaseline?: string,
  reason: "invalid_oid" | "unknown_commit" | "primary_head" |
          "worktree_head" | "ledger_baseline"
}
```

只包含成功读取的完整 OID；读取失败时省略对应值，不伪造 actual。details 不包含 Git stderr 原文。

## 7. Retry 与文档修正

- `agents/root.md` 第 6 节明确写成：**retry 是新的 Assignment，必须使用新 key；即使原任务已 closed，旧 key 仍只会重放历史记录。**
- `docs/dsh-mapping.md` 的 retry 定义同步修正，不再使用可被理解为“结案后可复用 key”的省略表述。
- Root 第 6 节保持简短，不加入各错误码的处理表。
- dsh 文档继续解释概念，不变成第二份工具 description。

## 8. `engineerInstructions` 配置

### 8.1 配置形状与默认值

在现有插件 options 中新增一个可选顶层字段：

```jsonc
{
  "options": {
    "models": { "engineer": "provider/model" },
    "steps": { "engineer": 80 },
    "engineerInstructions": [
      "临时和中间文件放在项目内，禁止使用 /tmp；子进程同样遵守。",
      "重活先执行 slot audit 和 slot status 并记录项目日志，再按项目规定通过 slot 提交。"
    ]
  }
}
```

- 默认值为 `[]`；省略配置时，默认 role system 和 `crew_task_start` 任务包均不得出现 `slot` 或“禁止使用 `/tmp`”。
- 值必须是非空字符串数组；去除首尾空白后不能为空。最多 32 项，每项最多 2000 字符，总计最多 8000 字符。
- 其他类型、未知 options 字段继续 fail fast；所有 options 和 role 输入验证完成后才注册 agent/command/tool。
- 配置文本是受信任的项目提示，不是插件执行的命令。插件不解析其中的命令、不授予权限、不安装依赖。
- 配置者必须确保所称工具和权限在目标环境真实存在。特别是当前 `agents/engineer.md` 默认 deny `execute`，仅配置 slot 文案不会赋予执行能力。

### 8.2 单一注入点

- 从 `agents/engineer.md:15` 删除固定 `/tmp` 和项目特定重活提交措辞，保留通用的真实验证及遵守任务/项目规则要求。
- 从 `src/tasks.ts:92` 的固定任务包删除“禁止使用 `/tmp`”和 slot 两句；其他 bind-only、安全、红绿和 Report 规则保持不变。
- 将非空 `engineerInstructions` 组成 `## 项目补充规则` 小节，追加到 **engineer role system**，位于共享正文和适用模型族附录之后。
- 不在 `crew_task_start` 任务包中再次注入这些配置，避免同一子会话重复出现。原生 engineer 与 `crew_task_start` 创建的 engineer 都从 role system 获得同一组项目规则。
- Root、architect、explorer、reviewer 不受该字段影响。
- 配置热更新只作用于后续新建会话；不得为应用新提示而中断正在运行的 engineer。Root 第 5 节和 README 的热更新说明同步泛化到该配置。

## 9. 实施映射

| 文件 | 改动责任 |
|---|---|
| `src/index.ts` | 验证 `engineerInstructions`；向 engineer system 合成传递项目补充规则；保持先完整验证后注册 |
| `src/model-family.ts` | 如需扩展 `composeRoleSystem`，以可选参数追加项目小节，保持既有模型族选择与调用兼容 |
| `src/tasks.ts` | 扩充三个 description；增加错误文案/nextAction 映射和必要 details；删除任务包中的机器特定规则 |
| `src/tasks-registry.ts` / `src/tasks-state.ts` | 仅在取得 baseline details 或 stop 未命中分类确有需要时扩展内部错误载体；不改变 ledger 状态机与预留语义 |
| `agents/root.md` | 修正新 key retry 表述及热更新措辞，保持第 6 节简短 |
| `agents/engineer.md` | 删除默认机器特定规则 |
| `docs/dsh-mapping.md` | 修正 retry/key 概念表述，其余概念章节保持 |
| `README.md` / `README.zh-CN.md` | 增加配置示例、默认无 slot 依赖、单一注入与权限边界；同步工具说明和离线 plan/apply 指引 |
| `test/tasks-tools.test.ts`、相关 v2/状态/配置测试 | 覆盖 description、错误、配置和零副作用回归 |
| `dist/index.js` | 实施验证后通过标准 build 更新，不手工编辑 |

## 10. 测试与验收

行为变更先增加针对目标行为的测试并取得有效红灯，再实现并取得绿灯；语法、导入或夹具错误不算有效红灯。

最低测试矩阵：

1. **description**：三个工具包含第 5 节的关键契约，尤其是 closed 旧 key 不重投、异 owner 冲突、容量不自动释放、status 空结果和 stop unconfirmed。
2. **容量与幂等错误**：`CAPACITY_RESERVED` 同时包含停止派发和离线 plan/apply；`IDEMPOTENCY_CONFLICT` 不建议原样重试；旧 key closed 重放仍零 create/prompt。
3. **baseline details**：分别注入主 HEAD、目标 HEAD、ledger baseline 不一致，断言 reason 和实际完整 OID；无敏感 Git stderr。
4. **所有权**：status 对其他 owner/不存在任务不泄露记录；stop 返回 `TASK_NOT_FOUND` 且零 interrupt；权限拒绝仍原样传播。
5. **未确认失败**：create/prompt 丢失、session mismatch 后错误不要求换 key 重派，预留保持，重复同输入仍不二次投递。
6. **默认可移植性**：未配置时，engineer system 与 start 任务包均无 slot 或 `/tmp` 禁令；通用安全规则仍在。
7. **配置注入**：配置后两种 engineer 路径的 system 均含项目补充规则，start 任务包不重复包含；其他 role 不含。
8. **配置校验**：非数组、空项、超限及未知字段在注册前拒绝；合法空数组与省略等价。
9. **既有安全回归**：容量、writer/cwd 历史、stop 至多一次、closed stop 零 interrupt、processSafety 和权限测试保持通过。
10. **输出最小化**：注入秘密异常正文，所有新增 message/nextAction/details/content 均不泄露。

实施后的标准门禁：

```sh
bun test
bun run build
git diff --check
```

若修改打包相关内容，再在独立 fixture 中执行 `npm pack --dry-run --json`，避免 prepack 污染任务主 worktree。真实 host 验证至少确认实际工具列表暴露新 description、配置后的新 engineer 会话收到项目补充规则，并且配置热更新没有中断旧 engineer；无法取得该证据时明确标记 `NOT_TESTED`，不以单元测试冒称 host 验证。

## 11. 完成标准

- 信息按第 4 节归位，Root 第 6 节仍为简短决策规则。
- 三个工具 description 与实现一致，retry 必须新 key 在代码提示和文档中无歧义。
- 普通错误提供稳定 code、具体下一步及必要脱敏 details，不再统一写成泛化人工调查。
- 默认安装不假定 slot 或 `/tmp` 禁令；项目可通过一个配置同时覆盖原生与 worktree engineer，且不重复注入。
- 不改变授权、容量、closed、stop、进程安全和离线维护边界。
- 全部测试、build、文档同步和适用的真实 host 验证完成；未验证项明确保留。
