# Crew sidebar：插件内可观测恢复最小契约

状态：ready；context-only。此文件不授予实施权限，Root 须另开 engineer Assignment。本文只设计，不声明当前会话已经恢复。

## 1. 背景、证据与边界

- 目标是阻止 Crew contribution 因异常落入宿主 `null` fallback 后静默消失；不修改宿主，不增加全局 reload watchdog，不改变 Alerts / Delegations / Subagents 的业务筛选与展示范围。
- 上游 explorer/本次 Assignment 已确认的本机路径：`context.ui.slot` → `lK registrations.slots` → `IA resolved.slotted` → `ZA` → `VK` 的 Solid ErrorBoundary；宿主 fallback toast + null，不写常规日志或插件 failed。原始证据 `/project/tmp/oc-strings.txt`，字节 offset 分别为 lK 17669368、IA 17627945、VK 17770743。本轮无字节切片工具，不重新全量读取约 30MB 文件；这些结论标记为上游已核实，而非本轮独立复测。不得套用另一条 core registry ownership/dataRef 路径。
- 上游运行现场：会话 `ses_e5f2c8213ffe1wVfG7k1dD4CSV` 有两个正常结束 explorer 子会话；TUI PID 2999654（17:52:50，cwd 本仓库）；run add78e95 的 role=cli 启动对账 15→16。均不能证明 slot 成功 render，本次具体异常仍未知。
- 本轮已读真实实现：`src/tui/index.tsx` 的 `setup` 直接注册 `<Sidebar>`；`Sidebar` 在组件初始化时取得 context、创建 controller/listener，随后 effect hydration、memo `buildSidebar` 和 JSX。memo 的 catch 返回 `{ alerts: [] }` 只能隐藏模型异常，无法保护初始化、effect、`Rows` 的 theme 读取或子组件渲染。
- `sidebar.tsx` 现有 `loadFamily` 保留 direct-child API、最多四次退避、挂载/重连触发；保留 family/local/live 合并及原有业务口径。只补生命周期和错误可观测性，不借机重写数据源。
- 已知用户改动：`src/tui/sidebar.tsx`、`dist/tui.js`、未跟踪 `.scratch/`。实施前记录差异，增量编辑，禁止 reset/checkout 覆盖、禁止清理 `.scratch/`。本轮唯一写入文件为本方案。
- 未发现仓库树内 AGENTS.md；遵守已注入全局规则。临时文件不得写 `/tmp`；使用项目子目录。重活先读 slot 规则，audit/status 记项目日志，再 slot 执行；本轮不运行测试/构建等重活。

## 2. 已决定的恢复架构

以下新名称均为拟新增插件内部符号，不是宿主 API。

### 2.1 边界及 owner

在 slot render 中返回拟新增 `SidebarRecovery`，其内部 ErrorBoundary 的懒 children 才创建 `Sidebar`。不可在边界外先调用 `Sidebar(props)`、`usePlugin()` 或预计算其 JSX。从 `setup(context)` 传入恢复基础设施所需 context，恢复壳不依赖业务 `useTone`、数据查询或 `buildSidebar`。

保护范围包含 Sidebar 初始化、Solid effect/memo、`Alerts` / `Delegations` / `Subagents` / `Row` 的 JSX。插件 setup/slot 注册自身失败、模块加载失败、底层 native renderer 绘制失败不属于此组件边界的保证；不得宣称这些问题也会自动恢复。

已核实本地 `solid-js` 1.9.17 的 `dist/solid.js` 中 `ErrorBoundary`：通过 memo 的 `catchError(() => props.children, setErrored)` 建立捕获 owner；fallback 获得 `() => setErrored()` reset，fallback 本身在 untrack 中执行，不受该边界保护。设计必须：

1. 使用此局部 reset，不调用 `resetErrorBoundaries()`，不在 timer 中直接重建 JSX/createRoot。
2. 将 fallback 实现为独立轻量组件，ErrorBoundary 返回它；它注册重试 timer/onCleanup，渲染只用基础 box/text、常量文案和安全标量。
3. reset 让 children 在原边界 owner 下重新求值、旧 subtree 被 dispose；不复用已计算 JSX。用真实挂载测试证明 setup 重跑、cleanup 执行、Provider context 保留。
4. `sessionID` 变化须使旧恢复周期与旧业务实例失效；以 keyed session 子树隔离，外层壳保持最小稳定。不可解构后把 sessionID 冻结为初值。

### 2.2 同步、异步与吞错

- 移除 `view` memo 的兜底空模型 catch：非预期构建错误交给内层边界。合法无任务/无子会话仍沿用正常空模型，不伪装为故障。
- 现有 `attempt`、`quiet`、`refresh`、`loadFamily`、live fetch adapters 的 catch 要分流：预期缺失值正常返回；真实请求失败记录限速 `data-degraded` 后保留原降级/重试策略；非预期计算/回调失败进入恢复。不得简单把网络中断全变成 remount 风暴。
- Solid 边界不自动接住 detached promise、timer、事件回调。新增内部 failure 回报通道：捕获异常后设置受保护子树中的 failure signal，由该子树的 effect 重新 throw；同时记录固定 phase。禁止在 Promise rejection 中直接 throw 指望宿主边界处理。
- `LiveController` 新增可选错误回报 callback（具体内部名称 engineer 定义），只用于非预期异步执行/回调失败；保持已有网络容错、刷新节奏与模型算法。完整覆盖 `tick`/`drain`/`resolve` 的 fire-and-forget 入口以及 timer 回调，防止未处理 rejection。尤其检查 `void work.finally(...)` 产生的第二条 rejection 链。正常失败不重复回报。
- `refresh` 的 `context.client.rpc(crewTasks)` 当前在 try 外，也须进入防护范围。监听回调同步 throw、Promise rejection、timer throw 均测试。

### 2.3 恢复节奏与可见 fallback

- fallback 显示 `Crew 暂时不可用`、短诊断 ID、自动重试状态、手动重试入口；绝不返回 null，不显示原始错误 message。提供鼠标点击及 command palette 重试（无新增默认快捷键）。
- 每个挂载 session 的故障周期最多三次自动重试，延迟 1s / 3s / 10s；同一实例最多一个恢复 timer。连续健康运行 60s 才重置自动预算，避免“重挂成功瞬间再次失败”无限循环。健康判定来自子树挂载完成且该段时间无 failure，不冒充屏幕绘制成功。
- 手动重试最短间隔 1s，取消待执行自动 timer，只执行一次局部 reset，不自动补满失败预算。耗尽后 fallback 持续可见，仍可手动尝试。
- timer 仅在故障/稳定性结算时存在，不另起常驻 polling/watchdog。切会话、slot 卸载、插件 reload 取消 timer；旧 reset 引用不能影响新实例。
- 在恢复壳 owner 下注册拟新增 `crew.sidebar.retry`（palette，故障时可用）及 `crew.sidebar.diagnostics`（查看诊断）。`context.keymap.layer` 是真实支持 API，随 owner dispose 自动注销；若注册失败，只记录基础设施异常，不让 fallback 再次抛给宿主。鼠标重试仍应可用。

## 3. 诊断及异常契约

本地 `node_modules/@opencode/plugin/dist/tui/context.d.ts` 的 `Context` 没有 logger；不得猜 `context.log`、runtimeAPI logger 或假定 console 被持久收集。最小受支持替代是 `context.storage.store(key, { initial })`：类型明确为持久 JSON、跨 reload/restart、跨 TUI 同步，更新返回 Promise。官方 V2 TUI 文档也明确支持。无需添加服务端 RPC 或直接写任意日志路径。

- 拟新增 `sidebar-diagnostics.ts` 提供无抛出的记录器；存储 key `sidebar-recovery-v1`，schemaVersion=1，最多 50 条、小于约 32KiB 的环形记录。同实例写入串行，重复 phase+fingerprint 在 10s 内合并 count/lastAt；多 TUI 的合并按 store mutation 执行，不用旧快照全量覆盖。
- 记录白名单：诊断 ID、ISO 时间、实例随机 ID、session 的不可逆短摘要、generation、phase、attempt、outcome、固定错误类别、去敏 fingerprint、计数。phase 至少区分 component / async-callback / hydrate / family / tasks / live / diagnostics-storage；无法定位精确子阶段时记 component，不伪造 setup/render 的精确定位。
- 禁止记录 prompt、消息、工具参数、会话标题、原始 sessionID、绝对路径、请求 URL/query、认证头、任意异常对象 JSON。默认不存原始 message/stack；可保留严格 allowlist 的插件内函数/文件基名帧，且过滤后限长。对任意 thrown 值（含恶意 getter/循环对象）不得调用不受控序列化。
- 记录 fault、retry、mounted、stable、data-degraded；mounted 仅是生命周期证据，非肉眼 render 成功。记录失败应被吞下但转为 fallback 的 `诊断未持久化` 标志及内存环形副本，不能递归记录自己、阻止恢复或产生 unhandled rejection。
- `crew.sidebar.diagnostics` 使用真实 `context.ui.dialog.alert` 展示可检索 ID/时间/阶段/计数/持久化状态；跨 reload 后能查旧 ID。不宣称知道宿主内部存储文件路径。诊断命令与 toast 自己的异常也须隔离。
- storage 初始化可惰性且失败可降级；绝不能因为新增诊断 store 初始化抛错让插件 setup 不再注册 slot。对持久化不支持/失败不静默宣称成功；以明确告警和可查看内存记录为最小降级。

## 4. 生命周期/data-source 最小修正

- 在第一个可能创建资源的步骤前注册总 cleanup，资源句柄逐个赋值；controller 已创建而 `data.listen` 抛错时也必须 dispose。清理每项互相隔离，某项 cleanup 抛错不能跳过后续清理。
- `Sidebar` 引入 disposed/generation 防护：卸载/切 session 时使 family、tasks 的在途响应失效、清除 familyRetry/debounce，迟到结果不得 setSignal、再 hydrate、再建 timer。`loadFamily` 重连/切 root 时取消旧 retry 并正确恢复其有限请求预算；保留原最多四次退避政策。
- 不可仅依赖 Solid signal 卸载后无 UI：必须证明网络响应不会再次订阅/安排定时器。`LiveController.dispose` 已有 disposed/generation/clearTimers，复用而非另造 global controller。
- 恢复壳 timer、业务 timer、数据重试 timer 是不同预算，不互相重置。不得为恢复增加持续服务端轮询。

## 5. 单一实施交付物与精确文件范围

一个可独立验收的交付物：插件内错误恢复 + 脱敏持久诊断 + 实际渲染红绿测试 + TUI bundle。建议 engineer Assignment 只授权下列文件：

修改：
- `src/tui/index.tsx`：slot 接入恢复壳，传入 context。
- `src/tui/sidebar.tsx`：去除模型静默空白，错误通道、局部 catch 诊断及 cleanup/代际防护；保留用户数据源补丁。
- `src/tui/live.ts`：可选错误回报、异步入口/回调隔离；不重写业务模型。
- `test/live-controller.test.ts`：新增异步异常/清理回归。
- `dist/tui.js`：最后发布步骤才更新；保留并核对原有用户补丁的对应行为。

新增：
- `src/tui/sidebar-recovery.tsx`。
- `src/tui/sidebar-diagnostics.ts`。
- `test/sidebar-recovery.test.tsx`：真正挂载恢复壳及真实 Sidebar。
- `test/sidebar-diagnostics.test.ts`。

无需改 package.json、bunfig.toml、业务 view-model/rows、服务端、宿主或 `.scratch/`。测试 fixtures 尽量内联上述测试文件；若必须新增配置/fixture 文件，先由 Root 明确增补 Scope，不能自动扩张。

## 6. 按依赖排序实施与验证

### A. 先测试，留下真实红灯

1. 记录受保护文件当前 diff；确认本地 native OpenTUI 能启动 test renderer。基础设施 smoke 成功后再确认功能红灯，缺依赖/JSX 编译/导入失败不算行为红灯。
2. 使用已经核实的真实设施：`@opentui/solid` 导出 `testRender`；`@opentui/core/testing/test-renderer.d.ts` 有 `renderOnce`、`flush`、`waitForFrame`、`captureCharFrame`、`dispose`；`@opencode/plugin/tui` 导出 `PluginContextProvider`。测试加载 `@opentui/solid/preload`（本地文件调用 `ensureSolidTransformPlugin`），使用 client/browser 条件避免 Solid SSR 路径。先验证 effect 与 cleanup 确实运行，不以“能 import”替代。
3. 外层测试 ErrorBoundary 模拟宿主：fallback 计数 + toast spy + null；里面 Provider + 真实 slot contribution。外层旁边渲染原生内容 sentinel，验证始终保留。不 mock Solid 的 ErrorBoundary，不把全部测试降为 controller 单测。
4. 首轮测试只能修改测试文件，不先写实现。通过现有 slot/Sidebar 入口注入 setup throw（例如 listen）、effect/memo throw、子组件 theme getter throw，断言出现 Crew fallback、外层计数=0；现状应因无 fallback 而失败。新增模块尚不存在导致 import 错误不算红灯；先以现有入口展示缺行为。

### B. 最小实现后补齐测试矩阵

- 初始化、effect、`buildSidebar` 调用链、真实子组件 JSX 各失败一次：内层 fallback 可见、外层从不吞掉整个 contribution。
- 错误解除后自动/手动 retry 恢复真实 Subagents 帧；使用两个已结束 direct-child explorer 的 fixture，host family cache 为空仍显示原模型允许的聚合内容。不要求虚构两条独立行，遵守现有 `Subagents` 分角色汇总。
- 永久失败：三次自动预算用尽，不忙循环；手动限速；健康 60s 预算复位；合法空数据不报错。
- detached listener/timer/promise 错误可观测；网络失败保持数据降级策略，不触发无限 remount；无 unhandled rejection。
- setup 中途失败、恢复、切 session、卸载、模拟 reload 后订阅/timer 数量回归基线；旧 family/tasks promise resolve/reject 不再改变新实例或安排任务；重复重试不增加并行 listener/controller。
- 持久 fake store 重建壳后旧诊断仍可检索；落盘失败显示未持久化但不阻止 fallback/retry；恶意 thrown 值、敏感字符串、环形上限、去重及多实例 mutation 测试。
- 每个真实 renderer 测试 finally `await dispose()`。可注入 clock 加速预算测试，但至少一组由真实 Solid/OpenTUI mount 驱动 reset、effect、cleanup 与帧输出。

### C. 命令和成功标准

由 engineer 在授权后执行（本轮未执行）：

```sh
# 功能红灯与绿灯均保存原始输出；同一测试命令。
bun --conditions=browser --preload @opentui/solid/preload test test/sidebar-recovery.test.tsx test/sidebar-diagnostics.test.ts test/live-controller.test.ts test/sidebar-view-model.test.ts

# 全量回归也需同一 JSX 转换环境。
bun --conditions=browser --preload @opentui/solid/preload test

# 先构建到非发布目录，避免提前触发在线 reload。
bun build src/tui/index.tsx --target bun --external @opencode/plugin --external solid-js --external @opentui/core --external @opentui/solid --external @opencode/theme --outfile test/.work/sidebar-recovery/tui.js
```

这是基于真实 package build 脚本裁剪的 TUI-only 命令，不擅自执行 `bun run build`（该脚本还覆盖 `dist/index.js`，超出本交付物）。上述命令的 native/条件兼容性须先 smoke 验证；若失败先修测试基础设施，不将环境失败当红灯，也不得改用仅纯函数测试规避。

成功标准：上述测试全部通过；有缺少恢复行为导致的红灯及同用例绿灯证据；真实挂载截图/字符帧断言覆盖 fallback→恢复；用户原有数据源行为保留；产物仅改授权文件。预计 >1min 的全量测试必须按全局 slot 流程执行，日志/中间文件仅放项目子目录或 `/project/tmp`。

### D. 发布与现实界面验收

1. 单测/暂存构建通过后，Root 批准发布窗口，再用相同 TUI-only build 命令将 outfile 改为 `dist/tui.js`。这是运行插件入口（package exports `./tui`），写入可能触发当前在线插件热重载；不要把 dist 更新当无影响的构建动作。
2. 原用户 dist 改动先保存证据并核对源代码对应，若存在无法从源码重建的差异，停止发布交 Root 判定，不能覆盖了再恢复。避免同时执行 agent 改 dist。
3. 观察当前会话 Crew 内容、原生 sidebar sentinel 对应实际区域仍在；测试故障注入只在测试 harness，未经单独授权不向在线会话注入错误。记录发布前后 bundle、时间、诊断 ID 与是否收到 mounted/stable。
4. 真人/可读帧观察才确认当前界面恢复；服务端有子会话、插件 loaded、启动计数上涨、mounted 诊断都不能替代现实 UI 验收。无法取得在线帧或人工确认时报告“自动验证通过，在线界面待确认”，不能声称整个故障已解决。

## 7. 风险与未决事项

- 当前最初异常原因未知。本交付物提供故障隔离、诊断和恢复，不把猜测写成根因；若仍无 slot mount 证据，应继续核查宿主是否调用 contribution，而非新增 watchdog。
- 本地依赖 2.2.3 / OpenTUI 0.8.0 / Solid 1.9.17 的测试与实际宿主打包版本可能不同；真实 owner/reset 测试必须通过，发布还需在线确认。宿主 fallback、native renderer 本身失败超出保证范围。
- 持久 storage API 有类型与官方依据，但物理存储位置、并发合并的宿主实现未在本轮读取；只使用公开 mutation 契约，不承诺跨实例绝对无损日志账本。运行时存储不可用必须显式降级。
- 正常“无 Crew 内容”仍允许空白；本次不扩展业务展示范围或增加常驻健康行。可通过诊断命令区分 mounted 无内容与 fault fallback。
- 没有待用户决定的业务口径；剩余事项是 engineer 验证测试环境、Root 授权 dist 发布、真人/可读帧确认当前会话。任何扩大业务范围或覆盖用户改动的需要均返回 Root。
