# 角色权限评审意见

## 当前状态：已实施，自动权限求值验证通过，R0 待端到端/TUI

用户已选择保留 `external_directory` 继承目标，并决定身份无法识别时非 external 动作 deny，不再是待选业务决策。`src/role-guard.ts` 与 `src/index.ts` 已实现：保留宿主前缀，过滤会匹配 external 的角色 action，追加已知动作显式 deny 和角色白名单，完整连续块已存在时不重复；Markdown 原 deny-all 保留供 guard 使用。external 完全由宿主裁决，其他 action 按每个资源的局部 last match 与宿主取严；显式身份优先，缺失时使用 session 身份。不是所有全局规则都无条件继承。

S1 红灯 33 pass / 60 fail，S2 同 93 项全通过；全量 439 pass / 0 fail，typecheck 通过，独立源码 review ready。S0 四例装配成功，最终全局规则位于尾部且 reload 稳定，仅证明装配而非权限行为。S3 隔离源码副本构建的 SHA-256 为 `841d3bf78add12304ce3b31ac6e6dc2d4ab4dfabdd97af0274ef047c67259e61`：G0 28 条、G1–G4 120 条真实 `permission.assert` 均符合预期，后者每行 initial/reload 重复；pending ask 已验证事件、list/get、reject 和清空，但不是 TUI 验证。证据索引：`/project/tmp/opencode-crew-read-policy-s1/{summary.md,red.log}`、`/project/tmp/opencode-crew-read-policy-s2/{s2-green.log,full-green.log}`、`/project/tmp/opencode-crew-read-policy-s3/{g0-assert,matrix}/summary.md`。

**R0 仍 blocked，R1/R2 未执行，issue #10 未实现。** 六格外部 read 端到端通过：三个角色在无全局 external 规则时读取成功，在全局 external deny 时均被拒绝；该 G0 仍有其他动作全局 deny。证据：`/project/tmp/opencode-crew-read-policy-s3/tool-smoke/sol-attempt/summary.md`。全局 external ask 与敏感 read ask 的 TUI 客户端确认未验，write/shell 等 A1/A2 真实工具覆盖不足。assert 证明权限求值，不证明工具调用路径；初轮构造失败也不能算真实工具通过。当前源码和隔离构建已验不等于主仓库 `dist` 已部署：其故意未更新，共享服务未重启。hook 注册必须成功；v2.3.0 受控 setup 失败测试中，hook 和 transform 注册成功后主动抛错，注册未在后续装配/reload 生效，正常 observer 继续运行。失败 transform 在首次 registry 前未执行，不证明已执行副作用回滚或所有 setup 失败安全；证据见 `/project/tmp/opencode-crew-read-policy-s3/setup-cleanup/summary.md`。后续插件可再次改变 effect，不经过 permission hook 的路径不在保证范围，`plans/` 词法匹配不是 symlink 沙箱。具体补测见 [宿主清单](role-permissions-host-checks.md)。

## 2026-11-17 初轮 R0 复审（历史，blocked）

**R0 未通过（reject），R1/R2 停止且未执行；issue #10 尚不能开始实现。** 真机 R0 共 27 项：14 通过、1 失败、11 构造失败、1 待 TUI；reviewer 的五条固定 git 例外仅测了 1 条。证据目录：`/project/tmp/opencode-crew-issue-10/evidence/`，见 `summary.md`、`a3-default.log`、`a3-deny.log`、`batch.sh` 和 `pass-audit.log`。独立 reviewer 因自身 `external_directory` deny 无法直接读取该目录，并未独立复跑；Root 已补做原始证据验收。

`a3-default.log` 显示 architect 实际 read `/project/tmp/opencode-crew-issue-10/outside/value.txt`，工具结构化返回 `Permission denied: external_directory`。默认和全局 deny 两种情况同样被拒绝，不能证明全局 deny 得到继承；ask 未测。11 项构造失败是模型未调用目标工具，不能作为权限拒绝证据。

下文保留 2026-11-09 历史评审，但其「删除显式 `external_directory` 即可继承、默认行为不变」的论证被本轮证据推翻，不可作为当前有效修复方案。初轮时三个读角色先有 `action: *`、`resource: *`、`effect: deny`，后有 read 等白名单，无显式 `external_directory`；当时 `src/index.ts` 整档替换权限。官方 V2 规则为 last match wins，agent 规则在全局之后，action `*` 匹配 `external_directory`，该检查先于 read；默认 base allow 因而被后续 agent deny-all 覆盖。当时的 inherit 测试只排除显式规则，并未断言通配 deny 的有效结果。没有旧宿主同规则对照，不能归因为 v2.3.0 宿主回归。

初轮当时列出的选项（现已选择 1，见顶部）：

1. 保留默认允许且尊重全局 ask/deny，重新设计权限表达或合并。
2. 接受读角色默认 fail-closed，并修改契约。
3. 暂缓修复，仅保持 blocked。

加回固定 allow 会覆盖用户 ask/deny，不作为修绿方案。初轮未改行为；后续实施与验证状态见顶部。

## 2026-11-09 历史评审

以下整节为 **2026-11-09 历史快照，不是现行合并语义或建议**；特别是整档替换表与“删除规则即可继承”的结论已被上方复审和后续实现取代。第 2 条 webfetch 风险仍保留。

## 1. 权限来源与合并语义

角色权限只来自 `agents/<role>.md` frontmatter（profile 档不覆盖 permissions，见 `docs/crew-profiles.md` §1）。插件在 `agent.transform` 里按三种语义合并（`src/index.ts:57-70`）：

| 角色 | frontmatter 策略 | 合并方式 | 效果 |
|---|---|---|---|
| root | `permissions: []` | 不添规则 | 完整继承宿主现有授权，插件不扩权 |
| engineer | 三条 deny（`subagent` / `question` / `execute`） | 保留宿主规则 + 查重追加 | bash/edit 等能力由宿主授予；插件只保证不递归、不问人、不 Code Mode |
| architect | deny-all + 只读白名单 + frontmatter 相对路径 `plans/**` 写规则 | 整档替换，**代码再追加**绝对路径 `plans/**` | 最小权限，与宿主配置无关 |
| explorer | deny-all + 只读白名单 | 整档替换 | 同上，无写权 |
| reviewer | deny-all + 只读白名单 + 五条固定 git 命令 | 整档替换 | 同上，shell 仅固定字符串 |

三种语义各有理由：Root 是用户直接驱动的 primary，权限应与普通会话一致；engineer 需要宿主授予的执行能力跑红绿灯测试；读角色整档替换保证最小权限不受宿主配置影响。追加均按 `(action, resource, effect)` 查重，重载幂等（`docs/crew-profiles.md` §9）。

两点口径需要说清：

- **architect 的 `plans/**` 写权分两处。** `agents/architect.md` frontmatter 已有相对路径 `edit: plans/**`；`src/index.ts:65-69` 再按查重追加一条绝对路径 `<cwd>/plans/**`，以便匹配绝对词法路径。改权限时只看 frontmatter 会漏掉绝对路径规则。
- 官方文档明确「A custom subagent uses its own permissions, not a subset of its parent's permissions」，所以读角色的整档替换符合宿主语义，不是覆盖父会话。

## 2. 逐角色结论

| 角色 | 结论 | 要点 |
|---|---|---|
| root | 合理 | 空策略 = 继承宿主（`src/index.ts:57` 注释），执行能力来自宿主授权而非插件扩权，宿主 ask/deny 仍是闸 |
| architect | 合理，属刻意设计 | `agents/architect.md:5-17` 默认 deny、无 shell/Code Mode/递归委派；产出是方案契约，执行验证归 engineer，限制 blast radius 让方案可审计 |
| engineer | 合理且必要 | `agents/engineer.md:5-8`：`question` deny 强制业务歧义 hand-back；`execute`（Code Mode）deny 防程序化编排绕过逐工具授权。能力下限取决于宿主配置，是分工而非缺陷 |
| explorer | 合理 | 与 architect 相同的只读白名单减掉 plans 写权，最小权限；比宿主内置 `explore` 更严——内置 explore 还允许 `shell` |
| reviewer | 最精致的一份 | `agents/reviewer.md:15-19` 五条固定字符串 git 命令，禁参数/管道/重定向；`--no-optional-locks` + `core.fsmonitor=false` 连 .git 写入都避免。已知代价：不能复跑测试，只能核实 diff 与证据一致性，伪造绿灯日志理论上无法直接戳穿——由「不把日志阅读称为自己执行测试」+ 缺项列明 + Root 验收兜底，取舍成立 |

## 3. 发现的问题（按严重度）

1. **读角色的 `external_directory: allow` 会盖掉用户自己的硬化配置。** 它本身不是异常授权（官方文档：`external_directory` 默认就是 allow，宿主内置 `explore` 也显式允许外部目录），真正的问题是合并顺序——官方文档明确「agent rules are appended after global rules」且「last matching rule wins」，所以只要用户全局设了 `external_directory: ask/deny`，crew 这三个角色都会静默放行。同类写法在 oh-my-openagent 已被用户投诉（issue #2194）。
2. **webfetch 是外泄链上唯一能带出数据的动作，且只在 architect、explorer 两个角色开放。** reviewer 的 frontmatter 里没有 `webfetch`/`websearch`。恶意文件可诱导这两个角色把源码细节拼进 URL；`.env` 的 ask 只挡密钥文件，不挡源码里的秘密。
3. **求值顺序与追加语义（已验证，非推断）。** 官方文档确认：规则按顺序合并、last match wins，agent 规则追加在全局规则之后；无规则匹配时为 `ask`；一次操作涉及多个资源时「任意 deny 即 deny，否则任意 ask 即 ask」。读角色「deny-all 在前、allow 在后」因此是文档化语义，而不是靠真机反推的隐性契约——但仍值得进回归清单，理由是防宿主改语义，而非防当前结论失效。
4. **plans/ 绝对路径是词典匹配，非 symlink 隔离（低危）。** `src/index.ts:65` 注释已明确声明；plans/ 内放 symlink 理论上可写出界外。

## 4. 建议（分档）

### 授权收窄：第 1 条已改，第 2 条经评估不改

1. **删掉三个读角色里的 `external_directory: allow`，改为继承。** 三种写法对比：

   | 方案 | 默认配置 | 用户已硬化 | headless `opencode run` | 深层子会话 |
   |---|---|---|---|---|
   | 保持 `allow`（现状） | allow | **静默覆盖用户 deny/ask** | allow | allow |
   | 改成 `ask` | 每次都问 | 尊重 | 子代理 ask 被 reject | 可能不上浮（opencode#39112） |
   | **删除规则（建议）** | allow（宿主默认，行为不变） | **尊重用户策略** | 按用户策略 | 按用户策略 |

   删除是唯一零行为回归又不再越权的选项：worktree 内路径本就不走 `external_directory` 检查，crew 主流程不受影响。

   **已实施**：`agents/architect.md`、`agents/explorer.md`、`agents/reviewer.md` 的三条规则已删除；`test/crew.test.ts` 增加「读角色不得携带 external_directory 规则」的断言防回退。

   若目标是「用户没配也默认收紧」，才需要 `ask`，代价是 headless 下 fail closed、深层子会话可能不上浮——两者都必须先确认宿主行为再定。

2. **`webfetch` 加域名白名单（architect、explorer 两处）**，`websearch` 可保留。配合 deny-all 在前，未列入的 URL 直接 deny。注意匹配的是请求 URL 本身，若宿主不校验重定向，白名单可被 302 绕过；收窄前需确认匹配粒度。

   **决定：暂不收紧（已知风险，接受）。** 理由：architect/explorer 需要能读任意链接，固定白名单会持续碍事；可配置白名单则多一份需维护的配置面。**残余风险明确记录**：这两个角色会读到不可信内容，且 webfetch 是权限模型里唯一能把数据带出本机的动作，恶意文件可诱导它把源码细节拼进 URL。`.env` 的 ask 只挡密钥文件，不挡源码里的秘密。若日后要收紧，先确认宿主对重定向的处理，再考虑白名单。

### 值得补：不改权限，补验证和口径

3. **把第 3 条的语义纳入真机回归清单**：读角色「能 read、不能 shell、architect 只能写 plans/」三条断言加进现有 host-verify 流程，防宿主升级后语义变化。

   **已实施**：见 `docs/role-permissions-host-checks.md`（A1/A2/A3 三条断言 + 执行方式 + headless/TUI 限制）。

4. **明确 architect 的 ready 口径**：ready = 方案可实施且验证步骤已指派给 engineer；只有未决事实影响选型才标 blocked。否则 architect 会被自己无权执行的验证永远卡住。XLSX 数值对账这类设计期验证需求走「Root 先派 engineer 跑、结果喂回 architect」，不给 architect 开 shell；真要开也只该开 narrowly-scoped 只读命令白名单，代价是权限模型多一个需维护的例外。

   **已实施**：`agents/architect.md` 正文与 GPT 附录已写明「无 shell 权限不构成 blocked」「ready 不以亲自执行验证为前提」，`test/crew.test.ts` 有对应口径断言。

### 不改

- reviewer 五条固定 git 命令、engineer 三条 deny、Root 继承语义：均经得起推敲。
- plans/ symlink 词典匹配：低危且已声明，不值得加 realpath 解析的复杂度。
- architect/explorer 的 `webfetch` 不加白名单：见 §4 第 2 条的决定与残余风险。

**历史建议（已撤回）：只删除规则不足以实现继承；现行实现见顶部。**

## 相关文件

- `agents/root.md`、`agents/architect.md`、`agents/engineer.md`、`agents/explorer.md`、`agents/reviewer.md`（权限定义）
- `src/index.ts`、`src/role-guard.ts`（现行合并、guard 与 plans 绝对路径注入）
- `docs/crew-profiles.md` §1、§9（permissions 不被 profile 覆盖；重载幂等）
- `src/tui/view-model.ts:327`（permission 告警通道）

## 参考资料

- OpenCode Permissions（V2）：https://opencode.ai/docs/permissions/ ——默认 base policy、`external_directory` 默认 allow、agent 规则追加在全局之后、last match wins、内置 `explore` 的策略、`ask` 的客户端语义
- oh-my-openagent issue #2194：硬编码 `external_directory: allow` 追加在用户配置之后，覆盖用户设置
- anomalyco/opencode#43669：用户 allow 规则被内置 agent 策略压过的同源问题（镜像方向）
- anomalyco/opencode#39112：级联子代理（depth ≥ 2）的 `ask` 不上浮（仅见标题与摘要，原文未逐字核实）
