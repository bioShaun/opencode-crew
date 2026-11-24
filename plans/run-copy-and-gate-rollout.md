# 运行副本、审查门禁上线与收尾方案

状态：**ready / context-only**。日期：2026-11-24。基线：HEAD `20343b4` = `origin/main`。

依据（已读）：`src/index.ts`（`setup`、`loadRole`）、`src/config.ts`（`defaultReviewGate`、`parseReviewGate`、`reviewGlobs`、`parseCrewOptions`）、`src/review-gate.ts`（`evaluateGate`）、`src/review-gate-host.ts`（`registerReviewGate`）、`src/review-gate-git.ts`（`collectNativeChanges`）、`src/display-rpc.ts`、`src/tasks-registry.ts`（`inspectProject`）、`src/tasks-ledger.ts`、`src/tasks.ts`、`scripts/build.ts`、`package.json`、`.github/workflows/ci.yml`、`.gitignore`、两份 README、`plans/handoff-2026-11-24.md`、`plans/review-gate-spec.md`、`plans/evidence/review-gate-probe/{s7-real-machine,summary}.md`，以及本机 `~/.config/opencode/{opencode.json,cli.json,tui.jsonc}`（只读）。仓库无 AGENTS.md，只适用全局指令。

本文只给方案，不改代码、不改配置、不做 git 写操作。所有「执行」都由 Root 另开 Assignment 交给 engineer，并按全局规则：禁用 `/tmp`（用 `/project/tmp/`）、重活走 `slot`、提交/推送需用户同意。

---

## 0. 结论速览

| 项 | 决定 |
|---|---|
| A 运行副本形式 | `git clone`（来源 `origin`），目录 `/project/glx/scripts/opencode-crew-live`，本地分支 `main`，只 fast-forward，禁推送 |
| A 依赖 | 默认在 live 执行 `bun install --frozen-lockfile`（与开发目录已验证的环境一致）；「宿主自己能解析」目前**无证据**，不作为前提；附可选验证 |
| A 配置 | 只改 `~/.config/opencode/opencode.json` 里 `plugins[0].package` 一个字符串；备份 + 原地替换，不用 `opencode plugin add` |
| A 发布 | dev: compile→commit→push→CI 绿；live: `fetch` + `merge --ff-only` →（依赖文件变了才重装）→ **显式 `/reload`**；live 不 build |
| A 回滚 | live `git checkout --detach <上一提交>` + `/reload`；兜底 `sed` 把 `package` 改回开发目录 |
| A 账本 | **不需要迁移**：账本在会话所在项目的 `.git/opencode-crew-stage1`，与插件目录无关（见 3.7） |
| B 门禁 | 先 `remind`，观察 ≥7 天且 ≥10 次提醒；`sensitiveGlobs` 覆盖为 `["**/AGENTS.md","agents/**","**/role-guard.*"]`；其余沿用默认 |
| C 文档 | 原地改写 handoff 为「已完成 + 剩余」；两份根目录原型 html 移出仓库；README 在「本地目录 / 离线分发」后补短节并修正 `planMultiFile` 的反向描述 |

---

## 1. 背景与边界

### 1.1 已核实的事实（本方案依赖）

1. 插件入口 `export default Plugin.define({ id: "opencode-crew", async setup(ctx) {...} })`。`loadRole` 在 `setup` 里一次性 `readFileSync(new URL("../agents/<id>.md", import.meta.url))`。`agent.reload()` 只重跑 `ctx.agent.transform`，**不重跑 `setup`**，所以 `agents/*.md` 只在插件整体重载时重读。
2. `dist/index.js` 以 `external: ["@opencode/plugin"]` 构建，运行时有一行 `import { Plugin } from "@opencode/plugin"`；`yaml` 已打进 bundle。`dist/tui.js` 外部依赖 `@opencode/plugin`、`solid-js`、`@opentui/core`、`@opentui/solid`、`@opencode/theme`（`scripts/build.ts`）。
3. 账本路径：`Ledger` 目录 = `join(commonDir, "opencode-crew-stage1")`（`src/tasks-ledger.ts`）；`commonDir` 来自 `inspectProject(ctx.location.directory)`（`src/tasks.ts`、`src/tasks-snapshot.ts`）。`ctx.location.directory` 是**会话所在项目目录**，不是插件目录。
4. 门禁观察对象同样是 `ctx.location.directory`（`src/review-gate-host.ts` 的 `collectNativeChanges(dir, ...)`、`collectTasks`），用 `git status --porcelain=v1 --untracked-files=all`，受 3 秒/1 MB 上限，超限或非 git 目录返回 `unavailable`（静默放行）。
5. 插件 options 是**全局**的：没有按项目覆盖的机制。门禁一旦开启，所有 git 项目里的 Root 会话都会被评估（包括 `/data_0/project/glx/<编号>/` 下的分析项目，若它们是 git 仓库）。
6. `reviewGlobs`（`src/config.ts`）对数组类选项是**整体替换**默认值，不是合并。覆盖 `sensitiveGlobs` 时必须把默认的 `**/AGENTS.md` 再写一遍。
7. `evaluateGate`：`ignoreGlobs` 只影响 `fileCount` 与 `planMultiFile` 的计数；`sensitivePath`、`deletedTest` 看全部路径。`planMultiFile` 的条件是「任务文本引用了 `plans/*.md` **且**改动文件数 ≥ `planMinFiles`」。
8. `enforce` 不是硬阻断，只是 idle 时对同一 fingerprint 最多重发 `maxReminders` 次后放行（`registerReviewGate`）。`remind` 每个 fingerprint 只发一次，会话总量上限 `5 × maxReminders`。
9. `mode === "off"` 时 `registerReviewGate` 直接返回：无 hook、无 `crew_review_gate` 工具。
10. `parseReviewGate`/`parseCrewOptions` 遇到非法值会 `fail(...)` 抛错，在 `setup` 里发生 → **插件加载失败 → 五个角色消失**。任何 options 编辑都要先离线校验。
11. 主工作区任何未跟踪文件都会令 `crew_task_start` 以 `DIRTY_PRIMARY` 拒绝（`src/tasks-registry.ts` 的 `status --porcelain=v1 --untracked-files=all`）。
12. `cli.json` 的 `plugins` 只有 `./herdr-opencode`，没有 Crew 条目；Crew 的 TUI 入口（`exports["./tui"]`）与 server 入口由同一个 `opencode.json` 的 `plugins[0]` 引出。切换只需改一处。
13. 宿主日志出现过 inotify `ENOSPC`（S7 记录）：**文件监视可能不可靠**，发布时不能只靠「dist 变化自动重载」。
14. 宿主 SQLite 在 `~/.local/share/opencode/opencode.db`，表 `session_message`（列 `id,type,seq,data,session_id`，S7 与 `plans/evidence/worktree-stage1/` 的核验脚本都用过）。

### 1.2 本方案发现的需要订正的点

- **README 两份对 `planMultiFile` 的描述方向相反**：README.md 写 “changes several files without a `plans/*.md` reference”，README.zh-CN.md 写 “多文件改动但没有 `plans/*.md` 引用”；代码与 `plans/review-gate-spec.md` 均是「**有** plans 引用且 ≥ planMinFiles 个文件才命中」。需在 C 里一并改正。
- handoff 待办 5（GitHub 安装失败）已过时：`package.json` 现已刻意避开 npm 生命周期脚本名（README 与 `ci.yml` 注释都有说明），GitHub 安装已在隔离环境验证。
- 任务描述里「live 是另一个 clone，开发目录里的任务历史不会出现在 live」的前提不成立，见 3.7。

### 1.3 边界

- 不改插件对外接口、不新增依赖、不改 `src/`、`agents/`、`dist/`。
- 不改变 `~/.config/opencode/crew-profiles/`（与插件目录无关）。
- 本方案不决定是否提交/推送；涉及 `git commit`/`push` 的步骤均标注「需用户同意」。

---

## 2. 已决定事项（含本方案的取舍理由）

1. **clone 而非 worktree**
   - worktree 会出现在开发仓库的 `git worktree list`，而 `crew_task` 的 `inspectProject`/`validateWorktree` 读取的就是这份列表（`records()`）；多出一个常驻的 detached worktree 属于未测试情形。
   - worktree 与开发目录共享对象库和 `.git` 配置，`git gc`、分支操作、`git clean` 误操作都能影响运行副本；也不强制「先 push、CI 绿」才能上线，会让未验证的提交跑进运行环境。
   - clone 直接从 `origin` 取，天然满足「只运行已 push 且 CI 通过的提交」。
2. **不采用 `github:bioShaun/opencode-crew#<commit>` 作为运行方式**：已验证可安装，但本机从未用它加载过，缓存目录与重载语义由宿主管理，回滚需改配置；用户要的是「运行副本」，本方案不选，保留为备选。
3. **live 不 build**：`dist/index.js`、`dist/tui.js` 已提交，且 CI 的 `rm -rf build-check && CREW_BUILD_OUTDIR=build-check bun run compile && diff -r dist build-check` 保证其与源码一致。live 只 checkout 已提交的 `dist`。
4. **live 不开会话**：任何会话的 cwd 不能是 live（否则账本、门禁、`plans/` 权限都会落到 live 上）。live 只被插件加载器读取。
5. **门禁先 `remind`**，`enforce` 只在有证据时升级（见 4.1）。
6. **两件事不同时改**：A 验收通过并稳定 ≥1 个工作日后再做 B，避免两次插件重载叠加导致无法归因。

---

## 3. A. 运行副本

### 3.1 目录、分支与提交策略

- 路径：`/project/glx/scripts/opencode-crew-live`（与现有 `/project/glx/scripts/opencode-crew` 并列；`/project/glx/scripts/worktrees/` 是 worktree 用的，不放这里）。
- 来源：`git@github.com:bioShaun/opencode-crew.git`（`package.json` 的 `repository` 为 https 地址，二者等价；本机既有 remote 用 ssh，保持一致）。**需验证**本机能访问：`git ls-remote git@github.com:bioShaun/opencode-crew.git HEAD`。不通时回退：先 `git clone` 本地开发目录，再 `git remote set-url origin git@github.com:bioShaun/opencode-crew.git`，但此时首次 `fetch` 仍需要网络。
- 分支：本地 `main` 跟踪 `origin/main`；**只允许 fast-forward**；live 内不提交、不改文件。
- 防误操作：`git config pull.ff only`；`git remote set-url --push origin no_push`（禁止从 live 推送）。
- 回滚态：`HEAD` 处于 detached（见 3.6）。此时 `git pull` 会直接报错，防止回滚后被下一次例行 pull 悄悄拉回新版本。
- 发布记录：每次改动 live 前向 `live/.git/crew-release.log` 追加一行（在 `.git` 内，不影响 `status`），格式 `<ISO时间> from=<sha> to=<sha> note=<说明>`，回滚时从这里取上一提交。

### 3.2 依赖：是否需要 `bun install`

- **没有证据**表明宿主能在没有 `node_modules` 的目录里解析 `@opencode/plugin`：
  - 开发目录一直带着 `node_modules`（`@opencode/plugin` 2.3.0 及 devDependencies 的 `@opentui/solid`、`solid-js`、`@opencode/theme`），当前能工作不能说明宿主自带这些包。
  - GitHub 安装的隔离验证里，宿主在安装目录里装了 `dependencies`（所以 server 入口能 import），并且 TUI 入口明确需要宿主提供 `@opentui/solid`；这同样不能证明「裸目录可解析」。
  - README 写「运行仍依赖宿主 OpenCode V2 的插件 SDK」，语义含糊。
- 判断：默认让 live 与开发目录**同样带完整 `node_modules`**：`bun install --frozen-lockfile`（装 `dependencies` + `devDependencies`，与 `bun.lock` 逐版本一致）。这样 live 的解析环境就是已知可工作的那一个，不引入「宿主是否自带」这个未验证变量。代价：占磁盘；`package.json`/`bun.lock` 变化时发布流程里要补一次安装（3.4 已写）。
- 注意：`bun --no-install` 才能避免 bun 在缺 `node_modules` 时自动安装到全局缓存造成误判（见 A3 的验证命令）。
- 可选的「瘦身」验证（只在用户想去掉 live 的 `node_modules` 时做）：另起一个无 `node_modules` 的临时 clone（`/project/tmp/crew-noinstall-probe`），按 `plans/evidence/review-gate-probe/summary.md` 的隔离做法（隔离 HOME/四个 XDG/TMPDIR、`--standalone`、插件配置为目录）让宿主加载它，看五个角色与 TUI 入口是否正常。通过前不得删除 live 的 `node_modules`。

### 3.3 `opencode.json` 修改与备份

- 只改一个值：`plugins[0].package` 从 `"/project/glx/scripts/opencode-crew"` 改为 `"/project/glx/scripts/opencode-crew-live"`。`options`（`models`/`steps`/`modelAliases`）原样不动。
- 备份命名沿用本机习惯：`~/.config/opencode/opencode.json.bak-live-switch-<YYYYMMDDTHHMMSS>`，用 `cp -p`。
- 修改方式：用精确匹配的字符串替换（旧值带结尾引号 `"package": "/project/glx/scripts/opencode-crew"` 在文件中唯一），**不用** `opencode plugin add`（它会追加第二项）。
- 「两份副本同时注册同一个插件 id」的避免：
  1. 只替换、不追加；`plugins` 数组里保持恰好一项 `opencode-crew`。
  2. 修改后用 `grep -n "opencode-crew" ~/.config/opencode/opencode.json ~/.config/opencode/cli.json ~/.config/opencode/tui.jsonc` 核对：只出现一处，且是 `-live` 路径。
  3. 同一台宿主上不得同时配置开发目录和 live（包括临时调试时往 `cli.json` 加 Crew 条目——S7 就这么做过一次，用完已删）。需要在开发目录里验证新提示词/新 dist 时，用**隔离宿主**（独立 HOME/XDG，`--standalone`），不是改共享配置。
- 改动后用 JSON 解析校验：`bun -e 'JSON.parse(await Bun.file(process.env.HOME+"/.config/opencode/opencode.json").text())'`（当前文件是纯 JSON；若将来含注释会解析失败，此时由 engineer 选用能解析 JSONC 的等价手段，**需验证**）。

### 3.4 发布流程

开发目录（`DEV=/project/glx/scripts/opencode-crew`）：

1. `cd $DEV && bun run typecheck && bun test`
2. `bun run compile`（写入 `dist/`；切换之后它不再触发运行端重载，这是预期收益）
3. `rm -rf build-check && CREW_BUILD_OUTDIR=build-check bun run compile && diff -r dist build-check`（CI 同款，必须无输出）
4. `git status --porcelain`，确认只含预期文件；`git add` + `git commit` + `git push origin main` —— **需用户同意**
5. 等 CI 通过：`gh run list --branch main --limit 1 --json status,conclusion,headSha`（**需验证** `gh` 可用；不可用就在 GitHub 页面确认，或接受第 1–3 步本地结果）。注意 `ci.yml` 对 `plans/**`、`docs/**`、README 的 push 设了 `paths-ignore`，纯文档提交不会跑 CI，这类提交也不需要重载。

运行副本（`L=/project/glx/scripts/opencode-crew-live`）：

6. 前置检查（均需满足，否则中止）：
   - `git -C $L status --porcelain` 为空；
   - `git -C $L symbolic-ref -q HEAD` 返回 `refs/heads/main`（若处于 detached 回滚态，先解决回滚原因再 `git -C $L checkout main`）；
   - 无活跃 `crew_task`（Root 调 `crew_task_status` 无 active）、侧栏 Delegations 无运行中的子代理——**重载会让正在跑的子代理报 `Agent not found`**。
7. `git -C $L fetch origin` → `git -C $L log --oneline HEAD..origin/main` 确认要上线的提交列表。
8. `git -C $L diff --name-only HEAD origin/main -- package.json bun.lock`：非空则记下，第 11 步需要重装。
9. 记发布日志：`echo "$(date -Is) from=$(git -C $L rev-parse HEAD) to=$(git -C $L rev-parse origin/main) note=<一句话>" >> $L/.git/crew-release.log`
10. `git -C $L merge --ff-only origin/main`。若失败（说明 live 有本地提交或历史被改写）：停止，不要 `reset --hard`，交 Root 排查。
11. 依赖文件变化时：`cd $L && bun install --frozen-lockfile`（按全局规则先 `slot audit`/`slot status` 并记日志；预计 >1 分钟则 `slot io -- bun install --frozen-lockfile`）。**必须在第 12 步重载之前完成**，否则重载时可能缺包。
12. 触发重载：在 TUI 里执行宿主 `/reload`（README「文件即角色」一节写的方式）。**不要只依赖 dist 变化的自动重载**：事实 13 说明监视可能不可靠；而且只改 `agents/*.md` 的发布根本不会改 `dist`。`dist/tui.js` 有变化时，还要关闭并重开 TUI（侧栏只在启动时加载，见 `docs/sidebar-ui.md`）。
13. 跑 3.8 验收清单中与本次改动相关的项；通过后在发布日志补一行 `note=verified`。

关于文件更新的原子性：`merge --ff-only` 会依次改写 `dist/`、`agents/`、`src/` 的多个文件，宿主若恰好在此时重载可能读到半新半旧的组合。发布窗口要选无人使用时，并且第 6 步已要求无活跃子代理；发生加载失败时按 3.6 立刻回滚。**需验证**宿主是否对 plugin 目录变化做防抖（无法验证时按上面的窗口策略处理，不需要额外代码）。

### 3.5 提示词「热读」的影响

- 切到 live 之后，`agents/*.md` 的有效版本 = **live 当前 checkout 的版本**，不再是开发目录里的工作区文件。
- 含义：
  1. 在开发目录改了 `agents/*.md`（包括未提交的草稿）**不会**进入运行环境，必须走完 3.4 的 commit → push → live 更新 → `/reload`。这消除了 handoff §3 里「未提交的提示词改动随重载悄悄生效」的风险。
  2. 代价：调提示词的迭代回路变长。需要先在真机试一版提示词时，用隔离宿主指向开发目录，不要改共享配置。
  3. 只改 `agents/*.md` 的发布不触发 dist 变化，**必须**手动 `/reload`；没做就是「live 已更新但运行中仍是旧提示词」，这是最容易被忽略的不一致。发布日志里的 `verified` 行就是为了避免这种漏做。
  4. 已运行的会话在下一次 provider 请求时按新 system 重组（README「使用」一节），所以重载后进行中的 Root/engineer 会话也会立刻用新提示词；与「等任务结束再发布」的窗口策略一致。
- 目前没有对外可见的「已加载提示词版本号」。**不为此新增接口**；可用的判据见 3.8 第 2 项（宿主日志加载时间 vs 发布日志时间）。

### 3.6 回滚

- 快速回滚（只回退到上一提交；`PREV` 取自 `$L/.git/crew-release.log` 最后一行的 `from=`，或 `git -C $L reflog -5`）：
  1. `git -C $L checkout --detach $PREV`
  2. 若 `PREV` 与当前版本之间 `package.json`/`bun.lock` 有差异：`cd $L && bun install --frozen-lockfile`
  3. `/reload`（TUI 入口有变化则重开 TUI）
  4. 跑 3.8 的 1、3、5 项
  - 回滚后 live 为 detached HEAD。恢复正常发布：在开发目录修好、推送，再 `git -C $L checkout main && git -C $L merge --ff-only origin/main`。
- 兜底回滚（live 本身坏了、或需要立刻回到开发目录运行）：
  - 若配置自切换以来没有其他改动：`cp -p ~/.config/opencode/opencode.json.bak-live-switch-<ts> ~/.config/opencode/opencode.json`
  - 否则只回退一个值：`sed -i 's#"package": "/project/glx/scripts/opencode-crew-live"#"package": "/project/glx/scripts/opencode-crew"#' ~/.config/opencode/opencode.json`
  - 配置变化会触发重载；回指前先在开发目录 `git status` 确认 `dist/` 和 `agents/` 是自己愿意运行的版本（工作区草稿会立刻生效）。
  - 此兜底只要有 shell 就能执行，不依赖 TUI 或任何角色可用。
- 回滚演练：在 A2 完成后、A4 改配置前，于 live 里实际执行一次 `checkout --detach HEAD~1` → `checkout main` 验证命令可用（此时配置仍指向开发目录，没有重载风险）。

### 3.7 `crew_task` 账本与证据：**不需要迁移**

- 账本位于 `<项目 git common dir>/opencode-crew-stage1`（`src/tasks-ledger.ts`），项目身份来自 `inspectProject(ctx.location.directory)`，即**会话的工作目录所在仓库**。插件从哪个目录加载与此无关。
- 因此：在开发目录里开 Root 会话 → 账本仍是 `/project/glx/scripts/opencode-crew/.git/opencode-crew-stage1`，历史任务不动；在其他项目里开会话 → 各自仓库的账本。live 只在被当作会话 cwd 时才会有自己的（空）账本，而第 2 节决定 4 要求 live 不开会话，所以不会出现。
- `architect` 的 `plans/**` 写权限（`src/index.ts`）同样用 `ctx.location.directory`，不受影响。
- 证据文件（`plans/evidence/**`）是普通仓库文件，随开发目录。
- 验证（切换前后各一次）：
  - `ls -la /project/glx/scripts/opencode-crew/.git/opencode-crew-stage1` 内容（`registry.json` 的 mtime/大小）不变；
  - Root 调 `crew_task_status` 返回的 active 列表与切换前一致。
- 唯一例外：若将来有人在 live 里直接开会话，那是误用，不做迁移也不做兼容。

### 3.8 验收清单（切换/发布/回滚后）

| # | 检查 | 方法 | 成功标准 |
|---|---|---|---|
| 1 | 插件来源与唯一性 | `grep -n "opencode-crew" ~/.config/opencode/{opencode.json,cli.json,tui.jsonc}` | 仅一处，指向 `-live` |
| 2 | 宿主确实加载了新目录 | 优先 `opencode plugin check`（**需验证**其输出是否含路径）；其次 `grep -n "opencode-crew" ~/.local/share/opencode/log/opencode.log \| tail`（**需验证**日志格式）；再其次 `stat -c '%x' $L/agents/root.md` 的 atime 晚于重载时刻（relatime 下仅首次读取可靠，**需验证**） | 能看到重载时刻晚于发布日志对应行，且无加载错误 |
| 3 | 五个角色存在 | TUI 的 agent 选择里有 Root，`@` 子代理列表里有 architect/engineer/explorer/reviewer；`/crew` 可用；shell 侧可尝试 `opencode agent list`（**需验证**命令存在） | 五个都在；`default_agent: root` 仍生效 |
| 4 | 角色可执行 | Root 派一个只读 explorer 任务（例如「列出 `agents/` 下的文件名」，低成本模型 luna） | 正常返回，无 `Agent not found` |
| 5 | `opencode-crew-display` RPC | 重开 TUI 后看侧栏模型列 | 显示别名（如 `sol`/`luna`/`opus`）而不是被截断的 model id。因为 v2.4.1 不向 TUI 转发 `plugins[].options`（`docs/sidebar-ui.md`），别名只能经 RPC 到达；`cli.json` 已无 Crew 条目，所以能显示别名即证明 RPC 可用 |
| 6 | 配置档 | 侧栏 footer / `/crew-profile` | 当前档仍是 `default`（`crew-profiles/active` 不受影响） |
| 7 | gate 状态 | 默认 `off`：Root 的工具列表中没有 `crew_review_gate`；`remind` 下可调用并返回 `mode:"remind"`、`hooks.idle:true` | 与当前配置一致 |
| 8 | TUI 侧栏 | 打开会话页 | Alerts / Delegations / Subagents 三块正常渲染，无 claim 故障回退提示 |
| 9 | 账本 | 见 3.7 | 与切换前一致 |
| 10 | 开发目录脱钩 | 在开发目录改一个无关的 `agents/*.md` 草稿（不提交）并 `/reload`，再还原 | 运行行为不变（可用 `git -C $DEV diff --stat` 确认还原干净）。该项为一次性检查，可选 |

### 3.9 实施步骤（按依赖排序，每步含验证）

**P0 前置（开发目录）**
- P0.1 清理工作区，使 `git status --porcelain` 只含已知的、将被提交的文件。处理两个原型 html，见 5.2。验证：`git -C $DEV status --porcelain`；成功标准：无意料之外的条目。
- P0.2 确认基线：`git -C $DEV rev-parse HEAD origin/main` 相同；`rm -rf build-check && CREW_BUILD_OUTDIR=build-check bun run compile && diff -r dist build-check` 无输出；`git -C $DEV status --porcelain -- dist` 无输出。成功标准：live 将克隆的提交的 `dist` 与源码一致。
- P0.3 `slot audit`、`slot status`，写入 `/project/tmp/run-copy-rollout/log.md`；首次起重活前读 `~/.config/agents/slot.md`。日志与中间文件放 `/project/tmp/run-copy-rollout/`，**不放仓库内**（避免 `DIRTY_PRIMARY`）。

**A1 克隆**
- 命令：`git clone --branch main git@github.com:bioShaun/opencode-crew.git /project/glx/scripts/opencode-crew-live`，随后 `git -C $L config pull.ff only`、`git -C $L remote set-url --push origin no_push`。
- 验证：`git -C $L rev-parse HEAD` = `git -C $DEV rev-parse origin/main`；`git -C $L status --porcelain` 为空；`diff -r $DEV/dist $L/dist` 无输出；`git -C $L push --dry-run` 报错（push 已禁用）。

**A2 依赖与回滚演练**
- 命令：`cd $L && bun install --frozen-lockfile`（按 3.4 第 11 步的 slot 规则）。
- 验证：`cat $L/node_modules/@opencode/plugin/package.json | grep '"version"'` 为 `2.3.0`；`git -C $L status --porcelain` 仍为空（`node_modules/` 被 `.gitignore` 忽略）；演练：`git -C $L checkout --detach HEAD~1 && git -C $L checkout main && git -C $L status -sb` 回到 `main` 且干净。

**A3 加载预检（不碰共享服务）**
- A3.1 解析预检：`cd /project/tmp && bun --no-install -e 'const m = await import("/project/glx/scripts/opencode-crew-live/dist/index.js"); console.log(m.default.id)'`。成功标准：输出 `opencode-crew`。`--no-install` 必须带，否则 bun 会自动安装而掩盖缺包。这只证明 bun 能解析，**不证明宿主**。
- A3.2 宿主预检（推荐，成本低于一次共享服务失败）：按 `plans/evidence/review-gate-probe/summary.md` 的隔离做法（隔离 HOME/XDG/TMPDIR、`--standalone`、`package` 配为 live 目录）起一个隔离宿主，不调用模型地列出 agent（`opencode agent list`，**需验证**），否则跑一次 `opencode run --agent root -m tcuni/gpt-6-luna#low '只回复 ok'`。成功标准：五个角色出现，进程退出码 0，日志无插件加载错误。若隔离宿主缺 provider 配置，复用 S0 探针当时的配置做法。

**A4 切换配置（共享服务，高风险）**
- 前置：3.4 第 6 步的三个条件；通知用户这是重载窗口。
- 步骤：备份（3.3）→ 精确替换 `package` → JSON 校验 → `grep` 唯一性核对。
- 验证：3.8 的 1 项。成功标准：仅一处且是 `-live`。

**A5 重载与验收**
- 配置变化会触发宿主热重载；再保险执行一次 `/reload`，并重开 TUI。
- 验证：3.8 清单 1–9 项全部通过；任一失败立即按 3.6 兜底回滚（`sed` 一行，不要先排查）。
- 记录：`/project/tmp/run-copy-rollout/log.md` 追加切换时刻、`HEAD` sha、验收结果；`live/.git/crew-release.log` 追加首行 `note=initial switch, verified`。

**A6 稳定观察**
- 至少 1 个工作日，其间不改配置，不做门禁相关修改。期间出现任何 `Agent not found`、角色缺失、侧栏回退提示，先回滚再分析。

---

## 4. B. 审查门禁上线

### 4.1 先 `remind`，观察期与信号

- **先 `remind`**，理由：
  1. 全局生效：options 没有按项目覆盖，所有 git 项目的 Root 会话都会被评估。先用「每组改动只提醒一次、会话总量封顶」的模式测噪音。
  2. `enforce` 的重复注入每次 idle 都会多一次模型调用，且真机从未验证（4.5）。
  3. 门禁本来就是软提醒，`remind` 与 `enforce` 的差别只是「同一组改动是否重发 ≤ `maxReminders` 次」。先证明提醒内容有用，再讨论是否要重发。
- 观察期：**至少 7 个日历日，且累计 ≥10 次提醒**，二者都满足才下结论；最长 14 天，14 天内不足 10 次则判定为低流量，维持 `remind`、不升级。
- 数据来源（只读）：`sqlite3 -readonly ~/.local/share/opencode/opencode.db "select session_id, count(*) from session_message where data like '%crewReviewGate%' group by 1"`（**需验证** `sqlite3` 命令可用及 `data` 为文本 JSON；S7 就是用这个表确认注入消息的）。命中规则分布可从 `metadata.crewReviewGate.rule` 取。
- 观察信号与建议阈值（均为起点，由用户确认）：

| 信号 | 看法 | 动作 |
|---|---|---|
| 提醒条数 / 命中规则分布（`sensitivePath`/`fileCount`/`planMultiFile`/`incomplete`/`deletedTest`/`outsideScope`） | 是否被某一条规则或某个项目刷屏 | 刷屏项目的无关路径写入 `ignoreGlobs`（注意是整体替换，需重列默认值） |
| 处置分布：派了 reviewer / 写 `Review-Skip` / 无响应 | 无响应占比（≥3 次且 ≥20%）说明 Root 在忽略提醒 | 才考虑升 `enforce` |
| `Review-Skip` 理由里「纯文档/格式/明显噪音」的占比 | >30% 视为误报偏高 | 把 `maxFiles` 提到 8，或补 `ignoreGlobs` |
| `incomplete` 命中占比 | 偏高说明 git 采集超过 3 秒/1 MB（大目录） | 对应项目的目录应被 `.gitignore`，或接受该项目不被覆盖 |
| 漏报抽查 | 每周抽 3 次「≥6 文件改动但没有提醒」的 Root 回合（对照 `git log`） | 找原因：被 `ignoreGlobs` 吞了？reviewer 已覆盖？采集不可用？ |
| 非本仓库项目的命中 | `改动目录` 字段 | 决定是否接受全局开启 |

### 4.2 本机 `options` 推荐值

`reviewGate` 只写需要覆盖的键：

```json
"reviewGate": {
  "mode": "remind",
  "sensitiveGlobs": ["**/AGENTS.md", "agents/**", "**/role-guard.*"]
}
```

其余键使用默认：`maxFiles=5`、`planMinFiles=2`、`maxReminders=2`、`testGlobs`、`ignoreGlobs=["plans/**","dist/**","**/*.lock","bun.lock"]`。

逐条理由与代价：

| 配置 | 理由 | 代价 / 噪音 |
|---|---|---|
| `**/AGENTS.md`（必须重列） | 项目指令影响此后所有会话；`reviewGlobs` 整体替换默认值，漏写就等于关掉该项保护 | 很低 |
| `agents/**` | 角色提示词与 frontmatter 权限是本仓库的行为源，改一个字就改变五个角色的行为，且没有测试能完整覆盖提示词语义 | 每次调提示词都会命中，哪怕只是改错别字；全局生效，其他仓库顶层存在 `agents/` 目录也会命中（本机大部分项目没有）。`sensitivePath` 不受 `ignoreGlobs` 影响 |
| `**/role-guard.*` | 权限 guard 是安全关键代码；`**/` 同时匹配根目录与 `src/` 下，且只匹配以 `role-guard.` 开头的文件名 | 同名 test 文件（`role-guard.test.ts`）也会命中，但改 guard 时通常本来就会一起改；其他项目几乎没有同名文件 |
| `maxFiles=5`（默认） | 本仓库一次典型功能 = `src` 2–3 + `test` 1–2 + 文档 1–2（`dist`、`plans` 被忽略不计），≥6 才提醒，小修不打扰 | 中等功能必然命中，这正是想要的；若误报率 >30% 再提到 8 |
| `planMinFiles=2`（默认） | 任务引用了 `plans/*.md` 方案，说明是被判为「需要方案」的改动，两个文件以上就值得一次审查 | 几乎每个按方案执行的 engineer 任务都会命中一次（reviewer 已覆盖则不提醒） |
| 不加 `src/tasks*.ts`、`src/review-gate*.ts`、`.github/workflows/**`、`package.json` | 这些改动通常同时满足 `fileCount`/`planMultiFile`，已被覆盖；额外加规则只会增加误报 | 若观察期发现漏报，再按实际路径加 |

提交前预检（**必做**，避免事实 10 的加载失败）：在开发目录用现有校验器离线解析将要写入的 options，成功才改配置，例如：

`cd $DEV && bun -e 'const { parseCrewOptions } = await import("./src/config.ts"); const c = JSON.parse(await Bun.file(process.env.HOME + "/.config/opencode/opencode.json").text()); const p = c.plugins.find(x => String(x.package).includes("opencode-crew")); console.log(JSON.stringify(parseCrewOptions(p.options).reviewGate, null, 1))'`

（**需验证**该一行命令可运行；engineer 可改写成等价脚本放进 `/project/tmp/run-copy-rollout/`。）成功标准：输出的 `mode`/`sensitiveGlobs` 与上表一致，无异常。

### 4.3 运行副本切换后 `ignoreGlobs` 是否够用

- 够用，且**不需要为 live 加任何项**：门禁观察的是会话 cwd（开发目录），不是插件目录；live 不会出现在任何 `git status` 里。
- 对本仓库自身：默认已覆盖 `plans/**`（含 `plans/evidence/**` 的大量证据文件）、`dist/**`、`bun.lock`、`**/*.lock`；`build-check/`、`node_modules/`、`.scratch/`、`test/.work/` 由 `.gitignore` 排除，`status` 看不到。`docs/**` 与 README 不在默认忽略里，文档改动会计入 `maxFiles`，这是有意保留的。
- 间接影响：根目录未跟踪的原型 html 会被计入 `fileCount`（`--untracked-files=all`），所以 5.2 的清理也是门禁噪音的前置。
- 对其他项目：默认值不一定够用（例如分析项目的 `work/` 或结果目录若未被 `.gitignore`），这部分靠 4.1 的观察结果再补，不预先猜。

### 4.4 关闭与回滚

- **关闭**：把 `options.reviewGate.mode` 改回 `"off"`（或删除 `reviewGate` 整块，默认即 `off`）。配置变化触发插件重载，`setup` 重跑，`registerReviewGate` 在 `off` 时直接返回，不再注册 hook 与 `crew_review_gate`。**需验证**：重载后旧 hook 是否确实被宿主清理——验证方法：关闭后制造一次必命中的改动（例如新增并保留一个 `AGENTS.md` 的临时仓库），确认没有新的 `crewReviewGate` 消息，且 Root 工具列表里没有 `crew_review_gate`。若旧 hook 仍在，则需要用户重启共享服务（`opencode serve --service`）。
- **误报时的自救阶梯**（由轻到重）：
  1. 本次提醒：让 Root 回复一行 `Review-Skip: <≥10 字的具体理由>`，只确认那一条；
  2. 想暂停：改 `mode` 为 `"off"`（一行），不删其他键；
  3. 完全撤销：删除 `reviewGate` 块；
  4. 配置整体回退：`cp -p ~/.config/opencode/opencode.json.bak-gate-<ts> ~/.config/opencode/opencode.json`（会丢掉备份之后的其他配置改动，最后手段）。
  - 以上 2–4 都会触发插件重载，会让运行中的子代理中断；不紧急时优先用 1。
- **`crew_review_gate` 在 `off` 下不存在**，排查路径：
  1. 先看 `opencode.json` 里 `mode` 实际值（忽略「没提醒是不是坏了」的猜测）；
  2. 需要诊断时，临时改为 `remind` → Root 调 `crew_review_gate`（输入 `{}`），看 `hooks`（`IDLE_HOOK_UNAVAILABLE`/`PROMPT_HOOK_UNAVAILABLE` 备注）、`native.status`、`baseline.present`、`reviewers.complete`、`notes`；
  3. 不改配置的替代：直接在目标目录跑 `git status --porcelain=v1 --untracked-files=all`，对照 4.2 的规则人工判断；
  4. 查历史：对 `opencode.db` 做 4.1 的只读查询，看是否曾注入过。

### 4.5 真机尚未验证的分支：最小成本验证

未验证项（S7 记录与 `review-gate-spec.md` §8 S7）：`enforce` 重复注入；reviewer 覆盖后停止（两种模式共用的覆盖判断）；`enforce` 下 `Review-Skip` 停止（与 S7 已验证的 `remind` 同一代码路径，可顺带）。

- **时机**：不是上线 `remind` 的前提；是**升级到 `enforce` 的前置**。`remind` 下的「reviewer 覆盖后不再提醒」则在观察期里自然出现，记录即可。
- **做法**（沿用 S7：载体仓库 + 短时改配置 + 还原）：
  1. 新建载体 `/project/tmp/gate-enforce`（`git init` + 一次提交），不用本仓库。
  2. 在安静窗口（无活跃子代理）备份配置，临时设置 `"reviewGate": { "mode": "enforce", "maxReminders": 2, "sensitiveGlobs": ["**/AGENTS.md"] }`，窗口 ≤15 分钟，用完恢复。**先跑 4.2 的预检**。更稳的替代是隔离宿主（A3.2 的做法），不影响共享服务，代价是需要复制 provider 配置。
  3. 场景 E1（重复注入）：`opencode run --agent root -m tcuni/gpt-6-luna#low`，提示「创建 `AGENTS.md`；之后收到 `[crew-review-gate]` 提醒时只回复 ack，不派 reviewer，也不写 `Review-Skip`」。成功标准：用 4.1 的查询统计该会话 `crewReviewGate` 消息，**恰好 2 条**（= `maxReminders`），第三次 idle 不再注入。如果模型不听话自行写了 skip/派了 reviewer，该次结果无效，重跑。
  4. 场景 E2（reviewer 覆盖后停止）：另起会话，同样创建 `AGENTS.md`；收到第一条提醒后指示「派 reviewer 读 `AGENTS.md` 并回复 ok」。成功标准：`crewReviewGate` 消息保持 **1 条**；此后在 Root 里调用 `crew_review_gate`，`native.reviewerCovered` 为 `true`。reviewer 使用 `opus-5-5#high`，把审查任务限定为只读 `AGENTS.md`，控制成本。
  5. E3（可选）：E1 的第二条提醒后改为回复 `Review-Skip: <≥10字理由>`，成功标准：消息保持 2 条且不再增加。
  6. 还原配置并核对 `diff` 只含 `reviewGate` 块；证据（命令、条数、会话 ID）写入 `plans/evidence/review-gate-probe/s8-enforce.md`。

### 4.6 实施步骤

- B1（依赖 A6 完成）：4.2 的预检 → 备份 `opencode.json.bak-gate-<ts>` → 写入 `reviewGate` → JSON 校验。验证：预检输出正确；`git`/`grep` 确认只新增 `reviewGate` 一个键。
- B2：重载 + 验证。成功标准：Root 工具列表出现 `crew_review_gate`；调用返回 `mode:"remind"`、`hooks:{idle:true,prompt:true}`、`config.sensitiveGlobs` 为三项；`notes` 无 `IDLE_HOOK_UNAVAILABLE`/`PROMPT_HOOK_UNAVAILABLE`；五个角色与 3.8 的 3、5、8 项仍正常。失败则按 4.4 第 3 步撤销。
- B3：观察期（4.1），每周一次汇总写入 `/project/tmp/run-copy-rollout/gate-observation.md`；结束时写结论到 `plans/`（见 5.1 的剩余事项表）。
- B4（可选，依赖 B3 结论）：4.5 的 E1/E2，通过后再决定是否改 `enforce`。

---

## 5. C. 文档与杂项

### 5.1 `plans/handoff-2026-11-24.md`

- 建议**原地改写**，不新开文件。理由：同一天、同一用途；现内容已失真（HEAD `b21662e`、「改动均未提交」、待办 1–5、GitHub 安装失败）；两份并存会让读者拿到过时版本；历史可由 git 保留（该文件若尚未跟踪，改写后首次提交即为准确版本）。
- 结构建议（保持短）：
  1. **当前状态**：HEAD 与 `origin/main`、CI 状态、`dist` 与 `build-check` 一致、宿主版本、live/开发目录路径与当前运行来源。
  2. **已完成**：表格「事项 → 提交 → 证据位置」。覆盖 reviewer/Root 提示词、§11 `engineerDispatchDenied`、审查门禁 S0–S7（`plans/evidence/review-gate-probe/`）、GitHub 安装修复、dist 重建；保留红灯/绿灯证据位置。
  3. **仍有效的事实与坑**：保留原 §3 中仍成立的条目（重载导致 `Agent not found`、实际模型由配置档决定、shell `workdir`/权限的推断、主工作区不干净会 `DIRTY_PRIMARY`）；删除或订正：「运行的是 11-17 编译的 dist」「GitHub 安装失败」「待办 5」。
  4. **剩余事项**：指向本方案的 A/B/C，并给每项状态列（未开始/进行中/完成/阻塞）。
  5. **用户已做的决定**：沿用原 §5，并追加本方案的待拍板结果（原型 html 处置、门禁观察期、live 路径）。
- 时机：A 完成后更新「当前状态」与「已完成」，B 观察期结束再更新门禁结论；不要在 A 之前定稿。

### 5.2 两个根目录原型 html

- 现状：`subagent-model-sidebar-prototype.html`、`subagent-model-tui-prototype.html` 未跟踪，没有任何文档/README/测试引用；对应功能（侧栏模型列、别名、`plans/sidebar-model-display.md`）已实现并有已提交的 `docs/sidebar-prototype.html`。`package.json` 的 `files` 白名单不含它们，不会进包。
- 它们会：① 令 `crew_task_start` 以 `DIRTY_PRIMARY` 拒绝（事实 11）；② 被门禁计入 `fileCount`。所以必须离开主工作区的未跟踪状态。
- 建议处置（默认）：**移出仓库，不提交、不忽略、不删除**：
  `mkdir -p /project/tmp/opencode-crew-prototypes && mv /project/glx/scripts/opencode-crew/subagent-model-*-prototype.html /project/tmp/opencode-crew-prototypes/`
  验证：`git status --porcelain` 不再出现这两个文件；`ls /project/tmp/opencode-crew-prototypes` 有两个文件。理由：设计已落地；放根目录不符合仓库布局；两个一次性文件不值得加 `.gitignore` 规则；移动可逆，删除不可逆。
- 备选（由用户决定）：
  - 想保留设计史：`git mv` 到 `docs/prototypes/` 后提交（需用户同意；README 目录树不用改）。
  - 只想本地留着：`.gitignore` 追加 `/subagent-model-*-prototype.html`（带前导 `/` 只匹配根目录）。不推荐，因为被忽略的文件仍占根目录。

### 5.3 README

- **需要补**，放在两份 README 的「本地目录 / 离线分发」（zh：`### 本地目录 / 离线分发`；en：`### Local directory / offline distribution`）两段之后，新增三级标题「开发目录与运行副本（维护者）」/ “Development checkout vs. running copy (maintainers)”。篇幅控制在 6–8 行，只写：
  - 建议把运行目录与开发目录分开，`package` 指向只读 clone；
  - `dist/` 已提交，运行副本不需要构建，但需要 `bun install --frozen-lockfile`（本方案 3.2 的结论，若 A3 的瘦身验证通过则改写）；
  - 更新 = `git fetch` + `merge --ff-only` + `/reload`（TUI 入口变化时重开 TUI）；回滚 = `checkout --detach <上一提交>`；
  - `agents/*.md` 只在插件加载时读取，因此提示词改动必须发布并重载；
  - 完整手册指向新文件 `docs/run-copy-release.md`（命令清单与验收表，来源于本方案 3.1–3.8，路径用 `<live-dir>`/`<dev-dir>` 占位，不写本机路径）。
- 同时修正两份 README 中 `reviewGate` 段落对 `planMultiFile` 的反向描述：改为「引用了 `plans/*.md` 方案且改动 ≥ `planMinFiles` 个文件」。文档变更，`ci.yml` 的 `paths-ignore` 会跳过其 CI。
- 本机 `~/.config/opencode/docs/crew-install.md` 仍写着旧路径 `/home/tcuni-claw/opencode/opencode-crew`，是用户级文档，不在仓库内；建议切换完成后让用户决定是否同步，本方案不改。

### 5.4 实施步骤

- C1：处理原型 html（5.2），排在 P0.1，是 A 的前置。
- C2：A 完成后改写 handoff（5.1，阶段 1、2、4 节）；B 结束后补门禁结论。
- C3：README 两份 + 新 `docs/run-copy-release.md`（5.3）；`bun test` 不受影响。验证：`git diff --stat` 只含文档；两份 README 的新节与订正逐句对应；`grep -n "without a" README.md` 不再出现反向描述。
- 以上提交均需用户同意。

---

## 6. 总顺序与依赖

```
C1(原型)  ─┐
P0.2/P0.3 ─┼─> A1 clone ─> A2 依赖+回滚演练 ─> A3 预检 ─> A4 改配置 ─> A5 重载验收 ─> A6 观察≥1工作日
           │                                                                             │
           └────────────────────────────────────────────────────────────────────────────>├─> B1 预检+配置 ─> B2 验收 ─> B3 观察≥7天&≥10次 ─> B4(可选 enforce 验证)
                                                                                         └─> C2 handoff 更新 / C3 README+runbook（可与 B 并行，A 完成后）
```

---

## 7. 风险与未决

### 7.1 风险（按严重度）

1. **A4/A5 切换配置与重载（最高）**：插件加载失败会让五个角色全部消失，运行中的子代理报 `Agent not found`；失败来源可能是 live 缺依赖、路径写错、重载时文件半新半旧。缓解：A2/A3 预检、安静窗口、备份、一行 `sed` 兜底回滚、验收失败先回滚后分析。
2. **B1 编辑 `reviewGate`（次高）**：非法值（拼错键名、`sensitiveGlobs` 含 `..` 或以 `/` 开头、超过 64 项）会在 `setup` 抛错，同样全员消失；且 options 全局，会影响所有 git 项目的 Root 会话。缓解：4.2 的离线预检、先 `remind`、一行撤销。
3. 其他：
   - 只改 `agents/*.md` 的发布不触发 dist 变化，忘记 `/reload` 会造成「已发布但未生效」（3.5）；
   - `dist/tui.js` 变化后未重开 TUI，侧栏仍是旧版；
   - 宿主监视可能不可靠（事实 13），依赖自动重载会漏；
   - live 误开会话会产生独立账本与门禁状态（3.7）。

### 7.2 需要 Root 或用户拍板（最多 3 条）

1. **提交/推送授权与时机**：P0/C 涉及的提交（含本文件、handoff 改写、README、`docs/run-copy-release.md`）与 `git push`，以及 A4 的重载窗口（需无活跃子代理）。
2. **原型 html 的处置**：默认移出到 `/project/tmp/opencode-crew-prototypes/`；备选提交到 `docs/prototypes/` 或加 `.gitignore`。
3. **门禁是否接受全局生效并以「≥7 天且 ≥10 次提醒」作观察期**：因 options 无法按项目限定，分析项目也会被评估；若用户不接受全局噪音，则 B 暂停，不影响 A。

### 7.3 未决（需验证，已给方法）

- 宿主是否能在无 `node_modules` 的目录解析 `@opencode/plugin`/TUI 依赖（3.2，默认不依赖）。
- `opencode plugin check`、`opencode agent list`、`gh`、`sqlite3`、`jq` 的可用性与输出格式（3.8、3.4、4.1）。
- 宿主对 plugin 目录变化是否防抖；`mode` 改 `off` 后旧 hook 是否被宿主清理（3.4、4.4）。
- 宿主日志里是否有可用的「插件加载」记录以判定实际加载的目录与时间（3.8 第 2 项）。
