# S8 真机：`enforce` 与 reviewer 覆盖（隔离宿主，2026-11-24）

## 目的

门禁升级到 `enforce` 前，验证两个真机未覆盖的分支：
E1 同一 fingerprint 是否按 `maxReminders` 重复注入；E2 reviewer 覆盖后是否停止。

## 环境

- 隔离宿主：私有 `HOME`/`XDG_*`，`opencode serve --hostname 127.0.0.1 --port 49581`，
  CLI 用 `--server http://127.0.0.1:49581` + `OPENCODE_SERVER_PASSWORD`。
- 插件指向运行副本 `/project/glx/scripts/opencode-crew-live`（HEAD `20343b4`）。
- options：五个角色统一 `tcuni/gpt-6-luna#low`（没有配置档，options 直接生效），
  `reviewGate: {mode:"enforce", maxReminders:2, sensitiveGlobs:["**/AGENTS.md"]}`。
- 载体：`/project/tmp/gate-enforce/repo`、`repo2`（各自 `git init` + 一次提交），提示词要求创建 `AGENTS.md`。

## 结果

| 会话 | 提醒条数 | 模型行为 | 有没有写 `Review-Skip` |
|---|---|---|---|
| `ses_df3f19976ffe…`（E1 第一次） | 1 | 收到提醒后**派了 reviewer** | 没有 |
| `ses_df3f09685ffe…`（E1 第二次，措辞更硬） | 1 | 仍然**派了 reviewer** | 没有 |

两次都在 reviewer 结束后进入 idle，且 `reminders(1) < maxReminders(2)`；若无覆盖，按 `enforce` 规则应当再注入一次。
实际没有第二条 `crewReviewGate` 消息，因此 **E2（reviewer 覆盖后停止）在真机上成立**。

**E1（重复注入）没有在真机上观察到**：两次都因为模型按提醒文本自行派了 reviewer，改动被覆盖后 ack，
走不到「无人理会 → 重发」的分支。这属于「模型配合时的正常路径」，不是缺陷；重复注入目前只有单测覆盖
（`test/review-gate-host.test.ts` 的 `enforce limits each fingerprint independently` 等用例，用 fake 会话驱动）。

## 结论

- 真机已确认：提醒文本足以让 Root 派 reviewer（这正是期望行为）；reviewer 完成后提醒停止。
- `enforce` 的重复注入仍缺真机证据。要拿到它，需要构造「Root 收到提醒后既不派 reviewer 也不写 skip」的会话，
  而当前模型会主动派 reviewer，无法用提示词稳定制造；建议保持 `remind`，不为该分支冒险。
- 隔离宿主已停止，临时目录已删除。
