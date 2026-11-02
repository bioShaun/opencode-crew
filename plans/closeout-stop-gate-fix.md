# Close stop gate：最小修复与永久 apply 回归契约

状态：**ready / context-only**。日期：2026-11-02。上游基线 HEAD `27d12c3`（本文未执行 Git 命令核验）。

## 1. 背景与权限边界

现有 `verifyClose` 仅检查 bundle 与 record 的 stop 字段一致，六种非 stop 状态也能首次结案。首轮证据 `plans/evidence/closeout-stop-gate-round1/report.md` 记录 submitted 的 plan/apply 均成功，apply 使 generation 5→6、active 1→0、closed 0→1。该报告是已读取的上游摘要，不是本文重新执行的结果。

本 Assignment **仅新增本文**；不修改已有 `test/tasks-maintenance.test.ts` 的 +52 红灯、首轮方案及 evidence、`plans/worktree-stage1-closeout-spec.md` 或任何源码。未来 Root 另开 engineer Assignment 后，建议实现范围严格为：

- `src/tasks-maintenance.ts`：私有共享校验的最小状态门禁。
- `test/tasks-maintenance.test.ts`：永久回归、测试本地 builder 与私有 fixture。

未来实现需要将首轮 apply 测试的准备方式替换为下述 builder；这不是本轮修改该文件的授权。旧红灯日志、首轮方案和历史收尾规范始终保留，不以新测试覆盖。新执行日志路径由 Root 单独授权，不能覆盖旧 evidence。真实 ledger、worktree、宿主和服务不在实施范围；不执行真实 maintenance 操作。

已读取全局 AGENTS 指令；仓库内未发现 AGENTS.md，检查到的祖先路径也无额外文件。依据为现有源码、测试、首轮方案/取证报告与历史收尾 spec；没有另行提供的 explorer 摘要。本文不扩大 Mandate/Scope，不替代实施 Assignment。

## 2. 已决定事项与生产契约

1. 对**尚未提交的首次 close**，权威 active record 为以下任一状态时，plan 和 apply 都必须抛 `TaskRegistryError`，`.code === 'MAINTENANCE_EVIDENCE_INSUFFICIENT'`：
   `reserved`、`session_create_requested`、`session_bound`、`prompt_requested`、`submitted`、`start_unconfirmed`。
2. 在 `verifyClose` 内针对 `item.record.state` 增加只接受 stop 阶段的检查，失败调用现有 `evidence()`。可放在该函数读取 bundle 前；不另定多重非法输入的错误优先级。`buildPlan` 和锁内 `applyClose` 共用此处，门禁在所有备份、归档和账本写入之前。
3. 不收窄全局 `states`，不修改 `parseBundle`、`validatePlan` 的八状态结构兼容性：旧 plan 必须仍能通过结构/摘要检查并到达业务门禁。禁止仅在 plan 入口修复，或为测试导出 `canonical`、`digest`、`verifyClose` 等私有函数。
4. `stop_requested`、`stop_unconfirmed` 及既有 interrupt 字段组合的行为不变；原有授权、排空、时间、一致性、listing 和证据闭包检查继续全部执行。兼容控制不代表确认这些组合符合完整异常结案政策，更不代表已停止进程。
5. 不改变 `planMaintenance` 中先 `replayCredential` 后 `buildPlan`，以及 `applyMaintenance` 中 `validatePlan` 后进入 transaction、先 `replayCredential` 后 generation/registryDigest 校验和 `applyClose` 的顺序。历史 closed（包括非 stop 状态）同 operationID/paramsDigest 重放仍返回原结果，不能重新要求 stop、重新读证据或产生新副作用。原有参数冲突继续 `OPERATION_CONFLICT`。
6. 拒绝不留下持久业务写入；合法获取/释放事务锁不属于此处“零写入”的反例。

## 3. 合法状态 fixture 与 stage 语义

复用 `setup`、`start`、`migrated`、`record`、`bundle`、`closeRequest`；`start` 实际只 reserve，并非 submitted。所有案例独立 `setup()`，在项目内 `test/.work/tasks-maintenance/` 新建私有仓库。先 reserve、迁移到 v2，再用 `Ledger.transition` 走 `src/tasks-state.ts` 的 `edges`：

| 测试状态 | 合法路径（起点 reserved） | session / interrupt |
|---|---|---|
| reserved | 不转换 | 均缺失 |
| session_create_requested | → session_create_requested | 均缺失 |
| session_bound | → session_create_requested → session_bound | 进入 bound 时传 `{sessionID:'fixture-session'}`；无 interrupt |
| prompt_requested | 上一行 → prompt_requested | 保留 session；无 interrupt |
| submitted | 上一行 → submitted | 保留 session；无 interrupt |
| start_unconfirmed | reserved → start_unconfirmed，传 `{lastErrorCode:'START_UNCONFIRMED'}` | 均缺失；模拟启动结果未确认，不是 stop |

逐例重新读 record 并断言 v2 active/state/session/interrupt 与预期一致，再 `bundle(f, rec)`。证据完整且与权威记录匹配；不得篡改 registry 状态字符串、mock 生产校验或把 schema-invalid 输入当门禁测试。可增补有 session 的 start_unconfirmed，但不作为六状态最小矩阵的前提。

这里的 **stop stage** 只指状态机阶段，不是证明历史来源的密码学凭据；**测试阶段**则指下文 A/B/C 的执行顺序，两者不能混用。static evidence 只能检验程序契约，不检验真实排空。

## 4. 永久 apply 输入：测试本地 legacy plan builder

选择独立的测试本地 builder（名称由 engineer 定义，非生产符号），只实现本测试使用的 v2 close 序列化，不复制整个验证器。不依赖修复后 `planMaintenance(nonStopRequest)` 返回成功，不从 stop plan 改 state 后遗漏摘要，不利用 stale 错误替代门禁。

### 4.1 摘要算法

按现有私有 `canonical` / `digest` 的 JSON 值域实现测试本地等价函数：数组保持顺序递归并以逗号连接；普通对象的 key 用 `.sort()` 排序，每项为 `JSON.stringify(key) + ':' + canonical(value)`；原始值用 `JSON.stringify`。摘要为 `createHash('sha256').update(canonical(value)).digest('hex')`。只传实际 JSON 数据，不创建 undefined 字段。

- `paramsDigest`：canonical(request) 的 SHA-256。
- `registryDigest`：当前 `registry.json` **原始 Buffer 字节**的 SHA-256，不是解析后重序列化。
- 每个 evidence.digest：对应文件原始 Buffer 字节的 SHA-256。
- `planDigest`：完整 plan 对象 canonical SHA-256，不包括外层 envelope。

### 4.2 精确结构与顺序

从准备完 evidence 后的 registry 原始字节读取 v2 registry 和目标 active item；request 使用现有 `closeRequest`，包含 `v, operation, operationID, operatorRef, authorizationRef, project, taskID, disposition, evidence`（最小矩阵为 preserved，不新增字段）。

外层恰为 `{v:1, ok:true, plan, planDigest}`。plan 恰含：

```text
request
paramsDigest
generation = registry.generation
registryDigest
changes = [{
  taskID: item.record.taskID,
  ownerSessionID: item.record.ownerSessionID,
  lifecycle: 'active',
  from: { periodID: item.periodID, state: item.record.state },
  to: { periodID: item.periodID, state: item.record.state,
        closeout: { disposition: request.disposition } },
  evidenceRefs: [request.evidence, bundle.review.listingRef]
}]
expectedActive = registry.active 去掉目标后的 record.taskID，保持原顺序
evidence
warnings = ['结案只释放账本名额，不代表进程已停止、成果已保存或 worktree 可清理。']
```

`evidence` 每项恰为 `{ref, kind, digest}`，必须按 `verifyClose` 的顺序：bundle (`request.evidence`, `bundle`)、listing (`bundle.review.listingRef`, `listing`)、`bundle.drain.inFlightEvidenceRefs` (`drain`)、`bundle.externalWriters.evidenceRefs` (`external-writer`)、`bundle.quiescence.evidenceRefs` (`quiescence`)、`bundle.review.resolutions` 中每项 ref (`resolution`)。数组顺序保留，不去重、不排序；默认 bundle 无 resolutions。builder 只读这些文件，不自行修证据。

builder 创建与 apply 之间不再改变 registry、generation、证据或 operationID。每次拒绝必须实际调用公开 `applyMaintenance(legacyEnvelope)`；不得只检查 builder 或捕获提前发生的 plan 拒绝。

## 5. 按依赖排序的红绿门禁

### A. 先仅改测试：证明六份 legacy 输入真实可被旧 apply 接受

生产源码保持未修。为六状态逐例运行独立表征：

1. 合法 fixture、完整 bundle，使用本地 builder 生成 envelope。
2. 在这个阶段可调用旧 `planMaintenance(request)`，断言 builder 输出与其完整输出深度相等，包含 warnings、证据顺序和两层摘要。这是旧实现表征，不是永久拒绝测试的准备步骤。
3. 将 **builder 产物**交给旧 `applyMaintenance`，逐例断言 `ok:true`、`replayed:false`、active→closed、generation+1、原 record 原样保留、backup/archive 实际生成。六例都必须输出状态和断言结果。
4. 同时建立 stop_unconfirmed 的永久 builder parity 控制：在合法 stop fixture 上与 `closePlan` 深度相等；该控制修复后仍须运行，及时发现格式漂移。

建议采用**独立临时表征测试，成功后原地改为拒绝断言**的简单策略：不引入环境开关，不让最终套件保留“非 stop 应成功”的测试。Root 保存 A 阶段测试 diff、命令、stdout/stderr、退出码和生产未改证明，再进入 B。A 期间原有 round1 红灯仍存在，因此用独立测试名前缀定向运行，不把整个文件预期红灯误当 A 失败。

### B. 仍不修生产：切为永久拒绝矩阵并取得新红灯

- 移除 A 的旧 non-stop `planMaintenance` 成功依赖和成功断言，保留 builder 和六状态 fixture；对六种状态分别设置 plan 拒绝和 apply 拒绝（共至少 12 个独立具名案例）。
- 首轮 submitted apply 的 `closePlan(f, rec)` 准备替换为 builder；既有 submitted 测试可作为矩阵一行或独立保留，但不能遗留一个在 plan 准备阶段就被挡住的伪 apply 绿灯。
- 每例使用 `gateSnapshot` / `observeGate` 的等价持久副作用检查；捕获待测调用结果/异常后统一断言错误码和快照，不能在预期抛错失败时提前漏查写入。
- 在未修生产上定向运行：六个 plan 实际成功，六个 apply 实际成功且写入，拒绝断言红灯。报告应能逐状态对应 A 的接受证明和 B 的失败输出；任何 `INVALID_INPUT`、`REGISTRY_INVALID`、`MAINTENANCE_PLAN_STALE`、导入/fixture 错误都不是合格红灯。
- 缺少 A 的全六状态接受证明或 B 的行为红灯，停止验收，不能直接修代码后宣称已覆盖。

### C. 最小源码修复，再跑绿

只按 §2 修改 `verifyClose`；运行永久 12 例和控制组。全部拒绝为证据不足，且 snapshot 不变，再运行 maintenance 全文件与已知回归套件。最终文件不得保留旧行为开关、skip/todo 或依赖未修版源码的动态装载。

## 6. 无写入、兼容与历史控制

拒绝前快照必须在 evidence 和 builder 全部准备完毕之后，覆盖现有 `gateSnapshot` 内容：registry 原字节、active/closed、generation、backups/archives 的存在性/名字/文件字节、evidence 字节、目标 a.txt 字节、worktree 存在性，以及无 `.lock` / 提交临时文件残留。不是只检查 active 长度。

必须保留/补充以下控制：

- 现有 `prepared`：reserved → stop_requested → stop_unconfirmed、无 session、unknown/not_requested，完整证据 plan/apply 成功。
- 从 submitted 合法进入 stop_requested → stop_unconfirmed，带有 session、unknown/request_completed，完整证据成功。
- stop_requested 控制：reserved → stop_requested、无 interrupt，完整证据沿用既有成功行为。测试名/注释明确 **compatibility only, not policy approval**；不把它写成“已完成停止”。
- 其他已有 stop/interrupt 组合不新增收紧；完整异常交叉矩阵不属于本次方案。
- 现有 close 重放与 fresh replay plan 测试继续通过，且 result 相同、无持久写入；保留 stale、operation conflict、证据不足等现有覆盖。
- 补充历史非 stop closed 重放控制，避免只覆盖新允许的 stop 记录：使用**私有合成 v2 历史 fixture**，按已读 `RegistryV2` / `Closeout` 字段结构构造 closed submitted 记录，原 request 的 canonical paramsDigest、operationID 和结果时间保持自洽；由 `AtomicRegistry.withLock` 写入仅该私有 fixture，随后用 `Ledger.load` 验证可解码。该造历史只用于重放路径，不能用于六状态首次 close 或声称 stop 可达。可复用 A 的成功输出结构，但不得导入真实历史 ledger。
- 对该历史 fixture：同原 request 调 `planMaintenance` 应得 `changes:[]` 的 replay plan；apply 它返回 `replayed:true` 和原 closeout 结果。另以此前有效 legacy envelope 调 apply（generation/registryDigest 已过期），仍先命中凭据重放；移除私有 evidence 后两条重放仍成功。快照确认 registry/backups/archives 不变，原 submitted state 未被补成 stop。输入本身仍须通过 `validatePlan` 的摘要与结构校验。

## 7. 验证命令与成功标准

以下由 engineer 另获授权后执行；本文未运行测试或构建。建议 A 的拟新增测试名前缀为 `legacy close characterization`，B/C 为 `close stop gate`；这些是拟定名称，不是现有符号。

```sh
# 预先确保此项目内 TMPDIR 存在；每阶段保存完整输出和实际退出码
TMPDIR="$PWD/test/.work/tasks-maintenance/tmp" bun test test/tasks-maintenance.test.ts -t 'legacy close characterization'
TMPDIR="$PWD/test/.work/tasks-maintenance/tmp" bun test test/tasks-maintenance.test.ts -t 'close stop gate|round1 stop gate'
TMPDIR="$PWD/test/.work/tasks-maintenance/tmp" bun test test/tasks-maintenance.test.ts
git diff --check
git diff -- src/tasks-maintenance.ts test/tasks-maintenance.test.ts
```

最终全量回归命令为 `bun test`（package.json 的 test 脚本）；执行前评估资源，不默认直接跑重活。若预计超过 1 分钟、2G 内存或大量 `/data_0` IO，先读 `~/.config/agents/slot.md`，执行 `slot audit`、`slot status` 并写项目日志，再用 `slot cpu -- bun test`（或按实际负载选择 io/nf/gpu）；TMPDIR 仍指向项目内。禁止 `/tmp`，子进程同样遵守。日志位置须 Root 授权，不能写入冻结 evidence。

成功标准：A 六例旧 apply 接受证明齐全；B 六状态双入口真实红灯齐全；C 永久测试全绿且确实进入 apply；兼容/历史控制全绿；拒绝不改字节和容量；变更只有授权的源码与测试，首轮 evidence/spec/真实现场零修改。报告必须列出各阶段命令、退出码、关键失败/通过输出及私有 fixture 路径，不能以“预计失败”代替实测。

## 8. 风险与未决项

- builder 复制私有格式有漂移风险：A 全输出 parity + 永久 stop_unconfirmed parity 控制，禁止为消除漂移放宽生产 validator。
- state 门禁不证明 stop 历史来源，不证明进程停止、外部 writer 排空或维护窗口有效；真实历史仍是 `CLOSED_WITH_DEVIATIONS`，D1/D2/D3 不变。
- stop_requested、缺 interrupt、HOST_ERROR、session 与结果反常组合的完整异常政策仍未决定。本次按用户明确决定保持现状，不将兼容测试解释为认证；未来要改变这些行为须另立业务决策与 Assignment。
- 本次没有阻塞最小修复的业务未决项；遇到必须扩大异常政策或公共结构才能继续的情况，返回 blocked 并请 Root/用户决定，不自行扩大范围。
