# 审查门禁：4 条已知限制的取舍建议

状态：**ready / context-only**。日期：2026-11-24。只写方案；不改代码、不改配置、不做 git 写操作。实施需 Root 另开 Assignment。

依据（已读）：`src/review-gate-host.ts`（`listRootChildren`、`coverageTime`、`describeChange`、`readNativePlan`、`registerReviewGate` 的 idle 回调、`crew_review_gate`）、`src/review-gate-git.ts`（`collectNativeChanges`）、`src/review-gate.ts`（`evaluateGate`、`renderReminder`）、`src/tasks.ts`（`caller`/`identity`、`start`/`status`/`stop`、`descriptions`）、`plans/review-gate-spec.md` §4.3/§9/§11、`plans/gate-rollout-decision.md`、`plans/evidence/root-only-probe/{summary,r4-real-machine}.md`、`plans/evidence/review-gate-probe/summary.md`、`test/review-gate-host.test.ts`、`test/tasks-tools.test.ts`、`test/tasks-interface.test.ts`、`node_modules/@opencode/plugin/dist/promise/tool.d.ts`。仓库无 AGENTS.md。

## 0. 结论一览

| # | 限制 | Root 结论 | 我的结论 | 改代码？ | 优先级 |
|---|---|---|---|---|---|
| 1 | 子会话列表不完整时让路 | 接受 | **接受**；补一个量化复查线，并补两个 Root 没提的相邻风险（见 1.3） | 否（文案/诊断可选） | 文案 P1；相邻风险 P2 先量后改 |
| 2 | task 变更时间回落首次观察时间 | 接受，且「没有更好的时间源」 | **接受现状，但不同意理由**：纯删除 + 同轮派 reviewer 是常规流程，必然多一条提醒；且存在更好的时间源（见 2.2） | 否；可选小改 | 诊断字段 P1；改时间源 P2 条件触发 |
| 3 | 原生改动按 Root cwd 整体算 | 接受 | **接受**；补一行文案让 `Review-Skip` 有正当用法 | 否（文案） | P1（文案） |
| 4 | `crew_task_*` 先校验参数再判身份 | 只改一小处 | **做，但只做调序**；不改 description，不做工具可见性；Root 说的测试用例要改（见 4.3） | 是，`src/tasks.ts` 3 处 | P2，搭车发布 |

**不同意 Root 的地方**：(a) 第 2 条「没有更好的时间源」；(b) 第 4 条「补『非 Root + 合法参数』用例」——这个用例今天就是绿的，不能当红灯，要补的是「非 Root + **非法**参数」；(c) 第 1 条只说「触发条件到不了」，没覆盖「列表调用抛错」这条更现实的路径。其余同意。

**发布批次原则**：任何源码、`agents/*.md`、README 变更都要重建 `dist`、同步 `opencode-crew-live`、重启服务（inotify 额度刚清过，不能指望自动重载；重启会中断运行中的子代理）。因此**不要逐条发布**：见 §6 的两个批次。观察期（至 2026-12-08）内，不改门禁判定逻辑，只允许改文案/诊断输出/第 4 条调序。

---

## 1. 子会话列表不完整

### 1.1 事实核对

- `listRootChildren`（`src/review-gate-host.ts:47`）：每页 `limit: 200`，最多 20 页，遇重复游标即 `break`，返回 `complete:false`。
- idle 路径：`complete === false` 时，只有「找到 reviewer 的正向证据」才 ack（`:230`）；否则 `if (!complete || notified) continue`（`:237`）既不提醒也不 ack。`remind` 和 `enforce` 行为一致。
- 显式 `Review-Skip` 在列表之前处理（`:217`），不依赖列表完整（`test/review-gate-host.test.ts` 的「R2b」钉住）。
- 方向性：让路 = fail-open，`enforce` 不会因此循环刷屏。这是安全方向，同意接受。

### 1.2 对 Root 判断的核实

- 「>4000 子会话」只在 **宿主真的按 200 条/页返回** 时成立。`@opencode/protocol/dist/groups/session.d.ts` 里 `limit` 只是 `Int`，没声明上限；宿主是否服务端截断（例如 100 或 50）**需验证**。截断到 50 时上限就只有 1000。
- 「循环游标」属于宿主 bug，可视为到不了。

### 1.3 Root 没提的风险

1. **列表调用抛错不等于 `complete:false`**。`listRootChildren` 没有 try/catch：`ctx.session.list` 抛错时，idle 回调被最外层 `catch {}`（`:249`）整体吞掉，且 `crew_review_gate` 返回「诊断不可用」（`:308`），**看不到** `REVIEWER_LIST_INCOMPLETE`。后果：门禁对用户完全静默，诊断工具也不解释。这比「>4000」更现实。
2. **`readNativePlan` 在 hit 判断之前执行**（`:185`，早于 `:203` 的 `if (!hits.length && !state.pending) return`）。只要原生改动文件数 ≥ `planMinFiles`（默认 2），每次 idle 都会 `listChildren()`，并对**每个 engineer 子会话**调用 `ctx.session.context`（`:70-72`）读完整上下文，直到找到含 `plans/*.md` 的那个；没有一个命中时会读完全部。engineer 数量多、上下文大的长寿 Root 上，这是每个回合结束的同步成本，而且 engineer 首条用户消息不可变，没有缓存。另外，其中任何一个 `context` 抛错，同样被外层吞掉，**并且发生在 Review-Skip 处理（`:217`）之前**，会让该 idle 里的 skip 也失效。
3. 「静默」的含义：`remind` 下用户看不到任何提示，无法区分「没命中」「已覆盖」「fail-open」。这不是 `incomplete` 独有，是门禁的整体属性，需要文案说清（§5）。

### 1.4 建议

- **接受**，不改判定逻辑。
- 复查线（把「到不了」变成可核对的事实）：对 DB 副本统计每个 Root 的子会话数；**任一 Root > 500** 就重新评估（500 = 在宿主截断到 50/页时 1000 上限的一半）。方法：先按 `plans/gate-rollout-decision.md` §3.3 备份 `opencode.db` + `-wal` + `-shm` 到 `/project/tmp/known-lim/db/`，再用 `bun:sqlite` 只读查询。表名/列名**需验证**（先 `.schema`）：

  ```
  ~/.bun/bin/bun -e 'import {Database} from "bun:sqlite"; const db=new Database("/project/tmp/known-lim/db/opencode.db",{readonly:true}); console.log(db.query("select parent_id, count(*) n from session where parent_id is not null group by parent_id order by n desc limit 5").all())'
  ```
- 相邻风险 1.3-1、1.3-2：**P2，先量后改**。
  - 量：在有 ≥2 个改动文件、且有若干 engineer 子会话的 Root 会话里调用一次 `crew_review_gate`，看耗时与是否返回 `error`（诊断工具与 idle 走同一个 `readNativePlan`，所以它能复现同样的失败）。
  - 若要改（观察期后）：`readNativePlan` 内对每个 child 单独 try/catch 并按「无 planRef」继续；用 `RootState` 里的 `Map<childID, boolean>` 缓存首条消息是否含方案引用；`listRootChildren` 捕获 `session.list` 异常并返回 `{data: 已取到的, complete:false}`，使其与分页失败走同一语义（从而 `REVIEWER_LIST_INCOMPLETE` 能出现在诊断里）。红灯测试沿用 `fixture().controls.childPage`，新增一个让 `list` 或 `context` 抛错的控制开关。

---

## 2. task 变更时间回落到首次观察时间

### 2.1 方向性核对

- `coverageTime`（`:35`）：非删除项逐个 `lstat`，任一失败整体返回 `undefined`；调用方回落 `observation.firstSeenAt`（`:229`）。`firstSeenAt` ≥ 真实改动时间，所以回落只会**多提醒，不会误判已审**。同意 Root 的方向性结论，以及「不能用 ledger 更新时间」的理由。
- `latestChangeAt` 在原生路径里 `collectNativeChanges` 已经算过一次（`review-gate-git.ts:116`），host 里又 `lstat` 一遍；开销是 O(文件数) 的 `lstat`，而 `git status`（3 秒上限）和 task 侧的 `reviewTask`（逐文件哈希，3 秒上限）远重于它。大改动集会先在 `git status` 超时变成 `unavailable`/`incomplete`，到不了 `lstat` 成为瓶颈。**`lstat` 开销不构成问题**，不改。

### 2.2 不同意的部分

Root 说「纯删除只能回落」且「多提醒」是边缘情况。实际流程：Root 删测试 → 同一回合派 reviewer → reviewer 运行期间 idle 因 `background` 非空直接返回（`:174`，此时没有创建 observation）→ reviewer 结束、Root 收尾 → **第一次** idle 评估才建 `firstSeenAt`（`:197`）。此时 `reviewer.time.created < firstSeenAt`，永远判未覆盖。`test/review-gate-host.test.ts` 的「R1 pure-delete」把这个行为钉成了契约（先建的 reviewer 不覆盖、之后建的才覆盖）。结论：**纯删除（`deletedTest` 规则的主场景）和含不可 lstat 路径的集合，在「先审后收尾」的正常流程里一定会多出一条提醒**；`remind` 下是 1 条，`enforce` 下最多 `maxReminders` 条，除非 Root 写 `Review-Skip`。

更好的时间源存在：**被删路径的最近存活祖先目录的 mtime**。删除一个条目必然更新其父目录 mtime，之后的变动只会让它更大，所以它 ≥ 真实删除时间，与现有「宁多提醒不误判」同向，但比「首次观察」早得多（通常就是删除那一刻）。限制：目录 mtime 会被无关的新建/删除抬高（只会多提醒）；文件系统是否可靠更新目录 mtime 需验证（`/project`、`/data_0` 各测一次：`touch a; stat -c %y .; rm a; stat -c %y .`）；`utimes` 显式回写或 rsync 保留目录时间会破坏假设（本机流程没有这种用法，但未证实）。

### 2.3 建议

- **现在不改判定**（观察期内不动逻辑）。
- **P1（诊断，不改判定）**：`describeChange` 里增加字段 `latestChangeAtSource: "mtime" | "firstObserved" | undefined`，让诊断输出直接说明 `reviewerCovered:false` 是时间回落造成的。三四行，不影响 fingerprint 与提醒。
- **P2（条件触发）**：观察期结束时统计「`deletedTest` 提醒中，提醒前已存在 reviewer 子会话」的比例；≥30% 或用户抱怨则实施「祖先目录 mtime」：只改 `coverageTime`，对 `type==="deleted"` 条目取祖先 mtime，取不到仍整体 `undefined`（保持「不采用部分结果」）。红灯：把「R1 pure-delete」改为 reviewer 创建于删除之后、首次 idle 之前 → 不应提醒；保留「reviewer 创建于删除之前 → 仍提醒」。
- 若不做，则在 README 写明「纯删除/无法读取时间的改动，reviewer 必须晚于门禁首次观察才算覆盖；否则会收到一条多余提醒，用 `Review-Skip: reviewer 已审` 回应即可」。

---

## 3. 原生改动按 Root cwd 整体计算

### 3.1 核对

- 基线只在 Root 首个 `prompt` hook 记录（`:255`），ack 或 reviewer 覆盖后推进（`acknowledge`，`:204`）。所以手工并发修改**最多污染一个窗口**：该窗口被 `Review-Skip` 或 reviewer 确认后，基线推进，污染随之清掉。Root 的「最多多一条提醒」成立。
- 提醒正文已列出命中路径（`renderReminder`，最多 10 条），Root 能看出哪些不是自己改的。
- 与 `plans/review-gate-spec.md` §9 风险 6/7 同类（基线缺失含既有改动、并发修改），不新增风险项。服务刚重启，内存里的 `states` 已清空：存量会话要等下一次 `prompt` 才重新取基线，这段时间的提醒会带「基线缺失，含既有改动」（`renderReminder` 已有该行），属预期。

### 3.2 Root 没提的风险：`Review-Skip` 习惯

全局 `remind` 下，噪音来源不止手工修改：构建产物、格式化器、`bun test` 生成的未忽略文件都会进来。若 Root 形成「看见提醒就回一行套话 skip」的习惯，门禁就退化成留痕噪音。缓解不靠代码，靠两点：
1. 让「不是我改的」成为 `Review-Skip` 的正当理由（见 §5 文案）。
2. 观察期结尾抽样：`Review-Skip` 理由里「纯文档/格式/噪音」的占比（`plans/gate-rollout-decision.md` §3.1 已有 30% 线，沿用，不新增指标）。

### 3.3 建议

接受，只改文案（§5）。精确归因需要按工具调用打点，宿主没有该信号，不做。

---

## 4. `crew_task_*` 对非 Root 先报 `INVALID_INPUT`

### 4.1 现状

`start`（`src/tasks.ts:139`）先 `normalizeStoredInput` + `realpathSync`，再 `identity(tc)`；`status`（`:183`）、`stop`（`:193`）先做参数校验，再 `identity`。`caller()`（`:117`）第一行才判 `tc.agent !== 'root'`。R4 真机（`plans/evidence/root-only-probe/r4-real-machine.md`）里 build 先撞 `INVALID_INPUT`。

附带的小问题：非 Root 调用者的参数会先走一次 `realpathSync`（只读，但属于身份确认前的文件系统访问）。

### 4.2 值不值得做

- 收益：非 Root 主代理少浪费一次调用，且第一次就看到 `FORBIDDEN_CALLER` 的明确 `nextAction`（「只能由 Root 调用；当前调用方不要重试」）；认证先于校验也是更干净的顺序。
- 风险：低。错误码集合不变；Root 路径不变；`FORBIDDEN_CALLER` 的负载与现在 `identity` 返回的完全一致（同一个 `failure('FORBIDDEN_CALLER')`）。
- 频率低（只在用户手动切到 build/plan 且模型去碰 `crew_task_*` 时发生），所以 **P2，搭车发布，不为它单独重启服务**。

### 4.3 最小改动

`src/tasks.ts` 的 `start`/`status`/`stop` 在**最前面**各加一行（在 `normalizeStoredInput`/`realpathSync`/参数校验之前）：

```ts
if (tc.agent !== 'root') return failure('FORBIDDEN_CALLER')
```

- 不删除 `caller()` 里的同一判断（它仍是 owner 校验的第一道，保持纵深）。
- 判断条件必须与 `caller()` 完全一致（`tc.agent !== 'root'`，`agent` 缺失同样拒绝），避免 Code Mode 嵌套调用被误伤：R0-3 已证明嵌套事件的 `agent` 为 `root`。
- 不改 `ERROR_INFO`、不改 `identity`、不改权限 `authorize` 次序。

**测试（与 Root 的描述不同）**：
- 既有 `test/tasks-tools.test.ts` 的「non-root callers get FORBIDDEN_CALLER from all three tools before any side effect」传的是**合法**参数（`f.input`、`{}`、`{taskID:'ct_one'}`），今天就是绿的，不能作红灯，也不用改。
- 红灯用例：非 Root（`engineer`、`build` 各一）+ **非法**参数（`start: {}`、`status: {bogus:1}`、`stop: {}`）→ 期望 `FORBIDDEN_CALLER`；今天会得到 `INVALID_INPUT`，失败原因是缺少目标行为。同时断言 `f.calls` 中无 `assert/create/prompt/interrupt`。
- 回归钉：Root + 同样的非法参数 → 仍是 `INVALID_INPUT`（证明 Root 行为不变）。
- 已查：`test/tasks-tools.test.ts` 无 `INVALID_INPUT` 断言；其余 `INVALID_INPUT` 断言属于 `tasks-state-v2`/`tasks-maintenance`/`tasks-review`，与工具层无关。grep 结果被 `test/.work/**` 的副本淹没，实施前用 `render_gre13` 限制 `path: test` 且排除 `.work` 复查（需验证）。
- 验证：`bun test test/tasks-tools.test.ts test/tasks-interface.test.ts test/crew-root-only.test.ts`，再全量 `bun test`、`bun run typecheck`。成功标准：新用例红→绿，全量仍 543+新增 全绿。

### 4.4 更彻底的做法与否决理由

| 做法 | 结论 | 理由 |
|---|---|---|
| 改 `descriptions` 加「仅 Root」 | **不做** | `test/tasks-interface.test.ts` 冻结了 description 契约，且 `start` 首行有 117 字符预算（「observed 2.2.5 catalog budget」测试）；`start` 第二行已写「只能从主 worktree 根目录的 Root 会话调用」，`status` 首行已含「当前 Root」。收益小，会动冻结测试 |
| `ToolEditor` 按 agent 隐藏工具 | **做不到** | `tool.d.ts` 的 `ToolEditor`（`add/update/remove/namespace`）是全局的；`Tool.Info` 是否有 per-agent 字段需验证（`@opencode/schema/dist/tool.d.ts:88`），已读到的部分没有 |
| guard `evaluate` 里对 `crew_task_*` 非 Root 设 deny | **不做** | R0-2 实测：build 调 `crew_task_status` 时宿主层**没有**对应 evaluate 事件，规则大概率是死代码（spec §11.4.2 已预判）。「不能证明所有路径均无」，但不值得为它加代码 |
| 宿主 `agents.<id>.permissions`（或全局 `permission`）对 `crew_task_*` 写 deny | **仅作可选实验，不推荐落地** | 零代码，但是用户配置，只覆盖被列出的 agent，新增 primary 不覆盖；宿主是否据此从模型工具列表隐藏该工具即 R0-4，**未实测**。验证方法：隔离宿主（沿用 `plans/gate-rollout-decision.md` §1.3 的隔离环境变量）给 `build` 配 `permission: {"crew_task_*": "deny"}`，`opencode run --agent build` 让模型「列出你可用的、名字含 crew_task 的工具」，一次廉价调用。若真隐藏，再由用户决定是否值得维护这份配置；`policies` 的 `tool.use` 同理，需先确认 v2.4.1 是否存在该键（需验证） |

工具「可见」本身接受：§11 已在 `subagent` 层拦住非 Root 派 engineer（R4 真机已验证），`crew_task_*` 执行层只认 Root 且零副作用（`tasks-tools.test.ts`）。

---

## 5. 低成本文案：让用户自己看出「这是已知限制，不是故障」

均为文本，不改判定。已核对：`test/review-gate-host.test.ts` 没有断言 `notes` 文案；`renderReminder` 的文案断言在 `test/review-gate.test.ts`，改动前需先 `grep` 并同步（需验证）。

| 位置 | 建议内容（要点，不写全文） |
|---|---|
| `src/review-gate-host.ts:296`（`REVIEWER_LIST_INCOMPLETE` 那条 note） | 追加「已知限制，不是门禁故障：子会话 >4000（或宿主分页异常）时出现；此时只有找到 reviewer 或 `Review-Skip` 才会静默确认，不会新提醒」。若采纳 1.4 的 `list` 异常捕获，再加「或子会话列表调用失败」 |
| `src/review-gate-host.ts:146` 的 `describeChange` | 新增 `latestChangeAtSource`（§2.3）；`notes` 里当有任一变更集用了 `firstObserved` 时加一条 `COVERAGE_TIME_FALLBACK：纯删除或无法读取修改时间，覆盖时间取首次观察；reviewer 需晚于它才算覆盖` |
| `src/review-gate.ts:99` `renderReminder` 末尾 | 追加一行固定提示：「若这些改动不是你本轮所做（如用户手工修改、构建产物），在 `Review-Skip:` 里写明即可。」同时服务第 3 条 |
| `README.md:75` / `README.zh-CN.md:75`（`reviewGate` 段末） | 新增 4 条要点的「已知限制」短列表：(1) 沉默不等于已审，可能是未命中、已覆盖或 fail-open，以 `crew_review_gate` 为准；(2) 子会话列表不完整时不提醒；(3) 纯删除/无法读时间的改动，reviewer 须晚于首次观察；(4) 原生改动按 Root 整个 cwd 计算，含手工修改。中英各一份，保持同义 |
| `agents/root.md:28`（门禁那条） | 只加半句：「改动按整个工作目录计算，可能含用户手工修改；确非你所改，用 `Review-Skip` 写明」。不要把 4 条都写进提示词（每回合都消耗 token） |
| `plans/review-gate-spec.md` §9 | 已有风险 6/7 和 §4.3 已知限制；只在末尾加一行指向本文，不重写 |

---

## 6. 优先级与批次

| 序 | 动作 | 何时 | 说明 |
|---|---|---|---|
| 1 | 查询每个 Root 的子会话数（§1.4，只读 DB 副本） | 现在 | 把第 1 条的「到不了」变成数据；不需要发布 |
| 2 | **批次 A（文本/诊断/调序，不改判定）**：§5 的 notes/提醒文案/README/root.md、`latestChangeAtSource`、§4.3 调序 + 测试 | 观察期内可发，但与其他需要重启的事合并，不单独重启 | 不改 fingerprint、提醒条件、覆盖判定；`bun test` 全量 + `bun run typecheck`；`dist` 与构建一致；`opencode-crew-live` 同步 |
| 3 | 量化 1.3-2（`readNativePlan` 成本/抛错） | 观察期内，只读 | 在有多个 engineer 子会话的 Root 里调一次 `crew_review_gate` 看耗时与错误 |
| 4 | **批次 B（改逻辑）**：`readNativePlan` 缓存 + per-child try/catch、`listRootChildren` 捕获异常、可选「祖先目录 mtime」 | 2026-12-08 观察期结束后，且仅在数据显示需要时 | 每项带红灯；逻辑变更会影响观察期结论，所以不提前 |
| 5 | `agents.<id>.permissions` 隐藏工具实验 | 低优先，随时（隔离宿主，一次廉价调用） | 只用于回答 R0-4，不据此改默认 |
| — | 不做：改 `descriptions`；`evaluate` 里给 `crew_task_*` 加 deny；精确归因手工修改；对 `lstat` 做优化 | — | 见各节理由 |

## 7. 风险与未决

- 宿主 `session.list` 的服务端页大小上限（影响 1.2 的 4000 估算）：需验证；§1.4 的 DB 统计先给出实际规模。
- 目录 mtime 在 `/project`、`/data_0` 上是否随删除可靠更新（影响 2.2 的可选改动）：需验证，命令见 2.2。
- 1.3-2 的耗时与抛错是否真实发生：需量（§6 第 3 项）；未量之前不改。
- 批次 A 与观察期的关系：文案和诊断字段不改变提醒是否发出，不会污染观察期统计；但 `renderReminder` 文案变化会让之前的提醒与之后的措辞不同，统计时按 `metadata.crewReviewGate.fingerprint` 而不是文案匹配（`plans/gate-rollout-decision.md` §3.3 已要求）。
- 本方案未执行任何命令；所有验证由 Root 交 engineer 执行，重活走 `slot`，临时文件放 `/project/tmp/known-lim/`，不用 `/tmp`。
