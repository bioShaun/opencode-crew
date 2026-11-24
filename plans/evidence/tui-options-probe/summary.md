# TUI 插件 options 实测（2026-11-24，宿主 v2.4.1）

## 问题

侧栏 Delegations 的模型列显示截断 id（如 `gpt-6.…`）而不是 `modelAliases` 别名。

## 结论

宿主只把插件 options 传给 **cli.json 里配置的条目**；写在 `opencode.json` 的
`plugins[].options` 只到 server 部分，TUI 部分拿到的是 `{}`。
`src/tui/sidebar.tsx` 的 `parseCrewDisplay(context.options)` 因此在 v2.4.1 上永远是默认值。

## 证据

探针：在 `dist/tui.js` 的 `setup(context)` 第一行追加一行，把 `context.options` 追加写入文件
（探针跑完后 `dist/tui.js` 已按字节还原，sha256 与备份一致，`git status -- dist/` 只剩并发写入者
的 `dist/index.js`）。每次运行是用 `script -qec` 在 pty 里起一个真实 TUI，25 秒后超时退出。

| 场景 | 配置 | 结果 | 日志 |
|---|---|---|---|
| A | 真实 `~/.config/opencode/cli.json` 已加 crew 条目 + `opencode.json` 原条目 | `options` = 别名表（来自 cli.json） | `A-opencode-json.log` |
| B | 隔离 `XDG_CONFIG_HOME`，crew 条目只在 cli.json（含 options） | `options` = `{marker, modelAliases}` | `B-cli-json.log` |
| C | 隔离 `XDG_CONFIG_HOME`，crew 条目只在 opencode.json（含 options），cli.json 无 crew | `options` = `{}` | `C-opencode-json-only.log` |

C 是用户原始状态，A/B 是加上 cli.json 条目后的状态；三个场景 `setup` 都只被调用一次，
说明同一 id 的两处配置会去重（不会出现两份侧栏）。

旁证：同一时刻 `opencode debug agents` 显示 server 侧 options 完全生效（engineer steps=80、
reviewer steps=30），因此「options 没传」只发生在 TUI 部分。

## 临时处置（已做）

`~/.config/opencode/cli.json` 增加一条 crew 条目，只带 `modelAliases`（备份
`cli.json.bak-crew-options-20261124T120221`）。TUI 重启后模型列即可显示别名。

副作用：别名表与 `opencode.json` 里的同名表重复，需要手工保持一致。

## 正式修法（已实施）

`src/display-rpc.ts`：server 部分经 RPC 域 `opencode-crew-display` 把 `{aliases, display}` 发给 TUI，
侧栏优先用 RPC 结果、失败时回落 `context.options`；RPC 结果按不可信处理（非法别名逐条丢弃、
`display` 非法按 `inline`）。`opencode.json` 仍是唯一配置源。

真机验证（宿主 2.4.1）：
- `opencode api rpc.call --param rpcID=opencode-crew-display --param method=get` 返回别名表；
- 门禁真机测试时侧栏新代码已加载（同一轮插件重载）。

`cli.json` 的临时条目已删除（RPC 生效后它只是重复配置）；把同一包写进 `cli.json` 仍作为
宿主没有该 RPC 时的回落手段保留在文档里。

## 复现材料

- `probe-plugin/`：最小双端插件（server 记录 options、tui 记录 options）。
- `cli-json-entry.json` / `opencode-json-entry.json`：两个场景的配置片段。
- `*-screen.log`：pty 里 TUI 的原始屏幕输出（含 ANSI 转义）。
