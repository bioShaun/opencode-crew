# 读角色 external_directory 继承方案

状态：方案（context-only，不扩大 Mandate/Scope）。基线：`/project/glx/scripts/opencode-crew`，HEAD `314fbc3`；本地 `@opencode/plugin|schema|client` 均为 2.3.0。

**本方案只足以授权 §5 的 S1（仅写测试并取红灯）。不授权任何产品实现（`agents/*`、`src/*`、README、`docs/*`）、不授权旧测试改动、不授权 S0b。** 授权链见 §7。

## 1. 背景、已决定事项与边界

- 三个只读角色 `agents/{architect,explorer,reviewer}.md` 的 frontmatter 首条是 `{action:"*",resource:"*",effect:deny}`；`src/index.ts:64` 对它们整档替换 `agent.permissions`。`*` 匹配 `external_directory`，因此默认外部 read 被拒（R0 blocked，R1/R2 停止；`docs/role-permissions-review.md`、`docs/issue-10-host-probes.md:36`）。
- **用户已决定（不重开）**：全局无 external_directory 规则 → 读角色读 cwd 外普通文件 allow；全局 deny → deny（继承）；全局 ask → ask（继承）。
- **禁止**固定 `external_directory` allow；**禁止**新增 `* allow` 或任何补 allow 来“修绿”。其他最小权限不退化：architect 只写 `plans/`（相对 + `<cwd>/plans/**` 绝对词法路径）；explorer/reviewer 不写；三者无任意 shell、`execute`、`subagent`；reviewer 仅保留 `agents/reviewer.md:14-18` 的五条固定 git 命令。
- 边界：只涉及读角色；root（空策略保留宿主）与 engineer（追加 deny）语义不动。

## 2. 证据（限定措辞）

等级：A = 固定 tag v2.3.0 源码（Root 取得）；B = 本地 SDK 类型/声明，只证明 API 存在；C = 文档/计划/旧版本，仅线索；D = 本机观测。

| # | 陈述 | 等级 | 限制 |
|---|---|---|---|
| E2 | 规则选择：`agents.resolve(input.agent ?? session.agent)`，合并 session 级规则与已保存规则；agent 解析不到走 `missingAgentPermissions` | A | `missingAgentPermissions` 内容未读（U6）；不排除其他规则来源 |
| E3 | `evaluateInput`：规则 deny 早返回、**不触发** evaluate hook；否则算出 effect 后 `hooks.trigger('permission','evaluate',{sessionID, agent, action, resources, effect})` | A | hook 改写 effect 是否被采用**未证实**（U5） |
| E5 | 新建 agent 基线 `[* allow, read *.env ask, read *.env.* ask, read *.env.example allow]` | B（`node_modules/@opencode/schema/dist/agent.js:34-39`） | 宿主 runtime 是否据此创建 id 不存在的 agent，仍以观测为准 |
| E6 | `ctx.permission.hook('evaluate', cb)`；`PermissionEvaluation{sessionID, agent?, action, resources[], effect(可写), message?(可写)}`；`ctx.session.get({sessionID})` 返回 `SessionInfo`，其 `agent?` 可缺省 | B | `node_modules/@opencode/plugin/dist/promise/permission.d.ts:7-19`、`registration.d.ts:8`、`@opencode/client/.../generated/types.d.ts:3221-3229`。`tasks.ts:108` 已有 `ctx.session.hook` 同形先例 |
| D1 | **本机装配观测（Root 逐条 JSON 验收，`/project/tmp/opencode-crew-permission-s0/evidence/four-case/verified/case-{1..4}/events.ndjson`）**：无/有三角色空桩 × 无/有哨兵共四例，均 12 agents；initial 与 reload 的四角色完整权限数组相等。有哨兵两例：before 无三个 crew 角色；after 三角色存在但无哨兵；final 角色数组含全局 `crew_s0_sentinel` ask 及 scoped `external_directory` deny，均**紧随角色块之后**，其后是 browser deny / skill browser deny。无桩与有桩结果一致。加载 `dist/index.js` sha256 `aef8cb18…59f39` | D | 只说明“本机最终全局规则在角色块**之后**注入”；不等于 crew transform 的精确输入，**不宣称** P/Q/N 无条件成立；尚未证明 dist 与 src 一致（S5/S2 验收须对被测 dist 重跑） |

未证实项（不得当事实；后续门禁回答）：
- U2：`event.agent` 是否总带上。 U3：去掉 `* deny` 后宿主是否仍对模型隐藏被拒工具（只影响提示噪声）。
- U4：`setup` 中途失败时已注册的 transform/hook 是否残留。 U5：hook 把 effect 改严后宿主是否采用。
- U6：`missingAgentPermissions` 内容。 U7：reload 重放时 transform 收到新基线还是累积数组（D1 显示 initial/reload 最终数组相等，但不披露 crew 输入）。 U8：被测二进制与 v2.3.0 tag 一致性。

S0 状态：**装配观测 ready（D1）；R0 仍 blocked**。不再扩展 20 格矩阵，不再设计更多探针；“无桩拿不到全局”的假设已取消，D1 观测到全局规则在角色块之后出现。

## 3. 推荐路线（唯一）：写入时过滤 + evaluate guard（Route W）

仅靠 V2 规则数组无法同时做到“external_directory 继承”和“未知动作 fail-closed”：`*`/`?` 无否定，任何匹配 `external_directory` 的 deny 都会盖掉继承。且 D1 显示全局规则位于角色块之后，**宿主规则层任何 deny 都可能被全局尾部宽 allow 盖掉**，所以资源级 guard 是硬门禁，不是附加项。

### 3.1 做法

1. **Markdown 不改**。`agents/{architect,explorer,reviewer}.md` 的 `* deny` 保留，作为 guard 的**局部策略来源**（再加 architect 的绝对 plans 规则，即 `src/index.ts:66-70` 现有规则）。
2. **写入宿主 agent 规则时过滤**：`agent.permissions = [...宿主前缀, ...宿主块]`
   - 宿主前缀 = transform 回调里该 agent 当前的 `permissions`，**原样保留，不重排、不去重、不补规则**；
   - 宿主块 = 角色局部策略中**去掉 action 模式能匹配 `external_directory` 的规则**（即 `*` deny，及任何 `*`/`?` 能匹配它的 action 模式），并在块首为已知动作逐一加显式 deny（`shell edit execute subagent question webfetch websearch` 与角色 Markdown 里出现的具体 action 并集，**不含 `external_directory`**），其后是角色具体规则（read/skill/glob/grep/白名单/.env/edit plans/reviewer 五条 shell）。显式 deny 的作用只是让宿主工具过滤继续隐藏被拒工具（U3），**不承担安全**；
   - 无宿主前缀（transform 看到空数组）时**不补任何 allow**：结果是宿主默认（无匹配时 ask，E1 为 C 级），该情形属 R0 blocked，由 S5 真机记录，不靠代码修绿；
   - 幂等：若宿主块已作为连续片段完整出现在数组内（重放/累积），**不改动数组**；否则追加。不得为幂等而“先删同值再整体尾追”（那会按值重排宿主规则）。architect 绝对 plans 规则同理只出现一次。
3. **guard**：`setup` 中注册**一次** `ctx.permission.hook("evaluate", cb)`，**先于** `agent.transform` 注册；注册 reject 或 `ctx.permission.hook` 不是函数 → `setup` 抛错，此时尚无 crew 角色被注册（失败不留“有角色无 guard”）。回调规则：
   - `action === "external_directory"`：**完全不介入**（保留宿主 effect，路径边界由宿主默认与用户全局规则裁决，这是唯一常量）；
   - 其余 action：对 `resources` 的**每个**资源，用该角色**完整局部策略**（Markdown 全部规则 + architect 绝对 plans，`*`/`?` 通配、findLast、**无匹配 deny**，语义对齐 `test/crew.test.ts:182-185` 的 `wildcardEffect` 但无匹配取 deny）求值；`resources` 为空按单资源 `"*"` 处理；本地结果与宿主 `event.effect` 取更严（deny > ask > allow），多资源取最严；**绝不放宽**；若有收紧，可写 `event.message`；
   - 回调自身不得抛出；不放宽 deny/ask。
4. **身份**（见 §4.4）与 root/engineer 不动。

### 3.2 与“修改 frontmatter”比较

| | 过滤写入 + guard（推荐） | 改 frontmatter 删 `* deny` |
|---|---|---|
| 单一来源 | 保留：默认 deny 是 Markdown 字面规则，guard 直接用 | 丢失：guard 仍需代码常量“无匹配 deny” |
| 安全承担 | 全部由 guard 承担（D1 下宿主规则层不可靠） | 同左，无额外安全 |
| 改动面 | `src/index.ts`（+可选新模块）；不改 Markdown 提示与 loadRole 校验 | 额外改三份 Markdown 与既有静态断言 |
| 过滤谓词风险 | 谓词误判保留 `*` deny → 外部目录被拒（过严、可在 S5 观测，不越权）；误判丢掉不匹配规则 → 只影响工具隐藏 | 无 |
| 共同前提 | U5 hook 被采用；U5 不成立则两条路线都无法满足安全契约 | 同左 |

结论：**推荐过滤写入**，不更安全也不更宽，但改动更小、保留单一来源。不虚构 API：用到的只有 `ctx.agent.transform`、`ctx.permission.hook("evaluate")`、`ctx.session.get`（均 §2 E6 已核）。

### 3.3 其他路线（一句话）
- 固定 `external_directory` allow/ask/deny：违反用户决定，拒绝。
- 仅显式 deny 无 guard（旧路线 A）：D1 下被全局尾部宽 allow 盖掉，fail-open，拒绝。
- 在 hook 把规则 deny 改回 allow：E3 规则 deny 早返回不触发 hook，且禁止放宽，不可行。
- 用户空角色桩（旧路线 G）：D1 显示有无桩结果一致，不再需要，取消。

## 4. 契约

### 4.1 求值目标（前提：宿主前缀有 `* allow` 基线；无基线则外部 read 为宿主默认 ask，属 R0 blocked）

| 场景 | architect | explorer | reviewer |
|---|---|---|---|
| 全局无 external_directory 规则，读外部普通文件 | allow | allow | allow |
| 全局 `external_directory * deny` | deny | deny | deny |
| 全局 `external_directory * ask` | ask | ask | ask |
| 全局仅 deny `/outside/blocked/*` | blocked 下 deny，其余 allow | 同 | 同 |
| read `.env`/`*.env.*`（含 `/outside/.env`） | ask | ask | ask |
| read `*.env.example` | allow | allow | allow |
| edit `plans/a.md`、`<cwd>/plans/a.md` | allow | deny | deny |
| edit `src/a.ts`、`<cwd>/src/a.ts`、`/outside/plans/a.md` | deny | deny | deny |
| shell | deny | deny | 仅五条固定命令 allow，加参数/其他 deny |
| `execute`/`subagent`/`question`/未知 action | deny | deny | deny |
| 全局 shell*/edit*/`*` allow 追加在角色块之后 | 以上除 external_directory 外全部不变 | 同 | 同 |

### 4.2 资源级硬门禁（任一不满足不得验收）
- **HG1** reviewer：在全局 `shell * allow` 尾部下，shell 仍只有五条固定命令 allow；多资源中含任一非固定命令即 deny。
- **HG2** architect：edit 仅 `plans/**` 与 `<cwd>/plans/**` allow；explorer/reviewer edit 全 deny。**词法路径，非 symlink/`..` 隔离**（沿用 `docs/role-permissions-review.md` §4.4 已知限制，不在断言里宣称）。
- **HG3** 未知 action deny；`execute/subagent/question` deny；**env ask**（`.env`、`.env.*`），`.env.example` allow。
- **HG4** 不新增 `* allow`、不新增 `external_directory` 规则；guard 对 `external_directory` 不介入。
- **HG5** guard 永不放宽（宿主 deny/ask 不降级）。
- **HG6（后续，不阻止 S1 红灯）**：U5 hook 被采用的真机证据（S0b `permission.assert`，见 §6）。
- **HG7（后续）**：setup 失败清理（U4）；被测对象为 `dist/index.js`（D1 的 hash 之后须重核 dist 与 src 一致）。

### 4.3 配置装配（宿主块写入）
见 §3.1.2。规则来源仍是 Markdown + `src/index.ts:66-70` 的绝对 plans 规则；不新增 frontmatter 字段（`loadRole` 白名单 `description/mode/steps/permissions` 不变）。

### 4.4 身份与失败策略

1. **explicit `event.agent` 优先**：`event.agent` 为非空字符串时以它为准——属于 `architect|explorer|reviewer` 才 guard；其它合法 id（`root`、`engineer`、内置或第三方 agent）**不介入**，**不得**用 `session.agent` 覆盖（E2：宿主本身就以显式 agent 选规则；子角色调用的 session 可与角色不同）。
2. **缺 agent 才用 session**：`event.agent` 缺失/非字符串时 `await ctx.session.get({sessionID})`，取 `.agent`（可缺省）。命中读角色则 guard；是其它字符串 id 则不介入。
3. **无法识别**（`event.agent` 缺失，且 `session.get` 抛错 / 返回无 `agent` / `agent` 非字符串）：**不得 failopen**。保守策略：对非 `external_directory` 的 action，effect 提到至少 `ask`（宿主 deny 保持 deny，宿主 ask 保持 ask，宿主 allow→ask），并写 `event.message` 说明“无法识别调用角色”；`external_directory` 仍不介入；回调不抛。支持范围：仅覆盖经 `evaluate` hook 的请求；未经该 hook 的宿主路径（U5/U6 未证）不在保证内。
4. 影响面：仅当 session 读取失败/无 agent 时 root/engineer 会多出确认提示（可见、不静默破坏）；正常路径（显式 agent 或 session 有 agent）对 root/engineer 零影响。
5. **本方案唯一未决点（需用户新决策）**：对“无法识别调用方”是否接受 **ask 下限**（推荐，如上）还是 **deny**（更严，但失败时会直接阻断 root/engineer）。S1 测试只断言两种选择的公共不变量“结果不是 allow、external_directory 不介入、回调不抛”，**不预设选择**；S2 前须由用户定。

## 5. S1：单独 Assignment（仅 tests 红灯；Root 验收红灯输出后才可授权 S2）

### 5.1 文件范围
- **唯一允许新增**：`test/crew-read-role-policy.test.ts`（新文件）。
- **不得修改**：`src/*`、`agents/*`、`docs/*`、README、`package.json`、`test/setup.ts`、**所有既有测试（含 `test/crew.test.ts`、`test/tasks-tools.test.ts`、`test/tasks-tools-v2.test.ts`、`test/tasks-interface.test.ts`）**、`test/.work/**`（既有散落产物，忽略）。不得改既有测试断言或夹具来制造红灯。
- 不得导入不存在的实现模块；只通过既有入口 `../src/index.ts` 的 `plugin()` 方式加载（沿用 `test/crew.test.ts:8-12` 写法）。不引入 `@opencode/schema` 运行时导入：宿主基线在测试内联常量并注释出处 `node_modules/@opencode/schema/dist/agent.js:34-39`。
- 类型：`tsconfig.json` 的 `include` 为 `["src","test"]`、`strict:true`，新文件须通过 `bun run typecheck`（夹具用 `any`，同既有风格）。

### 5.2 真实已有夹具与需补的 API
既有 `test/crew.test.ts:13-32` 的 `fixture()` 只有 `agent.transform/reload`、`command.transform`、`tool.transform`、`session.hook/switchAgent/switchModel/prompt`；`:241-250` 的 `replayable()` 可捕获 transform 重放。三个任务夹具（`tasks-tools.test.ts:23`、`tasks-tools-v2.test.ts:36`、`tasks-interface.test.ts:49`）的 `ctx.permission` 只有 `assert`，没有 `hook`。新文件在**本地**复制并补：
- `ctx.permission = { hook: async (name, cb) => { hooks.push({ name, cb }); return { dispose: async () => {} } } }`；
- `ctx.session.get = async ({ sessionID }) => ...`（`sessions` Map；可配置“返回无 agent”“抛错”）；
- `seeds` 支持宿主基线前缀；`runs` 重放（同 `replayable`）；“全局追加在角色块之后”的 helper（对应 D1：基线 → 角色块 → 全局）与“全局在前”（`[...基线, ...全局]` 作种子）；
- 辅助 `hostEffect(agent, action, resource)`：findLast + `*`/`?` 通配 + 无匹配 ask（复制 `crew.test.ts:182-185` 的 `wildcardEffect`，注释声明它不是宿主求值器）；`decide(f, {agent?, sessionID, action, resources})`：先算宿主 effect（多资源取最严），再按序 `await` 所有 `evaluate` hook，返回最终 effect 与 message。**无 hook 时返回宿主 effect 原值**，使红灯表现为 `Expected "deny" … Received "allow"`，而非 TypeError。
- 全局夹具：`DENY_ALL`、`ASK_ALL`、`DENY_SCOPED`（`/outside/blocked/*`）、`HOSTILE_TAIL`（`shell * allow`、`edit * allow`、`execute * allow`、`subagent * allow`、`probe_unknown_tool * allow`、`* * allow`，**仅作测试数据，不是产品规则**）、`COLLIDE`（含与角色同值的 `read *.env ask`、`read *.env.example allow`，与 `crew_s0_sentinel * ask`、scoped external deny 交错）。

### 5.3 目标断言与预期红灯（对当前代码）

下表“红”= 对当前代码必须因断言失败而红；“绿”= 当前已通过（回归/反向门禁，实现后仍须绿）。分组独立命名、独立验收。

| 组 | 断言 | 当前 |
|---|---|---|
| **A 默认外部 allow**（3 角色） | 基线前缀 + 无全局：`external_directory /outside/ok/f.txt` → allow（宿主求值） | 红：`Expected "allow", Received "deny"` |
| | 基线 + `DENY_SCOPED` 全局在前：`/outside/ok/*` allow、`/outside/blocked/*` deny | 红（ok 行）；blocked 行偶然绿 |
| | `ASK_ALL`、`DENY_ALL` 全局在前：ask / deny | ask 行红；deny 行偶然绿 |
| | 全局在**角色块之后**（D1 顺序）ask/deny | 绿（角色 deny 在前，全局在后胜出）——作为反向门禁保留 |
| | 空宿主前缀：数组内无 `*` allow、无任何 `external_directory` 规则；外部读求值为 `ask` | 红：当前为 deny |
| **B 写入形态** | 宿主前缀原样位于数组开头（深比较，且不被改写）；输入数组不被原地污染 | 红：当前整档替换 |
| | 宿主块不含能匹配 `external_directory` 的 action 模式、无 `* allow`；含显式 `shell/edit/execute/subagent/question` deny（reviewer 另含 `webfetch/websearch` deny） | 红：当前含 `* deny` 且无显式项 |
| | architect 绝对 plans 规则恰一条 | 绿（回归） |
| **C hook 注册** | `setup` 后恰有 1 个 `evaluate` hook；重放 transform 后仍恰 1 个；hook 回调不在 transform 内注册 | 红：`hooks.length` 为 0 |
| | `permission.hook` reject → `setup` reject，且三读角色均未被注册 | 红：当前 setup 成功 |
| | `ctx.permission.hook` 不是函数 → `setup` reject 且读角色未注册 | 红 |
| **D guard 资源级**（3 角色；`HOSTILE_TAIL` 追加在块后） | 未知 action `probe_unknown_tool` → deny；`execute/subagent/question` → deny | 红（Received allow） |
| | read `.env`、`nested/.env.production`、`/outside/.env` → ask；`.env.example` → allow；`src/a.ts` → allow | env 行红；其余绿 |
| | `external_directory`：宿主 allow/ask/deny 三种输入，hook 不改值 | 绿（反向门禁；防过度实现） |
| | reviewer shell：五条固定命令 allow；各加 `--help` deny；`git status`、`git push`、`sh -c id` deny；多资源 `[固定, 'git push']` deny | 红（宿主为 allow） |
| | architect edit：`plans/a.md`、`<cwd>/plans/a.md` allow；`src/a.ts`、`<cwd>/src/a.ts`、`/outside/plans/a.md` deny；explorer/reviewer edit 任意 deny；explorer/architect shell deny | 红 |
| | 多资源取最严：read `[src/a.ts, .env]` → ask；空 `resources` → 按 `"*"`：`execute` deny、`edit`(architect) deny | 红 |
| | 绝不放宽：宿主 deny 的 read `src/a.ts` 仍 deny；宿主 ask 的本地 allow 动作仍 ask | 绿（反向门禁） |
| **E 身份** | `agent: 'reviewer'` 且 `session.get` 返回 `agent:'engineer'`：按 reviewer（`git push` deny） | 红 |
| | `agent: 'engineer'`（或 `'root'`、`'custom'`）且 session 为 reviewer：不介入（edit 保持宿主 allow）；断言 `session.get` 未被调用 | 绿（反向门禁；防用 session 覆盖显式 agent） |
| | `agent` 缺失，`session.get`→`agent:'reviewer'`：guard 生效（`probe_unknown_tool` deny，`git push` deny）；`session.get` 以 `{sessionID}` 调用 | 红 |
| | `agent` 缺失，session agent 为 `'engineer'`：不介入 | 绿 |
| | `agent` 缺失，且 `session.get` 抛错 / 返回无 `agent` / `agent` 非字符串：非 external action 的最终 effect **不是 allow**，`message` 非空，hook 不抛，`external_directory` 不改 | 红 |
| **F 幂等/碰撞/真实 reload（分别命名、分别验收）** | (a) 同一数组连续重放两次结果相等且含宿主前缀 | 红（前缀断言） |
| | (b) 模拟宿主 reload：每次重放前把 agent 重置为 `[...基线]`（新基线）再 `[...基线, ...全局]`；两种形态结果一致、无重复 | 红 |
| | (c) 累积形态：`[基线, 宿主块, 全局]` 再重放，**数组不变**（不重复、不重排、全局仍在末尾） | 红 |
| | (d) 碰撞：全局含与角色同值规则（`COLLIDE`），setup + 重放后宿主前缀每条规则出现次数不减，`.env` ask、`.env.example` allow，sentinel 与 scoped deny 各保留一次且次序不变 | 红 |
| **G 回归行** | 既有 `crew.test.ts` 全部用例不改，仍全绿 | 绿 |
| | **shell 循环按 `effect === 'allow'` 过滤**：新文件内的 reviewer 五条循环写成 `filter(r => r.action==='shell' && r.effect==='allow')`，不被宿主块里的 `shell * deny` 干扰 | 绿 |

### 5.4 红灯验收（Root）
```sh
cd /project/glx/scripts/opencode-crew
bun test test/crew-read-role-policy.test.ts   # S1 预期：A/B/C/D/E/F 指定项红，反向门禁/回归项绿
bun test test/crew.test.ts                    # 既有用例全绿（证明未改旧测试）
bun run typecheck                             # 新测试文件须通过
git --no-optional-locks status --short --untracked-files=all   # 仅新增该测试文件
```
- 工程师须**先**只写测试并运行，报告贴红灯输出；失败原因必须是缺少该行为（`Expected … Received …`、`hooks.length`、规则存在断言），**不得是** SyntaxError、Cannot find module、TypeError、ReferenceError。缺红灯输出、或红灯来自改旧测试/导入不存在模块，一律不验收。
- 轻量，不需要 slot；不写 `/tmp`；不起真实宿主。

### 5.5 S1 明确不做
- 不写任何产品实现；不改 Markdown；不改旧测试；不设计新探针；不执行 S0b（`ctx.permission.assert` 真机需要创建临时 session，是新 scope，**未授权、未测**，ask 仍属 TUI）。

## 6. 后续硬门禁（不阻止先取 S1 红灯；S2 验收前须有）

- **S2 的已知旧测试冲突（须 Root 在 S2 Assignment 里明确授权，并仅作最小修改）**：
  - `test/crew.test.ts:169-179` “strict roles still replace seeded host permissions”：`a.permissions[0]).not.toEqual(host[0])` 与“保留宿主前缀”冲突，应改名并断言保留前缀；
  - `test/crew.test.ts:208`：`reviewer.permissions.filter(r => r.action==='shell')` 会纳入新增 `shell * deny`，须改为 `&& r.effect === 'allow'`；
  - `test/crew.test.ts:186-199` 名称与断言应改为调用组合求值；
  - 若 setup 对缺 `ctx.permission.hook` 抛错（§3.1.3），则 `test/crew.test.ts:13` 夹具与 `tasks-tools.test.ts:23`、`tasks-tools-v2.test.ts:36`、`tasks-interface.test.ts:49` 的 `permission` 都需**加法式**补 `hook`（只补夹具，不改断言）。
- **S0b（另行评审、另开 Assignment，未授权）**：用无模型的临时 session + `ctx.permission.assert`/`list` 验证 U5（hook 改严是否被采用）、U2（`event.agent`）、U6、通配语义校准（guard 本地求值器与宿主不一致时方向必须更严）。ask 分支仍需 TUI，不能写成已测。
- **setup 失败清理（U4）**、hook adopted（U5）、被测 dist 与 src 一致（U8）均**尚未测试**；它们是 S2 绿灯后、R0 解除前的硬门禁。U5 不成立则本路线无法满足安全契约，应保持 blocked 而不是退回 fail-open。

## 7. 授权链与实施顺序

| 门 | 条件 | 授权内容 |
|---|---|---|
| G0 | 本方案 §5 | 仅 S1（新增 `test/crew-read-role-policy.test.ts`，仅红灯） |
| G1 | Root 核对红灯输出与 §5.4 | 才可授权 S2 |
| G1′ | 用户定 §4.4.5 的 ask/deny 下限 | S2 前必须 |
| G2 | S2：实现 Route W，绿灯，授权修旧测试（§6）；`bun test`、`bun run typecheck` 全绿并贴红绿输出 | 才可进 S3 |
| G3 | S3：S0b 真机（HG6/HG7）+ S5 `docs/role-permissions-host-checks.md` A3 全格复测（被测 `dist/index.js`，每次记录 hash）；R0 全过前禁止 R1/R2 | 解除 R0 blocked |
| G4 | S4：文档口径（review/host-checks/README 中英文：不再有读角色整档 `*` deny 的外部目录描述；guard 与信任边界——后续插件的 hook 可再放宽 effect，crew 无法强制；§4.4 处置） | 仅在 G3 后 |

## 8. 回滚边界
- S1：删除新增测试文件即回滚。
- S2 起：还原 `src/index.ts`（及新增模块）、被改测试，回到当前 blocked 状态（读角色 fail-closed、外部 read 默认被拒）。已保存的“Allow always”审批不受影响；无数据迁移。

## 9. 风险与未决事项

1. **唯一需用户决策**：§4.4.5，“无法识别调用方”取 ask 下限（推荐）还是 deny。
2. **U5**：hook 改严是否被采用未证实；不成立则 Route W 不满足硬门禁，保持 blocked，不接受退回 fail-open。
3. **通配语义（E1 C 级）**：guard 的本地求值器与宿主有偏差的风险，S0b 校准；偏差方向须更严。
4. guard 对 `.env` 恒 ask：用户已保存的“Allow always”对读角色的 `.env` 会被重新要求确认（只会更严，不放宽）。
5. D1 之外的宿主路径（其他插件的 hook、未经 evaluate hook 的检查）不在保证内；README 须声明信任边界（S4）。
6. root/engineer 在“全局规则不可得”情形的影响不在本方案范围。
7. `plans/**` 词法匹配不防 symlink/`..`（已知，沿用既有说明）。
