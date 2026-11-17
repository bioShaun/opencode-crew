# Delegations 模型列 · 实施方案

日期：2026-11-10
状态：待执行（用户执行，本文即契约）
关联：`plans/subagent-model-label-investigation.md`（方向已由「原生工具行原位标签」改为「Crew 侧栏 Delegations」）

## 0. 定案摘要

| 项 | 结论 |
|---|---|
| 位置 | Delegations 每个运行中 delegation 行，角色与活动之间 |
| 形态 | 7 列纯文本标签，不反显、不着色、无 popover |
| 数据 | `SessionInfo.model`（实际会话模型）；缺失显示 `—`，**不回落 Crew 配置值** |
| 文案 | 已有定案：活动列已去掉 `Running`，streaming 用 `prep` |
| 别名 | `options.modelAliases`，TUI 侧直接读 `context.options`；未命中回退截断 `model.id` |
| 开关 | `options.modelDisplay: "inline" \| "off"`，默认 `inline` |
| 不做 | stacked / detail-only、hover popover、背景块、颜色、variant、Subagents 加列 |

列宽（37 列，`view-model.ts` 的 `WIDTH`）：

```text
inline : 角色 10 + 空 1 + model 7 + 空 1 + 活动 11 + 空 1 + 步数 6 = 37
off    : 角色 10 + 空 1 +              活动 19 + 空 1 + 步数 6 = 37
```

验收快照：

```text
Delegations (2 running)
engineer   ds4.1   edit…       ~41/80
explorer   h4-lite read…        ~8/30
```

## 1. 已核实的事实（不要重复调查）

- `SessionInfo.model?: ModelRef`，`ModelRef = { id, providerID, variant? }`
  （`node_modules/@opencode/client/dist/promise/generated/types.d.ts`）。
- `AgentInfo.model?: ModelRef` 也存在，但**不用**：它是配置值，不是实际模型。调查记录已明确「不能把配置值未经说明地当作实际模型」。
- `data.location.model: LocationCollection<ModelInfo>`，`ModelInfo` 有 `name` / `family` / `variants`。v1 不用它做列宽计算。
- **TUI 能直接读插件 options**：`Context.options: Readonly<Record<string, any>>`
  （`node_modules/@opencode/plugin/dist/tui/context.d.ts:480`）。因此别名**不需要 RPC**，和 server 共享同一份 options。
- server 侧 `ctx.options` 在 `src/index.ts:35` 读取；`parseCrewConfig` 会拒绝未知键（`src/config.ts:57`），所以必须给它开一个显式的展示键入口，不能直接塞。
- OpenTUI 的 `TextNodeOptions` 支持 `bg`，但 v1 不用（见 §10）。

## 2. M1 · 数据透传（先做，纯内部）

目标：让 `SessionView` 带上实际模型，UI 不变，全量测试仍绿。

### 2.1 `src/tui/view-model.ts:24`

```ts
export interface ModelRefView { id: string; providerID: string; variant?: string }

export interface SessionView {
  // ...existing
  model?: ModelRefView
}
```

### 2.2 `src/tui/sidebar.tsx:68`（`storeView`）与 `:85`（`toView`）

对象字面量里各加一行：

```ts
model: s.model,      // storeView
model: info.model,   // toView
```

### 2.3 `src/tui/live.ts:120`（`mergeSession`）

返回对象里加，保持「远端有则覆盖」：

```ts
model: remote.model ?? local.model,
```

`live.ts:331` 的 usage 合并已经展开 `...view.session`，不需要额外处理。

### 2.4 测试

`test/live-controller.test.ts` 增加一例：`session.usage.updated` 之后 `model` 仍在；
若 `mergeSession` 已导出，直接断言更省事。

**M1 完成标准**：`bun test` 仍全绿，`bun run typecheck` 通过，无可见变化。

## 3. M2 · 模型列（可见，唯一的可见行为变更）

### 3.1 `src/tui/view-model.ts` 常量

```ts
const MODEL_WIDTH = 7
const MODEL_GAP = 1
```

### 3.2 `ViewInput`（`view-model.ts:66`）新增

```ts
modelDisplay?: 'inline' | 'off'
/** provider/model → 展示别名；缺省表示只用截断 id */
modelAliases?: Readonly<Record<string, string>>
```

### 3.3 新增纯函数（放在 `delegationRow` 之前）

```ts
const modelKey = (m: ModelRefView) => `${m.providerID}/${m.id}`
const modelCell = (m: ModelRefView | undefined, aliases?: ViewInput['modelAliases']): string => {
  if (!m) return '—'
  return truncateCells(aliases?.[modelKey(m)] ?? m.id, MODEL_WIDTH)
}
```

规则：

1. 命中别名 → 用别名；否则用 `model.id`。
2. 一律 `truncateCells(..., 7)`，再用 `padEndCells(..., 7)` 补齐，保证整列对齐。
3. 缺 `model` → `—`（tone `faint`）。
4. **不展示 `variant`**：7 列放不下，且需求是「模型」不是「effort」。需要时由别名自行编码。

### 3.4 `delegationRow`（`view-model.ts:268`）

```ts
const showModel = input.modelDisplay !== 'off'
const modelW = showModel ? MODEL_WIDTH + MODEL_GAP : 0
const activityWidth = WIDTH - 10 - 1 - 1 - stepWidth - modelW
```

span 顺序：

```ts
role, ' ', [modelCell + ' ']?, activity, ' ', steps
```

- 模型列 tone：`muted`；`—` 用 `faint`。
- 行内其余 tone 不变（role base / activity info / steps faint）。
- 模型列**不参与** warning 升级：硬 stall / 80% 预算仍只影响 role / activity / steps。

### 3.5 默认值

`buildSidebar` 内 `input.modelDisplay ?? 'inline'`。

### 3.6 测试（`test/sidebar-view-model.test.ts`）

新增：

1. `inline` + 有 model + 别名命中 → 整行等于验收快照，`cells(row) === 37`。
2. 无别名 → 截断到 7（例：`deepseek-v4.1-flash` → `deepse…`）。
3. `model` 缺失 → `—`，行仍 37 列。
4. `modelDisplay: 'off'` → 活动列 19，行等于当前输出。

既有 5 处整行断言（`engineer   command…             ~1/80` 一类）需按 `inline` 布局重算，并给 `session()` 夹具补 `model`；这是唯一预期会改的既有断言。

## 4. M3 · 别名与开关（TUI 直读 options，无 RPC）

### 4.1 `src/config.ts`

```ts
export type ModelDisplay = 'inline' | 'off'
export interface CrewDisplayConfig {
  aliases: Readonly<Record<string, string>>
  display: ModelDisplay
}
export const defaultDisplay: CrewDisplayConfig = { aliases: {}, display: 'inline' }

/** 只解析展示键；不碰 models/steps/instructions。 */
export function parseCrewDisplay(input: unknown): CrewDisplayConfig

/** options 专用：先摘掉展示键，再交给 parseCrewConfig，保持 profiles 的严格键集不变。 */
export function parseCrewOptions(input: unknown): { baseline: CrewConfig; display: CrewDisplayConfig }
```

`parseCrewOptions` 实现要点：

```ts
if (!object(input)) fail("options 必须是对象")
const { modelAliases, modelDisplay, ...rest } = input
return { baseline: parseCrewConfig(rest), display: parseCrewDisplay({ modelAliases, modelDisplay }) }
```

校验规则：

- `modelAliases`：普通对象，最多 64 项；键必须 `provider/model`（单斜杠、非空、无空白）；值 trim 后 1–12 字符、无 `\r\n` / 控制字符。
- `modelDisplay`：`inline` | `off`，缺省 `inline`。
- 其它未知键仍由 `parseCrewConfig` 拒绝，报错文案沿用 `options.*`。

### 4.2 `src/index.ts:35`

```ts
const { baseline } = parseCrewOptions(ctx.options ?? {})
```

server 只用 `baseline`；`display` 由 TUI 自己解析。这样同一份 options 在两侧都通过校验。

### 4.3 `src/tui/sidebar.tsx`

组件已经拿到 `context`，在 `SidebarRecovery` 内解析一次：

```ts
const display = createMemo(() => parseCrewDisplay(context.options))
```

`sidebar.tsx:219` 的 `buildSidebar({...})` 增加：

```ts
modelDisplay: display().display,
modelAliases: display().aliases,
```

不需要新增文件、RPC、缓存或跨组件传参。options 变化需要重载插件；不要为此加轮询。

### 4.4 测试

- `test/config.test.ts`（或并入 `crew.test.ts`）：别名键/值非法用例、64 项上限、`parseCrewOptions` 仍拒绝真正未知的键。
- `test/sidebar-view-model.test.ts`：同 §3.6。

## 5. 文档与分发

1. `docs/sidebar-ui.md:7`：删除「不显示模型名」，改为「Delegations 显示实际模型（7 列），可配别名/关闭」。
2. `docs/sidebar-ui.md` §3（:99 起）：补列宽算式、`—` 回退、`off` 布局。
3. `docs/sidebar-ui.md` §视觉与交互：模型列用 `text.muted`，`—` 用 `text.faint`，不参与 warning。
4. `docs/sidebar-ui.md` §第一版验收标准：追加「模型列 7 列且整行 37」「缺模型显示 —」「off 恢复 19 列活动」。
5. `README.md` / `README.zh-CN.md` 的 options 示例补：

```jsonc
"modelDisplay": "inline",
"modelAliases": { "provider/model": "h4-lite" }
```

6. `plans/subagent-model-label-investigation.md` 顶部加一行：方向已改为侧栏，见本文件。
7. 最后 `bun run build`：`dist/tui.js` 与 `dist/index.js` 都会变，两者都在版本控制内。

## 6. 验收命令

```sh
bun test                 # 全绿；新增用例覆盖 §3.6 / §4.4
bun run typecheck        # 无输出
bun run build            # Built dist/index.js / dist/tui.js
```

人工验收：

1. 两个角色配置不同模型，派两个并行子代理；
2. 侧栏 Delegations 每行第 12–18 列为模型标签，右边界 37 列齐；
3. 活动列不被截断到影响 `command…` / `prep write…`；
4. 未配别名的长 id 显示 `xxxxx…`；
5. `modelDisplay: "off"` 后回到当前布局。

## 7. 风险与回退

| 风险 | 处理 |
|---|---|
| 7 列仍不足以区分模型 | 优先配别名；仍不够再讨论加宽（会动活动列） |
| TUI 侧 `context.options` 为空 | 回退默认（无别名、`inline`）；人工验收第 4 条可立即发现 |
| 别名需重载插件才生效 | 文档写明；不加热更新 |
| `SessionInfo.model` 缺失 | 显示 `—`，不猜配置值 |
| 既有整行断言全挂 | 预期；集中在 `test/sidebar-view-model.test.ts` 按 §3.4 重算一次 |
| 列宽挤掉活动信息 | 已核：11 列可容纳 `command…`(8)、`prep write…`(11)、`websearch…`(10) |

## 8. 不做（本方案明确排除）

- stacked 两行制、detail-only 模式、点击 popover、Esc 关闭。
- 反显块 / `Span.bg` 扩展（`rows.tsx` 需要改，风险高于收益）。
- 模型家族颜色、`theme.categorical` 映射。
- `variant`（`#high`）展示。
- Subagents 汇总表加模型列（37 列已满）。
- 原生 subagent 工具行原位标签（见调查记录，方向已放弃）。
- 新 RPC 域、TUI 侧配置缓存文件（`context.options` 已足够）。

## 9. 执行顺序

```text
M1 数据透传 ──► M2 模型列 ──► M3 options 解析与接入 ──► 文档 + build
   (无 UI)        (可见)          (可配)
```

每步单独跑 `bun test`，不要攒成一次提交；M1 与 M3 都可独立回退，M2 是唯一的可见行为变更。
