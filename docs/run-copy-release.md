# 运行副本与发布手册

2026-11-25 起，本机当前运行方式已切到 GitHub 固定 commit 安装（证据：`plans/evidence/github-install-switch-2026-11-25.md`）。
本文保留为运行副本备用/回滚手册；只有 `plugins[0].package` 重新指向 `/project/glx/scripts/opencode-crew-live` 时，文中的“当前运行副本”描述才适用。宿主 OpenCode V2.4.1。

## 为什么要把运行副本和开发目录分开

- 宿主会在插件目录文件变化时重载；开发目录里改一个 `agents/*.md` 草稿或重编译 `dist`，
  都会直接进入正在使用的环境。
- 插件加载失败（例如 options 非法）会让五个 Crew 角色一起消失，正在跑的子代理报 `Agent not found`。
- 运行副本固定在「已 push 且 CI 通过」的提交上，开发目录可以随意改。

## 一次性搭建

```bash
DEV=/project/glx/scripts/opencode-crew
L=/project/glx/scripts/opencode-crew-live

git clone --branch main git@github.com:bioShaun/opencode-crew.git "$L"
git -C "$L" config pull.ff only          # 只允许 fast-forward
git -C "$L" remote set-url --push origin no_push   # 禁止从运行副本推送

cd "$L" && bun install --frozen-lockfile  # dist 是打好的，但 @opencode/plugin 等仍是外部依赖
```

改配置（只改一个字符串，不要用 `opencode plugin add`，它会追加第二项）：

```bash
cp -p ~/.config/opencode/opencode.json ~/.config/opencode/opencode.json.bak-live-switch-$(date +%Y%m%dT%H%M%S)
# 把 "package": ".../opencode-crew" 改成 ".../opencode-crew-live"
grep -n "opencode-crew" ~/.config/opencode/{opencode.json,cli.json,tui.jsonc}   # 必须只剩一处
```

同一宿主上**不要**同时配置开发目录和运行副本；需要试新 `dist` 或新提示词时，用隔离宿主
（独立 `HOME`/XDG + `--standalone`），不要改共享配置。

## 发布

```bash
# 1) 开发目录：测试与构建
cd "$DEV" && bun run typecheck && bun test
bun run compile
rm -rf build-check && CREW_BUILD_OUTDIR=build-check bun run compile && diff -r dist build-check   # CI 同款
# 2) 提交与推送（需用户同意）
git add -A && git commit && git push origin main

# 3) 运行副本：前置检查
git -C "$L" status --porcelain          # 必须为空
git -C "$L" symbolic-ref -q HEAD        # 必须是 refs/heads/main（detached 表示处于回滚态）
#    且当前没有活跃 crew_task、侧栏没有运行中的子代理（重载会中断它们）
git -C "$L" fetch origin
git -C "$L" log --oneline HEAD..origin/main        # 确认要上线的提交
git -C "$L" diff --name-only HEAD origin/main -- package.json bun.lock   # 非空则下一步要重装

echo "$(date -Is) from=$(git -C "$L" rev-parse HEAD) to=$(git -C "$L" rev-parse origin/main) note=<说明>" >> "$L/.git/crew-release.log"
git -C "$L" merge --ff-only origin/main            # 失败就停，不要 reset --hard

# 4) 依赖有变化时（在重载之前）
cd "$L" && bun install --frozen-lockfile

# 5) 重载：TUI 里执行 /reload
```

要点：

- `dist/` 已提交，运行副本**不构建**；CI 用 `diff -r dist build-check` 保证提交的 `dist` 与源码一致。
- **只改 `agents/*.md` 也必须 `/reload`**：`agent.reload()` 不会重跑插件 `setup`，提示词只在插件整体重载时重读。
- `dist/tui.js` 有变化时，侧栏要关闭并重开 TUI 才生效。
- 不要只依赖「文件变化自动重载」：本机 inotify 曾报 `ENOSPC`（监听上限耗尽），文件监视可能不可靠。

## 回滚

```bash
# 快回滚：回到上一提交
PREV=$(tail -1 "$L/.git/crew-release.log" | sed -E 's/.*from=([0-9a-f]{40}).*/\1/')
git -C "$L" checkout --detach "$PREV"
# package.json / bun.lock 有差异时再执行 bun install --frozen-lockfile
# 然后 /reload（改过 tui.js 则重开 TUI）

# 恢复正常发布
git -C "$L" checkout main && git -C "$L" merge --ff-only origin/main
```

兜底（运行副本本身坏了，或要立刻回到开发目录）：

```bash
sed -i 's#"package": "/project/glx/scripts/opencode-crew-live"#"package": "/project/glx/scripts/opencode-crew"#' \
  ~/.config/opencode/opencode.json
```

回指前先确认开发目录的 `dist/` 和 `agents/` 是你愿意运行的版本（工作区草稿会立刻生效）。

## 切换/发布后的验收

| 检查 | 方法 | 成功标准 |
|---|---|---|
| 插件来源唯一 | `grep -n "opencode-crew" ~/.config/opencode/{opencode.json,cli.json,tui.jsonc}` | 只有一处，指向运行副本 |
| 实际加载了哪个目录 | 日志 `loading plugin ... entrypoint=file:///.../dist/index.js` | 路径是运行副本 |
| 五个角色 | `opencode debug agents` | root/architect/engineer/explorer/reviewer 都在 |
| 能跑 | `opencode run -m <低价值模型> "只回复 ok"` | 正常返回 |
| 侧栏别名（display RPC） | 打开会话页看模型列 | 显示别名（如 `sol`/`luna`），不是截断 id |
| 配置档 | `/crew-profile` 或侧栏 footer | 仍是原来的档（本机 `default`） |
| 门禁状态 | Root 工具列表 / `crew_review_gate` | 与 `reviewGate.mode` 一致（默认 `off` 时没有该工具） |

## 账本与提示词

- `crew_task` 账本位于**会话所在仓库**的 `.git/opencode-crew-stage1`，与插件从哪个目录加载无关；
  切到运行副本不需要迁移。前提是不要在运行副本目录里开会话。
- 切到运行副本后，`agents/*.md` 的生效版本是运行副本 checkout 的版本。开发目录里改了未提交的提示词
  不会进入运行环境——这消除了「草稿随重载悄悄生效」的风险，代价是调提示词要走完整发布流程。
