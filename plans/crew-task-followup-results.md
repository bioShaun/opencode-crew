# Crew 工具接口与提示配置后续验证记录（V1–V4）

日期：2026-11-01。对应 `crew-task-followup-spec.md` 第 4.1 节的真实 host 验证。
基线：`0c08661cd7f15c60bb01a040b5bd661d91185ece`，宿主 OpenCode **2.2.5**（`opencode v2.2.5`）。

## 方法与证据位置

- 私有 fixture（`plans/evidence/crew-followup/host-verify/`，gitignore）：独立 clone、detached worktree、`npm pack` 解包加载（包内 src 哈希与工作区一致）、私有 XDG/DB/config/tmp/loopback 端口，不触碰真实 ledger 与业务会话。
- 确定性假 provider（`fixture_provider.py`，OpenAI-compatible `/chat/completions`）：记录每个出站请求体，用 `!call <tool> <json>` 脚本化 tool_call 驱动 Root，经 `execute` Code Mode 调 `crew_task_*`。
- witness 插件（`witness/entry.mjs`）包装真实 `dist/index.js`，在插件边界记录 `setup` 进入/返回及 options、`agent.transform` 计算结果、`tool.transform` 注册负载；每次事件带模块实例 nonce 与 pid。
- runner：`runner.py <with-instructions|default> <attempt>`；原始日志 `run3–run7.log`、`attempt*/provider.jsonl`、`attempt*/witness.jsonl`。
- slot 预检与提交：`slot audit`/`slot status` 记录于 `slot1.log`；各轮经 `slot cpu --` 执行，服务与 provider 进程组均在 finally 回收。

关键会话与时间戳见各 attempt 日志；下文引用 attempt5（with-instructions，V3 决定性现场）与 attempt7（default，V4）。

## V1 工具列表暴露 —— PASS（有暴露面细节）

判据：三个 `crew_task_*` 的实际 description 包含冻结文本关键契约。

- `crew_task_*` 不在 provider `tools[]` 直接工具数组中（该数组仅含 edit/execute/subagent 等宿主工具），而是经 `# Code Mode` catalog 以 `tools.crew_task_start({...})` 签名+注释形式暴露给模型。
- **catalog 中每个工具只显示 description 的第一行**：`crew_task_start` 只露出"在手工准备的独立 detached worktree 中启动 engineer 会话并一次性投递任务。"，幂等/容量/边界等契约句不在默认上下文（`v1_catalog` 四项全 false）。
- 通过 Code Mode `search({query:'crew_task'})` 可取回**完整** description，冻结契约四项全部命中：closed 旧 key 不重投（"不重新创建会话或投递"）、容量不自动释放（"不释放"）、status 空结果（"不含 task 字段"）、stop unconfirmed（"unconfirmed"）。
- witness 注册边界同样确认三个工具以完整冻结文本注册（`v1_registered` 全 true）。

结论：实际 description 即冻结文本且经宿主工具面完整可达（search）；默认 catalog 视图仅为首行摘要。含义：模型若不主动 search，看到的 `crew_task_start` 说明只有第一行——冻结契约依赖调用方查全文，这一点值得在后续设计中知悉（不属于本轮文档修正义务，如实记录）。

## V2 配置注入位置 —— PASS

配置 `engineerInstructions: ["MARKER-CREW-FOLLOWUP-A1-… 唯一项目补充规则标记A"]`。

- 原生 engineer 会话（`POST /api/session` agent=engineer，attempt5 `ses_e683be2e…`）：出站请求的 system 含 marker-A **恰好 1 次**，位于 `## 项目补充规则` 小节；`/api/agent/engineer` 返回的 system 同样恰含 1 次。
- `crew_task_start` 创建的 engineer 会话（attempt5 child `ses_e683bde7…`）：system 含 marker-A 恰 1 次；其任务包（user 消息）**不含** marker-A。
- root 与 explorer 会话的 system 均不含 marker-A。
- 检查项全过（`V2_native`、`V2_child`）。

## V3 热更新边界 —— FAIL（子项，走文档修正路径）

判据：修改配置后新会话收到新规则；运行中旧 engineer 不中断且 system 不被原地改写。

实测（attempt5，配置 marker-A → marker-B）：

- **setup 确实重跑**：编辑配置文件后约 0.5s，witness 记录两个插件实例（同进程、不同模块 nonce）各收到 `setup_enter`，`ctx.options.engineerInstructions` 已含 marker-B。spec 担心的"热更新只重载配置、不重新执行 setup"**不成立**；auto-watch 即可完成重载，无需显式 reload。
- **新建会话收到新规则**：配置变更后新建 engineer 会话（POST-EDIT-PING-01）system 含 marker-B、不含 marker-A —— PASS。
- **已存在会话的 system 不是创建时快照**：配置变更前创建的 engineer 会话（`ses_e683be2e…`，首请求含 marker-A），变更后再发 prompt（POST-EDIT-OLD-01），其下一次 provider 请求的 system **变为 marker-B**。即会话 system 按当前 agent 定义逐请求重算，配置热更新的实际生效边界是"下一次 provider turn"，**包括已存在会话的下一轮**。spec 判据"system 不被原地改写"因此 FAIL；`README`/`agents/root.md`/前一轮 spec §8.2 的"只作用于后续新建会话"表述被证伪，须修正。
- 附带观察（不作为判据）：auto-watch 重建已完成时立刻 `POST /api/location/reload`，请求正常返回且未再触发 setup（增量 0），但此后新建会话与旧会话的 prompt 均未再派发 provider 请求（≥90s，attempt4 中约 6 分钟重试亦无），疑似宿主/fixture 边界怪癖；auto-watch 路径本身正常，不再依赖该接口即可复现热更新。

## V4 默认可移植性 —— PASS

attempt7（不配置 `engineerInstructions`）：engineer agent system（`/api/agent/engineer` 与 child 出站请求）与任务包均无 `slot`；剔除宿主 env 固有句"Prefer … over generic system temporary directories such as /tmp"后无 `/tmp` 字样；任务包仍含通用安全规则（"禁止 commit、push…"），engineer system 仍含 `Report:` 等通用规则。

## 汇总

| 项 | 结果 | 后续 |
|---|---|---|
| V1 | PASS（catalog 首行摘要 + search 全文） | 记录暴露面细节 |
| V2 | PASS | — |
| V3 | FAIL（新会话生效 PASS；旧会话 system 按请求重算被改写 FAIL） | 按 spec 修正 README、root.md、前 spec §8.2 表述为"下一次 provider turn"语义 |
| V4 | PASS | — |

证据均来自真实 2.2.5 host 私有 fixture；未用单元测试冒称 host 结果。私有 DB/cache 不分享。

## 行为变更红绿证据（4.2–4.5）

| 项 | 红灯 | 绿灯 | 提交 |
|---|---|---|---|
| 4.2 结构断言 | 纯测试可维护性改动，无生产行为变化 | `bun test` 192→192 pass | `20b698a` |
| 4.4 FORBIDDEN_CALLER 直接抛出 | 外部契约原本成立（identity 特判已兜底），新测试作为表征测试钉住契约 | 193 pass + build | `3aef92a` |
| 4.5 拒绝换行 engineerInstructions | `invalid engineerInstructions` 1 fail：换行用例当时通过校验（行为缺失，非语法错） | 193 pass + build | `a28c666` |
| 4.3 MODEL_NOT_CONFIGURED | `Expected "MODEL_NOT_CONFIGURED", Received "HOST_ERROR"` | 194 pass + build | `88d014e`（错误契约变更，消费方若按 HOST_ERROR 判等需更新） |

## 发布与收尾检查（4.6）

- **版本**：保持 `0.1.0`。仓库无 tag、无 CHANGELOG、无发布记录，本轮为 0.1.0 开发线上的契约加固，未触发发布；不补造 tag/changelog。
- **打包**：在 `test/.work/pack-fixture` 独立目录执行 `npm pack --dry-run --json`（prepack 只在该副本内 build）。包内容确认：`dist/index.js`、全部 8 个 `src/*.ts`、全部 5 个 `agents/*.md`、双 README、`THIRD_PARTY_NOTICES.md`，共 16 个文件、113538 bytes。
- **构建产物**：`dist/index.js` 全程仅由 `bun run build` 生成，未手工编辑。
- **未跟踪文件**：`plans/worktree-stage1-closeout-spec.md`（2026-11-01，Stage 1 收尾规范，自述"用户接受偏差收尾后状态为 CLOSED_WITH_DEVIATIONS"）非本轮产物，且处于待用户接受状态。**保持未跟踪、不删除**，归属与处置由用户决定。
- **全量验证**：`bun test` 194 pass / 0 fail；`bun run build` 成功；`git diff --check` 干净。
