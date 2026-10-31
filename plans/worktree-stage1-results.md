# 受限阶段 1 打包及有界验收记录

## 当前结论与最新检查

**受限阶段 1 实现完成，有界验收通过；完整阶段 1 验收仍未通过。** 在本地 checkpoint `4972eb7` 的既有 27 项故障/崩溃测试上新增 3 项独立进程竞争测试及 2 项 harness 自检，未修改生产代码。最新完整 `bun test`：87 pass、0 fail、11 files；构建、打包 dry-run 及 diff 检查通过。以下 start、AtomicRegistry、stop 子矩阵均通过独立只读复核。故障注入证据覆盖模拟宿主、本地文件系统运行时故障和 SIGKILL；其余真实宿主的有限补验见下文，不等同断电持久性或完整工具级底层故障组合矩阵。

Root 本轮已复验完整测试 **87 pass**、build 和 diff，生产代码无改；此处依据 Root 交接记录，本只读核验子轮未重跑这些命令，也未启动服务或模型。下文各子轮“未重跑”均指该子轮当时，不与 Root 后续复验矛盾。

## 双服务历史调用完整性只读复核

两个成功现场的 runner 按 messageID 汇总事件，同消息多个嵌套调用可能覆盖，原 `len(ev)==1` 本身不足以证明唯一调用。本轮对已退出的四个私有 DB 以 SQLite `mode=ro` 离线扫描 Root 消息，按 user prompt 顺序划分阶段，再按 messageID、外层 call ID/索引及嵌套索引/ID 枚举所有 `crew_task_start`，不按 messageID 覆盖。每个事件均 completed、实际参数等于预期；输出只保留工具名、状态、参数摘要、相等性和索引，不输出 prompt 或推理。

| 现场 | 各 Root 阶段的实际调用数 | 总数 |
|---|---|---|
| 不同 owner 同 key | A race 1；B race 1、winner replay 1 | 3 |
| 最后容量位 | A first 1、last-slot 1；B last-slot 1、winner replay 1 | 4 |

两脚本均退出 0；命令为仓库根 cwd 下 `python3 plans/evidence/worktree-stage1/host-multiservice/verify-all-calls.py` 和 `python3 plans/evidence/worktree-stage1/host-multiservice-capacity/verify-all-calls.py`，各自脱敏输出为同目录 `verify-all-calls.log`。输出 JSON 均可解析；本次脚本仅检查可解析性，不独立断言具体结果值，提交/冲突与 ledger、child 和 prompt 计数仍依据上文对应原始成功证据。没有修改旧日志、runner 或生产代码。

## 真实宿主内部权限 ask→reject（OpenCode 2.2.5）

**有限 PASS**：单独的 2.2.5 私有服务、私有 DB/config/auth/data/cache/tmp、空 registry 和干净 clone/worktree；重新打包并外部加载当前代码，包内 src 哈希与工作区一致。实时 OpenAPI 确认 session permission list 和 reply 路径；Root 实际 agent 权限为 `*/* allow`，session 设置并回读 `subagent/engineer ask`。真实 Root 模型经 `execute` 调用一次 `crew_task_start`，在插件内部第二个 `permission.assert` 暂停，pending 请求为 action `subagent`、resources `["engineer"]`，source 为对应 execute 的 tool call ID 和 message ID。真实 reply 为 `reject` 并附反馈 `fixture rejection`，HTTP 成功。

宿主持久工具状态中，外层 `execute` 为 `completed`，但 `metadata.error=true`、content 为反馈文本；其唯一嵌套 `crew_task_start` 状态为 `error`，不是正常 completed 的 `{ok:false}`。只读 DB 核验 source 与外层 message/call ID 精确一致；宿主持久状态没有公开异常 cause 或具体类型，不能进一步断言运行时异常类。拒绝前后 registry 均不存在，DB 均仅 1 Root、0 child、0 child prompt，marker 均不存在且目标 worktree 干净。此观察与插件的 assert 位于 reserve 前一致，但不覆盖其他权限 action 或拒绝形式。

项目根 cwd 下 `slot audit`、`slot status` 均退出 0，`slot cpu -- python3 plans/evidence/worktree-stage1/host-permissions/runner.py` 的本次 runner 退出 0；证据为忽略目录 `host-permissions/slot2.log`、`run2.log`、只读二次核验 `db-inspect.log`（退出 0）。服务 PID 1593799 在 finally 回收，退出 130，进程组不存在。初次 `run1.log` 的 NameError 是验证脚本缩进错误，未启动服务，不是生产红灯。无生产代码修改，未重跑完整测试或 build，未提交推送。私有 DB/cache 不应分享。

该 2.2.5 单服务权限证据不外推到 2.2.4；下面历史双服务证据均为 2.2.4，二者各自独立。显式 deny、其他 assert 层、interrupt 和双 child 重叠仍为 NOT_TESTED。

## 双真实服务最后容量位子矩阵（2026-10-31）

**PASS（有限子矩阵）**：在仓库根 cwd，经 `slot audit` / `slot status` 预检均退出 0，再执行 `slot cpu -- python3 plans/evidence/worktree-stage1/host-multiservice-capacity/runner.py`，runner 退出 0。`slot.log`、`run1.log` 和 runner 位于该忽略目录；私有 DB/cache 不应分享。新建 HEAD `4972eb7` clone 和三个 detached sibling worktree、空 registry，两个 OpenCode 2.2.4 服务分别独立 DB/认证/data/cache/state/config/tmp、不同 Root owner；各自在 primary 加载插件并确认模型可见。新打包产物 SHA-256 为 `68e830a870a87a0453c1ff88ff7d51dd274e96526e911e0c369e6cb49944a59c`，包内全部 src 文件哈希与当前工作区一致；prepack 改写 fixture dist 后恢复，primary clean。

- A 的 Root 真实调用 `crew_task_start`，`ct_first` submitted，占用第一位。随后 A 的 `candidate-a` 和 B 的 `candidate-b` 以不同 key、不同目录争最后位：两次 Root 请求区间 Unix 秒分别为 `[1793409726.9916673,1793409731.53978]` 和 `[1793409726.99164,1793409731.5349228]`，区间重叠。实际 execute 嵌套工具事件参数与请求分别完全一致，B submitted，A 返回 `CAPACITY_RESERVED`；无需重试。B/A 工具事件首次观察时间分别为 `1793409729.5246725` 和 `1793409730.032546`，没有锁临界区时间证据，**不能称实际持锁临界区重叠**。
- 合并两 DB 和共享 ledger，最终恰有 2 Root、2 child、2 条任务记录；两个 child 各 1 条 user prompt，无第三 child、第三任务或额外 child prompt。两 marker 内容精确，失败目标 worktree 与 primary clean；child 工具包括 patch/read/glob，部分 read 报错，最终 marker 校验通过，未见 shell。Root 自身 user 消息未计入 child prompt。
- B Root 以新 prompt 重放 winner 原输入，返回同一 task/child 和“不再投递”提示；ledger 重放前后完全相同，两个 child prompt 数不变。两个私有服务 PID `1586353`、`1586354` finally 回收，退出码均 130，进程组均不存在。未操作共享服务；不证明进程树安全。

**当时未验证**：实际锁临界区重叠、双 child 执行重叠、同 owner 同 digest 跨服务重放、真实 ask/deny 或 interrupt 计数；其后 2.2.5 单一 ask→reject 补验见上文。该结果与下节不同 owner 同 key 子矩阵、历史 host1/host2 单服务证据分别成立，不代表完整多服务矩阵通过。该子轮未重跑完整 tests/build；未提交或推送。

## 双真实服务、不同 owner 的同 key 子矩阵（2026-10-31）

**PASS（有限子矩阵）**：两个 OpenCode 2.2.4 loopback 私有服务分别使用独立 DB、认证和 data/cache/state/config/tmp，两个不同 Root 均位于新 fixture primary，同用该 Git common-dir registry；插件 active、指定模型可见。fixture 从 `4972eb7` 新建 clone 和三个 detached sibling worktree；npm pack 产物解包加载，包内全部 `src/*.ts` 哈希与主工作区一致，包 SHA-256 `68e830a870a87a0453c1ff88ff7d51dd274e96526e911e0c369e6cb49944a59c`。打包 prepack 更新 fixture 的 dist 后已在该新 fixture 恢复，发起请求前 primary clean。凭据仅内存读取，不记录。

- 两 Root 请求区间分别为 Unix 秒 `[1793409631.861733, 1793409635.9010205]` 和 `[1793409631.861752, 1793409636.096129]`，重叠；实际经各 Root 的 `execute` → `metadata.toolCalls` 调用 `crew_task_start`，事件参数完全一致。B 成功提交 `ct_multiservice-samekey`，A 返回 `IDEMPOTENCY_CONFLICT`。B/A 事件首次观察时间分别为 `1793409634.078243` / `1793409634.3941724`；宿主没有提供锁临界区时间，**实际锁临界区重叠未证**。这是不同 owner 跨服务全局排他/冲突，不是同 owner 同 digest 的跨服务重放。
- 汇总两个私有 DB 和共享 ledger：仅两个 Root、一个 child、一条 ledger 记录，child 仅一条 user prompt，失败方 DB 无 child；marker 内容精确，目标 worktree 仅该 marker，primary 和另两个 worktree clean。child 调用了 patch、read 和 glob；部分 read 报错，但 marker 和最终只读检查通过，未见 shell。
- B Root 以新 prompt 真实重放完全相同输入，返回同一 task 和 child，提示“重放不会重新投递”；ledger 前后完全相同，child user prompt 仍一条。未重发失败方。
- 两服务 PID `1583641`、`1583642` 均由 runner finally 回收，退出码 130，进程组均不存在；不证明任意 child 进程树安全。未操作共享服务。

仓库根 cwd，预检 `slot audit` / `slot status` 及退出码记录于忽略目录 `plans/evidence/worktree-stage1/host-multiservice/slot.log`；`slot cpu -- python3 plans/evidence/worktree-stage1/host-multiservice/runner.py` 最终退出 0，脱敏工具事件、时间、DB 计数和回收结果见 `run3.log`。前两次尝试如实保留：`run.log` 在模型启动前因 npm stderr 合并导致 JSON 解析失败；`run2.log` 两个真实工具调用均返回 `DIRTY_PRIMARY`，因 prepack 改写新 fixture 的 dist，未形成成功任务；两个私有服务均已回收。修正 runner 并用全新 fixture 得到 `run3.log`，没有改写历史或生产代码。目录内私有 DB/cache 不应分享或提交。

**当时 NOT_TESTED**：跨服务最后容量位（其后见上节）、同 owner 相同 digest 跨服务重放、实际锁临界区重叠、真实 ask/deny、真实 interrupt 计数、双 child 实际执行重叠。此前 87 项测试结果为历史结果，该轮未重跑完整 tests/build；未提交或推送。

后文 55/67/75/82/85 等计数属于各历史验证轮次；当前总数为 **87**。`processSafety: unconfirmed` 仍是契约边界，不是缺陷；自动释放、清理、合并、resume 不在本阶段范围。多真实 service 同 key 的不同 owner 和最后容量位子矩阵已补验；真实宿主权限仅补验上文所列的 2.2.5 单一 ask→reject 案例，其他权限、interrupt 计数、双 engineer 时间重叠和 Git 输出超限尚待补验。

## 独立 OS 进程模拟宿主竞争（2026-10-31）

三个用例各自建立真实 clone 和 detached sibling worktrees；每次启动都是新 OS 进程、新 `registerTasks` 实例，唯一生产协调媒介为 Git common dir 的真实 registry。测试 barrier 只控制调度，不参与互斥；各进程独立 fsync 自己的包含 PID、session metadata、create/prompt 的 artifact，父进程仅汇总。相同 owner 和输入对应相同 digest。未使用共享模拟服务或共享计数器。

| 场景 | 观察 |
|---|---|
| 同 key，winner 持真实锁 | contender `REGISTRY_LOCKED` 且零副作用；释放后 winner submitted，1 create/1 prompt；新进程重放同 ID 无变化 |
| 同 key，winner 已 reserve、锁外暂停 | contender 返回 reserved、不续投；winner submitted，1 create/1 prompt；新进程重放不增记录或副作用 |
| 最后容量位、不同 key/目录 | 第一个已 submitted；winner 持锁时 contender `REGISTRY_LOCKED`，释放后 winner submitted，失败方新进程返回 `CAPACITY_RESERVED`；最终 2 submitted、2 不同 child、2 prompt，第三记录及副作用均不存在；新进程重放不变 |

定向 3 pass、完整 85 pass；具体 PID、task 状态和副作用汇总见 `test/.work/tasks-process-races/target-final.log`、`final.log`，预检见 `slot-final.log`，独立 artifact 位于该目录各 UUID 子目录。初次 `target.log` 的 3 次失败源于测试 mock 未支持对自身新建会话的 get，未到达目标副作用，不是生产语义红灯；修复测试 mock 后通过，无生产修复。**当时多进程模拟宿主 PASS，多真实服务 NOT_TESTED；最新补验见上文**。该轮不证明真实服务权限、生命周期、断电或进程树停止，也不改变永久预留和 `processSafety: unconfirmed` 契约。未启动模型或真实服务，未提交或推送。

竞争 harness 收尾：每用例共享 10 秒 deadline，子进程从 spawn 开始 watchdog，所有登记子进程在 finally 中回收；barrier 和 finish 均传播超时或 spawn 错误。副作用断言包含 create、prompt、interrupt、resume。两项短时自检覆盖不达 barrier 的卡住进程和不存在的可执行程序：旧 harness 的自检红灯为 `Expected: "rejected" / Received: "resolved"`，见 `harness-red.log`；修复后定向 5 pass、全量 87 pass，构建、diff 和 pack dry-run 均退出 0，见 `harness-final.log` 和 `harness-slot.log`。这只是 harness 修复，不是生产行为红灯或真实服务验证。

## stop checkpoint 子进程子矩阵（2026-10-31）

本轮在 HEAD `4972eb7` 和既有未提交测试上，使用真实 Git worktree、生产 `registerTasks` 和 Ledger，模拟宿主记录 fsync 的副作用；先经真实 `crew_task_start` 形成 submitted，再由父进程在 barrier 后 SIGKILL 子进程并回收，新实例以相同 owner 和 taskID 重放 stop。没有运行模型或真实宿主。

| SIGKILL 窗口 | 持久 state | 原进程 interrupt 次数 | 重放结果 |
|---|---|---|---|
| stop_requested 落盘后、interrupt 前 | stop_requested | 0 | 返回原记录，不补发 |
| interrupt 副作用已记录、响应前 | stop_requested | 1 | 返回原记录，不重发 |
| interrupt 响应后、stop_unconfirmed 落盘前 | stop_requested | 1 | 返回原记录，不重发 |
| stop_unconfirmed 落盘后 | stop_unconfirmed | 1 | 返回原记录，不重发 |

各窗口核对完整持久记录及 session binding 在重放前后相同，事件中没有额外 create、prompt、resume 或 interrupt。stop_requested 代表案例还以 status 读到原记录，且同 cwd 不同 key 返回 `WRITER_RESERVED`，证明占位未释放。

测试侧 checkpoint **写入前异常**：stop_requested 失败时原 submitted 不变、interrupt 为零，随后正常重试允许并实际发送一次 interrupt；stop_unconfirmed 写失败时保留 stop_requested，重放不再 interrupt。宿主 interrupt 抛含秘密的异常时，持久摘要仅 `{interrupted:"unknown",result:"error",errorCode:"HOST_ERROR"}`，输出和记录均不泄漏秘密，重放不再 interrupt。这些不是底层系统调用写故障注入。

最终定向、全量、构建和 diff 检查输出及 slot 预检分别保存在 `test/.work/tasks-stop-checkpoints/final.log` 和 `slot-final.log`。纯测试首次运行通过，无生产修复及本轮生产行为红灯。仍不称完整 stop durable 矩阵：未覆盖 stop 持锁 SIGKILL、底层 rename/fsync 错误、无 sessionID stop、身份核验/权限故障的全部窗口、多 service 竞争或真实宿主与模型；未证明进程树停止。processSafety 仍为 unconfirmed，没有 cleanup/release/merge/自动恢复。未提交或推送。

## AtomicRegistry 底层故障与持锁崩溃补充（2026-10-31）

在仓库根、HEAD `4972eb7`、前述未提交测试和报告基线上，测试子进程用 `mock.module('node:fs')` 包装实际文件调用并执行生产 `AtomicRegistry.withLock` / `write`，没有复制原子写算法。父进程用新 `AtomicRegistry` 实例验证读取、文件权限和再写行为；纯 Atomic payload 的结果只证明底层，不冒充工具端到端。

| 注入点 | 注入后读到的完整记录 | 锁及后续操作 |
|---|---|---|
| 首次 `Ledger.reserve` 临时文件 write | 无 registry；目录 0700 | 异常后锁及临时文件清除；新实例可写 |
| 已有记录更新的临时文件 write | 旧记录 | 异常后锁及临时文件清除；新实例可写 |
| 临时文件 fsync | 旧记录 | 同上 |
| rename 前抛错 | 旧记录 | 同上 |
| rename 后目录 fsync 抛错 | 完整新记录 | 异常后锁清除；新实例可写；错误返回与新记录并存是模糊结果 |
| 持锁、rename 前 SIGKILL | 旧记录 | `.lock` 0700 和临时文件 0600 遗留；新实例可读，写返回 `REGISTRY_LOCKED`，不抢占 |
| 持锁、rename 后 SIGKILL | 完整新记录 | `.lock` 0700 遗留、临时文件已重命名；新实例可读，写返回 `REGISTRY_LOCKED`，不抢占 |

存在的 registry 均核对 0600、目录 0700、JSON 完整性；所有子进程等待回收。两个 SIGKILL 窗口是在调用 rename 前和 rename 返回后、目录 fsync 前；这是本地文件系统运行时观察，**不是断电持久性保证**。未手工删锁，也未证明 stop 或多 service 竞争。

额外在先前 start fixture 注入 submitted 和随后的 start_unconfirmed 两次连续 checkpoint 前异常，持久记录仍为 `prompt_requested`、绑定 child，重放不重复 prompt；事件独立记录两次失败。reserved 崩溃代表案例重放后，第二个工作区成功预留，第三个返回 `CAPACITY_RESERVED`，原记录不变。上述异常仍属测试侧 checkpoint API 抛错，不是对每个工具调用的底层系统调用端到端注入。

验证日志位于 `test/.work/tasks-atomic-faults/`；`development.log` 是初版测试 mock 包装自身递归导致未到达注入点的失败，非生产缺陷红灯，修正测试包装后通过，未修改生产代码。最终验证记录见 `final.log` 和 `slot-final.log`。未启动模型或宿主、未提交或推送；该轮当时尚未覆盖 stop，后续子矩阵见上节，完整矩阵及其他未列窗口仍未完成。

## start checkpoint 子进程崩溃子矩阵（补充，2026-10-31）

在 `4972eb7`、仓库根 cwd，使用真实 Git clone/worktree、生产 `registerTasks`/ledger 和独立 Bun 子进程，宿主为测试 stub，不启动真实宿主或模型。测试侧包装 Ledger 方法设置确定性 barrier；父进程收到 barrier 后 SIGKILL 并等待回收，再以同 owner/key/input 启动新插件实例重放。事件记录 fsync 后统计，状态直接读 registry，重放前后比较完整记录。以下各行重放前后 create/prompt 数均不变，无 resume/interrupt，原预留及绑定不变：

| SIGKILL 位置 | durable state | sessionID | create / prompt |
|---|---|---|---|
| reserve 返回 | reserved | 无 | 0 / 0 |
| create intent 落盘 | session_create_requested | 无 | 0 / 0 |
| create 已返回、绑定前 | session_create_requested | 无 | 1 / 0 |
| session_bound 落盘 | session_bound | child | 1 / 0 |
| prompt intent 落盘 | prompt_requested | child | 1 / 0 |
| prompt 副作用后响应前 | prompt_requested | child | 1 / 1 |
| prompt 响应后 submitted 前 | prompt_requested | child | 1 / 1 |
| submitted 落盘 | submitted | child | 1 / 1 |

另在测试侧对四个 transition **调用写入前抛错**：create intent、session_bound、prompt intent、submitted 分别观察 create/prompt 为 0/0、1/0、1/0、1/1，均进入 start_unconfirmed，重放无新副作用。此注入是 checkpoint API 边界的写入前异常，并非实际文件 write/rename/fsync 系统调用故障；该 start 子矩阵本身未覆盖 rename、fsync、reserve 写失败或持锁 kill，其分层补验见上方 AtomicRegistry 一节，不等价于每个工具 checkpoint 的底层端到端故障组合。初轮未再验证第二、第三预留，后续已在 reserved 崩溃代表案例补验容量，见上节。未测 stop 完整矩阵、多 service 竞争、真实宿主及模型；自动恢复在范围外。**不是完整 durable 故障矩阵**。

`test/.work/tasks-checkpoints/slot.log`、`slot-checks.log` 保存 slot audit/status（均退出 0，audit 未发现绕过 slot 的重进程）。仓库根、项目内 TMPDIR 下经 `slot cpu` 执行：定向 12 pass、完整 `bun test` 67 pass、`bun run build` 与 `git diff --check` 均退出 0，日志 `test/.work/tasks-checkpoints/checks.log`。纯测试新增首次运行通过，无生产行为修复，故无本轮行为变更红灯。未提交或推送。

日期：2026-10-31。**受限阶段 1 实现完成，有界验收通过**；不是完整阶段 1 验收通过。私有宿主单任务及重启后第二任务、容量拒绝、stop 状态和同 key 重放实测 PASS；完整故障和并发矩阵仍有下列缺口。`processSafety: unconfirmed` 是受限契约的既定边界，不是缺陷或待实现功能，也不阻碍本次有界验收；它不证明进程树停止。

## 初始有界验收现场和证据（历史记录）

- cwd `/home/tcuni-claw/opencode/opencode-crew`，HEAD `4a5f5157fade2fa433cd845e7d4778f58d1ff20f`。原有未提交 tasks 模块、测试及 index/dist 修改保留；收尾另更新双语 README、测试发现配置及回归测试。没有提交、推送、stash 或重启共享服务。
- 本地私有证据在 `plans/evidence/worktree-stage1/`，整个目录已忽略，不应提交或分享其中潜在 DB/cache。`slot.log` 保存预检，audit/status 均退出 0，audit 报未发现绕过 slot 的重进程。
- 已核对已有有效红绿日志：`test/.work/tasks-tools/reviewfix-red.log`（两项 worktree 消失/别名行为失败，退出 1）及 `reviewfix-green.log`（15 pass，退出 0）；`test/.work/tasks-state/recovery-red.log`（历史与重放恢复两项失败，退出 1）及 `recovery-green.log`（8 pass，退出 0）。不能据此声称完整矩阵每项均已验证。
- 测试发现修复先写哨兵行为测试：`bun test test/test-discovery.test.ts` 配置前退出 1，因仓库根外 `test/` 的临时哨兵实际运行而断言失败；加 `bunfig.toml` 后同命令退出 0、1 pass。日志 `test/.work/stage1-final/red.log`、`green.log`；哨兵由 finally 删除。

## 初始有界验收矩阵（历史：当时状态；后续故障、双服务及权限补验见上文）

| 项目 | 状态 | 证据 |
|---|---|---|
| 限定 test/ 的测试 | PASS | 本轮 `bun test` 和 `bun test ./test/` 均退出 0，55 pass、0 fail、7 files；见 `test/.work/stage1-final/checks.log`。历史 74/130 等默认扫描数混入 evidence 旧 worktree fixture，不能作为本项目测试总数。 |
| 构建 | PASS | `bun run build` 退出 0，见 `checks.log`。 |
| 打包 | PASS | `npm pack --dry-run --json` 与 `npm pack --pack-destination plans/evidence/worktree-stage1/package` 均退出 0，TMPDIR 和 npm cache 在 evidence 目录；`package-list.txt` 仅列 dist、src、agents、README、中译 README、notice 和 package.json，无 plans/evidence、registry 或 node_modules。包 SHA-256 见 `fixture.log`。 |
| 解包 exports/setup | PASS（模拟上下文） | 从解包包自身的 `opencode-crew` exports 用 Bun import 并调用 setup，退出 0；`exports.log` 列出五个角色和三个 crew_task 工具。此检查不是实际宿主加载或真实工具调用。 |
| Git fixture | PASS | 本地 `git clone --no-local --no-checkout` 后 detached checkout 现有 HEAD，另建三个 sibling detached worktree；`fixture.log` 记录四者同一 HEAD、各自 clean。没有新增 commit。 |
| 私有宿主包加载、两个独立 engineer marker | PASS | 独立 loopback host 2.2.4 实际加载解包包；同一 Root 在两次服务运行中分别启动两个 engineer，各完成自己的 marker。不证明两者执行重叠。 |
| 同 key 重放、status、容量及 stop 状态 | PASS（有界） | 同 Root 真实工具调用，两个预留后第三个返回 CAPACITY_RESERVED；stop 两次均 stop_unconfirmed，重放同 ID、不增加 prompt。实际 interrupt 调用计数无法由本次宿主记录核实。 |
| 私有宿主重启同 DB 后查询及重放 | PASS（有界） | 第二次启动复用原 DB、Root、child 和 ledger，找回原消息并在目标 dirty、stop 后原输入重放，仍为原 ID/原 prompt。未测试自动 resume。 |
| 丢失响应后的不重投 | PASS（mock） | `tasks-tools.test.ts` 的 `lost create response and denied permissions never launch twice`：create 抛错后重复 start，create 仅一次、prompt 零次；`lost prompt response does not replay...`：prompt 抛错后重复 start，prompt 仅一次。不是各持久化 checkpoint 崩溃全覆盖。 |
| interrupt 次数与权限拒绝 | PASS（mock） | `stop requests at most one interrupt...` 和 `concurrent stop records bounded error...` 检查重复/并发 stop 的 mock interrupt 一次；`denial, non-root...` 检查 mock 拒绝后无 create/prompt/interrupt，另测 subagent/edit deny 无 create。真实宿主 ask/deny 零副作用及 interrupt 独立计数仍未验证。 |
| 同 key 并发 | PASS（同进程、mock） | `independent registrations racing the same key launch once` 在同一进程两次 plugin setup 的注册间并发 start，create/prompt 各一次；不等于独立 service 进程竞争验证。 |
| 跨进程锁及遗留锁 | PASS（registry 层） | `tasks-ledger.test.ts` 的 `independent process holds lock until killed; stale lock remains while reads work`：子进程持锁时本进程写锁返回 REGISTRY_LOCKED；SIGKILL 后遗留锁仍不可抢占，读取原 durable 数据仍可用。不等于多 service 对同 key 或最后容量位的端到端竞争。 |
| 完整 checkpoint 故障/崩溃矩阵 | NOT_TESTED（完整矩阵） | 上述响应丢失已有 mock 验证；reserve、ID 落盘等每个 intent 写入故障和崩溃窗口及重建恢复未完整实证。 |
| 多 service 同 key / 容量竞争 | NOT_TESTED | 上述同进程双注册及独立进程 registry 锁已测；独立 service 进程对同 key 或最后容量位的端到端竞争尚未实证。 |
| 真实宿主权限及 interrupt 计数 | NOT_TESTED | mock 拒绝和 interrupt 次数已测；真实 ask/deny 零副作用、重复 stop 底层 interrupt 独立计数尚无充分证据。 |
| 双 engineer 执行时间重叠 | NOT_TESTED | 两个 marker 在两次服务运行完成，不证明同时执行。 |
| Git 输出超限 | NOT_TESTED | `tasks-git.test.ts` 已验证 dirty、baseline、路径等部分边界；Git 输出超限及完整边界矩阵未实证。 |

检查命令的 cwd 均为上述仓库根；解包 setup 检查的 cwd 为 `plans/evidence/worktree-stage1/unpacked/package`。历史细节见本机忽略的 `checks.log`、`exports.log`、`package-list.txt`、`fixture.log`；本轮输出见 `test/.work/stage1-final/`，双语 README 已更新。测试和 npm 的 TMPDIR/cache 均设在项目内。

## 单任务真实宿主补验

`slot audit` 和 `slot status` 均退出 0，见 `host1/slot.log`。以仓库根为 cwd 执行 `slot cpu -- python3 plans/evidence/worktree-stage1/host1/runner.py`：私有 host 的 tmp/data/cache/state/config/DB 均在 `host1/`，使用内存中读取的现有 provider 配置，不输出凭据；端口仅绑定 loopback，加载 `unpacked/package`，模型 `tcuni/gpt-6.1-terra` 可见。服务退出码 130，进程组已不存在；未操作共享服务。

- Root `ses_e70afaa46ffeWZuyat3hbbVOKc`；child `ses_e70af9f7cffeYiKXy7vX2DXftX`；task `ct_host1-marker`。
- 外层实际工具为 `execute`，其 `metadata.toolCalls` 记录嵌套 `crew_task_start`、`crew_task_status`、`crew_task_start` 均 completed；对应 Root 消息依次 `msg_18f5055ca001BFyUs38YtZ0k6K`、`msg_18f50a441001C9zvnd4VJoQP1F`、`msg_18f50bfb8001bK7rDTcwfpPF0Y`。三次结果均 `ok:true`，status 观测 engineer outcome succeeded，但 processSafety 仍为 unconfirmed；replay 警告“不再投递”。
- 私有 DB 只有 Root 和该 child 两个 session，ledger 一个 task；child 一条 user prompt `msg_18f5060ab001Baqi9lXz0cXcX4`。`wt-a/stage1-host1-marker.txt` 内容为 `HOST1-MARKER\n`，目标 worktree 唯一变动为该 untracked 文件，primary clean。child 使用 patch 和 read，未见 shell；部分额外 read 报错但不影响 marker 结果。
- **runner 自身退出 1**：末尾错误地只按外层工具名寻找 `crew_task_*`，而宿主将其放在 `execute` 的 `metadata.toolCalls` 内，导致断言失败；不是上述工具调用失败。未重跑模型。随后以 `python3 plans/evidence/worktree-stage1/host1/verify.py` 只读私有 DB 和 ledger，按嵌套事件核验，退出 0，输出 `independent_verification PASS`。脱敏事件和核验结果见 `host1/verify.log`，原始 runner 输出见 `host1/run.log`。私有 DB 仍在忽略目录，不应分享。

## 后续

若需推进完整矩阵，剩余范围包括：

1. 逐 checkpoint 写入故障、崩溃及重建恢复。
2. 同 owner 同 digest 跨 service 重放及实际锁临界区重叠（不同 owner 同 key 和最后容量位的有限证据见上文）。
3. 真实宿主其他权限 action、显式 deny 和 interrupt 独立计数（2.2.5 的 subagent/engineer ask→reject 已测，见上文）。
4. 双 engineer 执行时间重叠。
5. Git 输出超限及其余边界，然后重跑全部检查。

上述真实双服务请求区间重叠，但不证明 child 实际并发运行或进程树停止。cleanup、release、merge、自动 resume 及跨机分布式锁均在本阶段范围外，不是待实现验收项。进程安全仍未确认，marker 和 ledger 现场保留，不能自动清理或整合。

## host2：重启、第二任务、容量和 stop

执行日期 2026-10-31。仓库根 cwd 下先 `slot audit`、`slot status`，均退出 0，audit 未发现绕过 slot 的重进程；随后 `slot cpu -- python3 plans/evidence/worktree-stage1/host2/runner.py`，**runner 退出 0**。证据为被忽略的 `host2/slot.log`、`host2/run.log` 和 `host2/runner.py`。独立服务使用同一个 host1 DB、同一个 fixture ledger 和解包包，host2 独立 tmp/data/cache/state/config，未重启共享服务。为满足复用同 DB 的要求，宿主实际更新了忽略目录里的 `host1/private.db`，并更新 primary 的 Git common-dir ledger；host1 日志和原 marker 未改。不要分享该 DB 或 cache。

- 服务启动先通过 API 找回 Root `ses_e70afaa46ffeWZuyat3hbbVOKc`、child `ses_e70af9f7cffeYiKXy7vX2DXftX`，原 child prompt `msg_18f5060ab001Baqi9lXz0cXcX4` 和原 Root start 消息均存在；不是自动恢复执行的证明。
- Root 实际经 execute 嵌套工具启动 `ct_host2-marker`（消息 `msg_18f530161001yIgEeuVg2m388e`），第二 child `ses_e70acf29fffeeB14Qy7cGLjzdZ`，唯一 user prompt `msg_18f530d870015iQnAPvRwbWVGr`。`wt-b/stage1-host2-marker.txt` 内容 `HOST2-MARKER\n`；child 事件中无 shell，部分额外 read 报错。
- 第三个目标 `wt-c` 返回 `CAPACITY_RESERVED`（消息 `msg_18f534fcc0010ow7T31RaoOeVm`），最终 DB 仅 Root 和两个 child，ledger 仅两个 task，wt-c clean。
- 对第一个 task 的 stop（消息 `msg_18f536b47001mUBUzrms5R7vfA`）返回 `stop_unconfirmed`、`processSafety:unconfirmed`、interrupt result `request_completed`；重复 stop（`msg_18f538e9a001vJ0JYMPMV5oWp0`）保留结果并提示不会重复中断。宿主 event 表为空，**不能独立证明第二次 interrupt 调用数为零**。
- 从原 ledger 取得未经改动的完整 input 重放（消息 `msg_18f53aa150014ytMql5GUHXAHF`），尽管 wt-a dirty 且 task 已 stop，仍返回原 child ID 和不再投递警告；两个 child 最终各仅一个 user prompt。原 marker 前后 SHA-256 均为 `b481f21510cc261ab9afc86aed473a08e8d7c6371a763785f74d31be18ce2615`，primary clean。
- 私有 host PID 1427327 退出码 130，进程组不存在。这个观察只涵盖私有 host 进程组，不是任意后台或进程树安全保证。
