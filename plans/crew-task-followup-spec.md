# Crew 工具接口与提示配置后续加固 Spec

日期：2026-11-01。状态：**提议，尚未实施。本文只整理后续改进建议，不授权修改源码、测试、提示词、ledger、worktree 或服务。**

基线：`0c08661cd7f15c60bb01a040b5bd661d91185ece`（`feat: clarify crew task contracts and configure engineer rules`）。

## 1. 授权与范围

用户要求把上一轮验收后提出的建议整理成 spec 文档，本文因此只新增文档，不改变现有实现。

前一轮已完成并提交的内容见 [Crew 工具接口提示与环境规则配置化 Spec](crew-task-interface-and-prompt-spec.md)：冻结三个 `crew_task_*` 的 description、结构化错误、baseline details、`engineerInstructions` 单一注入点、默认提示去机器特定化，以及文档和构建产物同步。

本文讨论的是该提交之后仍然存在的验证缺口和低风险加固项。各项实施仍需单独授权；本文不因“建议”自动获得实现授权。

## 2. 现状与问题

| 事实 | 影响 | 本文处理 |
|---|---|---|
| 真实 host 验证仍为 `NOT_TESTED` | 无法证明实际工具列表、配置注入和热更新行为符合文档 | 4.1 给出 host 验证清单和证据要求 |
| `test/crew.test.ts` 曾断言 `agents/root.md` 中不存在的旧文案 | 提示词改一句话就可能让无关测试变红，测试与文档漂移不易发现 | 4.2 改为结构/契约断言 |
| `src/tasks.ts:147` 在未配置 engineer 模型且会话无模型时返回 `HOST_ERROR` | 调用方会按宿主故障处理，nextAction 指向“人工调查”而非“补配置” | 4.3 新增明确错误码 |
| `src/tasks.ts:110-121` 中 `caller()` 对非 Root 抛 `HOST_ERROR`，再由 `identity()` 特判为 `FORBIDDEN_CALLER` | 错误语义依赖一个容易漏改的转换点 | 4.4 直接抛 `FORBIDDEN_CALLER` |
| `src/model-family.ts:73` 把每个配置项直接拼成 `- ${item}` | 配置项含换行或 Markdown 标题时会破坏 `## 项目补充规则` 小节结构 | 4.5 拒绝含换行的配置项 |
| 本次实现更新了 `dist/index.js`，但 `package.json` 仍为 `0.1.0` | 若对外发布，版本、包内容和变更记录没有对应收尾 | 4.6 明确发布前检查 |
| `plans/worktree-stage1-closeout-spec.md` 仍是未跟踪文件 | 可能被误提交或误删 | 4.6 要求确认归属 |

## 3. 目标与非目标

### 3.1 目标

1. 用真实 host 证据关闭前一轮 spec 的唯一未验证项。
2. 降低提示词、测试和文档之间的漂移成本。
3. 让“缺少模型配置”这类可修复问题不再伪装成宿主故障。
4. 减少 `FORBIDDEN_CALLER` 的隐式转换路径。
5. 防止 `engineerInstructions` 的多行内容破坏注入结构。
6. 明确发布前的版本、打包和未跟踪文件收尾。

### 3.2 非目标

- 不新增在线 `crew_task_*` 工具，不增加 release/close/cleanup 接口。
- 不改变 key 全局唯一、owner 绑定、容量最多 2、closed 历史、stop 至多一次、`processSafety:"unconfirmed"`、`canCleanup:false`、`canIntegrate:false`。
- 不改变 `permission.assert` 的拒绝传播方式。
- 不实现 slot 调度器，不检测或安装 `slot`，不自动选择临时目录。
- 不把 worktree 或 scope 变成操作系统沙箱。
- 不自动清理、合并、提交或推送任何任务成果。

## 4. 分项设计

### 4.1 P0：真实 host 验证

本项只验证，不先改代码。验证环境必须是独立 host 或私有夹具，不得触碰真实 ledger、真实 worktree 或正在运行的业务 engineer。

| 编号 | 验证内容 | 通过标准 |
|---|---|---|
| V1 | 工具列表暴露新 description | 三个 `crew_task_*` 的实际 description 包含冻结文本的关键契约：closed 旧 key 不重投、容量不自动释放、status 空结果、stop unconfirmed |
| V2 | 配置注入位置 | 配置带唯一标记的 `engineerInstructions` 后，原生 engineer 会话与 `crew_task_start` 创建的 engineer 会话的 system 都含该标记且只出现一次；其他角色不含；任务包不出现该标记 |
| V3 | 热更新边界 | 修改配置后，新建 engineer 会话收到新规则；运行中的旧 engineer 不中断，且其 system 不被原地改写 |
| V4 | 默认可移植性 | 不配置 `engineerInstructions` 时，engineer system 和 `crew_task_start` 任务包都不含 `slot` 或“禁止使用 `/tmp`”，通用安全规则仍在 |

证据至少包含：host 版本、配置 diff、涉及会话 ID、时间戳、关键输出片段。每项标记 `PASS`、`FAIL` 或 `NOT_TESTED`，不得用单元测试结果冒充 host 结果。

**关键风险**：如果 OpenCode 的热更新只重载配置、不重新执行插件 `setup`，那么 `engineerInstructions` 的修改不会进入新会话。此时必须修正 README、`agents/root.md` 第 5 节和前一轮 spec 第 8.2 节的表述，明确实际生效条件，不能保留“无需重启即生效”的笼统说法。

### 4.2 P1：测试改为结构断言

前一轮曾把 `test/crew.test.ts` 中对不存在文案的断言替换为当前文案。这只解决了当下红灯，没有解决漂移根因。

建议把测试目标从“正文包含某句话”改为“结构符合契约”：

1. 未知模型时，`agent.system` 等于 `splitRoleBody(body).base`。
2. GPT 模型注入 GPT 附录，Claude 模型只注入 Claude 附录，未知模型不注入附录。
3. `engineerInstructions` 只出现在 engineer system，位置在共享正文和模型族附录之后，且只出现一次。
4. 默认配置下 engineer system 与任务包不含机器特定规则。
5. 三个工具 description 可以继续断言冻结文本的关键词，因为这些文本本身就是冻结契约；但不要断言角色正文中的非契约句子。

实施后仍需 `bun test` 全绿；本项不改变生产行为，属于测试可维护性改进。

### 4.3 P1：新增 `MODEL_NOT_CONFIGURED`

当前 `src/tasks.ts:147`：

```text
if (!existing && !(configuredModel ?? owner.model)) return failure('HOST_ERROR')
```

建议改为稳定错误码 `MODEL_NOT_CONFIGURED`，语义为“没有可用于 engineer 的模型”。

建议文案：

```text
message: 未配置 engineer 模型，且当前 Root 会话没有可继承的模型，本次未创建会话。
nextAction: 配置 options.models.engineer，或确保调用方 Root 会话已有模型后重新派发；不要把它当作宿主故障。
```

约束：

- 检查必须仍在 `ledger.reserve` 之前，确保不写 ledger、不创建会话、不 prompt。
- 不改变同 key 重放路径：已有记录的重放不需要模型检查。
- 需要同步 `ERROR_INFO`、错误码类型、前一轮 spec 第 6.2 节、测试和 README 中的错误契约说明。
- 这是一次错误契约变更；如果消费方依赖 `HOST_ERROR`，应作为独立提交并在变更说明中标注。

验收：无模型时返回 `ok:false`、`error.code === 'MODEL_NOT_CONFIGURED'`、nextAction 指向配置；ledger 无新增记录；零 `session.create`、零 `session.prompt`。

### 4.4 P2：`FORBIDDEN_CALLER` 直接抛出

当前 `caller()` 对非 Root 抛 `HOST_ERROR`，`identity()` 再根据 `tc.agent` 特判：

```text
try { return await caller(tc) } catch(e) { return {error:tc.agent!=='root' ? 'FORBIDDEN_CALLER' : errorCode(e)} }
```

建议：

- 把 `FORBIDDEN_CALLER` 加入 `TaskRegistryErrorCode`。
- `caller()` 在 `tc.agent !== 'root'` 时直接抛 `TaskRegistryError('FORBIDDEN_CALLER')`。
- `identity()` 简化为 `try { return await caller(tc) } catch(e) { return { error: errorCode(e) } }`。

验收：三个工具在非 Root 调用时均返回 `FORBIDDEN_CALLER`，不出现宿主故障文案，零 ledger 写入、零会话创建、零中断。权限检查顺序和 `permission.assert` 传播保持不变。

### 4.5 P2：拒绝含换行的 `engineerInstructions`

当前 `composeProjectInstructions` 对每项输出 `- ${item}`。配置项若包含 `\n` 或 `\r`，可能插入额外 Markdown 标题或伪造小节。

建议在 `src/index.ts` 的 `instructions()` 校验中直接拒绝原始配置项：

```text
if (/[\r\n]/.test(item)) fail(`options.engineerInstructions[${index}] 不能包含换行`)
```

理由：

- 保持“每项一条规则”的结构稳定。
- 比自动拆行再缩进更简单，也不会悄悄改变配置者原意。
- 现有长度限制（32 项、每项 2000 字符、总计 8000 字符）不变。

验收：原始配置项在首尾或中间含换行时，均在注册任何 agent/tool 前失败；合法单行数组与省略配置行为不变；README 补充该限制。

### 4.6 P2：发布与仓库收尾

发布前检查：

1. **版本**：决定是否把 `package.json` 从 `0.1.0` 提升；若发布，补对应变更记录和 tag，不把未发布改动混入旧版本说明。
2. **打包内容**：在独立 fixture 执行 `npm pack --dry-run --json`，确认 `dist/index.js`、`agents/*.md`、双 README 和 `THIRD_PARTY_NOTICES.md` 在包内；不要在任务主 worktree 触发 prepack 副作用。
3. **构建产物**：`dist/index.js` 只由 `bun run build` 生成，不手工编辑。
4. **未跟踪文件**：确认 `plans/worktree-stage1-closeout-spec.md` 的归属，再决定提交、忽略或删除；不得因清理工作区而误删他人方案。

## 5. 验收矩阵

| 项目 | 证据 | 门禁 |
|---|---|---|
| 4.1 host 验证 | host 版本、配置、会话 ID、输出片段 | V1–V4 全部 `PASS`；`FAIL` 或 `NOT_TESTED` 均为未完成，须继续验证或由用户明确接受对应缺口 |
| 4.2 测试结构断言 | 修改后的测试与全量 `bun test` | 全绿，且不再断言非契约正文 |
| 4.3 `MODEL_NOT_CONFIGURED` | 新测试红灯与绿灯输出、ledger 无写入 | 错误码、nextAction、零副作用均满足 |
| 4.4 `FORBIDDEN_CALLER` | 三工具非 Root 测试 | 返回码正确，零副作用，权限传播不变 |
| 4.5 换行校验 | 非法配置在注册前失败 | 合法配置不受影响，README 同步 |
| 4.6 发布收尾 | `npm pack --dry-run --json` 输出、版本决策 | 包内容完整，未跟踪文件归属明确 |

行为变更继续遵循先写测试取得有效红灯，再实现取得绿灯；语法、导入或夹具错误不算有效红灯。

## 6. 不变量

- 三个在线工具的输入、权限检查和拒绝传播方式不变。
- key 在 active 与 closed 全历史唯一；requestDigest 包含 owner。
- active 容量最多 2；idle、error、stop 不释放预留。
- closed 记录永久保留；旧 key 重放零 create/prompt/interrupt。
- stop 至多一次中断请求；closed stop 零 interrupt；`processSafety` 始终为 `unconfirmed`。
- 离线维护仍是 plan/apply 两阶段，不新增在线 release/close/cleanup。
- 默认配置不依赖 `slot`，不包含机器特定的 `/tmp` 禁令。

## 7. 风险与开放问题

1. **热更新假设未证实**：4.1 的 V3 是前置验证；若结论为“不重跑 setup”，相关文档必须降级表述。
2. **新增错误码的兼容性**：`MODEL_NOT_CONFIGURED` 会改变调用方可见契约，需要确认是否有外部消费者依赖 `HOST_ERROR`。
3. **测试结构化的边界**：冻结的工具 description 可以断言关键词，但角色正文不应成为测试夹具；需要避免从“完全不测文案”滑到“测了所有文案”。
4. **换行策略**：拒绝换行是最小改动；如果项目确实需要多行规则，应另立格式契约，而不是在拼接时隐式处理。
5. **发布时机**：本文不决定版本号，也不授权发布；4.6 只列出检查项。

## 8. 建议实施顺序

1. 先完成 4.1 的真实 host 验证，尤其是热更新是否重跑 `setup`。
2. 根据 V3 结论修正文档，再决定是否调整 `engineerInstructions` 的生效说明。
3. 做 4.2、4.4、4.5 三项低风险加固，分别提交，保持测试红绿证据。
4. 把 4.3 作为独立错误契约变更处理，同步 spec、测试和 README。
5. 发布前执行 4.6 的版本、打包和未跟踪文件检查。

## 9. 完成标准

- V1–V4 真实 host 验证全部 `PASS`；每项均有结论，未验证项不被单元测试掩盖。任一项为 `FAIL` 或 `NOT_TESTED` 时不得宣称整体完成，除非用户明确接受对应缺口。
- 测试不再依赖角色正文中的非契约句子。
- 缺少模型配置时返回可操作的专用错误，且零副作用。
- 非 Root 调用直接返回 `FORBIDDEN_CALLER`。
- `engineerInstructions` 的多行内容不会破坏注入结构。
- 发布前包内容、版本和未跟踪文件均有明确结论。
- 所有行为变更都有有效红灯与绿灯证据，全量测试、build 和 `git diff --check` 通过。
