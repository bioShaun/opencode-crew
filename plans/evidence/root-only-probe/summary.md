# R0 宿主权限探针

隔离根：`/project/tmp/opencode-crew-probe-20261124-terra`；宿主 `opencode v2.4.1`；隔离构建 SHA-256 `4feb46b0419737ad80f74d57bc465eacc7520cefbfaaa9515a1695392f9121da`；最终模型 `tcuni/gpt-6-luna`，`tcuni/gpt-6.1-sol` 不可用。独立 HOME/XDG/TMPDIR、`--standalone`，只读加载仓库探针；插件配置改为隔离 build 目录以满足宿主插件目录要求。原始事件及相应 CLI 输出均在本目录，另见隔离根 `logs/`。

| 断言 | 宿主版本 | 实际输出 / 日志摘录 | 判定 |
|---|---|---|---|
| R0-1 build 原生派 engineer 和 reviewer | v2.4.1 | `ses_df4a023e5ffeBwjgmMGvHt0qib`：`agent:build, action:subagent, resources:["engineer"], source:{type:tool,messageID:msg_20b5fde1f001eMqZVits0SF5c9,id:call_33091bc4a05b41c0ab585e8973d98219}, effect:deny`；reviewer 同为 `action:subagent, resources:["reviewer"], effect:allow` | 通过 |
| R0-2 build 调 status 的宿主层求值 | v2.4.1 | 外层 execute 确实调用 `tools.crew_task_status({})`，返回 `FORBIDDEN_CALLER`；该 session 的 evaluate 日志无 `crew_task_status` 事件 | 通过（本次调用未观察到宿主层事件；不能证明所有路径均无） |
| R0-3 Root 的 start/stop 内部 assert | v2.4.1 | `ses_df49f9cccffej0ik0GpwLDMXTu` 内同一外层 execute `call_adc2b106ec1149a9b5d3f5ff0ad677d0` 产生两条 `agent:root, action:subagent, resources:["engineer"], source:{type:tool,messageID:msg_20b608e8e001bBCqOtVRy0aw1i,id:call_adc2b106ec1149a9b5d3f5ff0ad677d0}, effect:allow`；同次并发也有 `crew_task_start` 与 `crew_task_stop` 各一 | 通过（只捕获事件；不存在的目标使 start 返回 `INVALID_INPUT`、stop 返回 `TASK_NOT_FOUND`，任务本身未成功；两条 assert 同时发生，不能单凭顺序区分） |
| R0-4 deny 前后工具可见性 | v2.4.1 | baseline context 中 build 可见 `execute`；未对 build 注入 deny 规则做对照 | 未实测（可选项） |
| R0-5 deny message 返回模型 | v2.4.1 | evaluate 的 `Crew：engineer 只能由 Root 派发（调用者：build）。请用 /crew 切到 Root，或改派 explorer / architect / reviewer。` 与 `r0-native.jsonl` 中 subagent 工具 error 及模型最终答复一致 | 通过 |

原生事件的 action/resource 确为 `subagent` / 裸名 `engineer`，本次观测不要求改 §11.4.1 匹配条件。Root 经 Code Mode 的内部 assert 调用者为 `root`，但本次未证明任务成功或完整端到端验收。

预算：探针 context hook 共记录 25 次模型请求构造（含中断尝试；可核对 NDJSON），低于 40；候选 sol 有一次无路由尝试，未实际生成。每场景不超过三次尝试。此数字是宿主 context hook 口径，不包含可能发生的未经过该 hook 的辅助请求。

验证：测试项目中 `jq -c 'select(.hook=="evaluate")' root-only-probe.ndjson` 和同样的 `context` 筛选退出 0；上述三个 R0 run 均退出 0；构建 hash 和 build log 同目录。检查项不包括完整 R4、TUI 或持久部署。
