# S0 宿主探针

隔离根：`/project/tmp/opencode-crew-probe-20261124-terra`；宿主 `opencode v2.4.1`；隔离构建 `index.js` SHA-256 `4feb46b0419737ad80f74d57bc465eacc7520cefbfaaa9515a1695392f9121da`；最终模型 `tcuni/gpt-6-luna`。候选 `tcuni/gpt-6.1-sol` 返回 `provider.no-route`，故切换。所有 run 使用 `--standalone`、隔离 HOME、四个 XDG 和 TMPDIR；构建引用的 agents 是隔离副本。宿主要求插件配置为目录而不是文件，因此使用隔离 `build/` 目录。探针源码本身按任务配置从仓库目录只读加载。原始记录见同目录 NDJSON 和 JSONL，路径及构建 hash 也保留在隔离根。`slot audit` 显示一个既有绕过 slot 的进程；本次单场景低并发，不干预它。模型请求计数见 R0 报告。

| 断言 | 宿主版本 | 实际输出 / 日志摘录 | 判定 |
|---|---|---|---|
| S0-1 Root 空闲识别 | v2.4.1 | `ses_df4a173e9ffeadz6gxEnz7PD44`：idle `background:[]`，`session.agent:"root"`，JSON 中无 `parentID` | 通过 |
| S0-2 子会话查询 | v2.4.1 | 父 `ses_df4a08db7ffeGk1lKFF2v56ef8` 的 `children` 包含 `id:ses_df4a07dc3ffe8JCh84jedNS0Bd`、`agent:reviewer`、`parentID` 为父、`time.created:1795487138366`；末次 `outcome:succeeded` | 通过 |
| S0-3 queue / steer | v2.4.1 | queue `ses_df4a12320ffeFRKhfy2eUD9CUC`、steer `ses_df4a0e4ebffemEq1u5yb9kUjGZ` 各一次注入，同一 `opencode run` 各输出 `FIRST_*` 和 `PROBE_FOLLOWUP`，各有第二次 idle；每 session 只注入一次 | 通过 |
| S0-4 等待 2 秒 | v2.4.1 | `ses_df4a0bc6affeOzsYPGPPY4KO1d` enter `02:25:25.402Z`，exit `02:25:27.404Z`，run 退出 0；观察到 2.002 秒延迟且无超时 | 通过 |
| S0-5 后台工作 | v2.4.1 | reviewer 运行时父 idle 的 `background` 含 `kind:subagent`、父 `ses_df4a08db7ffeGk1lKFF2v56ef8`、子 `ses_df4a07dc3ffe8JCh84jedNS0Bd`；另一次 `sleep 90` 后台 shell 的 idle 显示 `kind:shell`、`sessionID:ses_df49d1a5effePV1XF2uogHm8MJ`、`shellID:sh_20b62f75c001lkh03ZSlspL2Oi`、`command:sleep 90` | 通过（捕获运行中背景；shell 场景 run 因 50 秒限时退出 124，未验证自然完成后的唤醒） |
| S0-6 中断 | v2.4.1 | `timeout -s INT` 尝试退出 125，记录了请求 context 但没有取得可靠的宿主中断结果或会话完成事件，不能以无 idle 证明语义 | 未实测：中断状态未确认 |
| S0-7 最后 assistant 文本 | v2.4.1 | idle 内 `session.context` 返回 assistant `content:[{"type":"text","text":"PROBE_HELLO"}]`；请求期 context hook 独立记录 | 通过 |
| S0-8 默认权限自定义只读工具 ask | v2.4.1 | 未注册或调用该工具，亦未观察 `permission.asked` | 未实测（需 TUI 或专门的 headless ask 事件探针；不能推断） |

**S0 第 1、2、3 条全部通过**；是否采用完整门禁仍由 Root 决策。中断与只读工具 ask 尚未确认。

验证：在测试项目运行 `jq -c 'select(.hook=="experimental.idle")' review-gate-probe.ndjson`（退出 0）；宿主版本和 hash 如上。各成功场景的 `run-probe.sh` 退出码为 0。中断尝试的 stdout/stderr 和退出码位于隔离根 `logs/s0-interrupt.*`。
