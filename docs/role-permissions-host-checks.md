# 读角色权限真机回归清单

用于宿主（OpenCode）升级后复核 `agents/architect.md`、`agents/explorer.md`、`agents/reviewer.md` 的权限是否仍符合设计。单元测试只能覆盖本插件写入的规则数组，**覆盖不了宿主如何求值**；这份清单补的就是那一层。

## 语义依据（不是推断）

来自 OpenCode V2 官方 Permissions 文档：

- 规则按顺序合并，**last match wins**。
- 加载顺序：低优先级配置 → 全局规则 → **agent 规则追加在最后**。
- 无规则匹配时效果为 `ask`。
- 一次操作涉及多个资源时：任意 `deny` 即 `deny`，否则任意 `ask` 即 `ask`，否则允许。
- `external_directory` 在 `read`/`edit` 规则**之前**检查；默认策略允许外部目录，因此读角色不再自带该规则，跟随用户全局配置。

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

A3 是 `d8cd530` 那次修复的回归护栏；单元测试只断言规则不存在，真机行为要在这里复核。

## 执行方式与注意

1. 在**独立测试仓库或 worktree** 里做，不要污染真实项目 plans/。
2. A1/A2 的拒绝类断言在 headless `opencode run` 下即可：拒绝是确定性的，失败会写 stderr。
3. **A3 的 `ask` 行必须在 TUI 主会话里做**。headless 下子代理的 ask 会被 reject；级联子会话的 ask 有不上浮的已知报告（anomalyco/opencode#39112），在深层子会话里验证 ask 会得到假阴性。
4. 每个断言记录：宿主版本（`opencode --version`）、实际输出、权限提示原文、判定通过/失败。
5. 通过标准：三条断言全部符合预期。任何一条失败都视为宿主语义变化，回到 `docs/role-permissions-review.md` 重新评审，不要靠加规则把测试「修绿」。

## 何时跑

- 宿主升级（`@opencode/plugin` 或本机 opencode 版本变化）后必跑。
- 修改 `agents/*.md` 权限段或 `src/index.ts` 合并逻辑后必跑。
- 发布新版本前跑一次并记录宿主版本。

## 相关文件

- `agents/architect.md`、`agents/explorer.md`、`agents/reviewer.md`
- `src/index.ts`（合并语义、plans 绝对路径注入）
- `test/crew.test.ts`（规则数组层面的单元断言）
- `docs/role-permissions-review.md`（评审结论与建议状态）
