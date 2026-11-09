# Crew 配置档（profiles）

配置档是用户级、可手改、可 `git diff` 的「模型组合」开关：一个 JSON 文件整体替换 Crew 五个角色的 `models`、`steps` 与 `engineerInstructions`，因此不需要读写 `opencode.json(c)`，也不会碰 provider、其他 agent 或其他插件。本文是细节文档；概览见 `README.md` 的 *Crew profiles* 一节。

## 1. 边界

配置档**只**影响三个字段：

| 字段 | 生效方式 |
|---|---|
| `models.<role>` | 覆盖；缺省 = 宿主原生继承（子代理跟随父会话模型，Root 保留会话已选模型） |
| `steps.<role>` | 覆盖；缺省 = `agents/<role>.md` frontmatter 的值 |
| `engineerInstructions` | 覆盖 engineer 的 `## 项目补充规则` 段；缺省 = `[]`（该段不出现） |

不覆盖：`description`、`mode`、`permissions`、角色正文（仍只来自 `agents/*.md`）、provider 定义、顶层 `model`、`default_agent`、其他插件。模型族附录（GPT / Claude）由最终生效的 `models.<role>` 推导，档里**不需要也不允许**写提示词。

替换是**整档**语义，不是对 `opencode.json` 的 patch：档里没有的字段就是空的。唯一容易意外的点：档生效时，插件 options 里的 `engineerInstructions` **不会**叠加到 engineer 的 system。

## 2. 目录与来源

| 顺序 | 条件 | 目录 | 来源标签 |
|---|---|---|---|
| 1 | `OPENCODE_CREW_PROFILES_DIR` 非空 | 只用该目录，不回退 | `user` |
| 2 | `OPENCODE_CREW_PROFILES_DIR=""` | 完全没有档目录（显式关闭，测试也用它隔离） | — |
| 3 | 变量未设置 | `${XDG_CONFIG_HOME:-~/.config}/opencode/crew-profiles` | `user` |

目录不存在等于空集合：插件不创建、不报错。只有「切档时写指针」才会按需创建目录（`0o700`）。MVP 只有一个用户级目录，因此所有项目、所有 TUI 实例共享同一份选择；项目级档与包内示例档属于第二阶段。

## 3. 档文件格式

路径 `<dir>/<name>.json`，文件名主干即档名。

```json
{
  "models": {
    "root": "provider/model#high",
    "architect": "provider/model",
    "engineer": "provider/model#medium",
    "explorer": "provider/model",
    "reviewer": "provider/model#high"
  },
  "steps": { "engineer": 40, "reviewer": 20 },
  "engineerInstructions": [
    "临时文件与中间产物留在项目内，禁止使用 /tmp，包括子进程。"
  ]
}
```

- 三个字段都是可选的，`{}` 是合法档（效果 = 全部回落 Markdown / 宿主默认）。
- 只支持 `models` / `steps` / `engineerInstructions`；出现未知 key 直接判非法（与 options 校验同一条规则）。
- 只读同目录下的 `*.json`（扩展名大小写不敏感），跳过 `.` 开头的隐藏文件与临时文件；其他扩展名忽略。
- 单档损坏只影响该档：错误进入 `list` 的「错误」列表，其他档照常可用，插件照常加载。
- 单个档读入后超过 1MB 判为非法，错误消息给出实际字符数。
- 插件只 `JSON.parse`，从不 `import` / `require` / `eval` 档内容，也从不改写、不 chmod 档文件。

档名规则：`^(?!\.)(?=.*[a-z0-9])[a-z0-9._-]{1,64}$` —— 只允许小写字母、数字、`.`、`_`、`-`，至少含一个字母或数字，不能以 `.` 开头。档名永不含路径分隔符，因此 `join(dir, name + ".json")` 不可能逃出档目录（这也是路径穿越防线）。

保留名：`off` / `none` / `list` / `ls` / `help` 被命令占用。MVP 只读不写档，所以即使存在 `off.json` 也只是无法用 `/crew-profile off` 直达（`list` 仍会显示它）。

## 4. active 指针

- 路径 `<dir>/active`，无扩展名，因此不会被误认为档文件。
- 内容为单行档名，允许结尾一个 `\n`；`fast\n` 与 `fast` 等价。
- 文件不存在 = off，这是默认状态，插件**绝不**主动创建。
- 内容为空或纯空白 = off（便于 `: > active` 或编辑器清空）。
- 内容非法（含路径分隔符、超长、字符不在白名单）→ **不尝试读取该路径**，回退 options 配置并报 `active 指针内容非法`。
- 写入方式：同目录唯一临时文件（`.${name}.<pid>.<时间戳>.<随机>.tmp`，`flag: "wx"`、`0600`）→ `renameSync` 覆盖；`off` = 删除文件（`ENOENT` 视为成功）。临时文件以 `.` 开头，加载器天然跳过；即使进程崩溃留下陈旧临时文件，唯一后缀也保证下一次写入不会被阻塞。
- 权限：目录 `0o700`，指针与临时文件 `0600`。用户已有的档文件权限保持不变。

为什么不用宿主 KV storage：文件可 `cat`、可 `echo fast > active`、可脚本化、可 diff，`off` 就是删文件；代价是指针与档文件不构成事务（档被删后指针残留），该风险由下面的回退表吸收。

## 5. 生效时机

| 消费点 | 何时看到新档 |
|---|---|
| `/crew` 的 Root 模型 | 下一条 `/crew`（`execute` 内实时读盘） |
| `crew_task_start` 的 engineer 模型 | 下一次 `crew_task_start`（getter 实时读盘） |
| 五个 agent 的 system / steps / model | 切换触发的 `agent.reload()` 之后；若宿主重载失败，则下一次宿主重载后 |
| 已在运行的 engineer 会话 | 不变（模型与会话绑定，只影响后续请求与新会话） |
| 侧栏 footer | 切换后立即；外部手改最多 60 秒内校准 |

外部手改档文件或指针不需要重启进程：任何一次 `config()` 调用（transform、`/crew`、`crew_task_start`、RPC 的 `list`）都会重新读盘。实现上**没有内存缓存**，磁盘指针是唯一真相，因此同机多实例天然对齐；差异只在于未执行切换的实例需要等宿主重载才会更新 agent 定义。手改档文件本身不会触发 `agent.reload()`；若要让五个角色的 system / steps 立即更新，请执行宿主 `/reload`，或切换到另一个档再切回。

## 6. 命令

只在 TUI 侧注册 `/crew-profile`。不在 server 侧注册同名命令的原因：`CommandDefinition.execute` 只有 `{sessionID, prompt, delivery}`，没有任何 UI 输出通道，切换成功、档损坏、档名拼错都会静默；而 TUI slash 与 server command 同名时的宿主合并规则无法在本仓库门禁中验证。非 TUI 场景（如 `opencode run`）直接用文件就是 API：`echo fast > "$OPENCODE_CREW_PROFILES_DIR/active"`。

| 命令 | 行为 |
|---|---|
| `/crew-profile` | 打开选择面板，`●` 标出当前档，末项固定为「关闭档位（回到 opencode.json）」；`Enter` 切换、`Esc` 取消 |
| `/crew-profile <name>` | 直接切换，成功 toast 写明「新会话/下一次请求生效」，不二次确认 |
| `/crew-profile list` | alert 列出档目录（含来源与存在性）、每个档的三个字段摘要、当前档、逐档错误 |
| `/crew-profile off` | 删除指针，回到 options 配置 |
| `/crew-profile help` / `-h` / `--help` | 用法 |

TUI 不读文件系统：档目录在 server 机器上，attached 客户端可能不同机。所有读写都走独立 RPC definition `opencode-crew-profiles`（`list` / `switch` / `off`），与只读的 `crew-tasks` 契约分开，因为是写操作。

## 7. 错误码

`switch` / `off` 一律返回结构化结果，从不抛给 RPC 层。

| code | 含义 | 磁盘 | 内存与 agent | 建议 |
|---|---|---|---|---|
| `INVALID_NAME` | 档名不合法 | 不变 | 不变 | 用 `list` 看可用档名 |
| `NOT_FOUND` | 档不存在 | 不变 | 不变 | message 里带可用档名 |
| `INVALID_PROFILE` | 档校验失败 | 不变 | 不变 | message 带字段路径，例如 `档 "fast" 的 models.root 必须为 provider/model[#variant]` |
| `WRITE_FAILED` | 写/删指针失败（EACCES、ENOSPC 等） | 不变（临时文件已清理） | 不变 | 检查目录权限；内存与 agent 定义未改变 |
| `APPLY_FAILED` | 指针已写入，但复核不一致 | 已改 | 不变 | 人工检查 `active` 与档目录 |
| `HOST_ERROR` | RPC 层内部异常（不转发宿主异常正文） | 不变 | 不变 | 看 OpenCode 日志 |

`off` 的「是否有变化」判定依据是**指针文件是否存在**，而不是解析出来的档名：空内容、纯空白、非法内容都算「存在」，必须显式清掉；只有文件根本不存在才返回 `changed:false` 且不触发 `agent.reload()`。

## 8. 回退表（启动期）

| 情况 | 插件加载 | 生效配置 | footer |
|---|---|---|---|
| 未设置目录 / 目录为空字符串 | 正常 | options | 不渲染 |
| 目录不存在，或存在但没有 `active` | 正常 | options | 不渲染 |
| `active` 为空或纯空白 | 正常 | options | 不渲染 |
| `active` 指向不存在的档 | 正常 | options | `profile: off ⚠` |
| `active` 指向损坏档 | 正常 | options | `profile: off ⚠` |
| `active` 内容非法（穿越 / 超长 / 非法字符） | 正常 | options | `profile: off ⚠` |
| `active` 或档目录不可读（EACCES） | 正常 | options | `profile: off ⚠` |
| 非 active 档损坏 | 正常 | 视 active 而定 | 不变（仅 `list` 里逐条告警） |
| `options` 本身非法 | **启动失败**（保持现状） | — | — |

`options` 非法仍然硬失败是刻意的：档是可选覆盖层，不是修复配置错误的逃生门，放松它会让拼错模型的用户静默跑到默认模型上。任何回退都必须在 `list` 与 footer 里有一条可读原因，不允许静默回退。

## 9. 与 `agent.reload()` 的交互

切换成功后会调用 `ctx.agent.reload()`，让五个角色的 system / steps / model 立即跟随。这带来两个后果：

1. `agent.transform` 会**重复执行**。角色名、description、mode、system、steps、model 都是赋值，天然幂等；engineer 的权限是「保留宿主规则 + 追加 Markdown 规则」，因此追加前按 `(action, resource, effect)` 查重，避免 `subagent` / `question` / `execute` 的 deny 规则随每次重载累积。architect 追加的绝对 `plans/**` 规则同样先查重再 push。
2. 重载可能影响其他插件注册的 agent transform：切换不是 Crew 私有操作，真机上应观察副作用。

重载失败（或宿主未提供 `agent.reload`）时，切换仍然成功，返回 `warnings: ["配置已切换，但宿主 agent 重载失败；将在下次宿主动作后生效"]`，TUI 以 warning toast 展示。

## 10. 安全

- 档名白名单，且 RPC 入参在服务端再校验一次（防止直传穿越或超长名）。
- 只读 `OPENCODE_CREW_PROFILES_DIR` 与 `XDG_CONFIG_HOME`；不读 `.env`、不读凭据文件。
- 错误消息只含档名、目录、字段路径，不含文件全文与宿主异常正文。
- 读档允许跟随 symlink（便于把档放在 dotfiles 里）；写指针用 `rename`，替换 symlink 本身而非穿透写入。
- 不做跨进程锁：两次并发 `switch` 各自「读 → 写 → 复核」，最坏结果是后者覆盖前者，两者都返回自己复核到的状态；原子 `rename` 保证不会出现半行文件。

## 11. 测试与真机验收

自动化门禁：`bun test`（新增 `test/profiles.test.ts`、`test/profile-state.test.ts`、`test/profile-rpc.test.ts`、`test/tui-profile.test.ts`、`test/tui-profile-actions.test.ts`，并在 `crew` / `tasks-*` 用例中追加档相关场景），以及 `bun run build`。整套测试通过 `test/setup.ts` + `bunfig.toml` 的 `[test] preload` 把 `OPENCODE_CREW_PROFILES_DIR` 默认置空，避免开发者本机 active 档影响结果；显式传 `OPENCODE_CREW_PROFILES_DIR=/tmp/x bun test` 可跑真实目录。

本仓库测试覆盖不到、需要真机确认的项：

1. `ctx.agent.reload()` 是否真的重跑 `agent.transform`（若不重跑，只有 `/crew` 与 `crew_task_start` 会立刻生效，system/steps 要等宿主自然重载）。
2. `keymap.layer({ slash })` 是否让 `/crew-profile` 出现在 prompt slash 与命令面板。
3. `sidebar.footer` 的实际渲染位置与「无档时零占用」的视觉结果。
4. `-rw------- active` 与 `drwx------` 档目录的实际权限。

## 12. 第二阶段（本次未做）

- `/crew-profile new` / `edit` 向导（`ui.dialog.prompt` 取档名，逐角色选模型），需要先定「档文件写入也走 0600 + 备份」的细节。
- 模型候选列表接入向导（用宿主 `model.list`，不硬编码 provider 名）。
- `/crew-profile delete <name>`（删除前备份并保留若干份）。
- 包内示例档与同名覆盖（需要 `package.json` 的 `files` 增加 `profiles`）。
- 项目级档目录（`<cwd>/.opencode/crew-profiles/`，项目档优先）。
- footer 可点击打开面板。
- 若 profiling 显示热点，再引入 `mtime + size` 指纹缓存（接口不变）。
