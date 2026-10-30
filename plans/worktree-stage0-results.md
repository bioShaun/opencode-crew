# 阶段 0 实证记录：最新验收

阶段 0 的能力调查与受限验证已结束，不代表所有验收项通过。用户随后已批准受限阶段 1 的设计与实现，见 [实施契约](worktree-stage1-contract.md)；这不改变本报告的 FAIL / NOT_TESTED 结论。

## 证据保留与提交边界

`plans/evidence/worktree-stage0/` 是本机运行现场，含私有数据库、缓存、日志、嵌套 worktree 及模型原生载荷，不是可直接交付的 Git 目录。已加入 `.gitignore` 防止意外加入普通提交；现场保留，不执行清理。Git 忽略不是脱敏或访问控制，也不阻止强制添加。

当前报告可作为结论索引，原始证据留本机。若以后需要分享证据，须另建白名单导出：必要脱敏日志、脚本、标记快照及清单；排除数据库、缓存、嵌套 worktree、原生加密推理载荷及认证信息。已知秘密扫描未命中不等于整个目录适合公开。

## 最新验收矩阵（round 1–5 汇总）

| 项目 | 结果 | 证据及边界 |
|---|---|---|
| 私有服务和临时目录 | PASS | round2/05、round3/05、round4/09；独立数据库及项目内 TMPDIR，loopback。|
| 两会话目录绑定、并行和文件隔离 | PASS | round3/05、messages-a/b、06；build 会话，不是安全沙箱。|
| 当前 Crew 角色加载和规则 | PASS（规则核对） | round4/09：本地插件 active，package exports 指向当前 `dist/index.js`；engineer 的 allow/ask/deny 与两 location architect 绝对路径规则已核对。未以模型工具实测 engineer deny/ask 的执行效果。|
| 中断运行中的 `session.shell` 进程 | FAIL | round4/09：进程存活时 interrupt 返回 `interrupted:false`；3.5 秒后 heartbeat 从 1 增至 4、PID 仍活，active 却为空；受控任务随后按 25 秒上限自然退出。不能把 idle 当停止。未推断模型工具 shell 的行为。|
| 中断模型同步 shell 工具 | PASS（单一受控场景） | round5/05：engineer shell running 且 PID 存活时 interrupt 返回 true；1、4、7 秒后 PID 不存在且 heartbeat 未增长，退出后该进程组无成员。未验证后台、脱离进程组或其他命令。|
| 中断后成果保留 | PASS（worktree 受控探针） | round5/05、06：模型 patch 的 wt-a 标记在中断前后哈希一致；round4 另验证证据目录成果及重启。|
| 私有服务重启后找回原会话 | PASS（记录恢复） | round4/09：同一 session ID、location、消息 ID、成果哈希保留；不是自动续跑或消息内容逐字比对。|
| 原生 subagent 目录入口 | NOT_TESTED | 使用独立 API session 编排；不能推断父子通知或取消语义。|
| 自动续跑、去重、后台 shell 中断、权限执行与整合 | NOT_TESTED | 均没有对应实证；不能由记录恢复或规则列表推断。|

**阶段 1 判断：不按原自动化推进，采用已获批准的受限契约。** 同步模型 shell 的单例通过不适用于直接 `session.shell`（已失败）、后台或脱离进程组任务。首版仅绑定工作区、一次性投递与查询/请求停止，不提供整合、清理或自动释放；停止安全始终未确认，需人工外部核实。恢复仅证明原记录可找回，不代表自动续跑。保留每 cwd 单写入者、最多两预留、固定基线与未验收成果；不将 worktree 当权限沙箱。

## 第五轮：engineer 同步 shell 中断

- **PASS，范围限定。** 私有 loopback 服务 836094，独立 DATA/CACHE/STATE/DB 和项目内 TMPDIR；当前根目录 Crew 插件 active、dist SHA-256 `3342932f247c0e474bfa97a6b8c038e3997ec713d3d980862cb98883fe051498`，会话 `ses_e71f59169ffejk6ASFdtBgRYSq` 为 engineer / tcuni/gpt-6.1-terra，location 为 wt-a。真实 patch 与 shell 记录见 `round5/messages-before.json`、`messages-after.json`。
- `round5/05-run.log`：epoch ms 1793384432251 shell tool 状态 running，命令 `python3 .../round5/worker.py`，timeout 40000，PID/PGID 836751，starttime 748394489，heartbeat 1；1793384432252 请求 interrupt，2253 HTTP 200 `interrupted:true`。随后 3255、6256、9258 时 PID 不存在且 heartbeat 仍 1；服务退出后 PID 不存在，`06-final.log` 检查 PGID 及命令指纹均无匹配。此例为同步、无子进程的 Python worker，不能推广到任意进程树。
- 模型创建的 `wt-a/stage0-round5-attempt2.txt` 中断前后 SHA-256 均为 `ae33bd1d033a689db23f816eb0182468b5de1b3ea088078e45ea31edb5e13d55`，文件保留。首次尝试的 `stage0-round5-artifact.txt` 也保留：prompt 没明确允许 worker 写证据文件，engineer 正确拒绝运行；`03-run.log` exit 1 和 `attempt1-messages.json` 是失败尝试，并非中断测试结果。第二次明确授权证据写入，`05-exit.txt` 为 0。
- `01-baseline.log`、`06-final.log`：原两个标记哈希及五个 tracked 修改 diff SHA-256 `c6a3d5bd2a11a4d0075dbb5eccea836a6102995580b3cad952befb73bb14a1a2` 不变。两个私有服务均已退出，未重启共享服务；slot 前检 `02-slot.log`、`04-slot.log`，runner 两次经 slot cpu。`07-secret-scan.log` 对可识别配置及环境认证值扫描 round5 顶层文本未命中，非穷尽扫描。无源码行为变化，红绿灯不适用；未提交、推送或 stash。

## 第四轮：实证结果及原始证据

- 私有服务实际加载 `/home/tcuni-claw/opencode/opencode-crew` 插件；`package.json` exports 指向 `dist/index.js`，该文件 SHA-256 `3342932f247c0e474bfa97a6b8c038e3997ec713d3d980862cb98883fe051498`。engineer 会话 `ses_e7203ab23ffemZ28y5KhkM2v8q` 位于 wt-a；shell API 是直接调用，不是模型 tool 权限测试。
- 受控 PID 808701 在 interrupt 前存活，heartbeat 1；interrupt HTTP 200 且 `interrupted:false`，其后仍存活、heartbeat 4，最终 heartbeat 25 后自然退出。会话消息 ID `msg_18dfc54e3002PWgDv2OSqm3vg1` 重启前后相同，成果 SHA-256 `f7e44fbfacca3c7c089404f01157e3bc43db4b5aabf4a25b8b63b9dd111311a0`。全过程见 `round4/09-run.log`、`round4/run2/heartbeat.log`、`round4/runner.py`。
- `round4/03-run.log` 因插件尚未就绪得到 404；`05-run.log` 因同步等待 shell 返回后才检查进程而错过运行期；`07-run.log` 因第二 location 尚未就绪得到 404。均为保留的失败尝试，不作为目标通过；`09-run.log` 的 runner 退出 0 表示证据采集完成，不代表中断通过。
- `round4/01-baseline.log` 与 `10-final.log`：五个既有 tracked 改动的 diff SHA-256 均为 `c6a3d5bd2a11a4d0075dbb5eccea836a6102995580b3cad952befb73bb14a1a2`，两 worktree 的既有标记哈希不变；本轮私有服务及受控进程均已退出。`02/04/06/08-slot.log` 记录预检；`11-secret-scan.log` 对可识别配置认证值及模型环境认证值扫描未命中（非穷尽秘密扫描）。未修改共享服务/全局配置，未提交、push、stash 或清理成果。仅证据脚本，无源码行为变更，红绿灯不适用。

## 历史：第三轮（仅 build 并行目录绑定）：COMPLETE

- 私有服务使用正常的 `/home/tcuni-claw/.config/opencode/opencode.json` 配置加载路径，以及既有环境认证；DATA/CACHE/STATE、数据库及 TMPDIR 均独立于共享服务。`/api/model` 启动时 11 次返回 503，随后确认 `tcuni/gpt-6.1-terra` 可见；两个会话均实际得到模型响应，认证与工具调用成功。没有输出或复制认证值。证据 `round3/05-run.log`、`runner.py`；首次未等待模型初始化的尝试退出 1，见 `03-run.log`。
- 两会话均为 `build`，基线 `2cf3fe89aac9b689b18f64dc8710908ca29b1366`：wt-a `ses_e7206dfe2ffedcXTTr55yZKzhy`；wt-b `ses_e7206dfd4ffekyPIWDTz5i7P45`。会话 location、模型和角色见 `05-run.log`。并行不是仅同时提交：同一 `/api/session/active` 响应多次同时显示两个 ID running，从 epoch 毫秒 1793383276973 至 1793383300989。两个模型工具链也真实运行，见 `messages-a.json`、`messages-b.json`。
- 两会话均以 read 读取各自的 `README.md`，以 patch 添加自己的标记，shell 输出各自 worktree 的 cwd、项目内 TMPDIR、`OTHER_ABSENT`，退出码均 0。最终独立文件核验：wt-a 仅有 `stage0-marker-a.txt`（MARKER-A），wt-b 仅有 `stage0-marker-b.txt`（MARKER-B），主目录无标记；见 `05-run.log`、`06-final.log`。注意 wt-b 的 shell 检查发生在 wt-a 创建标记前，最终文件核验另外确认对方标记不存在。隔离是工作树文件区分，不是 OS 权限沙箱。
- 验证服务只监听 loopback，`/api/info` 确认临时路径；本轮私有 PID 800001、801116 均已退出，第二次 runner 退出 0，服务 SIGTERM 退出 130。slot 前置审计和状态在 `02-preflight.log`、`04-preflight.log`。未重启或重载共享服务。
- 主工作区五个已有修改的 diff 起止 SHA-256 均为 `c6a3d5bd2a11a4d0075dbb5eccea836a6102995580b3cad952befb73bb14a1a2`；`01-baseline.log`、`06-final.log` 记录状态及清单。两个未跟踪标记保留在各自 worktree；无提交、push 或 stash。证据目录扫描配置中可识别的认证值及现有模型环境认证值，未发现匹配；不代表对所有可能秘密的穷尽扫描。
- **范围限制：**仅本轮指定的 build 任务和目录隔离通过；Crew engineer、权限策略、中断、恢复、重载均未测；不据此自动进入阶段 1。无源码行为变化，红绿测试不适用。

## 历史：第二轮（缩范围）：BLOCKED，私有临时路径已验证

2026-10-31，cwd `/home/tcuni-claw/opencode/opencode-crew`。不进入阶段 1；中断和重载恢复不在本轮范围。

- **PASS：独立服务及临时路径。** 安装版 2.2.4 的 `opencode serve --hostname 127.0.0.1 --port <动态端口>` 在 `slot cpu` 内启动；以独立 XDG data/cache/state/config、`OPENCODE_DB` 和 `TMPDIR` 启动，不触碰共享服务登记或数据库。`/api/info` 实际报告项目内 `round2/tmp/opencode`；`build` 会话绑定 wt-a，session shell 的 `$PWD`、`$TMPDIR` 和 `mktemp` 的结果分别落在 wt-a、指定 tmp 和指定 tmp 内。完整命令及退出码见 `round2/05-probe-auth.log`、`round2/probe.py`；Python runner 退出 0，私有服务 SIGTERM 后退出 130。第一次未经认证探测退出 1（`03-probe.log`），不是服务不可用；随后依据安装的 `@opencode/client` Basic 认证实现修正。短期随机密码仅在进程环境和内存中，首次生成的服务日志已脱敏。
- **BLOCKED：两任务真实并行与读/edit/shell 全链路。** 完全独立的配置及数据库下，`/api/model/default` 返回 `opencode/big-pickle`，不是本任务已确认可用的模型；未调用它，也未擅自访问或复制用户凭据、读取 `.env`。需提供一种将现有获授权模型的配置及认证安全传递到独立服务的方式（不改共享服务/数据库且不暴露密钥），或批准具体可用的独立配置来源。API 会话建立和 shell 探测不代表模型 prompt、文件工具或并发已经通过。
- **NOT_TESTED：** Crew engineer 角色及权限；两工作区读写隔离、运行重叠、对方标记不可见；中断/重载。已验证的角色是内置 `build`，不是旧 worktree 的 Crew engineer。worktree 不是权限沙箱。
- 两个 worktree 均仍为干净 detached，基线 `2cf3fe89aac9b689b18f64dc8710908ca29b1366`；会话探针 ID 及位置见 `05-probe-auth.log` 和 `07-model-probe.log`。无本轮并行任务会话 ID。主工作区 5 个批准修改的完整 diff SHA-256 起止均为 `c6a3d5bd2a11a4d0075dbb5eccea836a6102995580b3cad952befb73bb14a1a2`，清单及状态见 `01-baseline-paths.log`、`08-final.log`。未提交、推送、stash；私有服务 PID 均已退出，工作区保留。
- 资源检查 `round2/02-slot-preflight.log`、`04-slot-preflight.log`、`06-slot-preflight.log`；私有服务/探针走 `slot cpu`。本轮只新增 `round2/` 证据和更新本报告，无源码行为改动，红绿测试不适用。

## 历史：第一轮（当时 INCOMPLETE）

2026-10-31，cwd `/home/tcuni-claw/opencode/opencode-crew`。结论 **INCOMPLETE**：已调查接口并准备两个干净 worktree，尚未进行会话级实证，不能据此批准进入阶段 1。

## 约束和停止原因

共享服务健康，版本 2.2.4，`/api/info` 返回 `paths.tmp=/tmp/opencode`（见 `02-host.log`）。任务禁止临时文件放在 `/tmp`，包括子进程；客户端设置 TMPDIR 不会改变已经运行的共享服务环境。该路径本身不证明本次请求一定写入 /tmp，但也不能证明会话创建、插件加载、执行工具及其子进程不会使用它。为避免违反约束，未触发这些写操作；没有重启、重载共享服务。尚未查明是否存在安全的私有服务替代方案，因此这是保守停止，不是断言宿主无法支持。

## 宿主接口调查

- 当前子代理可见工具列表没有原生 subagent 启动工具，因此没有在此工具界面发现 directory/worktree 参数；此观察不能证明其他宿主界面或内部实现不存在该能力。
- 运行中服务的 `/openapi.json` 表明 `session.create` 接受 `location`、`agent` 和 `parentID`；`session.move` 接受 `directory`，还有 prompt、shell 和 interrupt。只是接口契约，不证明权限、生命周期或与原生子代理等价。原始接口见 `openapi-installed.json`。在 `src/index.ts:70-71` architect 路径规则依赖 `ctx.location.directory`，实际跨目录效果未验证。
- 客户端 2.2.4；项目声明和安装的 plugin 均为 2.2.3。在线 V2 文档可能与安装版不同，以运行时 OpenAPI 为接口证据。
- `opencode api ... --param search=...` 的只读尝试返回了不相关会话，不能作为过滤结果或空会话证明；因其他项目隐私未保留返回正文。实际本次未创建验证会话。

## 历史验收矩阵（第一轮当时状态，非当前结论）

| 项目 | 结果 | 证据与限制 |
|---|---|---|
| 原生 subagent 指定目录入口 | NOT_TESTED | 本会话未暴露启动工具；非完整宿主结论。|
| 目录绑定：会话、文件工具、shell | BLOCKED | 未创建会话；接口存在不等于三者一致。|
| 目标目录配置、角色和路径权限 | BLOCKED | 未加载验证会话；代码仅展示依赖目录，未证明规则生效。|
| 两会话并行与读写隔离 | BLOCKED | 仅准备两个 worktree，未执行任务、未写标记。worktree 不是 OS 权限沙箱。|
| 任务、会话、基线、目录关联 | BLOCKED | 基线和目录已记录，但没有任务会话 ID 或结果。|
| 完成、中断与残留进程 | BLOCKED | 未启动可中断命令；不能以 idle 推断进程停止。|
| 中断后成果保留 | NOT_TESTED | 未产生任务成果。|
| 重载恢复和避免重复启动 | NOT_TESTED | 未重载共享服务，也未启动独立验证服务。|

## 证据索引及资源

- `plans/evidence/worktree-stage0/01-baseline.log`：起始 HEAD、状态、版本、worktree。
- `02-host.log`：服务状态、真实临时路径、版本与角色代码片段。`03-sdk-search.log`：已安装 SDK 只读搜索，不作为不存在某入口的证明。
- `openapi-installed.json`：目标服务实际 OpenAPI；`openapi-error.log`：读取错误流。
- `04-worktrees.log`：两次 `git worktree add --detach` 均退出 0，均从 `2cf3fe89aac9b689b18f64dc8710908ca29b1366` 建立，无复制主工作区未跟踪文件。
- `05-final.log`：最终主工作区状态 `?? plans/`，已跟踪 diff 为空；两个 worktree 状态为空。会话查询返回其他共享会话，已从日志剔除，不构成完整会话清单。

两 worktree 保留在 `plans/evidence/worktree-stage0/wt-a` 和 `wt-b`，空且 detached；本次没有向它们派发会话或启动任务进程。未对机器上不相关进程做全局活动结论；清理前仍需重新确认状态。未提交、推送或 stash；未修改 Crew 代码。

## 历史建议（第一轮当时，非当前结论）

不进入阶段 1。先查明并实证可配置到项目内或 `/project/tmp` 的独立服务及其子进程临时路径，不影响现有共享服务；然后在两个 worktree 中按方案完成真实双会话、配置权限、进程中断与安全范围恢复测试。若无法满足临时路径约束，交由用户决定环境处理方式，不将文档接口或空 worktree 当作验证通过。
