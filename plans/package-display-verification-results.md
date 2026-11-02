# 包级展示验证结果：partial / blocked

日期：2026-11-02。**包级完整验收状态：partial / blocked，缺少最小权限下的展示验证。**display-r5 收窄权限后，ping 请求中没有可定位的 Code Mode catalog；尚不能验证新权限下的 catalog/search。display-r4 的展示层曾通过，但 Root 为通配 allow，未满足最小权限；不能将 r4 的展示结果与 r5 的权限结果拼接成完整验收通过。

## 最新权限复测：display-r5（未通过）

根据 reviewer 对 r4 的阻塞意见，本轮仅在 fixture witness 中在产品 Root agent 定义回调之后追加 `{action:"*",resource:"*",effect:"deny"}` 和 `{action:"execute",resource:"*",effect:"allow"}`。实际 `/api/agent` 返回的 Root 规则末尾确为上述两条；创建的 Root session 无权限覆盖。依宿主 last-match 规则，execute 允许，shell、edit、read、subagent 和三个 Crew task 动作为 deny；原 Crew 执行前拒绝守卫仍在。完整实际规则和 session 记录分别见 `effective-permissions.json`、`loaded-agents.json`、`created-session.json`。

实际私有 host `2.2.5`、PID `3179581`，重新打包 20 文件，包 SHA256 `41e200e0424d7426d04227f5a941726e465b3fe435b36e015d41e42069778dfa`，入口 SHA256 `4cecb420065ff8deb4c697d4e30102de0f0d8d2e61086679802a2894f568610c`。ping 请求提供了 `execute` 工具，但 system/developer 中的 `## Code Mode tools (call only inside `execute`)` 边界出现 **0 次**；因此 runner 按契约返回 `RuntimeError: catalog boundary not found uniquely`，未继续发送固定 search，三条 catalog 及 search 均未验证。witness 实际捕获三工具注册，不能用它代替 catalog。现象与 deny 规则影响工具发现一致，但本次不能断言具体内部过滤机制或存在可用的纯 metadata 权限；未添加任何额外 allow。

无 forbidden-attempt；本轮无 task/engineer 调用，退出路径的主 dist 和受保护文件前后哈希一致，全部启动的进程组已回收。`slot audit` / `slot status` 均退出 0，audit 未发现绕过 slot 的重进程；日志 `test/.work/package-display/preflight-display-r5.log`。仓库根目录 `slot cpu -- python3 test/.work/package-display/runner.py display-r5` 退出 1，原始证据在 `test/.work/package-display/display-r5/`。这不是已证实的 fixture 解析错误，未使用仅供 fixture 问题的 r6。

## 历史：display-r4（展示通过、权限不足）

### 展示实测

Root 对原方案的 start 长句匹配作语义等价压缩修订：检查同一 Root 同 key、同输入返回原记录（含已结案）、不重投、重试换新 key、最多 2 个未结案预留、idle/出错/stop 不释放、仅离线结案释放；status/stop 判据不变。旧方案文件未修改。新 fixture 在 ping 的实际 catalog 边界中逐条检查，并额外要求 start 展示首行与注册首行逐字相等。

- 工作区 dirty 源码重新打包，20 个发布文件逐项核对；`src/tasks.ts` SHA256 `0f1fd0e9c2c98304d0f387a1f8f1c4444fa51ab6ffef649cdde00ad5ff52d1ff`，输入 manifest 文件 SHA256 `313c7acbc756857284fbcdcf534e6ccb86a93daf56e1544eac307deba8642928`，包 SHA256 `41e200e0424d7426d04227f5a941726e465b3fe435b36e015d41e42069778dfa`，解包入口 SHA256 `4cecb420065ff8deb4c697d4e30102de0f0d8d2e61086679802a2894f568610c`。
- 私有 host 为 `opencode v2.2.5`，本次启动 PID 和 `/api/info` PID 均为 `3170348`；唯一 active 外部插件来自私有 witness。三项注册完整 description 与独立从当前源码提取的预期相等。
- catalog 三项检查通过；start 实际首行 116 字符，与注册首行逐字相等、无截断，全部目标短语存在。search 的固定 execute 返回按 `call_fixture_search` 关联，三项完整多行 description 与源码和注册值逐字相等。
- 三次 provider 请求均为 fixture model；唯一工具决策为固定 search 的 execute，无 provider violation、无 forbidden-attempt、无额外 session 或 fixture ledger。witness 将三项 Crew execute 替换为执行前拒绝的 stub；没有运行 task 或创建 engineer。Root 权限是宽泛 allow，并非最小权限，也没有 OS sandbox；固定 provider 决策和 stub 不能替代权限隔离。私有 allowlist 环境不继承真实凭据，结论仅限此 host/fixture 组合，不证明真实模型表现或 task 业务行为。
- 主 dist 和受保护文件前后哈希相等，主 dist SHA256 `e9a6f385c2c00bc5fe339c0d03f423fcfefc17e600b0e917eea948937847d206`；所有本轮进程组已回收，清理通过。

仓库根目录执行：`slot audit` 和 `slot status` 均退出 0，audit 未发现绕过 slot 的重进程；日志 `test/.work/package-display/preflight-display-r4.log`。随后 `slot cpu -- python3 test/.work/package-display/runner.py display-r4` 退出 0；完整生命周期含 600 秒工作预算和独立 30 秒清理预算。这是 r4 当次运行结果，后续 r5 如上所述。

**脱敏证据索引**：本报告及 `plans/evidence/tool-summary-compact/` 为可供 Root 审核的资料；后者的红绿与全量测试由另一次产品修复工作产生，本轮未重跑。原始私有证据保留在 ignored `test/.work/package-display/display-r4/`，包括 `source-manifest.json`、`package-manifest.json`、`events.jsonl`、`api-info.json`、`registered.json`、`catalog-entries.json`、`search-result.json`、`provider.jsonl`、`witness.jsonl`、`integrity-before.json`、`integrity-after.json`、`cleanup.json` 和 `results.json`；原始日志可能含私有路径，不作为直接提交材料。

## 历史记录：r1 / r2

## 背景与运行边界

首轮预检曾因工作区祖先用户目录存在 `.opencode/`、无法确认宿主配置发现边界而阻塞；随后 Root 授权在 `/project/tmp` 的唯一私有树中运行。两次运行前复核 `/`、`/project`、`/project/tmp` 均无 `AGENTS.md`、`opencode.json`、`opencode.jsonc` 或 `.opencode`，并使用私有 HOME、XDG、配置、DB、缓存和临时目录。实际加载项检查尚未全部完成，不宣称已完整验证隔离。

fixture 的 witness 对三个 Crew task 工具设置执行前拒绝，仅用于展示验证；未调用 task 工具，未启动 engineer 或任务周转。假 provider 不代表真实模型理解或误用率，结果仅适用于实际的宿主与 fixture 组合。

## 两次实测

| 层次 | 结果与证据 |
|---|---|
| 包来源 | 两次 `npm pack` 均完成；工作区源文件复制到私有 build，包内 20 个发布文件路径及哈希与副本、源码一致。使用本地已核对版本的 `yaml` 2.9.1、`@opencode/plugin` 2.2.3；不安装或修改主依赖。两次 tar SHA256：`7fc0db3339bcc48312501fa0e5b7c0c84c411c5139162b0f3c897f32e932b46d`；解包入口 SHA256：`9ef11b3dca108304a6b854a6c389095f1b264bd3c240e76e46d7d1c2e91a18e3`。两次打包原始日志及 manifest 均保留。主 dist 的运行前后哈希未在这两次失败路径保存，故该保护项未完成验证。 |
| 宿主 | 实际二进制为 `~/.opencode/bin/opencode`，命令版本及两次私有 `/api/info` 均为 `2.2.5`，API PID 均与各次新启动的 host 匹配。只向本次本机端口发请求。 |
| 注册 | 第一次在插件加载完成前停止。第二次 API 列出 witness 所加载的 `opencode-crew` 为 active，witness 的解包入口哈希与上述包入口相同；每个工具各捕获两条注册事件，全部与独立从 `src/tasks.ts` 提取的完整文本相等。以字符计 start/status/stop 长度分别为 587/206/196；逐项完整文本及 SHA256 见 `registration-analysis.json`。这是注册层局部结果，不代替 catalog 或 search。 |
| 默认 catalog | **未验证。**两次均在创建 session 和发送 ping 之前退出，没有从真实 ping 请求解析 catalog 边界及条目。 |
| 完整 search | **未验证。**没有发送固定 execute 调用，未取得关联 call ID 的实际 search 结果。 |
| 安全及清理 | 第二次 witness 未记录 forbidden-attempt；没有进入 session 创建或 task 执行步骤；第二次私有树中查找 `opencode-crew-stage1` 无匹配。两次 runner 的 `cleanup.json` 中自身启动的全部进程组均 `group_exists: false`。第二次事后核对指定源码及受保护文件哈希与运行前 manifest 一致；这不替代完整 session/ledger/主 dist 验收。 |

## 中止原因与 fixture 修正

- **display-r1**：runner 读取插件列表后立即判断 active，未等待异步加载，返回 `crew plugin not active`；退出码 1。已将该检查改为在有界时间内轮询，并保存插件列表。
- **display-r2**：插件已 active；runner 将宿主 API 列出的内置插件也判为额外外部插件，返回 `unexpected active plugin`；退出码 1。API 中这些条目的 `source.type` 为 `builtin`，而唯一 active 的非内置插件为来自私有 witness 的 `opencode-crew`。已将 fixture 检查修正为允许宿主内置项，并严格核对唯一 active 非内置插件的 ID 与私有路径。**此修正仅做语法检查，未重新运行 host**；其他 API、权限、catalog 截断及 search 格式仍可能产生问题。

此前 fixture 的受保护文件检查已改为明确的小型文件清单，不递归读取旧 host 缓存；build 中的两个版本核对依赖使用链接，解包产物仅在发布文件集与哈希验证之后才添加运行时依赖链接。没有改变产品、旧证据或 `.gitignore`。

## 命令与证据

cwd 均为仓库根目录。两轮分别将 `TMPDIR`、`TMP`、`TEMP` 指向 `test/.work/package-display/preflight-tmp` 的绝对路径；逐轮执行 `slot audit`、`slot status` 并写入对应日志，四次命令均退出 0，audit 均未发现绕过 slot 的重进程。随后分别执行：

```sh
slot cpu -- python3 test/.work/package-display/runner.py display-r1  # exit 1
slot cpu -- python3 test/.work/package-display/runner.py display-r2  # exit 1
```

所有构建、provider、host 和 finally 清理都包含在对应单次 slot 生命周期内。runner 的 600 秒工作预算与额外 30 秒清理预算均未触发。末次 runner/provider Python AST 检查、`node --check` witness 和 `git diff --check` 均退出 0；静态检查不是 host 通过证据。受保护规范 SHA256 仍为 `63955f4bedd6ace450ddf4d2ab54c7c28129c1eab1937efc2e82c7b88d8a56a9`。

原始 ignored 证据相对路径：

- `test/.work/package-display/preflight-display-r1.log`、`preflight-display-r2.log`
- `test/.work/package-display/display-r1/`：`results.json`、`events.jsonl`、`api-info.json`、`pack.stdout`、`pack.stderr`、manifests、`cleanup.json`
- `test/.work/package-display/display-r2/`：上述对应证据，另有 `loaded-plugins.json`、`witness.jsonl`、`registration-analysis.json`、`postrun-audit.json`

当时的下一步需要新的实际运行授权；后续 r3–r5 结果见本报告，不可用注册结果或旧证据冒充最小权限下的 catalog/search 成功。原始日志、缓存和私有运行树不属于本简报。
# 历史补充实测：display-r3（未通过）

2026-11-02 在仓库根目录执行第三轮；`slot audit`、`slot status` 均退出 0，audit 未发现绕过 slot 的重进程，日志 `test/.work/package-display/preflight-display-r3.log`。随后 `slot cpu -- python3 test/.work/package-display/runner.py display-r3` 退出 1；完整证据在 `test/.work/package-display/display-r3/`。

- 包来源通过：20 个文件，工作区输入和解包内容逐项核对；host 实测 `opencode v2.2.5`，API PID 与启动进程一致，唯一 active 外部插件来自私有 witness。注册三项完整 description 与源码一致。
- **默认 catalog 不通过**：ping 对应请求中的 catalog 条目 `crew_task_start` 在 `最多保留 2...` 截断，缺失最多 2 个未结案预留、idle/出错/stop 不释放、离线结案释放三项；status、stop 条目满足本次首行断言。原始边界及逐条结果分别见 `catalog.txt`、`catalog-entries.json`。这是实际展示结果，不以 search 补足，不改变产品文案或验收标准。
- **search 通过**：固定 execute → search 的实际 tool result 与 `call_fixture_search` 关联；`search-result.json` 的 `items` 中三项完整多行 description 与注册值及源码期待一致。仅允许固定调用，witness 为三项 Crew execute 设置执行前拒绝守卫；未执行 Crew 任务。私有环境使用 allowlist 和 fixture provider，未继承真实凭据；模型列表包含内建可用模型不等于配置或实际调用真实 provider。
- 零任务副作用和清理检查通过：一个 Root session，无 forbidden-attempt、fixture ledger；所有本轮进程组不存在。`integrity-before.json` / `integrity-after.json` 包含主 dist 与受保护文件前后哈希并一致；主 dist SHA256 `e9a6f385c2c00bc5fe339c0d03f423fcfefc17e600b0e917eea948937847d206`。r2 没有运行前 dist 记录，不能追补。

fixture 调整：失败路径 finally 也写受保护文件和 dist 的事后摘要；模型目录只要求 fixture 模型存在，不把宿主列出的内建可用模型误判成已配置外部 provider。实际 provider 请求及隔离环境另行审计。以上只验证该 host/fixture 组合的展示与 search，不验证 task 业务行为或真实模型表现。由于 catalog 实际截断，全部层次未同时通过；修复产品超出本次授权，需交回 Root 决定后续。

## 收尾选择

只读咨询建议停止实验；目前不进一步放宽权限、不运行白名单实验，等待用户决定是否接受上述有界收尾。若用户希望继续，白名单加 mock 已验证 stub 可作为可选探索方向，须另行授权并重新明确安全边界与验收；不预设其可行或要求用户再造异常。
