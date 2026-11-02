# 包级展示验证与收尾材料边界

状态：ready / **context-only**。日期：2026-11-02。上游基线 HEAD `27d12c3`，本文未执行 Git、构建或宿主验证；实际版本、状态与结果由下一份 Assignment 核实。

## 1. Goal / Scope

验证当前工作区（包含本轮已验收 dirty 修改）打出的 npm 包，在一个指定私有 OpenCode host + `fixture/fixture-model` 组合中，能够加载、注册三个 Crew 工具、在默认 catalog 显示目标摘要，并通过真实 `execute` → `search` 返回完整 description。整理可提交单元建议，不执行提交。

本 Assignment **只新建本文**。Root 须另开 engineer Assignment，明确授权下述 fixture、证据及脱敏报告路径；本文不扩大 Mandate/Scope。

- 保留已验收四个 tracked 修改及 `plans/closeout*`、`plans/evidence/tool-summary/`、已有 closeout 证据；不覆盖既有首行摘要红绿证据。
- 用户原未跟踪 `plans/worktree-stage1-closeout-spec.md` 禁止修改，禁止纳入提交建议。
- 不授权 `git add/commit/push`、真实 ledger、真实业务会话、真实服务配置或 DB 操作、maintenance plan/apply、worktree 清理。
- 新 runner 放 `test/.work/package-display/`（已有 `.gitignore` 的 `test/.work/` 覆盖）。仅创建 fixture Root session；不创建 engineer 或其他角色会话，不运行 `crew_task_start/stop/status`，包括经 Code Mode 间接调用。

## 2. 已核实依据与复用边界

- `package.json`：`exports["."]` 为 `./dist/index.js`；`prepack` 执行 `bun run build`，build 由 `src/index.ts` 生成 dist；发布文件包括 dist、src、agents、两个 README、THIRD_PARTY_NOTICES。依赖 `@opencode/plugin` 为 `2.2.3`，**不是实际宿主版本证据**。
- `src/tasks.ts`：`descriptions.start/status/stop` 经 `ctx.tool.transform` / `editor.add` 注册完整 description。三个注册名为 `crew_task_start`、`crew_task_status`、`crew_task_stop`。
- `test/tasks-interface.test.ts` 与 `plans/evidence/tool-summary/report.md`：已有 `description first line` 红绿及全套验证摘要；只证明此前注册文本与测试，不代替本轮包加载/catalog/search 实测。
- 只读参考 `plans/evidence/crew-followup/host-verify/runner.py` 中 `sha`、`records`、`system_of`、`classify`、`req`、`create_session`、`prompt`、`wait_idle` 及私有进程清理模式；`fixture_provider.py` 的 `decide` / `H.do_POST`；`witness/entry.mjs` 的 `emit` / `instrumentTransforms` 和 `tool_register` 事件。
- **不修改、不执行旧 runner**：它 clone HEAD、固定断言旧版本、创建 engineer/explorer 会话并执行 task 周转，均不符合本轮边界。旧 provider 的任意 `!call` 能力必须在新副本收窄；旧 witness 只记录注册，并不能单独证明没有工具执行。
- V2 插件文档 `https://opencode.ai/v2/docs/build/plugins` 要求验证安装包而非仅 workspace-linked 源码；本轮以解包产物入口加载，不新增产品接口。

## 3. 顺序实施与交互契约

### 3.1 预检与冻结输入

1. Engineer 先读适用 AGENTS 与 `~/.config/agents/slot.md`。只读记录 `git rev-parse HEAD`、`git status --short --untracked-files=all`、`git diff --stat`，核对上游四项已验收文件，偏差先报告，不 restore/reset/clean。
2. 对工作区全部递归 src、agents、package.json、两个 README、THIRD_PARTY_NOTICES 及实际存在的锁文件生成路径→SHA256 清单；记录 dirty diff 摘要与主 `dist/index.js` 摘要。禁止仅 clone HEAD 作为打包输入。
3. 新建唯一 attempt 目录，禁止复用覆盖；全部 tmp/cache/日志/包/DB 放在其中。将当前上述文件复制至独立 build 目录，复制前后及结束时核对哈希；拒绝 symlink 逃逸。依赖只复用已存在且核对版本的本地依赖或私有安装，不改主依赖目录，不隐式升级。
4. 在副本运行 `npm pack --pack-destination <attempt>/pack --json`，让 prepack 仅写副本 dist。安全解包到 `<attempt>/unpacked/package`；核对文件名集合、package 元数据、所有源文件与 agents/readmes 的字节哈希，以及副本 dist 与包内 dist 一致。记录 tgz SHA256。包哈希不能只与 HEAD 对照；主 dist 必须前后不变。

### 3.2 私有 host 与观测

1. 新建最小 runner/provider/witness 副本，不复制旧 runner 的 task/多角色/hot-reload分支。新 provider 仅允许固定一次 `execute` 调用，参数严格等于 `{"code":"return await search({query:'crew_task'})"}`；其余正常回合只回复固定短文本，任何其他工具调用请求立即失败。
2. 以 allowlist 构造环境，移除继承的服务连接、provider token、配置注入与代理变量；设置私有 HOME、全部 XDG（含 CONFIG/DATA/CACHE/STATE）、OPENCODE_CONFIG_DIR、OPENCODE_DB、TMPDIR/TMP/TEMP 和 npm cache。不得写 `/tmp`。核实 fixture cwd 的祖先配置发现不会加载真实项目/用户配置；如不能隔离，阻塞，不能仅因设置 XDG 就宣称隔离成功。
3. 私有配置只加载新 witness，由 `CREW_WITNESS_PACKAGE_ENTRY` 指向**解包后的** `dist/index.js`；`CREW_WITNESS_LOG` 指向该 attempt。只配置 fixture provider、Root 模型及所需插件，不接真实 provider。host/provider 都绑定 `127.0.0.1` 随机空闲端口。
4. 实测 `opencode --version`，启动私有 `opencode serve --hostname 127.0.0.1 --port <port>`，从该端口 `/api/info` 验证版本、PID 与本次进程一致。不沿用旧 runner 的 `2.2.5` 断言；记录二进制位置和实际版本，仅对这个组合给结论。若 API 不兼容，停止并报告，不切换到已有服务。
5. 随机认证 token 只在内存/私有运行环境传递，绝不写提交材料、命令行或日志。只通过本次私有 base URL 请求 API；插件 active、fixture 模型可用之后，创建一个 `agent: root`、明确 `fixture/fixture-model` 的 session。不得照搬旧 `allow_all`；按实测宿主权限契约收窄，并保留下面的执行前守卫。
6. Root `ping` 获取 provider 原始请求与 catalog；再发固定 `!call execute` + 上述 JSON，等待真实 search 工具结果和后续 provider 请求。关联 session、请求序号及 tool_call_id，不以全文里最长的 `crew_task` 文本代替结果。

### 3.3 安全守卫与异常

- 新 witness 在注册时透明记录完整 description，同时给三项 Crew `execute` 加 **执行前拒绝** 守卫：记录 forbidden-attempt 并抛错，绝不进入原 task 实现。保持 name/schema/description 不变；报告披露该 fixture 守卫，验证目标仅是展示与 search，不验证 task 行为。
- Provider decision、实际工具调用和 session listing 三方交叉审计：唯一允许的执行为固定 search 的 `execute`；无 delegation/native subagent，无非 Root session。注册 agent 不等于创建该 agent 会话。
- fixture Git 目录若需要只 `git init`，不创建任务 worktree/ledger；前后确认 fixture 中无 `opencode-crew-stage1` registry/lock/归档生成。不读取或操作真实 ledger；真实路径安全由环境隔离和调用守卫保证，不靠事后打开真实 DB。
- 工具调用越界、意外权限请求、额外 session、配置污染、版本/PID不符、日志缺失/损坏、哈希不符均立即失败；不通过重试 task 或换真实 provider补救。

## 4. 展示验收与证据分层

以下各层**分别通过且同时成立**，不能用 search 成功替代 catalog 成功：

| 层 | 必须观察和断言 |
|---|---|
| 包来源 | 工作区→副本→包内 src/agents/readmes/package 的路径集合与哈希一致，包含 dirty 修改；构建产物同源，主 dist 未改；tgz hash 与加载 entry 绑定 |
| 注册 | witness 的三个 `tool_register` description 与本轮源码期待完整多行文本一致，不只是关键词；记录长度、hash、首行和正文完整性 |
| 默认 catalog | 从 **ping 对应请求** 的 system/developer 中解析实际 Code Mode 工具 catalog 边界，再定位每个工具的签名/描述条目及默认首行；保留原始段、条目和行定位。禁止在整个 system 或后续 search 注入文本里匹配；格式无法定位则失败/未验证，不能降级全文 grep |
| search | 固定 execute 的实际 tool result 通过 call ID 与后续 provider 消息关联，按返回结构定位三个工具；完整多行 description 与注册值一致，不能只有 excerpt、首行或最后一句。封装转义可解析还原，内容不可自行拼接补全 |
| 零任务副作用 | forbidden-attempt=0、crew task 执行=0、非 Root 会话=0、fixture ledger=0；所有已启动自身进程完成回收；原工作区受保护内容无新增变化 |

Catalog 每个工具的实际默认首行至少覆盖以下既有目标（不得借同一条目的后续正文补足）：

- start：同一 Root、同 key 同输入含已结案返回原记录、不重新创建会话或投递、重试新 key、最多 2 个未结案预留、idle/出错/stop 不释放、离线结案释放。
- status：当前 Root 范围；不传 taskID 只列未结案；传 taskID 不存在/非本 Root 时成功但不含 task 字段。
- stop：最多一次中断、重复不再中断、已结案不发中断、不证明会话/进程树停止、processSafety unconfirmed、不释放预留。

原始证据含构建输出、哈希 manifest、版本/API info、witness/provider JSONL、关联的 catalog 条目/search结果、session清单、清理结果与逐项判定，留在 ignored attempt。日志缺失不得以旧证据填补。注册/search相等校验需要独立期待值，不能只从同一输出自比；依据当前 `src/tasks.ts` 和已有接口测试提取并审阅预期文本。

## 5. 超时、slot 与验证命令

本文件不执行下列命令。新 runner **拟定 CLI** 为 `python3 test/.work/package-display/runner.py <attempt-id>`，由 engineer 实现；不是声称已有文件。

先创建项目内 tmp/log 目录，设置 TMPDIR/TMP/TEMP。读完 slot 规则后，`slot audit`、`slot status` 输出写入 `test/.work/package-display/preflight-<attempt-id>.log`。随后将构建、provider、host、验证和 finally 清理全部包在**同一个** slot 生命周期内，例如：

```sh
slot cpu -- python3 test/.work/package-display/runner.py <attempt-id>
git diff --check
git status --short --untracked-files=all
```

Runner 使用单调时钟：全程上限 600 秒，构建子进程上限 180 秒，provider ready 15 秒、host ready 120 秒、单 HTTP 30 秒、每次 prompt/idle 120 秒，各阶段不得越过全程剩余预算；另留清理预算不超过 30 秒。所有子进程（含构建）登记 PID/进程组，finally 只向本次拥有的组 TERM，等待最多 15 秒后 KILL，再等最多 10 秒，记录退出与残留检查；不使用按名字全局 pkill、不停止共享服务。超时/异常也保留证据且非零退出；有残留即不验收，不宣称全局“无进程”。

成功标准：所有分层断言通过、runner 退出 0、清理证据完整、主源码/dist/受保护材料前后哈希不变；状态差异仅在授权 fixture/新报告/精确 ignore。验证脚本是测试 fixture 而非产品新功能，不强求 host runner 先红；既有产品首行修改的红绿证据必须保留。若需要修改产品行为，停止并请求新 Assignment，按测试先红再实现执行。

## 6. 收尾材料与可提交单元策略

只建议列表，不暂存，不提交，不推送，不改变历史 tracked 归属。

1. **已有行为修复单元**：核实后建议 `src/tasks-maintenance.ts` + `test/tasks-maintenance.test.ts` 成对列入，关联既有 closeout 红绿事实；不可将本轮展示验证冒充 closeout 实测。
2. **已有文本摘要单元**：`src/tasks.ts` + `test/tasks-interface.test.ts` 成对列入，关联 tool-summary 已有红绿。以上四项以 Root 实际状态核对为准，不因本文指定路径而吞入额外变更。
3. **文档/验证摘要单元**：本文及另获授权的新脱敏简报，可在 `plans/` 或 docs 索引中记录日期、实际宿主/provider、包和输入摘要、分层结果、复现命令、限制及私有证据定位。简报去除 token、Authorization、个人绝对路径、业务提示词；保留“仅指定组合、不证明 task 安全/模型误用率/所有 host”的限制。已有 `plans/closeout*` 原样保留，逐文件由 Root 审核候选，不自动全部纳入。
4. **本地原始证据**：新 fixture 已被 `test/.work/` 精确覆盖，不需另加宽 ignore。已有未跟踪 `plans/evidence/tool-summary/` 及 closeout 证据，先逐目录核对 tracked/untracked，再建议只添加对应精确目录规则；禁止 `plans/`、`plans/evidence/`、`closeout*` 等大范围规则，不用 `git rm --cached`，不更改历史 tracked。本 Assignment 不修改 `.gitignore`；须 Root 单独授权后实施。
5. 原始 JSONL、DB、tgz、缓存、token、临时安装产物不进入提交建议。忽略不等于删除，旧证据继续保留。用户原 `plans/worktree-stage1-closeout-spec.md` 明确从所有候选中排除。

## 7. 风险、未决项与停止条件

- 实际 host 版本、catalog 格式及 search 返回封装待实测；旧 runner 只提供搭建模式。不存在“预期必须是旧版本”的决定。遇到截断应如实判 catalog 未通过，不能修改产品文案或宿主设置来伪造默认展示通过。
- 新 witness 拦截 task execute 只保障零副作用，不证明这些工具业务执行正确；假 provider 不证明真实模型的理解、选择或误用率。
- 默认配置隔离（尤其祖先发现）、宿主权限能力、依赖离线可用性必须预检；无法确认时 Report: blocked，保留已有结果，不连接真实服务补齐。
- 无新增待裁决业务口径；若执行中需要扩大 Scope、修改产品、允许任务周转或提交，应回 Root/用户另行授权。本文 ready 只表示契约可交接，不表示宿主验证已通过。
