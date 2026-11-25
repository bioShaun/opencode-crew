# issue #10 真机复核清单：session.fork / experimental.idle

用于在真实宿主（OpenCode 2.3.0 系）上复核 issue #10 记录的两项可选增强，产出实现/不实现的决策证据。本清单只做观测，不改 crew 本体；`session.fork` / `experimental.idle` 的类型与语义依据为 `@opencode/plugin` 2.3.0 SDK（`SessionHooks`、`SessionIdle`）与 issue 正文引用的 #63675。

前置：#11 已合并，提示/文档/依赖基线对齐 2.3.0（issue 评论确认）。配套探针：`probes/issue-10/index.ts`。

## 0. 探针说明

- 只订阅三个 hook：`fork`、`experimental.idle`、`retry`，把事件原样追加到**项目根目录** `issue-10-probe.ndjson`，每行一条 JSON：`{ at, hook, ... }`。
- 不改任何 decision（retry 的 decision 归 crew 自己的 hook，src/tasks.ts），不读写 ledger，不创建会话。
- 运行期零依赖（对 SDK 只有 type import）；hook 注册失败会记 `{ hook, kind: "register", error }` 而不是让插件加载失败——旧宿主不认识某个 hook 名时，这本身就是复核结果。
- `fork` 事件除 `{ sessionID }` 外还附该会话摘要和当前会话列表（含 `metadata.crewTask`、`parentID`），用于回答「给的是原会话还是副本、副本带不带台账元数据」。

## 1. 准备

1. 建**独立测试仓库**（`git init` + 一次初始提交；crew worktree 任务需要 git 仓库），不要用真实项目。
2. 安装 crew 并按 README 配置对象形 options。建议两角色配不同模型，顺带完成 PR #12 的人工验收（模型列第 12–18 列、整行 37 列右边界齐、长 id 截断、`modelDisplay: "off"` 恢复旧布局），一次真机两用。
3. 挂探针：把 `<本仓库绝对路径>/probes/issue-10` 加进**测试项目** `opencode.json` 的 `plugins` 数组。探针目录无 package.json，宿主按约定解析根目录 `index`。`opencode plugin add` 会修改全局配置，隔离复核默认不用；若改用该命令，清理时必须执行对应的 `plugin remove`。
4. 启动 opencode，确认 `issue-10-probe.ndjson` 出现 `hook: "load"` 记录，且**没有** `kind: "register"` 错误行。
5. 记录 `opencode --version`。

读日志：`jq -c 'select(.hook=="fork")' issue-10-probe.ndjson`（同理换 hook 名）。

## 2. R0 · 门禁：权限三条断言

按 `docs/role-permissions-host-checks.md` 完整执行，此处只列摘要：

| 断言 | 内容 | 执行方式 |
|---|---|---|
| A1 | architect / explorer / reviewer 能读不能执行、不能再派 subagent | headless `opencode run` |
| A2 | architect 只能写 plans/（相对与绝对路径），越界拒绝 | headless `opencode run` |
| A3 | 读角色不覆盖用户全局 `external_directory` 策略 | deny/允许行可 headless；**ask 行必须在 TUI 主会话** |

三条全过才进入 R1/R2。任何一条失败即停止本清单，回 `docs/role-permissions-review.md` 重新评审；归因需区分 crew 规则/契约、宿主行为、构造或环境问题，不要靠加规则修绿。

2026-11-17 初轮 R0 reject；后续源码修复的隔离构建已完成 G0 28 条和 G1–G4 120 条真实 `permission.assert`，均符合预期，后者每行 initial/reload 重复。pending ask 的事件、list/get、reject 和清空已验证，但不是 TUI；assert 也不证明真实工具调用。六格外部 read 端到端通过（G0 无全局 external 规则但有其他动作 deny；G1 全局 external deny），证据为 `/project/tmp/opencode-crew-read-policy-s3/tool-smoke/sol-attempt/summary.md`。全局 external ask 与敏感 read ask 的 TUI 客户端确认未验，write/shell 等 A1/A2 实际工具覆盖不足。v2.3.0 受控 setup 失败测试中 hook 与 transform 注册后抛错，注册未在后续装配/reload 生效；失败 transform 首次 registry 前未执行，不证明已执行副作用回滚或所有 setup 失败安全，见 `/project/tmp/opencode-crew-read-policy-s3/setup-cleanup/summary.md`。**R0 仍 blocked，不能解锁 R1/R2；二者未执行，issue #10 未实现。** 该轮源码与隔离构建验证本身不代表部署或共享服务重启；后续发布状态不由本文断言，发布流程见 `docs/run-copy-release.md`。证据与补测步骤见[权限宿主清单](role-permissions-host-checks.md)及[权限复审](role-permissions-review.md)。

## 3. R1 · session.fork（台账混淆边角）

### 步骤

1. 测试项目 Root 会话里 `crew_task_start` 派一条 engineer 任务，等会话创建，记录绑定的 `sessionID`（`crew_task_status` 或 ledger 可见）。
2. fork 这条会话，记录返回的新 sessionID：
   - 优先用 TUI 的会话 fork 入口；
   - 若当前宿主 UI 没有入口，用 `opencode serve` 起服务后：
     ```sh
     curl -X POST "http://127.0.0.1:<port>/api/session/<sessionID>/fork" \
       -H 'content-type: application/json' -d '{}'
     ```
     响应即副本的 SessionInfo。执行 fork 的实例必须也挂了探针（配置级挂载即满足）。
3. 读探针 `fork` 记录，回答：
   - 官方插件文档定义 `event.sessionID` 为**新副本 ID**；实测核对其是否等于 fork 响应的副本 ID，而不是原会话 ID。
   - 副本摘要里 `crewTask` 是否携带原任务的 `metadata.crewTask`？`parentID` 指向谁？
   - `kind: "sessions"` 列表是否同时包含原会话与副本，其 `parentID` 链是否连到原 Root？该列表只作辅助证据；侧栏实际使用 `session.family(rootID)`，是否进入 Delegations 以第 6 步真机观察为准。
4. 在 TUI 里查看副本会话，记录宿主注入的 fork 说明原文。
5. retry 观察（尽力项）：若副本上自然触发可重试错误，读探针 `retry` 记录，确认 crew 的 retry hook 不认领副本——`matches()`（src/tasks.ts）要求 `s.id === t.sessionID`，副本 id 不同即不认领。无法触发时，静态记录「副本 id ≠ ledger sessionID」并注明未实测 retry。
6. 侧栏观察：副本运行中时是否出现在 Delegations（预期外出现即混淆证据）。

### 判定

| 观察 | 结论 |
|---|---|
| 副本不带 `crewTask` 元数据、不进 Root 会话族 | 台账无涉 → **不实现** fork 处理，记录结论 |
| 副本带元数据，但不被 matches/observe 认领、不进侧栏 | 低风险 → 仍可不实现，记录证据 |
| 副本被 observe/retry 认领，或出现在 Delegations | 混淆成立 → 立项：fork 时打日志或去混淆 |

## 4. R2 · experimental.idle（turn 空闲但后台还在跑）

### 步骤

1. 构造目标状态：让一个会话（原生会话或 crew engineer delegation 均可，engineer 默认允许 shell）用 shell 工具以**后台模式**跑 `sleep 90`，然后让 turn 正常结束、无待处理输入。不要中断——idle hook 不在中断、失败、纯控制操作（如手动 compaction）后触发。
2. 读探针 `experimental.idle` 记录：
   - 是否触发？`background` 是否含 `kind: "shell"`，`sessionID` / `shellID` / `command` 是否正确？
   - 附带会话摘要的 `time.busy` / `time.idle` / `outcome` 是什么？
3. 对照 #63675 语义：模型可见的 `<subagent state="running">` 汇报 vs job / TUI 卡片元数据 `completed`。在父会话消息文本与 TUI 卡片两侧各记一份证据。
4. **同时看 crew 侧栏**：该 delegation 是否从 Delegations 消失（`sessionRunning` 按 busy/idle 水位判定，src/tui/view-model.ts）。预期消失——这正是「后台还在跑但侧栏看不见」的缺口，截图或抄录文本。
5. 等 `sleep` 结束：idle hook 应再次触发且 `background` 为空（宿主 wake 语义）。
6. 可选 descendant 场景：让子代理留下后台 shell、父会话先 idle；`background` 应列出子会话拥有的 job（仅信息性，wake 的是子会话）。

无记录时先排除场景构造问题（turn 未真正结束、被中断、后台 shell 未以后台模式启动），再下「hook 未触发」的结论。

### 判定

| 观察 | 结论 |
|---|---|
| 场景正确但 hook 不触发（或 register 报错） | 宿主未开放 → **不实现**，记录宿主版本与现象 |
| 触发，但 crew 工作流里该状态罕见、不造成误判 | **不实现**，记录证据（重活走调度器、turn 不提前结束） |
| 触发，且侧栏确实丢失「后台仍在跑」、影响验收判断 | 值得做 → 立项接 `experimental.idle`，侧栏加后台运行标注 |

## 5. 记录与回贴

每条断言按下表记录，结果贴回 issue #10 评论，由决策者按 R1/R2 判定表决定是否立项：

| 断言 | 宿主版本 | 实际输出 / 日志摘录 | 判定（通过/失败/未实测） |
|---|---|---|---|
| R0-A1 / A2 / A3 | | | |
| R1-1 … R1-6 | | | |
| R2-1 … R2-6 | | | |

## 6. 清理

移除探针的 plugin 配置条目，删除 `issue-10-probe.ndjson`。探针不写 ledger、不改 decision，无其他残留；测试仓库可整体保留或删除。
