# 角色权限评审意见

2026-11-09 评审，**仅为意见，未实施任何改动**。依据：当前工作区 `agents/*.md` frontmatter、`src/index.ts` 的权限合并逻辑，以及 OpenCode V2 官方权限文档。

## 1. 权限来源与合并语义

角色权限只来自 `agents/<role>.md` frontmatter（profile 档不覆盖 permissions，见 `docs/crew-profiles.md` §1）。插件在 `agent.transform` 里按三种语义合并（`src/index.ts:47-69`）：

| 角色 | frontmatter 策略 | 合并方式 | 效果 |
|---|---|---|---|
| root | `permissions: []` | 不添规则 | 完整继承宿主现有授权，插件不扩权 |
| engineer | 三条 deny（`subagent` / `question` / `execute`） | 保留宿主规则 + 查重追加 | bash/edit 等能力由宿主授予；插件只保证不递归、不问人、不 Code Mode |
| architect | deny-all + 只读白名单 | 整档替换，**另由代码追加**绝对 `plans/**` 写规则 | 最小权限，与宿主配置无关 |
| explorer | deny-all + 只读白名单 | 整档替换 | 同上，无写权 |
| reviewer | deny-all + 只读白名单 + 五条固定 git 命令 | 整档替换 | 同上，shell 仅固定字符串 |

三种语义各有理由：Root 是用户直接驱动的 primary，权限应与普通会话一致；engineer 需要宿主授予的执行能力跑红绿灯测试；读角色整档替换保证最小权限不受宿主配置影响。追加均按 `(action, resource, effect)` 查重，重载幂等（`docs/crew-profiles.md` §9）。

两点口径需要说清：

- **architect 的 `plans/**` 写权不在 frontmatter 里。** `agents/architect.md` 只有 deny-all 与只读白名单，`edit` 规则是 `src/index.ts:64-68` 注入的绝对路径。改权限时只看 frontmatter 会漏掉它。
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
4. **plans/ 绝对路径是词典匹配，非 symlink 隔离（低危）。** `src/index.ts:63` 注释已明确声明；plans/ 内放 symlink 理论上可写出界外。

## 4. 建议（分档）

### 值得改：两处授权收窄

1. **删掉三个读角色里的 `external_directory: allow`，改为继承。** 三种写法对比：

   | 方案 | 默认配置 | 用户已硬化 | headless `opencode run` | 深层子会话 |
   |---|---|---|---|---|
   | 保持 `allow`（现状） | allow | **静默覆盖用户 deny/ask** | allow | allow |
   | 改成 `ask` | 每次都问 | 尊重 | 子代理 ask 被 reject | 可能不上浮（opencode#39112） |
   | **删除规则（建议）** | allow（宿主默认，行为不变） | **尊重用户策略** | 按用户策略 | 按用户策略 |

   删除是唯一零行为回归又不再越权的选项：worktree 内路径本就不走 `external_directory` 检查，crew 主流程不受影响。若目标是「用户没配也默认收紧」，才需要 `ask`，代价是 headless 下 fail closed、深层子会话可能不上浮——两者都必须先确认宿主行为再定。

2. **`webfetch` 加域名白名单（architect、explorer 两处）**，`websearch` 可保留。配合 deny-all 在前，未列入的 URL 直接 deny。注意匹配的是请求 URL 本身，若宿主不校验重定向，白名单可被 302 绕过；收窄前需确认匹配粒度。

### 值得补：不改权限，补验证和口径

3. **把第 3 条的语义纳入真机回归清单**：读角色「能 read、不能 shell、architect 只能写 plans/」三条断言加进现有 host-verify 流程，防宿主升级后语义变化。
4. **明确 architect 的 ready 口径**：ready = 方案可实施且验证步骤已指派给 engineer；只有未决事实影响选型才标 blocked。否则 architect 会被自己无权执行的验证永远卡住。XLSX 数值对账这类设计期验证需求走「Root 先派 engineer 跑、结果喂回 architect」，不给 architect 开 shell；真要开也只该开 narrowly-scoped 只读命令白名单，代价是权限模型多一个需维护的例外。

### 不改

- reviewer 五条固定 git 命令、engineer 三条 deny、Root 继承语义：均经得起推敲。
- plans/ symlink 词典匹配：低危且已声明，不值得加 realpath 解析的复杂度。

**如果只选一件做，选第 1 条——但按「删除规则」而不是「改成 ask」实施。**

## 相关文件

- `agents/root.md`、`agents/architect.md`、`agents/engineer.md`、`agents/explorer.md`、`agents/reviewer.md`（权限定义）
- `src/index.ts:47-69`（合并语义、plans 绝对路径注入与幂等追加）
- `docs/crew-profiles.md` §1、§9（permissions 不被 profile 覆盖；重载幂等）
- `src/tui/view-model.ts:327`（permission 告警通道）

## 参考资料

- OpenCode Permissions（V2）：https://opencode.ai/docs/permissions/ ——默认 base policy、`external_directory` 默认 allow、agent 规则追加在全局之后、last match wins、内置 `explore` 的策略、`ask` 的客户端语义
- oh-my-openagent issue #2194：硬编码 `external_directory: allow` 追加在用户配置之后，覆盖用户设置
- anomalyco/opencode#43669：用户 allow 规则被内置 agent 策略压过的同源问题（镜像方向）
- anomalyco/opencode#39112：级联子代理（depth ≥ 2）的 `ask` 不上浮（仅见标题与摘要，原文未逐字核实）
