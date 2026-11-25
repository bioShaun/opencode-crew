# 读角色权限真机回归清单

用于宿主（OpenCode）升级后复核 `agents/architect.md`、`agents/explorer.md`、`agents/reviewer.md` 的权限是否仍符合设计。单元测试不能替代真实宿主求值和工具端到端验证。

## 已执行与边界

- 用户已选择 external 继承、身份无法识别时非 external deny。源码实现的 guard 对 external 不介入，其他动作按资源的局部 last match 与宿主取严；显式身份优先，缺失才回退 session。hook 注册必须成功。v2.3.0 受控 setup 失败测试：hook 与 transform 注册后抛错，失败插件注册未在后续装配/reload 生效，正常 observer 继续；失败 transform 首次 registry 前未执行，不证明已执行副作用回滚或所有 setup 失败安全。证据：`/project/tmp/opencode-crew-read-policy-s3/setup-cleanup/summary.md`。后续插件可再改 effect；不走 permission hook 的路径不在保证内，plans 词法匹配不是 symlink 沙箱。
- S1 红灯 33 pass / 60 fail，S2 同 93 项通过；全量 439 pass / 0 fail、typecheck 通过。S0 四例装配成功，最终全局尾部注入、reload 稳定，不是权限行为验证。
- S3 隔离源码副本构建 SHA-256 `841d3bf78add12304ce3b31ac6e6dc2d4ab4dfabdd97af0274ef047c67259e61`：G0 28 条、G1–G4 120 条真实 `permission.assert` 符合预期，G1–G4 每行 initial/reload 重复。pending ask 观察到事件、list/get、reject 和清空，**不是 TUI**。assert 验证求值，不执行目标工具。证据：`/project/tmp/opencode-crew-read-policy-s1/{summary.md,red.log}`、`/project/tmp/opencode-crew-read-policy-s2/{s2-green.log,full-green.log}`、`/project/tmp/opencode-crew-read-policy-s3/{g0-assert,matrix}/summary.md`。
- **R0 仍 blocked**：全局 external ask 和敏感 read ask 的 TUI 客户端确认未验；write/shell 等 A1/A2 真实工具覆盖不足；初轮构造失败不能算工具通过。当时用隔离构建验证，不等于当时主仓库 `dist` 已部署；那次验证后主仓库 `dist` 未随其更新，共享服务也未重启。此后 main 的 `dist` 已从 `84a935c` 起更新，仍不表示共享服务已按当前 dist 重新部署，也不表示已在当前 main 重跑本清单；R1/R2 未执行。

### 最终覆盖概览

| 层次 | 结果与边界 | 证据 |
|---|---|---|
| 单元及回归 | 439 pass / 0 fail，typecheck 通过；S1 红灯 33 pass / 60 fail，S2 93 pass | `/project/tmp/opencode-crew-read-policy-s1/{summary.md,red.log}`；`/project/tmp/opencode-crew-read-policy-s2/{s2-green.log,full-green.log}` |
| 真实宿主权限求值 | S3 共 148 条 assert 符合预期（G0 28、G1–G4 120，后者 initial/reload 每行重复）；不是工具执行或 TUI | `/project/tmp/opencode-crew-read-policy-s3/{g0-assert,matrix}/summary.md` |
| 真实外部 read | 六格通过：三个角色 G0 read completed 且含 marker，G1 read 被 external_directory deny；每格一次 read、无重试，合计 12 模型 steps，模型 `tcuni/gpt-6.1-sol`。G0 仅无全局 external 规则，仍有 shell/edit 等全局 deny；先前 bigpickle 429 是模型不可用，不是权限失败 | `/project/tmp/opencode-crew-read-policy-s3/tool-smoke/sol-attempt/summary.md` |
| 受控 setup 清理 | v2.3.0 指定注册后失败路径通过；不证明已执行副作用回滚或所有失败安全 | `/project/tmp/opencode-crew-read-policy-s3/setup-cleanup/summary.md` |
| 未完成 | TUI external ask / 敏感 read ask；write/shell 等 A1/A2 实际工具覆盖不足；R0 仍 blocked | 本清单下方步骤 |

## 语义依据（不是推断）

来自 OpenCode V2 官方 Permissions 文档：

- 规则按顺序合并，**last match wins**。
- 官方配置合并口径：低优先级配置 → 全局规则 → **agent 规则追加在最后**。这不能推断 Crew registry transform 与宿主内置 config projection 的先后；本轮 S0 实测最终 global 规则尾部注入，不与该口径矛盾。验收以最终 effective rules 和真实求值为准。
- 无规则匹配时效果为 `ask`。
- 一次操作涉及多个资源时：任意 `deny` 即 `deny`，否则任意 `ask` 即 `ask`，否则允许。
- `external_directory` 在 `read`/`edit` 规则**之前**检查；默认策略允许外部目录。历史原始实现中读角色的通配 deny 会匹配该动作，故不能仅凭没有显式规则断言继承；当前 host block 已过滤这类 action 模式。见 `docs/role-permissions-review.md` 的复审。

宿主若改动其中任何一条，下面断言可能失效，需要重新评审 `agents/*.md`。

## 三条必过断言

### A1 读角色能读、不能执行
对 architect、explorer、reviewer 分别验证：

| 操作 | 预期 |
|---|---|
| `read` 仓库内源码文件 | 成功 |
| `glob` / `grep` 仓库内路径 | 成功 |
| 执行任意 `shell` 命令 | 拒绝（reviewer 仅五条固定 git 命令例外） |
| `execute`（Code Mode） | 拒绝 |
| 再派 `subagent` | 拒绝 |

### A2 architect 只能写 plans/
| 操作 | 预期 |
|---|---|
| `edit`/`write` `plans/probe.md`（相对路径） | 成功 |
| `edit` 绝对路径 `<cwd>/plans/probe.md` | 成功（`src/index.ts` 注入的绝对规则） |
| `edit` `src/index.ts` 或 `<cwd>/src/index.ts` | 拒绝 |
| `edit` cwd 之外的 `plans/` 路径 | 拒绝（词典匹配，不是 symlink 隔离） |

### A3 读角色不覆盖用户的 external_directory 策略
| 前置 | 操作 | 预期 |
|---|---|---|
| 全局无 `external_directory` 规则 | 读 cwd 之外普通文件 | 允许（宿主默认） |
| 全局 `external_directory: deny` | 读 cwd 之外普通文件 | **拒绝**，不被 agent 规则覆盖 |
| 全局 `external_directory: ask` | 读 cwd 之外普通文件 | 按宿主客户端语义进入 ask |

A3 的权限求值和六格外部 read 工具已由隔离构建验证；TUI 和其余实际工具覆盖仍须按下述步骤完成，R0 尚未通过。

## 执行方式与注意

1. 在**独立测试仓库或 worktree** 里配置使用上述经验证的隔离 package，记录实际加载包的构建 hash；不要污染真实项目 plans/，不要求全局安装或修改共享 dist。
2. A1/A2 的拒绝类断言在 headless `opencode run` 下即可：拒绝是确定性的，失败会写 stderr。
3. **ask 必须在 TUI 主会话里做**：选择对应读角色，在隔离配置中设置全局 `external_directory: ask`，触发实际外部普通文件 read，检查权限提示并分别记录 Allow once 与 Reject 的结果；再触发敏感文件 read 的 ask 并同样记录客户端结果。使用无敏感内容的测试文件，分别构造请求避免既有审批影响。headless 子代理和深层子会话不能替代此确认。
4. 补跑尚缺的新构建真实工具端到端覆盖，特别是 A1/A2 的 write/shell 等允许与拒绝；记录目标工具确实被调用及结果，构造失败另记，不当作权限拒绝。每个断言记录宿主版本（`opencode --version`）、实际输出、权限提示原文、判定通过/失败。
5. 通过标准：三条断言全部符合预期。任何一条失败即停止并回到 `docs/role-permissions-review.md` 重新评审；归因需区分 crew 规则/契约、宿主行为、构造或环境问题，不要靠加规则把测试「修绿」。

## 何时跑

- 宿主升级（`@opencode/plugin` 或本机 opencode 版本变化）后必跑。
- 修改 `agents/*.md` 权限段、`src/index.ts` 合并逻辑或 `src/role-guard.ts` 后必跑。
- 发布新版本前跑一次并记录宿主版本。

## 相关文件

- `agents/architect.md`、`agents/explorer.md`、`agents/reviewer.md`
- `src/index.ts`（合并语义、plans 绝对路径注入）
- `src/role-guard.ts`（局部权限求值）
- `test/crew.test.ts`（规则数组层面的单元断言）
- `docs/role-permissions-review.md`（评审结论与建议状态）
