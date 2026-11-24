# R4 真机：§11 派发限制（隔离宿主，2026-11-24）

## 目的

`plans/handoff-2026-11-24.md` 与 `docs/role-permissions-host-checks.md` 里 §11 只剩真机端到端未做：
非 Root 主代理派 `engineer` 是否被拒、Root 派是否正常。R0 探针此前只捕获了权限事件（且任务本身没跑通）。

## 环境

- 隔离宿主：私有 `HOME`/`XDG_*`，`opencode serve --hostname 127.0.0.1 --port 49582`，
  CLI 用 `--server` + `OPENCODE_SERVER_PASSWORD`。
- 插件：运行副本（`/project/glx/scripts/opencode-crew-live`）。
- options：五个角色 `tcuni/gpt-6-luna#low`，`reviewGate` 未配置（`off`），避免门禁干扰。
- 载体：`/project/tmp/r4-check/repo`（`git init` + 一次提交）。

## 结果

| 场景 | 工具 | 结果 |
|---|---|---|
| `--agent build` 调 `subagent`（agent=engineer） | `subagent` | **deny**：`{"error":{"type":"permission.rejected","message":"Crew：engineer 只能由 Root 派发（调用者：build）。请用 /crew 切到 Root，或改派 explorer / architect / reviewer。"}}` |
| `--agent root` 调 `subagent`（agent=engineer） | `subagent` | 成功，返回子会话 `ses_df3d65943ffe…`（后台运行） |

补充观察：同一个 build 会话第一次尝试的是 `crew_task_start`，收到 `INVALID_INPUT`（参数不合法）——
说明 `crew_task_*` 工具对所有主代理可见，但执行层由 `src/tasks.ts` 的 `caller()` 只认 Root；
本次没有构造合法参数去触发 `FORBIDDEN_CALLER`，该分支仍由单测覆盖。

## 结论

- §11 的两种方向在真机上成立：非 Root 派 engineer 被拒且错误信息可读，Root 派发正常。
- 隔离服务器已停止，临时目录已删除。
