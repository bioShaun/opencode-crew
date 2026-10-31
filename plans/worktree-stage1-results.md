# 受限阶段 1 打包及有界验收记录

日期：2026-10-31。**受限阶段 1 实现完成，有界验收通过**；不是完整阶段 1 验收通过。私有宿主单任务及重启后第二任务、容量拒绝、stop 状态和同 key 重放实测 PASS；完整故障和并发矩阵仍有下列缺口。`processSafety: unconfirmed` 是受限契约的既定边界，不是缺陷或待实现功能，也不阻碍本次有界验收；它不证明进程树停止。

## 现场和证据

- cwd `/home/tcuni-claw/opencode/opencode-crew`，HEAD `4a5f5157fade2fa433cd845e7d4778f58d1ff20f`。原有未提交 tasks 模块、测试及 index/dist 修改保留；收尾另更新双语 README、测试发现配置及回归测试。没有提交、推送、stash 或重启共享服务。
- 本地私有证据在 `plans/evidence/worktree-stage1/`，整个目录已忽略，不应提交或分享其中潜在 DB/cache。`slot.log` 保存预检，audit/status 均退出 0，audit 报未发现绕过 slot 的重进程。
- 已核对已有有效红绿日志：`test/.work/tasks-tools/reviewfix-red.log`（两项 worktree 消失/别名行为失败，退出 1）及 `reviewfix-green.log`（15 pass，退出 0）；`test/.work/tasks-state/recovery-red.log`（历史与重放恢复两项失败，退出 1）及 `recovery-green.log`（8 pass，退出 0）。不能据此声称完整矩阵每项均已验证。
- 测试发现修复先写哨兵行为测试：`bun test test/test-discovery.test.ts` 配置前退出 1，因仓库根外 `test/` 的临时哨兵实际运行而断言失败；加 `bunfig.toml` 后同命令退出 0、1 pass。日志 `test/.work/stage1-final/red.log`、`green.log`；哨兵由 finally 删除。

## 实测矩阵

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

若需推进完整矩阵，按以下顺序另行验证：

1. 逐 checkpoint 写入故障、崩溃及重建恢复。
2. 独立 service 进程的同 key 和容量竞争。
3. 真实宿主 ask/deny 零副作用和 interrupt 独立计数。
4. 双 engineer 执行时间重叠。
5. Git 输出超限及其余边界，然后重跑全部检查。

本次不证明并发运行或进程树停止。cleanup、release、merge、自动 resume 及跨机分布式锁均在本阶段范围外，不是待实现验收项。进程安全仍未确认，marker 和 ledger 现场保留，不能自动清理或整合。

## host2：重启、第二任务、容量和 stop

执行日期 2026-10-31。仓库根 cwd 下先 `slot audit`、`slot status`，均退出 0，audit 未发现绕过 slot 的重进程；随后 `slot cpu -- python3 plans/evidence/worktree-stage1/host2/runner.py`，**runner 退出 0**。证据为被忽略的 `host2/slot.log`、`host2/run.log` 和 `host2/runner.py`。独立服务使用同一个 host1 DB、同一个 fixture ledger 和解包包，host2 独立 tmp/data/cache/state/config，未重启共享服务。为满足复用同 DB 的要求，宿主实际更新了忽略目录里的 `host1/private.db`，并更新 primary 的 Git common-dir ledger；host1 日志和原 marker 未改。不要分享该 DB 或 cache。

- 服务启动先通过 API 找回 Root `ses_e70afaa46ffeWZuyat3hbbVOKc`、child `ses_e70af9f7cffeYiKXy7vX2DXftX`，原 child prompt `msg_18f5060ab001Baqi9lXz0cXcX4` 和原 Root start 消息均存在；不是自动恢复执行的证明。
- Root 实际经 execute 嵌套工具启动 `ct_host2-marker`（消息 `msg_18f530161001yIgEeuVg2m388e`），第二 child `ses_e70acf29fffeeB14Qy7cGLjzdZ`，唯一 user prompt `msg_18f530d870015iQnAPvRwbWVGr`。`wt-b/stage1-host2-marker.txt` 内容 `HOST2-MARKER\n`；child 事件中无 shell，部分额外 read 报错。
- 第三个目标 `wt-c` 返回 `CAPACITY_RESERVED`（消息 `msg_18f534fcc0010ow7T31RaoOeVm`），最终 DB 仅 Root 和两个 child，ledger 仅两个 task，wt-c clean。
- 对第一个 task 的 stop（消息 `msg_18f536b47001mUBUzrms5R7vfA`）返回 `stop_unconfirmed`、`processSafety:unconfirmed`、interrupt result `request_completed`；重复 stop（`msg_18f538e9a001vJ0JYMPMV5oWp0`）保留结果并提示不会重复中断。宿主 event 表为空，**不能独立证明第二次 interrupt 调用数为零**。
- 从原 ledger 取得未经改动的完整 input 重放（消息 `msg_18f53aa150014ytMql5GUHXAHF`），尽管 wt-a dirty 且 task 已 stop，仍返回原 child ID 和不再投递警告；两个 child 最终各仅一个 user prompt。原 marker 前后 SHA-256 均为 `b481f21510cc261ab9afc86aed473a08e8d7c6371a763785f74d31be18ce2615`，primary clean。
- 私有 host PID 1427327 退出码 130，进程组不存在。这个观察只涵盖私有 host 进程组，不是任意后台或进程树安全保证。
