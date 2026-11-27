# 宿主与插件版本口径

日期：2026-11-27。本文避免把三个不同“版本”混为一谈。本次只更新对照基线与已公布的宿主行为说明，不是 2.4.2 真机验收。

| 口径 | 当前值 / 例子 | 含义 |
|---|---|---|
| 插件 SDK 依赖 | `@opencode/plugin` **2.3.0**（`package.json`） | 编译和类型检查所依据的插件 API。它不等于本机正在运行的 OpenCode 宿主版本。 |
| 当前运行宿主 | 对照基线为 OpenCode **v2.4.2**（2026-11-27） | 当前开发机上实际加载插件、TUI 和 hooks 的宿主。尚未按 [`role-permissions-host-checks.md`](role-permissions-host-checks.md) 在 2.4.2 上重跑。宿主升级后必须按复核清单重跑行为检查。 |
| 历史验收宿主 | 阶段 1/2 多处私有 fixture 使用 **2.2.5** | 只证明当时那些场景在 2.2.5 上成立；不能外推为当前全部功能已在 2.2.5 或任意新版本验证。 |

## 使用规则

1. 文档写“依赖/对齐 2.3.0”时，指 `@opencode/plugin` SDK 与类型契约，不指宿主二进制。
2. 文档写“在 2.2.5 验证”时，是历史 fixture 证据；不应改写成“当前已在当前宿主验证”。
3. 在 v2.4.1 上观察到宿主不把 `plugins[].options` 转发给插件 TUI 部分，因此侧栏显示配置由 server 端 RPC（`opencode-crew-display`）或 `cli.json` fallback 提供。v2.4.2 发行说明未宣布改变，该 RPC 仍保留。不要写成已在 2.4.2 上再次观察确认。
4. 宿主升级后，把新的 `opencode --version`、相关证据和结论记录到 `docs/role-permissions-host-checks.md`；发布/回滚仍按 `docs/run-copy-release.md`。
5. 本仓库不是 OpenCode 全版本兼容矩阵；没有证据时不要声称支持某个宿主版本。
6. 向已归档会话发消息（crew 侧会触发的是 `session.prompt` / `session.synthetic`，例如 `/crew`、审查门禁提醒、`crew_task` 跟进）可能被宿主自动解档。`session.interrupt` 是否也解档，未在 2.4.2 typings / 发行说明中确认，不要写成已证实。
7. Web fetch 的 Always allow 现在只对该站点生效（旧审批不变）。architect/explorer 已是 `webfetch: * allow`，通常走不到 Always allow；Root 权限为空、继承宿主，用户若在 Root 上点 Always allow，范围会变窄。这不改变「暂不给 webfetch 加白名单」的既有决定，详见 [`role-permissions-review.md`](role-permissions-review.md)。
