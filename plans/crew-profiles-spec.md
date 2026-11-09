# Crew 配置档（Profiles）Spec

日期：2026-11-07。状态：**方案待拍板**。本文只新增本文件，不修改任何业务源码、测试、README 或 package.json。

参考实现：`/home/tcuni-claw/pi/pi-subagent-switch`（Pi 扩展，读写 `~/.pi/agent/settings.json` 的 `subagents` 块）。本文复用其**档文件格式、目录优先级、逐档错误隔离、原子写与 0600** 的产品结论，**不复用**其宿主 API（`ctx.ui.setStatus` / `ctx.reload()` / settings 改写路径），因为 OpenCode 的等价能力与风险完全不同（见第 2、8 节）。

---

## 1. 目标与非目标

### 1.1 目标

1. 用户可以在**不改写 `opencode.json(c)`** 的前提下，用预先手写的档文件整体替换 Crew 五个角色的 `models` / `steps` / `engineerInstructions`。
2. 支持一条命令列出、切换、关闭档位；切换**不重启进程**即生效（agent 定义、`/crew` 的 root 模型、`crew_task_start` 的 engineer 模型三者同时跟随）。
3. 档位是**用户级状态**：同机多项目、多 TUI 实例共享同一份选择；状态落在磁盘上可读、可手改、可 `git diff`。
4. 没有档目录、没有 active 指针时，插件行为与当前版本**完全一致**（含视觉与错误信息）。
5. 档损坏、指针损坏、目录不可读时**永不阻止插件加载**，一律回退到 `opencode.json` 配置并给出可读原因，保证用户仍能用 `/crew-profile off` 自救。
6. MVP 只做「读取 + 选择」，不做档的创建/编辑向导（那是第二阶段）。

### 1.2 非目标（明确不做）

- 不重写、不读取、不备份 `opencode.json(c)`；不改变 provider、其他 agent、其他插件、顶层 `model`、`default_agent`。
- 不覆盖五个角色以外的东西：`description` / `mode` / `permissions` / 角色正文仍只来自 `agents/*.md`。
- 不实现"档继承/合并"：档是**整块替换**，不是 `opencode.json` 的 patch。
- 不做项目级档目录、不做 `git` 版本化档、不做档的远程分发。
- 不做档的创建/编辑/删除向导（第二阶段，见 §14.2）。
- 不做跨机器同步、不做多实例强一致（见 §11.3）。
- 不新增面向模型的工具（`crew_task_*` 之外的 tool 一个都不加）。
- 不引入文件锁或守护进程；不做热监视线程（TUI 侧用已有的 60s 校准节奏）。

---

## 2. 现状核对与约束

以下事实均已在仓库内逐条核实（行号为当前 HEAD 的实际内容）。

| 事实 | 位置 | 对本方案的含义 |
|---|---|---|
| `IDS` 是五个角色；`options()` 校验 `models`/`steps`/`engineerInstructions`，未知 key 直接 `fail` | `src/index.ts:9`、`src/index.ts:36-58`（`instructions` 辅助在 `src/index.ts:19-34`） | 档正文必须复用同一套校验；需先抽到独立模块，否则 `index.ts` 与档模块互相 import 形成环 |
| `setup` 在 `src/index.ts:80` 一次性算出 `config` 常量，`:82-97` 的 `agent.transform` 与 `:101-106` 的 `/crew` 闭包都捕获这个常量 | `src/index.ts:76-110` | 运行时切档必须改成**每次读取**；保留常量就会"切了但没生效" |
| agent 系统提示词由 `composeRoleSystem(role.system, role.appendices, config.models[id], …)` 合成，模型族附录（GPT/Claude）由模型自动决定 | `src/index.ts:88`、`src/model-family.ts:65-70`、`src/model-family.ts:79-83` | 档**不需要**复制任何提示词；换模型自动换附录，这是本方案的白拿收益 |
| `/crew` 用 `config.models.root` 决定是否 `switchModel` | `src/index.ts:103` | 档内不给 `models.root` 时，`/crew` 应维持会话当前模型（与今天的"省略即继承"一致） |
| `registerTasks(ctx, configuredModel?)` 把 engineer 模型**捕获进闭包** | `src/tasks.ts:104` | 必须改成惰性取值，否则切档后 `crew_task_start` 仍用旧模型 |
| 该模型在 `start` 里被用三处：`MODEL_NOT_CONFIGURED` 判定、`session.create` 的 `model`、`modelFamilyTaskHint` | `src/tasks.ts:151`、`:158`、`:167` | 改成在 `start` 顶部**取一次**存局部变量，避免一次调用内取到不同值 |
| `crew_task_start` 是唯一创建 engineer 会话的地方 | `src/tasks.ts:156-169` | 已运行的 engineer 会话不会被切档改写——这是正确行为，需在文档里写明 |
| `crewTasks` 是 server→TUI 的唯一 RPC 通道，`id: "opencode-crew"`，只读 | `src/snapshot.ts:57-76`、`src/tasks-snapshot.ts:67-108` | 切档是**写**操作，不要塞进"只读契约"；另注册第二个 definition |
| TUI 用 `context.client.rpc(crewTasks)` 并按需传 `{ location }` | `src/tui/sidebar.tsx:97-100` | TUI **端不读文件系统**（TUI 可能是远端 attached 客户端），一切经 RPC |
| TUI 插件当前只注册 `sidebar.content` 一个 slot，`setup` 直接返回该 slot 的 cleanup | `src/tui/index.tsx:7-13` | 加第二个 slot 时必须合并 cleanup，不能只返回后一个 |
| server 端 `CommandDefinition.execute` 只有 `{sessionID, prompt, delivery}`，**没有任何 UI 输出通道** | `node_modules/@opencode/plugin/dist/promise/command.d.ts:6-15` | server command 无法回报"切换成功/档损坏"；这是 §9 决策 D1 的核心依据 |
| server 端有 `ctx.agent.reload()`、`ctx.rpc.register`、`ctx.storage.{get,set,remove}` | `dist/promise/agent.d.ts:12-15`、`dist/promise/rpc.d.ts:17-22`、`dist/promise/storage.d.ts:3-8` | 切档后需要 `agent.reload()`；不需要 `ctx.storage`（理由见 §4.3） |
| TUI 端有 `ui.dialog.{alert,confirm,prompt,select,custom}`、`ui.toast.show`、`keymap.layer({commands:[{slash}]})`、`storage.memory`、`sidebar.footer` slot | `dist/tui/context.d.ts:327-338`、`:236-247`、`:339-365`、`:317-326`、`:391-416`、`:175-177` | MVP 交互全部可落在 TUI 侧，无需 server UI |
| `Row` 组件接受 `Span{text,tone,bold?}`，`Tone` 含 `muted/faint/warning/error` | `src/tui/rows.tsx:21-31`、`src/tui/view-model.ts:4-5` | footer 复用 `Row`，不新增渲染原语 |
| 构建脚本两条 `bun build`（server 与 tui 分别打包） | `package.json:20-22` | 新模块必须在两条链上都能被解析：server 侧只用 `node:*`，TUI 侧不得 import server-only 代码 |
| `files` 只含 `dist/src/agents/README…` | `package.json:18` | 若最终决定预置 `profiles/`，必须加入 `files`（见 D3） |
| 测试发现被 `bunfig.toml:1-2` 限制在 `./test` | `bunfig.toml:1-2` | 新增测试只能放 `test/` |
| 测试基线：`test/` 下**22 个** `*.test.ts`（不是 18 个）+ 4 个 fixtures + `test/workdir.ts` | `test/` | 任务输入里的"18"需更正；本文按 22 个文件规划 |
| 现有 fixture 的 `ctx` 大多**没有** `agent.reload`、没有 `rpc`、没有 `ctx.options` | `test/crew.test.ts:11-30`、`test/tasks-interface.test.ts:267-275`、`test/tasks-tools.test.ts:23-27` | 新代码必须对 `reload` / `rpc` 做存在性保护，否则老 fixture 全红 |

### 2.1 三个关键约束

1. **不得程序化改写 `opencode.json(c)`**。主配置含 provider 定义、其他插件条目和注释（jsonc）；任何"读-改-写"都会破坏注释并可能在写盘瞬间让用户丢配置。收益/风险比不成比例，因此档位状态**另存于独立小文件**。
2. **不得让插件加载依赖档目录的健康度**。档坏了必须仍能启动，否则用户唯一的自救命令（`/crew-profile off`）也用不了。
3. **不得改变无档时的行为**。包括：`options()` 的硬校验仍然硬失败（不因为"反正会被档覆盖"而放松）；无档时 `agent.model`、`steps`、`system` 逐字节等同今天。

---

## 3. 最终行为契约

### 3.1 不变量（Invariants）

| # | 不变量 | 违反即视为实现错误 |
|---|---|---|
| I1 | 没有档目录 / 目录空 / 无 `active` 指针 → `config()` 返回的 `CrewConfig` 与 `parseCrewConfig(ctx.options)` 完全相同（同一对象语义，逐字段相等） | 任何字段差异 |
| I2 | 任何档相关的 I/O 异常都不得让 `Plugin.setup` 抛出 | setup reject |
| I3 | 生效配置只有一个来源：磁盘上的 `active` 指针 + 对应档文件。没有第二份内存真相、没有缓存的 setup 期常量 | 闭包捕获旧 config |
| I4 | 切换先写指针、后生效；写指针失败时内存与 agent 定义**保持不变** | 出现"内存已切、磁盘没切" |
| I5 | 档只影响五个角色的 `models`/`steps`/`engineerInstructions` 三个字段，其余（permissions/mode/description/正文）与无档时逐字节相同 | 任何其他字段变化 |
| I6 | 插件从不执行档内容：只 `JSON.parse`，不 `import`/`require`/`eval` | 任何代码加载 |

### 3.2 用户可见行为

| 场景 | 行为 |
|---|---|
| 装好插件、没建档目录 | 与当前版本 100% 一致：无 footer、`/crew-profile list` 提示"未找到档目录"。 |
| 放了档但没设 active | 同上（档只是可选项，不自动生效）。 |
| `/crew-profile` | 打开 TUI 选择面板：`●` 标出当前档，末尾固定一项「关闭档位（回到 opencode.json）」；`Enter` 切换、`Esc` 取消。 |
| `/crew-profile fast` | 直接切到 `fast`：写指针 → 重新合成 → `agent.reload()` → toast「已切换到档 "fast"」。 |
| `/crew-profile off` | 删指针 → 回到 `opencode.json` 配置 → toast「已关闭档位」。 |
| `/crew-profile list` | alert 列出：档目录（含来源与存在性）、每个档的三个字段摘要、`●` 当前档、以及所有逐档错误。 |
| 外部手改档文件 | 下一次 `config()` 调用（`/crew`、`crew_task_start`、agent 重载）立即读到新内容；角色 system/steps 需宿主 `/reload` 或下一次切换，footer 最多 60s 内校准。 |
| active 指向已删除的档 | 插件正常加载、按 `opencode.json` 运行；`list` 与 footer 显示 `profile: off ⚠` 与原因。 |
| 同机另一个项目 / 另一个 TUI | 通过同一指针文件看到同一档；已运行的另一个 server 实例在下一次宿主重载后对齐 agent 定义（§11.3）。 |

### 3.3 字段级替换语义（整档替换，不合并）

档一旦生效，三个字段**整体替换**，与 `opencode.json` 的同名字段**无任何合并**：

| 字段 | 档里有 | 档里没有 |
|---|---|---|
| `models.<role>` | 用档值 | `agent.model = undefined` → 宿主原生继承（子代理跟随父会话模型；root 保留会话已选模型） |
| `steps.<role>` | 用档值 | 回落到 `agents/<role>.md` frontmatter 的 `steps`（如 engineer 80、architect 40） |
| `engineerInstructions` | 用档值（仅 engineer 的 system） | `[]` → engineer 无 `## 项目补充规则` 段 |

> 注意最后一行：档生效时，`opencode.json` 里写的 `engineerInstructions` **不会**叠加。这是"整档替换"的直接后果，也是本方案唯一一个可能让用户意外的语义，故列为决策 D5 请你确认。

模型族附录不是字段，它由最终生效的 `models.<role>` 推导（`src/model-family.ts:65-70`），因此档里**不需要也不允许**写提示词。

---

## 4. 档文件与 active 指针格式

### 4.1 档文件

- 路径：`<profiles-dir>/<name>.json`；**文件名主干即档名**（`fast.json` → `/crew-profile fast`）。
- 正文就是 `CrewConfig` 的三个可写字段，无外层包装、无 `name`/`description` 元数据：

```json
{
  "models": {
    "root": "provider/root-model#high",
    "architect": "provider/architect-model#high",
    "engineer": "provider/implementation-model#medium",
    "explorer": "provider/fast-model",
    "reviewer": "provider/review-model#high"
  },
  "steps": { "engineer": 80, "reviewer": 30 },
  "engineerInstructions": [
    "Keep temporary and intermediate files inside the project; do not use /tmp, including for child processes."
  ]
}
```

- 三个字段**都是可选的**；`{}` 是合法档（效果＝全部回落 Markdown/宿主默认）。
- 校验完全复用 `parseCrewConfig`（见 §7.1），错误消息带档名：`[opencode-crew] 档 "fast" 的 models.root 必须为 provider/model[#variant]`。
- **命名规则**：`^(?!\.)(?=.*[a-z0-9])[a-z0-9._-]{1,64}$` —— 只允许小写字母/数字/`.`/`_`/`-`，至少含一个字母或数字，禁首点、禁 `/`、`\`、`..`。这一条同时是**路径穿越防线**：档名永远不含路径分隔符，`join(dir, name + ".json")` 不可能逃出目录。
- 只认同目录下 `*.json`（大小写不敏感），跳过 `.` 开头的临时/隐藏文件（原子写的临时文件名以 `.` 开头，天然被忽略）。
- 单档损坏**只影响该档**：进入 `ProfileSet.errors`，不进入 `profiles`，其他档照常可用。

### 4.2 active 指针

- 路径：`<profiles-dir>/active`（**无扩展名**，因此不会被误认成档）。
- 内容：单行档名（UTF-8），允许结尾一个 `\n`。示例：`fast\n`。
- **文件不存在 = off**（这是默认状态，绝不主动创建）。
- 内容为空或纯空白 = off（不报错；便于 `: > active` 或编辑器清空）。
- 内容非法（不匹配命名规则、超长）→ **不尝试读取该路径**，回退 `opencode.json` 并报错 `active 指针内容非法`。
- 写入：同目录**唯一**临时文件（如 `.<name>.<pid>.<timestamp>.tmp`，`flag:"wx"`, `mode:0o600`）→ `renameSync` 覆盖；`off` = `unlinkSync`（`ENOENT` 视为成功）。临时文件以 `.` 开头，加载器会跳过；若进程崩溃留下陈旧临时文件，随机/时间后缀保证不会阻塞下一次写入。
- 权限：目录 `0o700`（仅在需要创建时创建），指针与临时文件 `0600`；**不 chmod 用户已有的档文件**（它可能在 git 里、可能被用户刻意设权限）。

### 4.3 为什么用文件指针而不是 `ctx.storage`

| 维度 | 文件指针（推荐） | `ctx.storage`（server 端 KV） |
|---|---|---|
| TUI 可读 | 可（经 RPC，也可人肉 `cat`） | 只能经 RPC 转发，且 server 端 storage 对 TUI 不可见 |
| 可调试 | 高：一个文件、一行文本 | 低：opaque KV，需要工具才能看 |
| `off` 语义 | 删文件，天然干净 | `remove(key)` 语义可用但不可见 |
| 手改/脚本化 | 支持（`echo fast > active`） | 不支持 |
| 与档文件同一目录 | 是，一切配置在一个目录里 | 分散在两处 |
| 依赖 | `node:fs` | 宿主 storage 版本/schema、`ctx.storage` 可用性、plugin id 绑定 |
| 风险 | 指针与档文件非事务（档被删后指针残留） | 一致但同样非事务 |

结论：**文件指针**。残留指针的风险由 §10 的回退表完全吸收（回退 + 可读报错 + `off` 自救），代价可接受。Pi 参考实现用"内容深比较"推断当前档而不落状态文件，那是因为它直接持有 settings 文档；我们没有可比较的宿主配置文本文档（不能读 `opencode.json`），所以必须显式落一个指针。

---

## 5. 目录优先级与来源

```
1) 环境变量 OPENCODE_CREW_PROFILES_DIR
     - 非空 → 只用该目录（不回退），source = "user"
     - 空字符串 → 完全没有档目录（显式关闭；测试用它做隔离）
2) 未设置 → $XDG_CONFIG_HOME/opencode/crew-profiles   (source = "user")
             XDG_CONFIG_HOME 未设置/空 → ~/.config/opencode/crew-profiles
```

- MVP **只有一个目录**，因此不存在同名覆盖/shadowing。
- 关于"包内 `profiles/` 示例档 + 同名用户档覆盖"：**建议 MVP 不实现**，理由见决策 D3。若你要求保留，落地方案是：`profileDirs()` 返回 `[user, package]`（`package` 指向 `new URL("../profiles", import.meta.url)`），`loadProfiles` 按顺序遍历并对已见档名跳过（首个命中优先），`profiles/README.md` 与示例 `.json` 加入 `package.json:18` 的 `files`。
- 目录不存在 = 空集合，**不创建、不报错**（只有"切档时写指针"才会创建目录）。
- 目录存在但不可读（EACCES）→ 记为一条目录级错误，`profiles: []`，回退 `opencode.json`，插件照常加载。

---

## 6. 配置合成与优先级

```
effective_config =
  active 指针缺失/非法/指向不存在的档/档校验失败
      → baseline = parseCrewConfig(ctx.options ?? {})          // 与今天完全相同
  active 指针有效且档校验通过
      → { models: 档.models ?? {}, steps: 档.steps ?? {}, engineerInstructions: 档.engineerInstructions ?? [] }
```

优先级从高到低：**档 > `opencode.json` 的 `options` > `agents/*.md` 的默认值 > 宿主继承**。

三个消费点必须全部走 `effective_config`：

| 消费点 | 位置 | 说明 |
|---|---|---|
| agent 定义（system/steps/model） | `src/index.ts:82-97` | 在 transform 回调**体内**取 `profiles.config()`，不得在 `setup` 作用域取 |
| `/crew` 的 root 模型 | `src/index.ts:101-106` | 在 `execute` 内取；`models.root` 缺省 → 不调用 `switchModel` |
| `crew_task_start` 的 engineer 模型 | `src/tasks.ts:151,158,167` | 通过 getter 注入，在 `start` 顶部取一次 |

**基线仍要硬校验**：`parseCrewConfig` 在 `setup` 里先跑一次，非法就 `fail`（现状不变）。即使档会覆盖这三个字段，也不允许"用坏配置启动"，否则用户拿不到确定的错误位置。

---

## 7. 接口签名

### 7.1 `src/config.ts`（新增，从 `src/index.ts` 抽出）

```ts
export const IDS = ["root", "architect", "engineer", "explorer", "reviewer"] as const
export type RoleID = typeof IDS[number]
export type ModelRef = { providerID: string; id: string; variant?: string }

export type CrewConfig = {
  models: Partial<Record<RoleID, ModelRef>>
  steps: Partial<Record<RoleID, number>>
  engineerInstructions: string[]
}

/** 错误消息标签；让同一套校验既能报 "options.*" 也能报 '档 "fast" 的 *'。 */
export type ConfigLabel = { subject: string; path(field: string): string }
export const optionsLabel: ConfigLabel        // subject "options"，path f => `options.${f}`
export function profileLabel(name: string): ConfigLabel  // subject `档 "${name}"`，path f => `档 "${name}" 的 ${f}`

export function fail(message: string): never
export function object(value: unknown): value is Record<string, unknown>

/** 现 src/index.ts:36-58 的 options() + :19-34 的 instructions()，语义不变。 */
export function parseCrewConfig(input: unknown, label?: ConfigLabel): CrewConfig
```

消息构造要求（保持现有文案不变，只把前缀参数化）：

| 现有文案 | 参数化后（`optionsLabel`） | 档场景（`profileLabel("fast")`） |
|---|---|---|
| `options 必须是对象` | 同 | `档 "fast" 必须是对象` |
| `未知 options.workerSteps` | 同 | `未知 档 "fast" 的 workerSteps` |
| `options.models.root 必须为 provider/model[#variant]；省略即可继承会话模型` | 同 | `档 "fast" 的 models.root 必须为 …` |
| `options.engineerInstructions[0] 必须为字符串` | 同 | `档 "fast" 的 engineerInstructions[0] 必须为字符串` |

> 现有测试只断言 `toThrow("opencode-crew")`（`test/crew.test.ts:127`、`test/tasks-interface.test.ts:276`），因此文案参数化是安全的；但仍要求 `optionsLabel` 下**逐字**保持今天的样子。

### 7.2 `src/profiles.ts`（新增，纯读 + 指针写）

```ts
export type ProfileSource = "user" | "package"
export type ProfileRoot = { dir: string; source: ProfileSource }

export type ProfileErrorKind =
  | "invalid-name" | "not-found" | "unreadable" | "invalid-json" | "invalid-config"
export type ProfileError = { kind: ProfileErrorKind; name: string; path: string; message: string }

export type Profile = { name: string; path: string; source: ProfileSource; config: CrewConfig }
export type ProfileSet = { profiles: Profile[]; errors: ProfileError[]; dirs: ProfileRoot[] }

/** 依赖注入面：只覆盖测试需要的失败路径；默认实现直接包 node:fs。 */
export type ProfileFs = {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: "utf8"): string
  writeFileSync(path: string, data: string, options: { flag: string; mode: number }): void
  renameSync(from: string, to: string): void
  unlinkSync(path: string): void
  mkdirSync(path: string, options: { recursive: true; mode: number }): void
  readdirSync(path: string): string[]
}
export const nodeProfileFs: ProfileFs

export const PROFILE_NAME_MAX = 64
export const ACTIVE_FILE = "active"

/** 不合法就抛带可读中文的错误；合法则返回 void。 */
export function assertProfileName(name: string): void
/** 名字→布尔，用于 RPC 输入过滤，不抛。 */
export function isProfileName(name: string): boolean

export function profileDirs(env?: NodeJS.ProcessEnv): ProfileRoot[]

export function loadProfiles(deps?: { fs?: ProfileFs; dirs?: ProfileRoot[] }): ProfileSet

export type ProfileLookup =
  | { ok: true; profile: Profile }
  | { ok: false; error: ProfileError }
export function findProfile(set: ProfileSet, name: string): ProfileLookup   // 同名损坏档返回其原始 error，不误报 not-found

export type ActivePointer = { name: string | null; path: string; raw: string | null; error: string | null }
export function readActive(deps?: { fs?: ProfileFs; dirs?: ProfileRoot[] }): ActivePointer
/** name === null 即 off（删文件）。失败抛错，调用方负责不落地内存状态。 */
export function writeActive(name: string | null, deps?: { fs?: ProfileFs; dirs?: ProfileRoot[] }): void
```

实现要点：

1. `loadProfiles` 对每个候选目录：`existsSync` 假 → 跳过；`readdirSync` 抛 → 记目录级错误并跳过（**不中止**）。逐文件 try/catch，把 `unreadable` / `invalid-json` / `invalid-config` 全部转成 `ProfileError`。最后按 `name` 字典序排序，保证 `list` 顺序稳定。
2. `readActive` 的四种状态必须可区分：文件缺失（`raw: null`，无 error）、可读但空白（`raw: ""`，`name: null`，无 error）、内容非法（`name: null`，有 error）、读取异常（`name: null`，有 error）。
3. 目录解析在**每次调用**时读 `process.env`，不得在模块顶层计算常量（否则测试无法逐例覆盖）。
4. `writeActive` 只写 `active`，**从不写档文件**。本文件内不得出现写 `*.json` 的代码路径（便于 code review 时一眼确认）。

### 7.3 `src/profile-state.ts`（新增，运行时合成 + 切换编排）

```ts
export type CrewProfilesInfo = {
  /** 真正生效的档；null = 按 opencode.json 运行 */
  active: string | null
  /** 指针内容（即使它无效也如实报告，便于 list 解释） */
  requested: string | null
  /** 回退原因（可读中文）；无回退为 null */
  error: string | null
  /** 最终生效配置（= baseline 或档配置） */
  config: CrewConfig
  set: ProfileSet
}

export type CrewSwitchCode =
  | "INVALID_NAME" | "NOT_FOUND" | "INVALID_PROFILE" | "WRITE_FAILED" | "APPLY_FAILED" | "HOST_ERROR"
export type CrewSwitchResult = {
  ok: boolean
  active: string | null
  changed: boolean
  code?: CrewSwitchCode
  message?: string
  warnings: string[]
  info: CrewProfilesInfo
}

export type CrewProfileRuntime = {
  config(): CrewConfig            // = info().config
  info(): CrewProfilesInfo        // 每次读盘，无缓存
  switch(name: string): Promise<CrewSwitchResult>
  off(): Promise<CrewSwitchResult>
}

export function createCrewProfiles(deps: {
  baseline: CrewConfig
  env?: NodeJS.ProcessEnv
  fs?: ProfileFs
  dirs?: ProfileRoot[]
  /** 默认 () => ctx.agent.reload()；测试注入以断言调用次数 */
  reload?: () => Promise<void>
  now?: () => number
}): CrewProfileRuntime
```

**刻意不缓存**：`info()` 每次 `readdirSync` + 至多两次小文件 `readFileSync`，调用频率是"每次 agent transform / 每次 `/crew` / 每次 `crew_task_start`"，量级完全可忽略。代价换来的是彻底消除"内存状态与磁盘不一致"这一类 bug，以及多实例天然对齐（§11.3）。若未来 profiling 显示热点，再加 `mtime+size` 指纹缓存，接口不变。

`switch(name)` 的**严格顺序**（每一步失败都在此停止）：

```
1. isProfileName(name) 为假            → { ok:false, code:"INVALID_NAME", 零写盘 }
2. loadProfiles → findProfile
     not-found                          → { ok:false, code:"NOT_FOUND" }
     invalid（同名损坏档）               → { ok:false, code:"INVALID_PROFILE", message: 该档原始错误 }
3. changed = (readActive().name !== name) || !deepEqual(info().config, profile.config)
4. changed 时才 writeActive(name)       → 抛错则 { ok:false, code:"WRITE_FAILED" }（内存/agent 均未变）
5. 重新 info()；若 info().active !== name，或 info().error（仅指**回退原因**，非 active 档的逐档错误不算）→ { ok:false, code:"APPLY_FAILED" }（指针已写，报错请人工核查）
6. 仅在 `changed` 时尝试 `await reload()`；抛错或不存在 → `warnings.push("配置已切换，但宿主 agent 重载失败；将在下次宿主动作后生效")`。未变时跳过 reload（手改档内容不触发 agent 重载；需要立即更新角色定义时用宿主 `/reload`，或切换到其他档再切回）。
7. { ok:true, active:name, changed, warnings, info }
```

`off()` 同理，但判断依据必须是**指针文件是否存在**（`readActive().raw === null`），而不是 `name === null`：空内容或非法内容都算“文件存在”，必须 `writeActive(null)` 清掉；只有文件不存在才 `changed:false`、不写盘、不 reload。否则 `writeActive(null)` → 重新 `info()` → 确认 `active === null` 且无回退 error → `reload()`。

`deepEqual` 只比较三个字段（`models` 的 `providerID/id/variant` 三键、`steps`、`engineerInstructions` 数组），用稳定排序后逐项比较，不引入依赖。

**`reload` 的防御**：`createCrewProfiles` 的默认 `reload` 由 `index.ts` 注入为 `async () => { if (typeof ctx.agent.reload === "function") await ctx.agent.reload() }`。理由：`test/crew.test.ts:11-30` 之外的多个 fixture 没有 `agent.reload`（如 `test/tasks-interface.test.ts:271`、`test/tasks-tools.test.ts:23`），且不保证所有宿主版本都提供该方法。

### 7.4 `src/profile-rpc.ts`（新增，第二个 Rpc definition）

```ts
import type { Rpc } from "@opencode/plugin"

export type CrewProfileView = {
  name: string
  source: "user" | "package"
  models: number        // 已设置的模型数
  steps: number
  instructions: number
  /** `models.root` 的原始值；缺省表示继承，供 list/menu 展示。 */
  rootModel?: string
  roles: RoleID[]       // 已设置模型的角色，供 list 展示
}
export type CrewProfilesView = {
  active?: string       // 缺省 = off（JSON Schema 不用 null，沿用 snapshot.ts 的"缺省即无"风格）
  requested?: string
  error?: string
  dirs: { dir: string; source: "user" | "package"; exists: boolean }[]
  profiles: CrewProfileView[]
  errors: { name: string; message: string }[]
}
export type CrewSwitchView = {
  ok: boolean
  active?: string
  changed: boolean
  code?: string
  message?: string
  warnings: string[]
  profiles: CrewProfilesView
}

export const crewProfiles = {
  id: "opencode-crew-profiles",
  methods: {
    list:   { input: { type: "object", properties: {}, additionalProperties: false },
              output: { … } },                                   // CrewProfilesView
    switch: { input: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 64 } },
                       required: ["name"], additionalProperties: false },
              output: { … } },                                   // CrewSwitchView
    off:    { input: { type: "object", properties: {}, additionalProperties: false },
              output: { … } },                                   // CrewSwitchView
  },
  events: {},
} satisfies Rpc.PortableDefinition

/** 服务端视图投影（纯函数，可单测）。 */
export function toProfilesView(info: CrewProfilesInfo): CrewProfilesView

/** TUI 侧不得信任线上数据：全部字段重新校验，坏数据降级为空视图。 */
export function parseProfilesView(value: unknown): CrewProfilesView
export function parseSwitchView(value: unknown): CrewSwitchView | undefined

export async function registerProfileRpc(ctx: Context, profiles: CrewProfileRuntime): Promise<void>
```

- 用**独立 definition id**（`opencode-crew-profiles`）而不是往 `crewTasks` 里塞方法：`src/snapshot.ts:1-2` 的注释明确它是"read-only contract"，把写方法混进去会破坏该契约与后续 review 的可读性；`ctx.rpc.register` 支持注册多个 definition（`dist/promise/rpc.d.ts:21`）。
- `registerProfileRpc` 内部：`await ctx.rpc?.register(crewProfiles, { list, switch, off })`，与 `src/tasks-snapshot.ts:69` 一致的防御式可选链。三个 handler **永不 throw**，一律返回结构化结果（错误走 `ok:false` + `code` + `message`），避免 RPC 层把宿主异常体透给 TUI。
- `list` handler 不写盘，纯读；`switch`/`off` handler 直接调 `profiles.switch/off`。
- 输入非法（非对象、`name` 不是合法档名）→ `switch` 返回 `ok:false, code:"INVALID_NAME"`，`off` 直接执行，`list` 直接返回当前视图。

### 7.5 `src/tasks.ts` 签名变更

```ts
// before: export async function registerTasks(ctx: Host, configuredModel?: ModelRef)
export type ModelSource = ModelRef | (() => ModelRef | undefined)
export async function registerTasks(ctx: Host, configuredModel?: ModelSource)
```

内部：

```ts
const readModel = () => (typeof configuredModel === "function" ? configuredModel() : configuredModel)
```

在 `start` 内（`src/tasks.ts:138` 之后、`:151` 之前）取一次：`const model = readModel()`，随后三处改用 `model`：

| 行 | 现在 | 改后 |
|---|---|---|
| `src/tasks.ts:151` | `if (!existing && !(configuredModel ?? owner.model))` | `if (!existing && !(model ?? owner.model))` |
| `src/tasks.ts:158` | `model: configuredModel ?? owner.model!` | `model: model ?? owner.model!` |
| `src/tasks.ts:167` | `modelFamilyTaskHint(configuredModel ?? owner.model)` | `modelFamilyTaskHint(model ?? owner.model)` |

兼容性：现有 fixture 全部以 `registerTasks(ctx)` 无第二参调用（`test/fixtures/*.ts:22/25/30`），新签名完全兼容；`index.ts` 改为传 getter。

**错误文案**：`src/tasks.ts:61` 的 `MODEL_NOT_CONFIGURED.nextAction` 目前只说“配置 options.models.engineer”。档生效时用户可能已经在 `opencode.json` 配了 engineer，只是被 active 档整档替换掉了；建议改为“配置 active 档或 options 的 `models.engineer`……”并保留 `models.engineer` 子串，以满足现有断言 `test/tasks-tools.test.ts:121`。

### 7.6 TUI 模块

```ts
// src/tui/profile-command.ts（纯函数）
export const PROFILE_USAGE: string
export type ProfileCommand =
  | { kind: "menu" } | { kind: "list" } | { kind: "off" } | { kind: "help" }
  | { kind: "switch"; name: string }
  | { kind: "invalid"; message: string }
export function parseProfileCommand(raw: string): ProfileCommand
```

解析规则（`raw` 先 `trim()`）：

| 输入 | 结果 |
|---|---|
| `""` | `menu` |
| `list` / `ls` | `list` |
| `off` / `none` | `off` |
| `help` / `-h` / `--help` | `help` |
| 单 token 且 `isProfileName` | `switch` |
| 其他（多 token、非法字符、超长） | `invalid`（message 带用法） |

```ts
// src/tui/profile-menu.ts（纯函数）
export type ProfilePick = { kind: "profile"; name: string } | { kind: "off" }
export function profileOptions(view: CrewProfilesView): {
  options: DialogSelectOption<ProfilePick>[]
  current: ProfilePick | undefined
}
export function profileListText(view: CrewProfilesView): string
export function profileFooterLabel(view: { active?: string; error?: string } | undefined): string | undefined
```

`profileOptions` 规则：
- 每档一项：`title = (current ? "● " : "  ") + name`，`description = (rootModel ? \`root: ${rootModel} · \` : "root: inherit · ") + \`${models} 模型 / ${steps} 步数 / ${instructions} 补充规则\``，`value = { kind:"profile", name }`，`source==="package"` 时 `footer = "内置"`。
- 末尾固定追加：`title = "关闭档位（回到 opencode.json）"`，`value = { kind:"off" }`。
- `current`：`view.active` 命中某档 → 该档；`view.active` 缺省 → off 项。
- 无可用档且无 off 需求时不返回空菜单：仍返回 off 一项（保证用户永远能"关"）。

`profileFooterLabel` 规则（**默认零视觉占用**）：

| 状态 | 返回值 |
|---|---|
| `active` 有值、无 error | `profile: <name>` |
| `active` 有值、有 error | `profile: <name> ⚠` |
| `active` 缺省、有 error | `profile: off ⚠` |
| `active` 缺省、无 error | `undefined`（footer 不渲染任何内容） |
| `view === undefined`（RPC 未就绪/失败） | `undefined` |

渲染：`<Row spans={[{ text: label, tone: active ? "muted" : "warning" }]} />`，复用 `src/tui/rows.tsx:21-31`。

```ts
// src/tui/profile-actions.ts（有副作用，可用 fake context 单测）
export function profileRpc(context: Context): RpcClient<typeof crewProfiles>
export async function refreshProfile(context: Context): Promise<CrewProfilesView | undefined>
export async function runProfileCommand(context: Context, raw: string): Promise<void>
```

`runProfileCommand` 的分支（每一步都 `try/catch`，绝不把异常抛给 keymap 层）：

| command | 流程 |
|---|---|
| `help` | `ui.dialog.alert({ title:"Crew 配置档", message: PROFILE_USAGE })` |
| `list` | `refreshProfile` → `ui.dialog.alert({ title:"Crew 配置档", message: profileListText(view) })` |
| `menu` | `refreshProfile` → `ui.dialog.select({ title:"Crew 配置档", options, current })` → `profile` → `switch`；`off` → `off`；`undefined`（Esc）→ 返回 |
| `switch` | `rpc.switch({ name })` → `ok` 时 `ui.toast.show({ variant:"success", message:"已切换到档 \"x\"（新会话/下一次请求生效）" })`；失败 `ui.dialog.alert({ title:"切换失败", message })` |
| `off` | `rpc.off({})` → 成功 toast「已关闭档位，回到 opencode.json 配置」 |
| `invalid` | `ui.dialog.alert({ title:"用法", message: PROFILE_USAGE })` |
| 任一分支结束 | 用响应里的 `profiles`（或重新 `refreshProfile`）写 `storage.memory` 的 `{ active, error, at }`，footer 立即刷新 |

`src/tui/profile-footer.tsx`：
- `usePlugin()` → `storage.memory<{ active: string; error: string; at: number }>("opencode-crew-profile", { initial: { active: "", error: "", at: 0 } })`（`storage.memory` 要求 `Value extends object`，`dist/tui/context.d.ts:19-21`）。
- mount 时 `refreshProfile(context)`；`setInterval(refreshProfile, 60_000)`；`onCleanup(clearInterval)`。
- 读 memory store → `profileFooterLabel` → `undefined` 则不渲染 box，否则渲染单行 `<Row>`。

---

## 8. 逐文件修改点

> 行号基于当前 HEAD。插入位置以"函数/回调体内"为准，实现时以实际 diff 为准但不得改变语义位置。

### 8.1 `src/config.ts`（新增，约 110 行）

- 自 `src/index.ts:9-13`（`IDS` / `RoleID` / `ModelRef` / `Rule` / `Role` 中的 `IDS`、`RoleID`、`ModelRef` 与 `CrewConfig`）与 `src/index.ts:15-58`（`fail`/`object`/`instructions`/`options`）迁移。
- `options()` 改名 `parseCrewConfig(input, label = optionsLabel)`；所有 `fail(...)` 文案按 §7.1 的表格参数化。
- `Rule` / `Role` / `LoadedRole` / `loadRole` 留在 `src/index.ts`（它们只服务于 Markdown 加载，不应被 TUI 侧间接拉到）。
- 不得 import 任何 `node:fs`（TUI bundle 不需要它；虽然 TUI 不 import 本文件，但保持纯净便于复用）。

### 8.2 `src/profiles.ts`（新增，约 220 行）

按 §7.2 实现。额外约束：

- 顶层只 import `node:fs` / `node:path` / `node:os` 与 `./config`。
- `loadProfiles` 内**不得**出现任何写操作（`writeFileSync` / `renameSync` / `unlinkSync` / `mkdirSync`），便于 grep 审计。
- `profileDirs` 的 XDG 解析：`env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config")`，再 `join(base, "opencode", "crew-profiles")`。
- `readActive` 对指针内容做 `trim()`；trim 后为空 → off（`raw` 保留原文以便 `list` 说明）。

### 8.3 `src/profile-state.ts`（新增，约 130 行）

按 §7.3 实现。额外约束：

- 内部分两个函数：`resolve(baseline, deps): CrewProfilesInfo`（纯读，不抛）与 `apply(...)`（编排）。
- `resolve` 用 `try/catch` 包住整个读盘；任何意外异常 → `{ active:null, requested:null, error:"读取档目录失败：<message>", config: baseline, set: emptySet }`。
- `error` 文案要求可执行：至少包含"哪一步失败 + 已回退到 opencode.json"，例如
  `active 档 "fast" 不存在；已回退到 opencode.json 配置。可用档：gpt, local`
  `active 指针内容非法（只允许 a-z 0-9 . _ -，≤64 字符）；已回退到 opencode.json 配置`
- 不 import `@opencode/plugin`（保持可被纯单测驱动；`reload` 由外部注入）。

### 8.4 `src/profile-rpc.ts`（新增，约 180 行）

按 §7.4 实现。额外约束：

- JSON Schema 里**不要**用 `null` 类型（避免 `JsonSchema` 支持的差异），用"缺省字段"表达 off。
- 所有 handler `try/catch` → `ok:false, code:"HOST_ERROR"`；错误消息里**不得**出现宿主异常原文（沿用 `src/tasks.ts:89-92` 的"不外泄 body"纪律）。
- `parseProfilesView` 必须逐个字段类型校验并丢弃坏项（对齐 `src/snapshot.ts:130-136` 的 `parseTasksOutput` 风格）。

### 8.5 `src/index.ts`（修改）

| 位置 | 改动 |
|---|---|
| `:1-7` | 删除本地 `IDS`/`ModelRef` 与 `fail`/`object`/`instructions`/`options` 定义，改为 `import { IDS, parseCrewConfig, type CrewConfig, type ModelRef, type RoleID, fail, object } from "./config"`；新增 `import { createCrewProfiles } from "./profile-state"` 与 `import { registerProfileRpc } from "./profile-rpc"` |
| `:9-13` | 保留 `Rule` / `Role`；`RoleID`、`ModelRef` 改为从 `./config` 导入 |
| `:15-58` | 整段删除（已迁至 `src/config.ts`） |
| `:80` | `const config = options(ctx.options ?? {})` → `const baseline = parseCrewConfig(ctx.options ?? {})` |
| `:80` 之后（`:81` 之前）新增 | `const profiles = createCrewProfiles({ baseline, reload: async () => { if (typeof ctx.agent.reload === "function") await ctx.agent.reload() } })` —— **不得**放在 `try/catch` 外依赖抛错；`createCrewProfiles` 自身保证不抛 |
| `:82` 之后、`:83` 之前新增 | `const config = profiles.config()`（**在 transform 回调体内**，每次 transform 重新取值） |
| `:88` | `composeRoleSystem(role.system, role.appendices, config.models[id], id === "engineer" ? config.engineerInstructions : undefined)` 保持，但 `config` 现在是回调体内的局部量 |
| `:89` / `:90` | `config.steps[id]` / `config.models[id]` 同上 |
| `:92` | engineer 权限追加改为**幂等**：`const extra = role.permissions.filter(rule => !agent.permissions.some(p => p.action === rule.action && p.resource === rule.resource && p.effect === rule.effect)); agent.permissions = [...agent.permissions, ...extra.map(rule => ({ ...rule }))]` —— 防止 `agent.reload()` 重复执行 transform 时 deny 规则累积（新增风险，见 §13 R2） |
| `:93` | 不变（严格角色是整体替换，天然幂等） |
| `:95` | architect 的 `plans/** allow` 改为先查重再 push（防御性对称，`role.permissions` 里是相对 `plans/**`，绝对路径规则不会重复，但显式查重后语义更稳） |
| `:101-106` | `execute` 体内首行取 `const config = profiles.config()`；`:103` 用该局部量决定 `switchModel` |
| `:108` | `await registerTasks(ctx, config.models.engineer)` → `await registerTasks(ctx, () => profiles.config().models.engineer)`（**不得**捕获 `config`） |
| `:109` 之后新增 | `await registerProfileRpc(ctx, profiles)` |
| `:109` | `registerTaskSnapshot` 顺序不变（与 profiles 无依赖） |

### 8.6 `src/tasks.ts`（修改）

| 位置 | 改动 |
|---|---|
| `:104` | 签名改为 `registerTasks(ctx: Host, configuredModel?: ModelRef \| (() => ModelRef \| undefined))`；文件内新增 `type ModelSource` 或用内联联合 |
| `:104` 之后（`registerTasks` 体内首行） | `const readModel = () => (typeof configuredModel === "function" ? configuredModel() : configuredModel)` |
| `:138-142` 之后 | `const model = readModel()` —— 一次调用只取一次，保证同一次 `crew_task_start` 的判定、创建、提示词用同一模型 |
| `:151` / `:158` / `:167` | 见 §7.5 替换表 |

### 8.7 `src/tui/index.tsx`（修改，当前 14 行）

```tsx
/* @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { Sidebar } from "./sidebar"
import { ProfileFooter } from "./profile-footer"
import { runProfileCommand } from "./profile-actions"

export default Plugin.define({
  id: "opencode-crew",
  setup(context) {
    const sidebar = context.ui.slot({
      prepend: "sidebar.content",
      render: ({ sessionID }) => <Sidebar sessionID={sessionID} />,
    })
    const footer = context.ui.slot({
      append: "sidebar.footer",
      render: () => <ProfileFooter />,
    })
    context.keymap.layer(() => ({
      commands: [{
        id: "opencode-crew.profile",
        title: "Crew 配置档",
        group: "Crew",
        palette: true,
        slash: { name: "crew-profile", aliases: ["crewprofile"], arguments: true },
        run: input => runProfileCommand(context, input ?? ""),
      }],
    }))
    return () => { sidebar(); footer() }
  },
})
```

要点：
- `sidebar.content` 的 claim 与注释语义（"prepend inside the native boundary"）保持不变，避免影响现有布局回归。
- **两个 slot 的 cleanup 必须合并**（`src/tui/index.tsx:9-13` 当前直接返回单值）。
- `keymap.layer` 由宿主在插件停用时自动移除（`dist/tui/context.d.ts:391-398`），无需返回 cleanup。
- `ProfileFooter` 不带 `sessionID`：档是用户级状态，与具体会话无关；footer slot 的 input 可忽略。

### 8.8 `src/tui/sidebar.tsx`（不改）

footer 作为独立组件挂在 `sidebar.footer`，不侵入 `Sidebar`（`:205-228` 的渲染结构保持不变），避免影响 22 个测试里对 `buildSidebar` 的断言。

### 8.9 `test/setup.ts`（新增）+ `bunfig.toml`（修改）

```ts
// test/setup.ts —— 让整套测试与开发者本机真实档目录隔离
process.env.OPENCODE_CREW_PROFILES_DIR ??= ""
```

```toml
# bunfig.toml
[test]
root = "./test"
preload = ["./test/setup.ts"]
```

- 用 `??=` 而不是 `=`：允许开发者用 `OPENCODE_CREW_PROFILES_DIR=/tmp/x bun test` 显式跑真实目录。
- 空字符串语义（§5）保证 `profileDirs()` 返回 `[]`，因此**现有 22 个测试的行为与今天完全一致**，不会因为开发者本机有 active 档而随机变红。
- 子进程 fixture 通过继承 `process.env` 得到同一隔离。
- 若宿主/工具链对 `preload` 有兼容问题（备选）：在各 fixture 里显式传 `dirs: []` 给 `createCrewProfiles`，但那要改更多文件，故首选 preload。

### 8.10 `package.json`（仅当 D3 选择"预置示例档"时）

- `:18` `files` 追加 `"profiles"`。
- 不需要新增 `dependencies`（只用 `node:*` 与已存在的运行时代码）。

### 8.11 文档

| 文件 | 改动 |
|---|---|
| `README.md` | 在 `## Usage`（`:83`）下新增 `### Crew profiles` 子节：目录与 `OPENCODE_CREW_PROFILES_DIR`、档格式（含 `provider/model` 占位示例）、三条命令、整档替换语义（**显式写出 `engineerInstructions` 不会叠加**）、生效时机、失败回退、与 `opencode.json` 的边界（只覆盖三个字段，不动 provider/其他 agent/其他插件）、如何彻底关闭（`/crew-profile off` 或删 `active`）。在 `## Verification and limitations`（`:166`）追加一句"测试通过 `test/setup.ts` 与真实档目录隔离"。在 `## Roles as files`（`:142`）的文件树里补 `src/profiles.ts` / `src/profile-state.ts` / `src/profile-rpc.ts` / `src/tui/profile-*`。 |
| `README.zh-CN.md` | 同上，对应 `## 使用`（`:83`）、`## 验证与限制`（`:166`）、`## 文件即角色`（`:142`）。 |
| `docs/crew-profiles.md`（建议新增，可选） | 与 `docs/sidebar-ui.md`、`docs/model-family-prompts.md` 同级的长文档：完整格式、错误码表、与 `agent.reload` 的交互、第二阶段向导范围。README 只留摘要 + 链接，避免 README 继续膨胀。**是否拆出请见 D8。** |
| `profiles/README.md`（仅 D3 选择预置时） | 说明"示例档只有 `provider/model` 占位符，不含任何真实 provider/模型默认值"，与 README 现有"package contains no keys or concrete model defaults"的承诺一致。 |

---

## 9. TUI 与 server 的分工

### 9.1 结论

| 能力 | 归属 | 理由 |
|---|---|---|
| 读目录、校验档、写 `active` 指针 | **server** | 档目录在 server 机器上；TUI 可能是远端 attached 客户端，不能假设同机文件系统 |
| 重新合成配置、`agent.reload()` | **server** | 配置与 agent 定义只存在于 server 进程；TUI 无法触达 |
| RPC 三方法 `list`/`switch`/`off` | **server** | 唯一跨进程通道（沿用 `crewTasks` 的既有模式） |
| 命令解析、选择面板、toast、alert | **TUI** | server command 无 UI 输出通道（`dist/promise/command.d.ts:6-15`） |
| 当前档的显示缓存 | **TUI**（`storage.memory`） | 仅用于 footer 立即刷新；**不是**真相来源，真相永远是磁盘 |

### 9.2 为什么不注册 server command（决策 D1，建议采纳）

不在 `ctx.command.transform` 里注册 `/crew-profile`，原因：

1. **无法反馈**：`CommandDefinition.execute({sessionID, prompt, delivery})` 没有 UI 通道。切成功、档损坏、档名拼错都只能静默，用户会以为命令没生效。
2. **同名命令冲突不可验证**：TUI 的 slash（`keymap.layer` 的 `slash.name`）与 server 的 `command.transform` 若用同一个名字，宿主的合并/覆盖规则未在本仓库验证过，可能互相遮蔽或双触发，而本仓库的验收门禁（`bun test` + `bun run build`）无法覆盖这种宿主行为。
3. **非 TUI 客户端不需要它**：`opencode run` 等场景下，用户可以直接 `echo fast > ~/.config/opencode/crew-profiles/active`（文件就是 API，文档里写明），比一个无输出的 slash 更可靠。
4. **server 命令会把参数当 prompt 文本**，语义上容易和"发一条消息"混淆。

若你坚持要 server 侧入口，最小可行形态是注册一个**只做切换、不做展示**的 `crew-profile` server command，并**同时移除** TUI 的 slash 同名注册（避免冲突），代价是切换完全无反馈。

### 9.3 时序（切换一次）

```
TUI 进程                                    server 进程
runProfileCommand("fast")
  rpc.switch({name:"fast"})  ───────────►   profiles.switch("fast")
                                              ├ 校验档名
                                              ├ loadProfiles + findProfile
                                              ├ writeActive("fast")  [原子写]
                                              ├ resolve() 复核 active==="fast"
                                              ├ ctx.agent.reload()   ← transform 重新执行
                                              │     └ 回调体内 profiles.config() 读到新档
                                              └ return {ok, active:"fast", profiles}
  ◄────────────────────────────────────────
  ui.toast.success("已切换到档 \"fast\"")
  storage.memory ← { active:"fast" }
  footer 立即显示 profile: fast
```

`/crew` 与 `crew_task_start` 不需要额外通知：它们每次调用都重新 `profiles.config()`。

---

## 10. 错误与回退表

### 10.1 启动期（`Plugin.setup`）

| # | 情况 | 插件加载 | 生效配置 | `active` 视图 | 用户可见 |
|---|---|---|---|---|---|
| S1 | `OPENCODE_CREW_PROFILES_DIR=""` | 正常 | baseline | off | 无（显式关闭） |
| S2 | 档目录不存在 | 正常 | baseline | off | 无（footer 不渲染） |
| S3 | 目录存在、无 `active` | 正常 | baseline | off | 无 |
| S4 | `active` 为空/纯空白 | 正常 | baseline | off | 无 |
| S5 | `active` 指向不存在的档 | 正常 | baseline | off + error | `list` 与 footer `profile: off ⚠`；`list` 列出可用档名 |
| S6 | `active` 指向损坏档（JSON/schema） | 正常 | baseline | off + error | 同上，error 带该档的字段级原因 |
| S7 | `active` 内容非法（穿越/超长/字符） | 正常 | baseline | off + error | 同上；**不尝试读该路径** |
| S8 | `active` 不可读（EACCES） | 正常 | baseline | off + error | 同上 |
| S9 | 档目录不可读（EACCES） | 正常 | baseline | off + error | 同上，error 说明目录 |
| S10 | 某非 active 档损坏 | 正常 | 视 active 而定 | 不变 | 仅 `list` 里逐条告警 |
| S11 | `options` 非法 | **fail 启动**（现状不变） | — | — | 现有 `[opencode-crew] …` 错误 |
| S12 | `createCrewProfiles` 内部意外异常 | 正常 | baseline | off + error | error 含"读取档目录失败" |

> S11 是**有意保留**的硬失败：档位是"可选的覆盖层"，不是"修配置错误的逃生门"。放松它会让拼错 `models` 的用户静默跑到默认模型上。

### 10.2 切换期（`switch` / `off`）

| # | 情况 | 磁盘 | 内存/agent | 返回 |
|---|---|---|---|---|
| C1 | 档名非法 | 不变 | 不变 | `ok:false, INVALID_NAME` |
| C2 | 档不存在 | 不变 | 不变 | `ok:false, NOT_FOUND`（message 带可用档名） |
| C3 | 档校验失败 | 不变 | 不变 | `ok:false, INVALID_PROFILE`（带字段路径） |
| C4 | 指针对已是最新且配置相同 | 不写 | 不变（不 reload） | `ok:true, changed:false` |
| C5 | 写指针失败（EACCES/ENOSPC） | 不变（临时文件已清理） | **不变** | `ok:false, WRITE_FAILED` |
| C6 | 写入成功但复核不符 | 已改 | 不变 | `ok:false, APPLY_FAILED`（提示人工核查 `active`） |
| C7 | 写入成功但 `reload()` 抛错 | 已改 | 下次宿主动作后对齐 | `ok:true` + `warnings[]` |
| C8 | 宿主无 `agent.reload` | 已改 | 同上（走 warning） | `ok:true` + warning |
| C9 | 宿主无 `ctx.rpc` | — | — | TUI 侧 alert「宿主不支持 RPC，无法切换」（server 侧静默跳过注册） |
| C10 | `off` 且本来就没有指针 | 不变 | 不变（不 reload） | `ok:true, changed:false` |

### 10.3 三个失败原则

1. **fail-open 到 baseline，绝不 fail-close 到"不加载"**（S1–S10、S12）。
2. **失效即失效声张**：任何回退都必须有一条可读 error 出现在 `list` 与 footer，不允许静默回退。
3. **写盘失败不得留下半生效状态**（C5/C6）。

---

## 11. 一致性、生效时机与并发

### 11.1 生效时机

| 消费点 | 何时看到新档 |
|---|---|
| `/crew` 的 root 模型 | 下一条 `/crew` 命令（`execute` 内实时读） |
| `crew_task_start` 的 engineer 模型 | 下一次 `crew_task_start`（getter 实时读） |
| 五个 agent 的 system/steps/model | 切换触发的 `agent.reload()` 之后；若宿主重载失败，则下一次宿主动作/`/reload` 后 |
| 已在运行的 engineer 会话 | **不变**（模型与会话绑定；`README.md:88` 已声明"systems 不是创建期快照"，但模型切换只影响后续请求/新会话） |
| footer | 切换后立即；外部手改最多 60s |

**文案要求**：切换成功的 toast 必须写明"下一次请求/新会话生效"，不能让用户以为在跑的任务会中途换模型。

### 11.2 `agent.reload()` 的重复执行风险

`agent.transform` 会**重复执行**（每次宿主重建 agent 列表）。当前实现里：

- `agent.name/description/mode/system/steps/model` 是**赋值覆盖** → 幂等。
- root / architect / explorer / reviewer 的 `permissions` 是**整体替换**（`src/index.ts:93`）→ 幂等。
- **engineer** 是 `[...agent.permissions, ...role.permissions]`（`src/index.ts:92`）→ **不幂等**：同一对象被 transform 两次就会得到两份 `subagent/question/execute` deny。

今天这不是 bug，因为 transform 实际只跑一次；**本方案引入反复 `reload()` 后它会变成真问题**。因此 §8.5 要求把 engineer 的追加改成按 `(action, resource, effect)` 查重，并新增回归测试（§13 用例 `crew.test.ts` 的"transform 两次"）。

### 11.3 多实例一致性

- **唯一真相是磁盘**（§7.3 不缓存），所以任何实例下一次 `profiles.config()` 都会读到新档。
- 已运行的**其他** server 实例的 agent 定义（system/steps）不会自动重载 —— 只有执行切换的那个实例调用 `reload()`。它们的 `/crew` 与 `crew_task_start` 会先用上新配置，agent 定义在下一次宿主重载后对齐。这是已知且可接受的偏差，文档写清，不做跨进程广播。
- 同一实例内的多项目：`ctx.rpc.register` 按 location 实例化（既有 `crewTasks` 已是如此），档目录与指针是用户级常量，因此各项目看到同一档。

### 11.4 并发写

不做跨进程锁。两次并发 `switch` 各自"读→写→复核"，最坏结果是后者覆盖前者，两者都会返回自己复核到的状态；不会产生半行文件（原子 rename）。这与 Pi 参考实现"尽力原子写、不引入锁"的取舍一致。

---

## 12. 安全与写盘

| 项 | 要求 |
|---|---|
| 档名 | 正则白名单（§4.1），不含路径分隔符，因此 `join` 不可能穿越；写入前再 `assertProfileName` 一次（防 RPC 直传） |
| 目录 | 仅在写指针需要时 `mkdirSync(recursive, 0o700)`；不 chmod 已存在目录 |
| 指针写入 | 同目录临时文件 `flag:"wx"` + `0o600` → `renameSync`；失败清理临时文件后重抛 |
| 档文件 | 插件**只读**，从不写、从不 chmod；`profiles.ts` 内不得出现写 `*.json` 的路径 |
| 内容执行 | 只 `JSON.parse`，不 `import`/`require`/`eval`/`new Function` |
| 环境 | 只读 `OPENCODE_CREW_PROFILES_DIR` 与 `XDG_CONFIG_HOME`；不读 `.env`、不读任何凭据文件 |
| 日志与错误 | 错误消息只含档名、目录、字段路径；不含文件全文、不含宿主异常 body |
| symlink | 读档允许跟随 symlink（便于用户把档放在 dotfiles 里）；写指针用 rename，替换 symlink 本身而非穿透写入 |
| 体积 | 单档读入前不做大小上限则存在巨大文件风险 → 读入后 `length > 1MB` 直接判 `invalid-config`（`档 "x" 超过 1MB`） |

---

## 13. 测试矩阵

新增测试文件 5 个（按 `test/setup.ts` 隔离真实目录）：

| 文件 | 覆盖点 | 关键断言 |
|---|---|---|
| `test/profiles.test.ts` | `profileDirs`（env 非空/空/未设置 + XDG 回退）；`loadProfiles`（只认 `*.json`、跳过 `.` 开头、大小写扩展名、损坏档隔离、排序、目录不可读）；`assertProfileName`（含 `../x`、`/x`、`.hidden`、超长、`""`）；`readActive` 四态；`writeActive`（0600、原子替换、off 删除、ENOENT 容忍、目录自动创建 0700、rename 失败清理临时文件）；1MB 上限 | 用 `mkdtempSync` + `WORK`（`test/workdir.ts:3-8`）；`fs` 注入模拟 EACCES/rename 失败 |
| `test/profile-state.test.ts` | S1–S10、C1–C10 全表；`switch` 顺序（校验失败零写盘、写失败不 reload）；`changed` 幂等；`reload` 调用次数（0 或 1）；`info()` 每次读盘（改文件后立刻反映）；`deepEqual` 三字段比较 | 注入 `reload: async () => calls++`、`fs` 故障注入 |
| `test/profile-rpc.test.ts` | `crewProfiles` definition 形状（id、三方法、`events:{}`、schema 无 `null`）；`toProfilesView` 投影；`parseProfilesView`/`parseSwitchView` 对坏数据的降级；handler 对 `rpc undefined` / `list`/`switch`/`off` 的行为；错误不透传宿主异常 body | fake `ctx.rpc.register` 捕获 definition 与 handlers |
| `test/tui-profile.test.ts` | `parseProfileCommand` 全表；`profileOptions`（`●` 标记、off 项恒在、`current` 推导、package `footer`）；`profileListText`（含错误行、无目录行）；`profileFooterLabel` 五态（含 `undefined`） | 纯函数，无渲染器 |
| `test/tui-profile-actions.test.ts` | `runProfileCommand` 在 fake TUI context 下：menu→select→switch 链路；Esc 取消零写；switch 失败走 alert；off 成功走 toast；memory store 被更新；`refreshProfile` 失败不抛 | fake `context.client.rpc` / `ui.dialog.select` / `ui.toast.show` / `storage.memory` |

修改既有测试：

| 文件 | 追加用例 |
|---|---|
| `test/crew.test.ts` | ① 有 active 档时五个 agent 的 `model`/`steps`/`system` 全部来自档；② 档缺 `models.root` 时 `/crew` **不**调用 `switchModel`；③ `/crew-profile off` 后恢复 `options` 配置；④ engineer 权限在**连续两次 transform** 后不重复；⑤ 档损坏时 setup 不抛、agent 仍按 options 配置 |
| `test/tasks-tools.test.ts` | 在 `:113-117` 附近追加：`registerTasks` 传 getter 时，`create.model` 取 getter 返回值；getter 返回值随外部状态改变后，第二次 `crew_task_start` 用新值 |
| `test/tasks-interface.test.ts` | 追加：`registerTasks(ctx)` 无第二参仍工作在 `MODEL_NOT_CONFIGURED` 路径上（签名兼容回归） |

门禁命令（每步见 §14.1）。`bun test` 后应有 **27 个** `*.test.ts`（22 + 5）。

---

## 14. 分阶段 Todo

### 14.1 MVP（本次实施范围）

按依赖顺序，每步都能独立跑绿再进入下一步。

| # | 步骤 | 目标文件 | 局部验证 |
|---|---|---|---|
| M1 | 抽出配置校验与类型，`label` 参数化，`options()` 改名 `parseCrewConfig` | 新增 `src/config.ts`；改 `src/index.ts:1-58`、`:80` | `bun test test/crew.test.ts test/tasks-interface.test.ts`（现状须全绿，证明纯重构） |
| M2 | 测试隔离基座 | 新增 `test/setup.ts`；改 `bunfig.toml` | `bun test test/test-discovery.test.ts test/crew.test.ts`（证明 preload 不影响既有发现规则） |
| M3 | 档目录/加载/校验/指针 | 新增 `src/profiles.ts` | `bun test test/profiles.test.ts` |
| M4 | 运行时合成与切换编排 | 新增 `src/profile-state.ts` | `bun test test/profile-state.test.ts` |
| M5 | `registerTasks` 惰性模型 | 改 `src/tasks.ts:104`、`:138-167`；追加 `test/tasks-tools.test.ts`、`test/tasks-interface.test.ts` 用例 | `bun test test/tasks-tools.test.ts test/tasks-interface.test.ts` |
| M6 | server 接线（transform/命令/tasks 全部读实时配置 + engineer 权限幂等 + 注册 RPC） | 改 `src/index.ts:80-110`；新增 `src/profile-rpc.ts` | `bun test test/profile-rpc.test.ts test/crew.test.ts` |
| M7 | TUI 纯函数层 | 新增 `src/tui/profile-command.ts`、`src/tui/profile-menu.ts` | `bun test test/tui-profile.test.ts` |
| M8 | TUI 副作用层与接线 | 新增 `src/tui/profile-actions.ts`、`src/tui/profile-footer.tsx`；改 `src/tui/index.tsx` | `bun test test/tui-profile-actions.test.ts`；`bun run build`（验证 TUI bundle 能解析新 import） |
| M9 | 文档 | 改 `README.md`、`README.zh-CN.md`；（可选）新增 `docs/crew-profiles.md` | 人工通读；确认示例只用 `provider/model` 占位 |
| M10 | 全量门禁 | — | `bun test`（27 文件全绿）；`bun run build`（exit 0，产出 `dist/index.js` 与 `dist/tui.js`） |

**M6 的隐藏验收点**：`test/crew.test.ts` 现有 15 个用例必须**零修改**通过 —— 它们都没设 `OPENCODE_CREW_PROFILES_DIR`，靠 M2 的 preload 隔离；若有任何用例需要改断言才能过，说明 I1 被破坏，应回退实现而不是改测试。

### 14.2 第二阶段（本次不做，仅登记范围）

| # | 内容 | 前置 |
|---|---|---|
| P1 | `/crew-profile new` / `edit` 向导：`ui.dialog.prompt` 取档名 → 逐角色选择模型 → `writeActive` 之外的档写入（新增 `writeProfile`，同 M3 的原子写） | MVP 合入；需先定"档文件写入也走 0600 + 备份"的细节 |
| P2 | 模型候选列表（`context.data.location.model.list(location)`）接入向导 | P1；注意不要硬编码 provider 名 |
| P3 | `/crew-profile delete <name>`（删除前备份，参考 Pi 的 `.bak-<stamp>` + 保留 5 份） | P1 |
| P4 | 包内示例档 + shadowing | D3 若改为"要预置" |
| P5 | 项目级覆盖（`<cwd>/.opencode/crew-profiles/`，项目档 > 用户档） | 需再定"项目档是否允许指针" |
| P6 | footer 可点击打开面板（`onMouseDown` → `runProfileCommand(context, "")`） | MVP 的 footer 已合入 |
| P7 | 若 profiling 显示热点，再引入 `mtime+size` 指纹缓存 | 有实测数据 |

---

## 15. 需要你拍板的决策

> 以下 8 项我给了建议与理由；不拍板也可以按建议推进，但 D1/D2/D3 会直接改变交付物形状。

| # | 决策 | 我的建议 | 理由 | 备选 |
|---|---|---|---|---|
| **D1** | 命令归属 | **只在 TUI 注册 slash `/crew-profile`**，不注册 server command | server command 无 UI 输出（`dist/promise/command.d.ts:6-15`），切换无反馈；同名命令的宿主合并规则不可验证 | 只注册 server command（无反馈）；或两者都注册（冲突风险，需真机验证） |
| **D2** | MVP 是否带状态显示 | **带 `sidebar.footer` 一行，但默认零占用**（仅 active 或有 error 时渲染 `profile: <name>` / `profile: off ⚠`） | 没有状态显示时用户无法确认当前档，切错档很难发现；"off 且无错误就不渲染"完全满足"无档时视觉与今天一致" | 完全不做（靠 `/crew-profile list`）；或改用 `prompt.footer.status`（更醒目但更打扰输入区） |
| **D3** | 是否预置包内示例档 | **不预置**（MVP 只有用户目录） | 仓库明确承诺"不含真实 provider/model 默认值"，示例只能是 `provider/model` 占位符；用户一旦切到占位档，模型解析失败，首用体验更差。且预置需改 `package.json:18` 与 shadowing 逻辑 | 预置 1–2 个占位档 + shadowing（代码量约 +40 行 + `files` 改动） |
| **D4** | 档位作用域 | **用户级全局**（所有项目共享一个 active 指针） | 与 Pi 参考实现一致；档描述的是"这台机器上我愿意用哪套模型"，不是项目属性 | 项目级覆盖（P5），或"用户档 + 项目档"两级 |
| **D5** | 档生效时 `opencode.json` 的 `engineerInstructions` 是否叠加 | **不叠加**（严格整档替换，档缺省即清空） | 与 `models`/`steps` 保持同一语义，避免"部分字段替换、部分字段合并"的认知负担；README 会显式写明 | 叠加（档在前、options 在后）——语义更复杂，且与"整档"口径冲突 |
| **D6** | 切换是否需要二次确认 | **不确认**，但 toast 明确"下一次请求/新会话生效" | 切档是可逆、低风险操作；弹确认会让"来回试档"变烦 | `ui.dialog.confirm`（仅在存在运行中的 engineer 会话时确认） |
| **D7** | 切换后是否调用 `ctx.agent.reload()` | **调用**，失败降级为 warning | 不调用则 system/steps 要等宿主自然重载，用户会觉得"切了没变"；`reload` 已在 `dist/promise/agent.d.ts:14` 公开 | 不调用，改为文档要求用户 `/reload`（体验差） |
| **D8** | 文档形态 | README + README.zh-CN 各加一节（必需），**另建 `docs/crew-profiles.md` 承载细节** | 与 `docs/sidebar-ui.md`、`docs/model-family-prompts.md` 的既有惯例一致；README 已 172 行，继续内联会失控 | 只写 README（更简单，但 README 变长） |

---

## 16. 风险与开放问题

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | `ctx.agent.reload()` 是否真的重跑 `agent.transform`，未在本仓库验证（无真机门禁） | 若不重跑，system/steps 不生效，只有 `/crew` 与 `crew_task_start` 生效 | 已在 §11.1 写明"以 `reload` 成功为前提"；`switch` 返回 warning 通道；README 的"生效时机"如实描述；真机验收清单（§17.2）包含该项。另注意 `agent.reload()` 可能触发其他插件注册的 agent transform，切换时需在真机观察副作用，不要把它当成 crew 私有操作。 |
| R2 | transform 重复执行导致 engineer 权限累积 | 权限规则膨胀，行为仍正确但列表脏 | §8.5 的幂等查重 + `test/crew.test.ts` 双次 transform 回归 |
| R3 | 指针与档文件非事务：删/改档后指针残留 | 回退到 baseline（S5/S6） | 已在 §10 覆盖；`list` 明确报"active 档 X 不存在，可用：…" |
| R4 | 开发者本机有 active 档会让 `bun test` 变红 | 测试不确定 | `test/setup.ts` + `bunfig.toml` preload 隔离（§8.9）；`OPENCODE_CREW_PROFILES_DIR=…` 可显式覆盖 |
| R5 | TUI 与 server 的 RPC 契约漂移（schema 与投影不一致） | footer/list 显示错数据 | `parseProfilesView` 严格校验 + `test/profile-rpc.test.ts` 对坏数据断言 |
| R6 | 档名与子命令重名（用户建 `off.json` / `list.json`） | 该档无法用 `/crew-profile <name>` 直达 | MVP 只读不写档，风险低；文档注明保留名 `off`/`none`/`list`/`ls`/`help`；P1 写入时在 `assertProfileName` 里加保留名拒绝 |
| R7 | 远端 TUI（`opencode serve` + attach）场景未验证 | footer 依赖 RPC 可用性 | footer 在 RPC 失败时静默不渲染；`runProfileCommand` 失败走 alert |
| R8 | 1MB 上限可能挡住合法的大档 | 罕见 | 上限只用于防呆，错误消息给出实际大小 |
| R9 | 依赖 `keymap.layer` 的 `slash` 语义（`dist/tui/context.d.ts:355-360`）在宿主中的实际表现未真机验证 | 命令可能不出现 | §17.2 真机清单第一条；备选是改用 palette + 键位绑定 |
| R10 | `storage.memory` 的跨热重载共享（`dist/tui/context.d.ts:14-21`）语义依赖宿主 | footer 短暂显示旧值 | 60s 校准 + 每次命令后强制刷新；footer 只是显示层，不影响生效 |

开放问题（不阻塞 MVP）：

1. 是否需要 `/crew-profile` 的 Tab 补全（Pi 有 `getArgumentCompletions`）。OpenCode 的 `slash` 定义（`dist/tui/context.d.ts:355-360`）没有参数补全字段 → MVP 不做，等宿主支持。
2. `steps` 是否值得放进档？保留了（用户明确要求覆盖 `steps`），但注意它与 `agents/*.md` 的 frontmatter 存在双写风险 —— 文档需说明"档里的 steps 覆盖 Markdown 默认值"。
3. 是否要一个"当前档来源"提示（`内置` vs `用户`）。MVP 只有一个目录，故 `source` 恒为 `user`，字段已留好。

---

## 17. 验收标准

### 17.1 自动化门禁（必须全绿，Engineer 返回前自行执行）

| 命令 | 通过标准 |
|---|---|
| `bun test test/profiles.test.ts` | 全 pass |
| `bun test test/profile-state.test.ts` | 全 pass |
| `bun test test/profile-rpc.test.ts` | 全 pass |
| `bun test test/tui-profile.test.ts` | 全 pass |
| `bun test test/tui-profile-actions.test.ts` | 全 pass |
| `bun test` | **27 个** `*.test.ts` 全 pass，0 fail；既有 22 个文件的断言**未被修改**（除确认为 bug 的例外需单独说明） |
| `bun run build` | exit 0；`dist/index.js` 与 `dist/tui.js` 均重新生成且能解析所有新 import |

> 仓库当前没有 `typecheck` 脚本（`package.json:19-23`），且 `bun build` 只剥离类型不做类型检查。**不要**在本轮偷偷引入 `tsc` 依赖；类型正确性靠测试与 review。

### 17.2 真机验收清单（可选，需真实宿主；不由本仓库测试覆盖）

1. 安装后不建档目录 → `/crew`、五个角色、footer 表现与升级前一致（无新增可见元素）。
2. 建 `~/.config/opencode/crew-profiles/fast.json`（含 5 个 `provider/model`）→ `/crew-profile list` 能看到；`/crew-profile` 面板显示 `●` 与 off 项。
3. `/crew-profile fast` → toast 成功；footer 出现 `profile: fast`；`/crew` 切到档内 root 模型；新 `crew_task_start` 的 engineer 会话用档内 engineer 模型；engineer system 出现对应模型族附录。
4. `/crew-profile off` → footer 消失；`/crew` 回到 `opencode.json` 的 root 模型。
5. 手改档文件里的 `steps.engineer` → 下一次 `/crew` 或重载后生效，无需重启进程。
6. 把 `active` 写成 `nope` → 重启 OpenCode 后插件正常加载、按 `opencode.json` 运行、footer 显示 `off ⚠`、`list` 给出可用档名；`/crew-profile off` 可清除。
7. 把 `active` 写成 `../escape` → 同上；确认没有读取目录外文件。
8. `ls -l` 确认 `active` 为 `-rw-------`，档目录为 `drwx------`。

### 17.3 文档验收

- `README.md` 与 `README.zh-CN.md` 均含：目录与 `OPENCODE_CREW_PROFILES_DIR`、档格式、三条命令、整档替换语义、生效时机、失败回退、与 `opencode.json` 的边界、彻底关闭方式。
- 示例中**只出现** `provider/model` 占位符，不出现任何真实 provider 或模型名。
- 明确写出"档生效时 `opencode.json` 的 `engineerInstructions` 不叠加"（D5 的结论）。

---

## 18. 附：本文与 Pi 参考实现的差异对照

| 维度 | pi-subagent-switch | 本方案 | 原因 |
|---|---|---|---|
| 被替换对象 | `settings.json` 的 `subagents` 整块（读-改-写主配置） | 三个字段的**内存合成**，主配置只读 | 主配置含 provider/插件/注释，重写风险不成比例 |
| 生效机制 | 不调用 `ctx.reload()`，靠 pi-subagents 的 `size:mtimeMs` 指纹惰性重读 | 显式 `ctx.agent.reload()` + 每次实时读盘 | OpenCode 的 agent 定义不自动跟随外部文件变化 |
| 当前档来源 | 内容深比较（无状态文件） | 显式 `active` 指针文件 | 我们拿不到可比较的主配置文本 |
| 目录优先级 | env（不回退）→ 用户 → 包内，同名 shadowing | env（不回退）→ 用户；包内列为 D3 可选项 | 避免占位档造成首用故障 |
| 备份 | 每次写 settings 前 `.bak-<stamp>`，保留 5 份 | MVP 不需要（只写一行指针）；P1 写档时再引入 | 指针可随时重建，档文件由用户自己管理 |
| 向导 | `/subprofile new|edit` 全键盘向导 | 第二阶段 | 控制 MVP 面积，先验证"读+选"是否够用 |
| 状态显示 | 状态栏总是显示 `subagents: <档|无档>` | footer 仅在 active 或 error 时显示一行 | 满足"无档时零视觉改动"的硬约束 |
