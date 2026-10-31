# Worktree 阶段 2：成果审阅与离线受控周转 Spec

日期：2026-10-31。状态：**S0-D 通过——D1–D6 已由用户于 2026-10-31 全部采纳建议，决策与精简接口冻结见 [S0 契约](worktree-stage2-s0-contract.md)。S1–S3 已按各自授权实现并在本地红绿门禁通过（S3 提交 `64b9e20`）；未迁移真实 ledger、未释放名额、未做真实维护。「停止证据可实际取得」仍只能在真实维护窗口验证，S4 私有宿主最小周转与 S5 另授权整合均未开始，且仍需逐次授权。**

## 1. 授权、基线与目标

本轮只新增本文，不修改源码、现有方案或 README，不启动服务/模型，不迁移真实 ledger。起点为 HEAD `5f2de187259983a0ed0a9639b2334480c72551c0`、工作区 clean，由 Root 实际 Git 检查确认；草稿作者未自行执行 Git。用户随后明确授权提交本文并重试推送，由 Root 统一执行。该文档提交授权不包括实现、真实维护、真实试运行或业务成果整合；这些授权分别取得，不能由批准本文自动推导。

已读全局 AGENTS 指令；项目内未检出 AGENTS.md，项目父目录的 AGENTS.md 不存在；阶段 1 契约记载其祖先无额外规则。调查输入为 Root 摘要、实际源码、阶段 1 契约第 3/6/7/8 节、阶段 1 结果、原隔离路线、README.zh-CN.md、package.json 和 Pi 的忽略目录建议。Kimi“先完整保全包再释放”的建议来自 Root 转述，没有冒称读取其原始证据。

阶段 1 已由 Root **按原受限契约有界验收**：OpenCode 2.2.5 双 marker、dirty 后原输入重放、status、stop 首次 1/重复 0、stop 后容量仍拒绝；最终 88 pass。精确范围见 [结果记录](worktree-stage1-results.md) 顶部最终结论，不以该文件历史子轮措辞推翻最终结论，也不将可选补测重新列为阶段 1 门槛。

痛点不是“stop 不够强”，而是当前 v1 两个预留及固定 baseline 无可验证的日常周转表示，Root 又缺少最小成果审阅索引。建议顺序：

**只读成果清单 → 离线受控人工结案/历史归档 → active 清空后新 baseline 周期 → 小规模周转试运行。**

这选择兼顾 Pi 的容量痛点与 Kimi 的保全优先：先提供审阅依据，结案仅改账本，保留原 worktree；**“保留 worktree + 最小清单”是否足够，仍须用户确认**。如要求可移交、可恢复的完整成果包，暂停结案路线，另立快照契约；本文不暗中降低该要求。

## 2. 现状与契约差异

| 已核对的事实 | 本阶段处理 |
|---|---|
| `src/tasks-state.ts` 的 `Registry` 为 schemaVersion 1、单一 baseline、tasks；`Ledger.decode` 限制 1..2 条；`reserve` 按全部 tasks 计数 | v1 没有 closed/period，也不能表达空活动集保留历史；不得靠删记录实现日常释放 |
| `Ledger.reserve` 先查 key/digest 再做新启动预检；`requestDigest` 包含 owner | 延续全历史幂等及 owner 约束；迁移不可重算/重解释旧摘要 |
| 原契约第 6 节允许外部核实后的维护窗口备份 ledger、人工归档 | 这是运维边界，不是现成可用 API；v2 是使其可验证的新增实现，不宣称现有自动支持 |
| `AtomicRegistry.withLock` 是同步短锁；`registerTasks` 在多个 transition 之间 await create/prompt/interrupt | 单次持锁不覆盖完整工具生命周期；锁不存在不等于没有在途副作用 |
| `taskView` 恒输出 unconfirmed/false/false；stop 保留预留 | close 不能改变这些字段，更不能等同进程已停或允许整合/清理 |
| 原路线阶段 2 包含真实行为任务、串行整合、完整改动快照 | 本文建议先补审阅与账本周转；最小清单不满足原完整快照契约；整合另授权且仍须相应成果保障 |
| README 尚有 2.2.4、权限未证的历史措辞；package 依赖为 `@opencode/plugin` 2.2.3 | 后续文档按结果同步；依赖版本和宿主验收版本分别陈述，不在本轮顺带升级 |

## 3. 范围与非目标

建议纳入：有界只读单任务审阅；维护窗口内显式 v1→v2 迁移、结案、周期切换；保留历史 key/owner/cwd 与审计依据；现有三工具的兼容读取及安全拒绝；少量同版本真实周转验证。

默认排除：在线 `close`/release 工具、自动释放、自动创建/清理 worktree、force remove、session 删除、merge/apply、commit/push、resume/retry、PID/TTL 抢锁、队列/DAG、跨机锁、提高并发、进程管理平台。scope 仍不是 sandbox，processSafety 仍为 unconfirmed。不开发完整成果导出包，不将 DB/cache/模型正文当成果。没有自动清理路径；人工结案也不解锁 cleanup。

## 4. 用户决策表（未确认即阻止相应危险实施）

| 决策 | 选项与建议 | 决策结果（2026-10-31） |
|---|---|---|
| D1 离线入口与操作者 | 建议独立本地维护入口，显式 plan/apply 两阶段，受控维护操作者；不注册在线工具。在线 Root 工具属改约另审 | **已采纳建议**：独立离线 plan/apply，不注册在线工具 |
| D2 停止核实证据 | 建议具名操作者、时间、受影响 host/任务范围、关闭新请求及续跑入口、在途调用排空依据、外部写入者核实、证据引用。不是一个 `stopped:true` 勾选 | **已采纳建议**：按证据结构取证，缺项即 BLOCKED |
| D3 最低成果保全 | 建议原 worktree 留存 + 完整性状态明确的最小清单 + 人工审阅/测试证据索引；备选先实现完整保全包 | **已采纳建议**：原 worktree + 最小清单 + 证据索引；首版不做完整保全包 |
| D4 故障/orphan 结案 | 建议仅独立核实所有可能副作用及 orphan 后人工结案；无法核实一律保留。备选首版完全禁止 orphan 结案 | **已采纳建议**：orphan 一律 BLOCKED，核实后人工结案 |
| D5 baseline 切换 | 建议 active=0 后显式开新 period；不得 start 隐式改 baseline；旧 period/摘要不变 | **已采纳建议**：active=0 后显式开新 period |
| D6 历史目录复用 | 建议首版永不复用历史规范 cwd，包括换 key、别名或删除后重建；备选另立再绑定安全契约 | **已采纳建议**：永不复用历史规范 cwd |

用户选择已记录，字段级冻结与生效约束见 [S0 契约](worktree-stage2-s0-contract.md)；不把沉默当接受。离线入口无法继承在线 ToolContext 权限，需显式管理者授权及文件权限策略，不能把任意 shell 使用者自报的 owner 当可信身份。历史 owner 不得被维护记录替换；授权管理员结案也不等于获准重放其他 owner 任务。

## 5. 只读成果清单契约（拟新增，非现有 API）

首版建议离线单任务清单能力，与维护入口共用本地受控执行边界；不新增在线模型工具。逻辑输入为已验证 project、taskID 和只读限额；不接受任意命令、自由 sessionID 或任意外部输出目录。实现文件/函数命名见第 9 节，最终 CLI 拼写须实现评审后固定。

最小输出：taskID、periodID（v1 可缺）、baseline、观测起止时间、HEAD 起止值及漂移标记、清单完整性 `complete/incomplete/changed`、按变更类型计数、有界相对路径列表、可安全读取的普通文件字节数/SHA-256、scope 外告警、排除/失败分类。这里 complete 仅指**本次有限枚举成功**，不是稳定完整快照。机器结果及简短中文摘要不得携带 goal/check/文件正文、diff 正文、环境、异常 body、DB/cache 或认证数据。

| 边界 | 必须语义 |
|---|---|
| tracked/staged/unstaged | 相对任务 baseline 枚举，不只比较 index；标明 index/worktree 来源，不把 staged 内容哈希冒充当前工作文件哈希 |
| HEAD 漂移 | 报 baseline→HEAD 漂移及相关路径；即使 Git status clean 也不能漏掉已提交差异；不自动接受新 HEAD |
| untracked / 删除 / rename | untracked 纳入（忽略项不读取）；删除保留路径及删除类型、不伪造现存字节哈希；rename 可保守表示删除+新增并声明计数口径 |
| binary | 可以仅散列安全普通文件原始字节，不输出内容；二进制分类若不确定必须报 unknown，不能因无文本 diff 就遗漏 |
| symlink / 特殊文件 | lstat 分类，不跟随 symlink、不读其目标正文；不打开设备/FIFO/socket。目录链符号链接及路径逃逸拒绝；异常项不能视为已保全 |
| 不可读 / 消失 / 变动中 | 输出分类及 incomplete/changed；读取前后身份/大小/时间检查、前后 HEAD/status 检查仅能发现部分漂移，不能证明没有并发写入 |
| 超限 | 预设路径数、单文件/累计读取字节、Git 输出及时间限额；超限不以截断清单给出成功，摘要明确失败和已观测计数；不得无界遍历 |
| scope 外 / 排除项 | scope 外变化显式告警；对秘密/依赖/cache/私有 DB 等排除项不读正文、不散列。可仅报排除类别计数，避免敏感路径泄漏；此时覆盖不完整 |

路径按字节边界安全解析 Git NUL 输出，展示转义控制字符；scope 匹配沿用精确文件/目录前缀语义而非字符串近似前缀。校验实际 worktree 登记、common dir 和目录身份，拒绝被替换的路径/别名。禁 Git 外部 diff/textconv、禁 shell 拼接、沿用有界只读 Git 环境策略；hash 不修改 index 或成果字节。

仅输出路径/hash 仍可能泄漏敏感信息，清单是私有审阅资料而非可直接公开报告；排除列表不是秘密识别器。它**不等于完整成果包、无秘密保证、沙箱或停止证明**。观察期间仍可能漂移；两次相同 hash 不证明无后续写入。结案前需人工在已核实维护窗口重新核对，不能凭旧清单释放。

## 6. v2 数据模型与三工具兼容（建议草案）

继续使用现有 common-dir 下 `opencode-crew-stage1/registry.json` 为唯一权威，避免第二路径让旧插件误判空库。建议结构如下，字段是拟新增草案，非当前 TypeScript 类型：

```text
RegistryV2 = {
  schemaVersion: 2, project, generation,
  currentPeriodID,
  periods: [{ periodID, baseline, openedAt, sealedAt? }],
  active: [{ periodID, record: TaskRecord }],
  closed: [{ periodID, record: TaskRecord, closeout }]
}
closeout = {
  operationID, closedAt, operatorRef, authorizationRef,
  disposition: preserved | abandoned | integrated,
  stopEvidenceRef, quiescenceEvidenceRef, reviewEvidenceRef,
  archiveRef, archiveDigest, integrationCommit?
}
```

首版将 closed 中原始 `TaskRecord` 保留为永久幂等墓碑；备份/历史归档用于审计，不是从权威记录删除 key 的理由。它较最小 digest 索引冗余，但避免重新设计旧记录重放与 retry 身份匹配。历史任务正文只保存在私有 ledger/归档，不能进入工具公开输出。`integrated` 仅记录另行授权且已验证的整合事实；不得通过该枚举触发 commit/merge。abandoned 也保留 worktree。

不变量：

1. key/taskID 在 active+closed 全局唯一，owner、规范 cwd、requestDigest、baseline 与原输入永久不变。task state 保持原 `TaskState`，closeout 是账本生命周期，不扩张 stop 状态机为“安全完成”。
2. 活动容量仅计 active，仍最多 2；异常、idle、stop_unconfirmed 在正式结案前仍计数。历史 cwd 全局保留，不因 period 变化重用。
3. 所有 active 属于 current period 且 baseline 相同。仅 active=0 可显式封存旧 period、开启新 period；切换时验证主 HEAD/clean、新 baseline 完整 commit。新 start 仍验证目标 clean/detached/相同 baseline。
4. 旧 key 查找先于新启动容量/当前 baseline/目标 clean 校验，但仍先做可信 caller 与 permission 检查。同 owner 原 input 返回原 task 的 closed 视图，绝不 create/prompt；不同 digest（含不同 owner）仍 `IDEMPOTENCY_CONFLICT`。缺失目录不抹掉历史，不因新 period 放行旧 key。
5. 三工具输入不变。`start` 重放可附加 `lifecycle:closed`、period 与最小结案摘要；现有安全字段不变。`status` 不带 taskID 继续返回当前 owner 活动集，避免无界历史输出；显式 taskID 可查该 owner 的 closed。`stop` 对已 closed 返回记录且不 interrupt，仍执行原身份/权限检查。禁止把 closed 任务重新纳入 transition。
6. `retry` hook 必须能查 active 和 closed 的旧绑定，不因归档丢失 `retry:false` 保护。该 hook 仍不阻止外部主动 prompt；维护必须关闭该入口。
7. 保留现有 1 MiB ledger 上限作为首版有界约束，closed 增长达到限额则拒绝写入/新启动，不删墓碑、不自动分片。可维护周期有限，后续扩容另审。

### 兼容与迁移

新 reader 支持 v1/v2；普通操作遇 v1 继续按原 v1 语义，**不隐式迁移**。显式维护迁移将所有 v1 tasks 原样放入一个 period 的 active，不释放任何名额，不重算 digest，不丢 owner/session/错误/时间字段。可重复读取 operationID/代际验证结果，重复 apply 不二次改写。

现有 `Ledger.decode` 会拒绝 v2，故旧插件应 fail closed 而非启动；不能宣称旧版本继续正常服务。维护前盘点所有 reader/writer（主与任务 location、多个服务、retry hook），升级兼容版本或隔离停用。旧 hook 捕获异常后不改宿主 decision，因此**不得让旧实例继续承载 v2 受管任务**。未知版本、无效枚举、重复 key/cwd、断裂 period/归档引用、错误 digest/owner、超限或损坏均拒绝；不回退空库，不自动回滚至缺墓碑的旧备份。

## 7. 离线维护、停止证据与原子性

**close ≠ stop。** stop 至多请求中断，close 表示在独立核实及保全门槛后把预留移至历史。有 sessionID 的建议先完成既有 stop 流程并记录 stop_unconfirmed；stop_requested 响应不明或身份核验失败时暂停调查。先 stop 只是必要非充分条件；无 sessionID 的 reserved/create-intent 等也可能有 orphan，不能跳过外部核实。D4 未获批准前故障任务不结案。

### 维护窗口（必须按序，不能只查锁）

1. 验证显式授权、项目真实身份和所有访问同 common dir 的合作实例清单；停止接收新 start/stop/维护写请求，并关闭受管 session 的继续 prompt/retry 入口。无法控制共享服务范围时，BLOCKED；不擅自重启健康共享服务。
2. 等待已有完整工具调用及 create/prompt/interrupt 等在途副作用完成或进入可调查的明确故障结局。普通 registry 锁只包一次同步读写，不能证明 quiescence。只有“锁不存在”或“一次 session idle”不合格。无法确认响应丢失是否仍在执行时不继续。
3. 人工核实外部终端、原生会话、模型及可能 orphan 的写入所有权，记录停止依据；不能以 session.list 空、无 sessionID、单次 PID 缺失或 hash 未变代替。无法核实非合作 writer 则 **BLOCKED**，保留原名额。
4. 从关闭入口至 apply 后复核始终保持维护窗口。维护程序再拿现有 `.lock`，读取/校验 ledger 代际和预期 digest；崩溃遗留锁照旧拒绝，不按 PID/TTL 抢占。新增长期 gate 文件不能代替外部排空证明；首版不开发在线排空协调器。
5. 先做只读计划，列 taskID、原 owner、操作类型、代际、证据引用及预期 active 数；apply 必须绑定此计划摘要、operationID 与当前 ledger 摘要，防止审阅后变更。证据缺失、摘要改变、重复操作参数冲突均拒绝。
6. 备份、归档、权威更新及读回验证成功后才允许运营方结束维护窗口；只重开已支持 v2 的实例。保留 worktree，维护程序不读写其成果正文（清单读取为独立只读步骤）。

### 备份/归档提交协议（建议）

备份及历史档案位于受保护的同一管理目录子目录，目录 0700、文件 0600；路径由内部 operationID 派生，不接受任意路径，不跟随 symlink。写文件用独占临时文件、fsync、原子 rename、目录 fsync；所有临时文件在该目录，禁止 `/tmp`。

多文件 rename 不具有整体事务性。建议以 **registry 原子替换为唯一提交点**：持锁期间先生成并校验旧 registry 字节备份及不可变归档，持久化成功后，才用一次原子写把 active 移到 closed（含永久墓碑与档案 hash）并增 generation。外部档案没有独立“释放名额”效力。替换前失败仍为旧 active；替换后即使响应丢失，也从新 registry 查同 operationID 得出已结案，不再次释放。未引用的档案残件不得触发自动恢复/释放，不自动删除。

rename 后 fsync 报错可能已写入完整新值，应报告结果未确认并停止操作；读回不能冒称断电持久性证明。恢复须在维护窗口校验备份/档案/权威记录；损坏或缺引用时停止所有写入，不能选择“看起来能用”的旧库继续 start。已提交结案的旧 key 仍存在，任何恢复方案不得让其重投。恢复处理期间不开放新容量。人工删除 registry/锁或恶意非合作写入不在保证内，也不是允许的运维快捷方式。

## 8. 拆分交付与依赖门禁

| 顺序 | 建议交付 | 可验收结果 / 停止条件 |
|---|---|---|
| S0 | 用户决策与精简接口冻结 | D1–D6 明确，停止证据能实际取得；否则相关维护实现 BLOCKED |
| S1 | 最小只读成果清单 | 仅观察、不改变任务/成果；边界和输出最小化通过。若要求完整包，另立契约 |
| S2 | v2 reader/writer 兼容、迁移及永久历史 | 全部写入者已覆盖、v1 不隐式迁移、unknown fail closed；不单独上线一个可删历史的迁移脚本 |
| S3 | 离线 plan/apply 结案与周期切换 | S1/S2 通过，授权/排空/停止/保全证据齐备；原子性及故障恢复有红绿证据后才触碰真实 ledger |
| S4 | 私有 2.2.5 最小周转试运行 | S3 通过、逐次维护授权；新周期可用，旧 key 不重投，成果原字节保留 |
| S5 | 可选真实双行为任务与串行整合评估 | 另行授权任务、完整成果保全/整合策略、提交策略；无授权不做 merge/commit/push |

实现按依赖串行落地，避免不同 engineer 同改公共 state/ledger。纯文档阶段不跑行为测试；后续每个行为变更先仅写测试并运行有效语义红灯，附命令/退出码/断言，再实现和贴对应绿灯。缺红灯不验收；语法/import/认证/服务未就绪不是有效红灯。

## 9. 真实实施映射与拟新增责任

| 文件/真实符号 | 后续实施责任（均未在本轮实现） |
|---|---|
| `src/tasks-state.ts`: `TaskRecord`, `normalizeStoredInput`, `requestDigest`, `Ledger.decode/read/reserve/transition` | 保留摘要语义；增加版本化解析及 active/历史查询、显式维护 mutation；区分任务状态与 lifecycle。新增方法名在实现前确定，不假称已有 close API |
| `src/tasks-ledger.ts`: `AtomicRegistry`, `AtomicStore`, `read`, `withLock` | 复用本地锁和有界原子写；为受控备份/归档提交增加测试过的原语。不得把同步锁改成覆盖任意 async host 调用的假事务 |
| `src/tasks-registry.ts`: `inspectProject`, `inspectProjectFromWorktree`, `validateWorktree`, `normalizeScopeLexical`, `normalizeScope`, `TaskRegistryError` | 保留新启动校验；清单需独立只读检查，不直接用要求 clean 的 `validateWorktree` 拒绝所有 dirty 成果；新增错误分类明确区分维护/清单 |
| `src/tasks.ts`: `registerTasks`, `taskView`, `matches`, 内部 `caller/authorize/start/status/stop` 与 retry hook | 三工具输入兼容，权限拒绝传播不变；历史重放/查询/stop 无副作用，retry 覆盖历史；不注册在线 close |
| 拟新增 `src/tasks-review.ts` | 有界清单构建纯责任；路径安全、计数/hash/漂移、最小输出。名字仅建议 |
| 拟新增 `src/tasks-maintenance.ts` 及本地入口 | plan/apply、显式 migrate/close/open-period 操作；这些是草案逻辑操作，不是已存在命令；实现前固定调用约定、身份与输出错误 schema |
| `test/tasks-state.test.ts`, `tasks-ledger.test.ts`, `tasks-registry.test.ts`, `tasks-git.test.ts`, `tasks-tools.test.ts` | 扩展既有回归；新增清单/维护测试文件名称待定 |
| `test/tasks-checkpoints.test.ts`, `tasks-atomic-faults.test.ts`, `tasks-process-races.test.ts`, `tasks-stop-checkpoints.test.ts` | 复用故障与独立进程测试方法，不把原有测试全部通过当新增行为已验证 |
| `package.json`, `README.md`, `README.zh-CN.md` | 依现有 build/exports/files 策略说明实际离线入口及新旧兼容，包不得含证据；README 同步最新有界证据，不夸大宿主或进程安全 |

新增错误语义草案：维护未排空、证据不足/授权不符、计划过期、历史目录拒绝、活动集非空、归档校验失败、清单漂移/不完整/超限。最终 code 名称随接口冻结；现有三工具已用的错误代码保留。所有错误只输出分类和必要上下文，不含原始异常载荷；permission rejection 仍原样传播，不转换为可继续执行的成功。

## 10. 测试先行矩阵

每行应有明确行为断言、故障注入点和零副作用/字节不变证据；不要求无界笛卡尔组合，不新增阶段 1 可选补测负担。

| 类别 | 新行为红灯目标 → 实现后成功标准 |
|---|---|
| v1/v2 与全写入者 | 真实 v1 fixture 无损读取、显式迁移前后摘要/owner不变；start/stop/transition/维护/retry 均适配；旧 reader 拒绝 v2、未知版本和损坏拒绝且不建空库 |
| 永久幂等 | close 后 dirty/目录缺失/新周期原 input 重放零 create/prompt；不同 input/owner 冲突；历史 stop 零 interrupt；历史 retry 仍 false |
| 容量/周期/目录 | 未结案 stop 后仍满；结案一项只释放一位且同 baseline；active>0 禁切周期；active=0 显式换 baseline；历史 cwd/别名/删除重建拒绝 |
| 互斥/close-start 竞态 | 用 barrier 暂停在 reserve 后及 host await 中；仅短锁释放不能申请结案；未排空/入口未关闭拒绝；合法维护内无法新 reserve；重复 apply 幂等且无半释放 |
| 写盘/响应丢失 | 备份/归档/权威写每个提交边界注入异常和代表性崩溃；替换前 active 保留，替换后 closed 墓碑存在；响应丢失不二次改写/重投；遗留锁不抢占 |
| 档案/迁移故障 | 缺失、错误 hash、symlink、未知 schema、输入摘要不符、备份超限拒绝；不自动回退旧库；未引用档案不释放；迁移失败无 task 丢失 |
| 清单覆盖 | tracked/staged/untracked/delete/binary/rename、HEAD clean 但已漂移均观察；scope 外警告；计数不把 unknown 当零；路径数/字节/时间超限不报完整 |
| 路径与竞态 | symlink 及目录链替换、逃逸、worktree 身份变化、特殊文件、不可读、读取中修改/删除；不外读、不挂起，结果 incomplete/changed 或拒绝 |
| 成果字节不动 | 清单/迁移/close/换 period 前后 tracked、untracked、binary、删除标记和链接对象保持；不出现 checkout/reset/clean/merge/remove 或 session 删除 |
| 身份/权限 | 三工具 root/owner/location/ask/deny 及 source 原有回归保留；历史不跨 owner 暴露；伪 operator/越权维护计划拒绝；管理结案不篡改历史 owner |
| 输出最小化 | 注入正文/秘密异常/DB/cache 标记，输出及公开日志无原始内容；排除项不读正文；清单不声称秘密扫描、稳定快照或 safe |

## 11. 验证命令、真实试运行与最终门禁

以下为后续执行者的真实现有命令（本文未运行）：

```sh
bun test test/tasks-state.test.ts test/tasks-ledger.test.ts test/tasks-tools.test.ts
bun test
bun run build
npm pack --dry-run --json
git diff --check
```

新增定向测试命令在文件落地后记录；维护命令尚无实现，本文不编造可执行 CLI。`npm pack` 触发 prepack build，可能改变 dist，必须在独立 fixture 中打包并核对，不能把构建差异误归因 child。实包 exports/setup 和文件清单仍需验证。所有 test/TMPDIR/npm cache/证据均在项目子目录；预计超过一分钟、2G 内存或大量 `/data_0` I/O 前，先读 slot 规则、`slot audit`/`slot status` 留项目日志，再 `slot <io|cpu|gpu|nf> -- <cmd>`，禁止 `/tmp`。

### 最小真实 host 周转（另授权后）

冻结 OpenCode **2.2.5**，记录实际包/源码哈希；升级版本另验收，不能混接旧版结果。新私有 loopback fixture、独立 DB/config/cache/state/tmp，不重启共享服务；沿用已授权模型与现有 host harness 的真实注册工具链核验方法，不以直接 session API 冒充工具验收。

1. 两个新 detached sibling 目标、相同 baseline、小 marker 任务；确认目录隔离与每 child 唯一投递。只验证周转不必证明执行时间重叠。
2. 清单观察 marker、scope/HEAD 和 incomplete 边界；保存只读观测时段，不宣称稳定快照。
3. 用原 stop 流程请求停止，记录 unconfirmed；关闭入口、排空调用并外部核实 writer。证据无法取得则停止试运行，不能为了演示释放造出 safe。
4. 明确维护授权下迁移（如为 v1），备份、结案两项；核对 worktree/marker 字节不变、closed 历史和 active=0。重放旧 input 仍原 task/session、零新 prompt；不同 owner/摘要拒绝。
5. 在同一周期用新 cwd 验证可再预留。跨 baseline 验证另一个 active=0 窗口，可使用 fixture 已有的另一个 commit OID（前提满足普通 clean 校验），不为了演示擅自提交；显式新 period 后新目标起一个小任务，旧历史不变。没有可用既有 OID 时该项 BLOCKED，待授权准备，不伪造通过。
6. 如需原路线的两项真实行为改动、串行整合、生成新提交后再周转，单独批准任务和整合/提交边界；红绿证据与整合后回归齐全才报告收益。不默认 commit/push/merge。

最终成功标准：用户决策签字、有效生产行为红灯/绿灯、上述安全矩阵和既有回归通过、build/包检通过、同版本最小真实周转有独立调用与账本/字节证据；缺项如实 NOT_TESTED/BLOCKED。报告区分“结案释放容量”与“进程安全”，列人工成本、保全方式及剩余上限，不将可用性演示当安全证明。

停止条件：未知外部 writer、在途副作用无法排空、orphan 无法核实、权限/身份不符、版本混用、计划过期、档案损坏、成果漂移/遗漏未被人工解决、容量或历史不变量破坏、需要自动释放/清理或完整导出包才能满足用户目标。均保留 worktree/ledger/证据并回问；不得删库解锁、弱化权限或扩大并发来继续。

## 12. 本文交付检查与未决项

本轮仅核对事实并新建本文；没有运行行为测试、构建、服务或模型。架构角色无 shell 权限，未自行执行 Git。独立 reviewer 只读核对草案、阶段 1 契约及实际源码，未发现阻塞文档交付的实质问题；该审查不是实现验证。Root 在暂存本文后执行 `git diff --cached --check` 检查全文空白，并确认仅预期文档进入本次提交；真实提交与推送结果以 Git 记录和最终回执为准。纯文档无行为红绿灯要求，后续实现仍须遵守第 10 节门禁。

原关键未决项 D1–D6 已于 2026-10-31 由用户全部采纳建议并记录，S0 的决策部分（S0-D）判定通过；字段级冻结（RegistryV2、closeout、离线 plan/apply、证据结构、清单输出、错误码）见 [S0 契约](worktree-stage2-s0-contract.md)。S1 只读清单、S2 v2 与显式迁移、S3 离线 plan/apply 已实现，S3 本地红绿门禁与全量回归通过；`integrated` 所需的 `integrationCommit` 来源已在 S0 契约中按实现评审结果显式补齐。S0 要求的「停止证据能实际取得」未在真实维护窗口验证，仍是未决项；S4 私有 2.2.5 最小周转与 S5 另授权整合均未开始，且各自仍需新的显式授权与逐次维护授权。当前未迁移真实 ledger、未释放名额、未触碰真实 worktree，也不宣称进程安全或生产可用。
