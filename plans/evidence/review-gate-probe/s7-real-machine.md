# S7 真机验收（2026-11-24，宿主 v2.4.1）

## 环境

- 插件：工作区 `dist/`（本次提交 `84a935c` 的构建），经配置热重载加载，**未重启服务**。
- 开关：临时在 `~/.config/opencode/opencode.json` 的 options 加 `"reviewGate": {"mode":"remind"}`，
  验证后删除（默认 `off`）。备份 `opencode.json.bak-s7-*`。
- 载体：`/project/tmp/gate-s7`（`git init` + 一次提交），会话 `ses_df4261964ffeJb31RgvPHl2N0m`，
  `opencode run --agent root -m tcuni/gpt-6.2-sol#high`。

## 结果

1. **提醒注入成功**：模型按提示创建 `AGENTS.md` 后，Host 在回合末触发 `experimental.idle`，
   注入一条 `synthetic` 消息 `msg_20bda1a3a001kztdZEQwulBu6v`：
   - `metadata = {"crewReviewGate":{"fingerprint":"4447616cd46ccbf1","rule":["sensitivePath"]}}`
   - 正文含 `[crew-review-gate] 本轮改动命中审查门禁：`、`改动目录：/project/tmp/gate-s7（1 个文件）`、
     `命中路径：AGENTS.md`、两条处理方式。
2. **模型响应**：同一轮的后续 assistant 文本以 `Review-Skip: 本次仅新增未提交的 AGENTS.md，…` 开头。
3. **skip 生效**：继续同一会话再跑一轮（不改文件），`synthetic` 消息数仍为 1，没有重复提醒。
4. **诊断工具**：真机调用 `crew_review_gate` 时先暴露一个缺陷——返回值里有 `undefined` 字段，
   宿主报 `Tool returned a non-JSON value for its output schema: Expected JSON value`。
   已修（输出前剔除 `undefined`，补回归用例），重载后同一调用返回完整结构。

## 未覆盖

- 未在真机上验证「派 reviewer 之后不再提醒」（该分支由 S4 单测用真实 git + fake 会话覆盖）。
- `opencode run` 的 `--format json` 不输出注入消息本身，需要查 `session_message` 表确认。
- 真机日志出现 `ENOSPC: no space left on device` 的 watcher 报错（inotify 上限），与本功能无关。

## 处置

验证后已删除 `reviewGate` 配置（恢复 `off`）与 `cli.json` 里临时的 crew 别名条目；
侧栏别名改由 `opencode-crew-display` RPC 提供，重开 TUI 生效。
