# 审查门禁：是否启用、怎么启用（本机决策）

状态：**ready / context-only**。日期：2026-11-24。承接 `plans/run-copy-and-gate-rollout.md` §4（本文只替换其中「是否全局、观察期、enforce 验证」的结论，其余沿用）。

依据（已读）：官方文档 `https://opencode.ai/docs/config`（Locations 一节）与 `https://opencode.ai/docs/plugins`（Configure 一节）；`src/config.ts`（`parseReviewGate`、`parseCrewOptions`）、`src/review-gate.ts`（`globToRegExp`、`evaluateGate`）、`src/review-gate-host.ts`（`registerReviewGate`，约 158–299 行）、`src/review-gate-git.ts`（`collectNativeChanges`）、`docs/run-copy-release.md`、`plans/evidence/review-gate-probe/{summary,s7-real-machine}.md`，以及 `~/.config/opencode/opencode.json`（只读，第 599–626 行是唯一的 Crew 条目）。仓库无 AGENTS.md，只适用全局指令。

不改代码、不改配置、不做 git 写操作；所有执行由 Root 另开 Assignment 交给 engineer，并遵守全局规则（禁 `/tmp`，用 `/project/tmp/`；`bun install` 之类重活走 `slot`）。

---

## 0. 结论

**有条件开：`remind`，先只在开发仓库 `/project/glx/scripts/opencode-crew` 生效；做不到按项目限定时，才退到全局 `remind`。不上 `enforce`。**

| 项 | 决定 |
|---|---|
| 要不要开 | 开 `remind`。理由：本机几乎没有噪音源（40 个分析目录里 38 个非 git、2 个 git 仓库当前干净），而收益只落在开发仓库（改 `agents/**`、`role-guard.*`、`AGENTS.md`、大改动） |
| 范围 | 首选项目级；是否可行取决于一次隔离实验（§1.3），实验前不得当作事实 |
| `mode` | `remind` |
| `sensitiveGlobs` | 照旧三项 `["**/AGENTS.md","agents/**","**/role-guard.*"]`（数组整体替换默认值，所以 `**/AGENTS.md` 必须重列） |
| 其余键 | 全部不写，用默认（`maxFiles=5`、`planMinFiles=2`、`maxReminders=2`、默认 `ignoreGlobs`/`testGlobs`）。没有任何证据支持现在改它们 |
| 顺序 | ① 隔离实验（不碰共享服务）→ ② 离线预检 → ③ 一次安静窗口内写配置 + 重载 → ④ 观察 → ⑤ `enforce` 只在隔离宿主验证，不在共享服务上验证 |
| 与 `enforce` 验证的关系 | 严格分开：`enforce` 验证全在隔离宿主做，不需要重载共享服务（§5） |

---

## 1. 能不能按项目限定范围

### 1.1 判断：**文档支持分层，但「同一个 package 的 options 怎么合并」没有文档；需验证**

已核实的依据：

1. `opencode.ai/docs/config`：配置按「当前目录向上到根」逐层合并，先合并各层 `opencode.json(c)`（远到近），再合并各层 `.opencode/opencode.json(c)`（远到近），**所有 `.opencode` 配置高于所有直接配置，全局配置优先级最低**；「不冲突的设置会保留」。
2. `opencode.ai/docs/plugins`（Configure）：「Plugin arrays from applicable config files are applied from lowest to highest precedence **instead of replacing one another**」，并列出顺序 `~/.config/opencode/opencode.jsonc` → `./opencode.jsonc` → `./.opencode/opencode.jsonc`。即 `plugins` 数组是叠加的，不是整体替换。
3. 本插件自己的代码侧证据：`registerReviewGate` 用的是 `ctx.location.directory`（`src/review-gate-host.ts:179`），文档的 `experimental.location_idle_timeout` 也说「每个 project location 独立加载、闲置卸载服务」——插件运行时是**按 Location 实例化**的，不是整个服务只实例化一次。这使「按项目取不同 options」在机制上可行。

**文档没有回答的（因此不能直接下结论）**：全局层和项目层各有一条 `package` 相同的条目时，宿主会
- (A) 按 package/id 去重并**深合并** `options`（项目层只写 `reviewGate` 即可）；
- (B) 按 package/id 去重但**整条替换** `options`（项目层必须重写完整 options，否则丢掉 `models`/`steps`/`modelAliases`）；
- (C) **两条都加载**（同一个插件 id 注册两次：角色/工具重复或加载报错）。

没有任何本机证据区分 A/B/C（`plans/` 里检索过，没有相关记录）。

### 1.2 对三种结果的处理

| 结果 | 做法 | 备注 |
|---|---|---|
| A 深合并 | 项目层只写 `reviewGate`（见 §2.1 片段） | 最干净，全局 `models` 以后改了不用同步 |
| B 整条替换 | 项目层写**完整副本**（全局 options + `reviewGate`） | 有漂移风险：以后改全局 `models`/`modelAliases` 要同步改这份；可接受，但要在 §2.1 备注里写明 |
| C 重复加载，或实验中出现任何异常 | **说「只能全局」**，退到 §2.2 | 不要在共享配置里试 C，会让该 Location 的角色重复或消失 |

### 1.3 低成本验证（隔离宿主，不碰共享服务，不调用模型）

核心思路：`models`/`steps`/`reviewGate` 都在**同一个 options 对象**里，宿主怎么合并 `models` 就怎么合并 `reviewGate`。所以用 `opencode debug agents`（`docs/run-copy-release.md` 的验收表已用到；**需验证**该子命令存在，不存在则用 `opencode agent list`）观察 `models`/`steps` 的合并结果即可，不必调用模型。最后再用一次廉价调用确认 `crew_review_gate` 工具的有无。

```bash
ROOT=/project/tmp/gate-scope
mkdir -p $ROOT/{home,config/opencode,data,state,cache,tmp,proj-on,proj-off}
export HOME=$ROOT/home XDG_CONFIG_HOME=$ROOT/config XDG_DATA_HOME=$ROOT/data \
       XDG_STATE_HOME=$ROOT/state XDG_CACHE_HOME=$ROOT/cache TMPDIR=$ROOT/tmp
```

全局层 `$ROOT/config/opencode/opencode.json`（用标记值，便于区分；provider 配置照 S0 探针做法另行放入，**不要把真实密钥写进仓库或证据文件**）：

```json
{
  "plugins": [{
    "package": "/project/glx/scripts/opencode-crew-live",
    "options": {
      "models": { "root": "tcuni/gpt-6-luna#low", "engineer": "tcuni/gpt-6-luna#medium" },
      "steps": { "engineer": 77 }
    }
  }],
  "default_agent": "root"
}
```

项目层：两个目录都 `git init` + 一次提交；只给 `proj-on` 写 `proj-on/.opencode/opencode.json`（`package` 字符串必须与全局**逐字符相同**；相对路径按「相对该配置文件」解析，所以用绝对路径）：

```json
{
  "plugins": [{
    "package": "/project/glx/scripts/opencode-crew-live",
    "options": {
      "models": { "root": "tcuni/gpt-6.2-sol#high" },
      "reviewGate": { "mode": "remind" }
    }
  }]
}
```

前置：确认祖先链上没有会干扰的配置：`ls -la /project/tmp/opencode.json* /project/tmp/.opencode /project/opencode.json* /opencode.json* 2>&1 | head`（实测 `/project` 下检索无 `opencode.json(c)`，但仍要在隔离目录里再确认一次，因为合并是沿祖先链向上的）。

观察（每个目录各跑一次，输出落到 `$ROOT/out-*.txt`；输出格式**需验证**，不确定字段名就直接读文本）：

```bash
for d in proj-on proj-off; do (cd $ROOT/$d && opencode debug agents > $ROOT/out-$d.txt 2>&1; echo "exit=$?" >> $ROOT/out-$d.txt); done
grep -n -i -E 'root|engineer|model|steps' $ROOT/out-proj-on.txt | head -40
grep -n -i -E 'loading plugin|opencode-crew|error' $ROOT/data/opencode/log/opencode.log | tail -30
```

判定表：

| 观察 | 含义 |
|---|---|
| `proj-off` 的 root 模型 = `gpt-6-luna#low` | 全局层单独生效（基线） |
| `proj-on` 的 root 模型 = `gpt-6.2-sol#high` | 项目层条目生效且优先于全局（排除「被忽略」） |
| `proj-on` 的 engineer 仍是 `gpt-6-luna#medium`、steps 77 | **A 深合并** |
| `proj-on` 的 engineer 回到宿主默认、steps 没了 | **B 整条替换** |
| 日志里 `proj-on` 出现两次 `loading plugin ... opencode-crew`，或 `debug agents` 里角色重复/报错 | **C 重复加载 → 结论「只能全局」** |
| `proj-on` 与 `proj-off` 的结果互不影响 | 按项目限定成立 |

确认 `crew_review_gate` 的有无（可选，一次廉价调用；provider 已在隔离环境配好才做）：

```bash
for d in proj-on proj-off; do (cd $ROOT/$d && opencode run --standalone --agent root -m tcuni/gpt-6-luna#low --format json \
  '如果你有 crew_review_gate 工具，调用它（输入 {}）并只回复 mode 字段；没有该工具就只回复 NO_TOOL' > $ROOT/run-$d.ndjson); done
jq -r 'select(.type=="text") | .part.text // .text' $ROOT/run-proj-on.ndjson $ROOT/run-proj-off.ndjson 2>/dev/null | head
```
成功标准：`proj-on` 返回 `remind`，`proj-off` 返回 `NO_TOOL`。（`jq` 的取值路径**需验证**；`/usr/bin/jq` 存在。）

结束后：不把 `$ROOT` 里任何东西带回仓库；证据摘要（命令、A/B/C 结论、日志片段）写到 `plans/evidence/review-gate-probe/s9-scope.md`。

### 1.4 项目层配置文件本身会制造噪音，必须本地忽略

`.opencode/opencode.json` 放进开发仓库后是**未跟踪文件**：它会被 `git status --untracked-files=all` 计入 `fileCount`，并令 `crew_task_start` 以 `DIRTY_PRIMARY` 拒绝（`plans/run-copy-and-gate-rollout.md` 事实 11）。处理：

```bash
printf '%s\n' '/.opencode/' >> /project/glx/scripts/opencode-crew/.git/info/exclude
git -C /project/glx/scripts/opencode-crew status --porcelain   # 不应出现 .opencode/
```
`.git/info/exclude` 不进提交、不改 `.gitignore`；它在 common dir 里，`crew_task` 的 detached worktree 也共享。写入前先 `ls -la /project/glx/scripts/opencode-crew/.opencode 2>&1` 确认目录不存在（存在则先看内容，别覆盖）。

---

## 2. 具体配置

### 2.1 首选：项目级（实验结果为 A 或 B）

文件：`/project/glx/scripts/opencode-crew/.opencode/opencode.json`（本地忽略，不提交）。

结果 A（深合并）：

```json
{
  "plugins": [{
    "package": "/project/glx/scripts/opencode-crew-live",
    "options": {
      "reviewGate": {
        "mode": "remind",
        "sensitiveGlobs": ["**/AGENTS.md", "agents/**", "**/role-guard.*"]
      }
    }
  }]
}
```

结果 B（整条替换）：把 `~/.config/opencode/opencode.json` 第 602–624 行的 `models`/`steps`/`modelAliases` **原样复制**进上面的 `options`，再加 `reviewGate`。在该文件里不能写注释（纯 JSON），所以把「这是全局 options 的副本，改全局要同步」记在 `docs/run-copy-release.md` 或观察日志里。

### 2.2 回退：全局级（实验结果为 C，或用户选择全局）

在 `~/.config/opencode/opencode.json` 的 `plugins[0].options` 里与 `modelAliases` 并列加一个键（其余不动）：

```json
"reviewGate": {
  "mode": "remind",
  "sensitiveGlobs": ["**/AGENTS.md", "agents/**", "**/role-guard.*"]
}
```

全局的实际影响面（事实 3）：38 个非 git 目录 `collectNativeChanges` 的 `rev-parse` 立即失败，返回 `unavailable`，不提醒；2 个 git 仓库当前 0 条改动，且基线在首个 `prompt` 钩子时用 `snapshotNative` 取得，**会话开始前就存在的脏文件不计入**。所以全局的噪音预期很低。代价主要两项：
- `agents/**`、`**/role-guard.*` 在其他仓库基本没有对应文件，等于空转，无害；
- `collectNativeChanges` 用 `spawnSync`（`src/review-gate-git.ts:73`，3 秒、1 MB 上限）：Root 每个回合结束会**同步**跑一次 `git status`。小仓库是毫秒级；超大 git 仓库最多阻塞宿主事件循环 3 秒（超时后降级为 `unavailable`，静默放行）。本机两个 git 项目都不大，可忽略；若以后有大仓库，把它列为排除对象，不要为此调阈值。

**范围补充核查（启用前做一次，命令不改任何东西）**：事实 3 只统计了 `/data_0/project/glx/`。门禁还会作用于 Root 所在的**其他** git 目录：

```bash
for d in /project/glx/scripts/*/ /data_0/panel_design/projects/*/; do
  [ -e "$d/.git" ] && echo "git  $d  dirty=$(git -C "$d" status --porcelain=v1 --untracked-files=all 2>/dev/null | wc -l)"
done | sort | tee /project/tmp/gate-rollout/git-repos.txt
```
（`/data_0/panel_design/projects/` 可能很大，先 `ls | wc -l`；超过几百就只看用过的项目。）这些才是真正的噪音源：若全局开启，它们里的 Root 会话也会被评估。结果为项目级可行时这一步只用于知情；结果为「只能全局」时，它决定要不要接受全局（见 §7 拍板点 1）。

### 2.3 写入前的离线预检（必做，防止 `setup` 抛错让五个角色消失）

`parseCrewOptions` 遇到非法值会 `fail(...)`，在 `setup` 里抛出即插件加载失败。写入共享配置**之前**先对将要生效的文件跑：

```bash
mkdir -p /project/tmp/gate-rollout
cd /project/glx/scripts/opencode-crew && F=<待检查的 json 文件> bun -e '
const { parseCrewOptions } = await import("./src/config.ts")
const cfg = JSON.parse(await Bun.file(process.env.F).text())
for (const p of cfg.plugins ?? [])
  if (String(p.package ?? p).includes("opencode-crew")) console.log(process.env.F, JSON.stringify(parseCrewOptions(p.options ?? {}).reviewGate))
'
```
成功标准：输出 `{"mode":"remind",...,"sensitiveGlobs":["**/AGENTS.md","agents/**","**/role-guard.*"],...}`，无异常。（一行脚本**需验证**可运行；不通就让 engineer 写成等价 `.ts` 放 `/project/tmp/gate-rollout/precheck.ts`。）对项目层先看到的是**该层单独**的解析结果，足够校验取值合法；A/B 的合并结果以 §1.3 实验为准。

---

## 3. 观察期怎么落地

### 3.1 时长与到期条件

原方案的「≥7 天且 ≥10 次提醒」在本机**到不了**：分析目录几乎不产生提醒，开发仓库一周也未必有 10 次。改为：

- **固定 14 个日历日**；14 天内累计 **≥8 条**提醒则**提前**到期，但不得早于第 7 天。
- 到期时的默认结论是**保持 `remind`**。低流量下不靠「等到足够多的样本」来升级 `enforce`（`enforce` 的验证是独立的，见 §4.3）。
- 仅在以下任一出现时才改配置：无响应提醒 ≥3 次且 ≥20% → 评估 `enforce`；误报（`Review-Skip` 理由为「纯文档/格式/噪音」）>30% → 提高 `maxFiles` 或补 `ignoreGlobs`（数组整体替换，需重列默认项）；提醒为 0 且抽查没有漏报 → 保持，不是失败。

### 3.2 要看的信号

1. 提醒条数、命中规则分布（`sensitivePath`/`fileCount`/`planMultiFile`/`incomplete`/`deletedTest`/`outsideScope`）、涉及目录。
2. 每条提醒之后的处置：派了 reviewer / 写了 `Review-Skip:` / 无响应。
3. 漏报抽查：开发仓库里「≥6 个计数文件的改动却没有提醒」。
4. 健康信号：宿主日志里有没有插件加载错误、`ENOSPC`、`Agent not found`（重载副作用）。
5. 副作用：`incomplete` 占比高说明 `git status` 超过 3 秒/1 MB，对应目录应被 `.gitignore`。

### 3.3 命令（`sqlite3` 判断：不可用，用 `bun:sqlite`）

在 `/usr/bin`、`/usr/local/bin`、`/bin` 下**没有找到 `sqlite3`**（`jq`、`gh` 存在；`bun` 在 `~/.bun/bin/bun`）。**需验证**：`command -v sqlite3`；不存在就用 Bun 内置的 `bun:sqlite`，以只读方式打开。数据库是 `~/.local/share/opencode/opencode.db`，表 `session_message`（列 `id,type,seq,data,session_id`，S7 用过）。

注意：不要用 `like '%crewReviewGate%'` 的命中数直接当提醒数——开发会话读源码、讨论门禁时，工具输出里也含这个字符串。必须解析 JSON，要求 `metadata.crewReviewGate.fingerprint` 存在。

`/project/tmp/gate-rollout/gate-events.ts`：

```ts
import { Database } from "bun:sqlite"
const db = new Database(`${process.env.HOME}/.local/share/opencode/opencode.db`, { readonly: true })
const rows = db.query("select session_id, seq, id, data from session_message where data like '%crewReviewGate%' order by session_id, seq").all() as any[]
const find = (v: any): any => v && typeof v === "object" ? (v.crewReviewGate ?? Object.values(v).map(find).find(Boolean)) : undefined
let n = 0
for (const r of rows) {
  let d: any
  try { d = JSON.parse(r.data) } catch { continue }
  const g = find(d)
  if (!g?.fingerprint) continue            // 排除只是「提到」该字符串的行
  n++
  const next = db.query("select data from session_message where session_id=? and seq>? order by seq limit 1").get(r.session_id, r.seq) as any
  console.log(JSON.stringify({ session: r.session_id, seq: r.seq, msg: r.id, rule: g.rule, fp: g.fingerprint,
    next: String(next?.data ?? "").replace(/\s+/g, " ").slice(0, 160) }))
}
console.log("reminders:", n)
```
运行：`~/.bun/bin/bun /project/tmp/gate-rollout/gate-events.ts | tee -a /project/tmp/gate-rollout/observation-$(date +%F).txt`。`data` 的实际 JSON 层级与是否有 `time` 列**需验证**：先 `| head -3` 看一眼；`next` 字段只是「该提醒后下一条消息的前 160 字」，用来人工判断是 `Review-Skip:`、派 reviewer 还是无响应。提醒总量预计只有个位数，人工逐条读即可，不要为此写分类器。

若担心读正在写入的库：先 `du -h ~/.local/share/opencode/opencode.db*`，体量合理就把 `.db`、`.db-wal`、`.db-shm` 一起 `cp -p` 到 `/project/tmp/gate-rollout/db-snapshot/` 再对副本查询（全局指令也要求先备份再用外部工具查）。

漏报抽查（开发仓库，14 天内哪些提交触及 ≥6 个计数文件；与提醒时间对照）：

```bash
git -C /project/glx/scripts/opencode-crew log --since='14 days ago' --date=short --format='@%h %ad %s' --name-only \
  -- . ':!plans' ':!dist' ':!bun.lock' | awk '/^@/{ if(c>5) print h" files="c; h=$0; c=0; next } NF{c++} END{ if(c>5) print h" files="c }'
```
注意提交粒度不等于「一个 Root 回合的改动」，这只是找线索；对命中的提交，在对应时段用 `crew_review_gate`（项目级开启后 Root 可调用）复核当时为何没提醒（被 `ignoreGlobs` 吞了？reviewer 已覆盖？采集 `unavailable`？）。

健康信号：

```bash
grep -n -E 'ENOSPC|opencode-crew|Agent not found|loading plugin' ~/.local/share/opencode/log/opencode.log | tail -40
```

### 3.4 节奏

第 0 天（开启当天）、第 3 天、第 7 天、到期日各跑一次 §3.3 的脚本，把输出追加到 `/project/tmp/gate-rollout/observation-*.txt`；到期日在 `plans/evidence/review-gate-probe/s10-observation.md` 写结论（提醒数、规则分布、处置分布、漏报抽查、是否改配置）。

---

## 4. 风险、回滚与 `enforce`

### 4.1 最坏情况

| 情形 | 影响 | 防线 |
|---|---|---|
| options 写错（拼错键、`sensitiveGlobs` 以 `/` 开头或含 `..`、超 64 项）→ `setup` 抛错 | 对应 Location 的五个角色消失，运行中的子代理报 `Agent not found`；全局级则**所有**项目 | §2.3 离线预检；项目级优先（影响面是否真的局限于该项目**需验证**，见 §1.3，不能当作保证） |
| 重载中断运行中的子代理 | 丢失一次进行中的任务 | 只在无活跃 `crew_task`、侧栏无运行中子代理时改配置（`crew_task_status` 无 active） |
| 提醒刷屏 | 每条提醒是一条 `queue` 的 synthetic 消息，会多触发一次 Root 回合（一次模型调用） | `remind`：同一改动集只发一次，会话总量上限 `5 × maxReminders = 10`；门禁是软提醒，不阻塞 |
| `git status` 同步阻塞 | 每个 Root 回合结束最多 3 秒 | 见 §2.2；本机仓库小，可忽略 |
| 门禁自身出错 | 无：`registerReviewGate` 的 idle/prompt 回调全部 fail-open（`catch {}`） | — |
| `enforce` | 同一改动集最多再多 `maxReminders` 次模型调用，且真机未验证 | 不上 |

### 4.2 一行撤销

先备份再改，改完 `/reload`（inotify 已耗尽，不依赖自动重载；见 `docs/run-copy-release.md` 的「不要只依赖自动重载」）：

- 项目级：`rm /project/glx/scripts/opencode-crew/.opencode/opencode.json`（或把 `"mode": "remind"` 改成 `"off"`）。
- 全局级：`cp -p ~/.config/opencode/opencode.json ~/.config/opencode/opencode.json.bak-gate-$(date +%Y%m%dT%H%M%S)` 后，`sed -i 's/"mode": "remind"/"mode": "off"/' ~/.config/opencode/opencode.json`；或删除 `reviewGate` 整块（默认即 `off`）。
- 验证：`/reload` 后 Root 工具列表里没有 `crew_review_gate`；制造一个必命中的改动（在载体仓库新增 `AGENTS.md`），确认没有新的 `crewReviewGate` 消息。旧 hook 是否被宿主清理**需验证**；不清理就需要 `opencode service restart`（文档说明仅在服务卡住时才用）。
- 单条提醒误报：让 Root 回复 `Review-Skip: <≥10 字的具体理由>`，不必改配置、不触发重载。

### 4.3 `enforce` 的门槛与最小验证（简化自原方案 §4.5）

**门槛**（全部满足才考虑改 `mode`）：
1. 观察期结论里「无响应提醒 ≥3 次且 ≥20%」（Root 确实在忽略提醒）；
2. 下面 E1、E2 在隔离宿主上通过。

**验证全部在隔离宿主做**（沿用 §1.3 的隔离环境变量与 provider 配置；载体 `$ROOT/carrier` = `git init` + 一次提交），**不改共享配置、不重载共享服务**：

- 隔离全局配置里加 `"reviewGate": {"mode":"enforce","maxReminders":2,"sensitiveGlobs":["**/AGENTS.md"]}`。
- E1（重复注入）：`opencode run --standalone --agent root -m tcuni/gpt-6-luna#low`，提示「创建 `AGENTS.md`；之后收到 `[crew-review-gate]` 提醒时只回复 ack，不派 reviewer，也不写 `Review-Skip`」。成功标准：§3.3 的脚本（把数据库路径换成隔离 `XDG_DATA_HOME`）统计该会话**恰好 2 条**（= `maxReminders`），之后不再增加。模型若自行写了 skip/派了 reviewer，该次无效，重跑。
- E2（reviewer 覆盖后停止）：另起会话，收到第一条提醒后指示「派 reviewer 只读 `AGENTS.md` 并回复 ok」。成功标准：提醒保持 **1 条**；随后 Root 调用 `crew_review_gate`，`native.reviewerCovered` 为 `true`。reviewer 用 `opus-5-5#high`，任务限定只读一个文件以控成本。
- E3（可选，与 E1 同会话）：第二条提醒后回复 `Review-Skip: <≥10字理由>`，成功标准：条数保持 2 且不再增加。
- 证据写到 `plans/evidence/review-gate-probe/s8-enforce.md`。

「reviewer 覆盖后停止」在 `remind` 观察期里也会自然出现；若观察期内看到一次「派了 reviewer 后没有再提醒」，可作为 E2 的补充证据，但不替代 E2。

---

## 5. 「真机验证 enforce」与「开 remind」：严格分开

- **`enforce` 验证不需要碰共享服务**（§4.3 全在隔离宿主），所以与 `remind` 上线没有任何耦合。可以先做、后做、或与 §1.3 的实验在同一个隔离环境里连续做，互不影响。
- **`remind` 上线需要一次重载**，会中断运行中的子代理：单独占一个安静窗口，不和任何其他需要重载的事情（发布新 `dist`、改 `agents/*.md`、切 `models`）叠加，否则出问题无法归因。
- 不要为了「验证 `enforce`」把共享服务临时切到 `enforce`（S7 当时对 `remind` 这么做过一次，代价是一次重载 + 一次还原；现在有隔离宿主做法，不再需要）。
- 建议顺序：
  1. 隔离环境：§1.3 范围实验；
  2. 隔离环境（可同一天）：§4.3 的 E1/E2——这一步不是上线 `remind` 的前提，可延后；
  3. 共享服务：§2.3 预检 → 安静窗口写配置 → `/reload` → 验收（见 §6）；
  4. 观察 14 天（§3）。

## 6. 启用当天的验收（项目级或全局级相同）

| # | 检查 | 成功标准 |
|---|---|---|
| 1 | 备份存在、改动只含 `reviewGate` | `diff` 只含该块 |
| 2 | `/reload` 后五个角色仍在 | `opencode debug agents` 或 TUI 选择器五个都在（**需验证**该子命令） |
| 3 | 在开发仓库的 Root 会话调用 `crew_review_gate`（输入 `{}`） | `mode:"remind"`、`hooks:{idle:true,prompt:true}`、`config.sensitiveGlobs` 为三项；`notes` 无 `IDLE_HOOK_UNAVAILABLE`/`PROMPT_HOOK_UNAVAILABLE` |
| 4 | 范围：项目级时，到**另一个**目录（如某个非 git 分析目录）开 Root 会话 | 工具列表里**没有** `crew_review_gate`（若有，说明项目级没有限定住，立即撤销并按 C 处理） |
| 5 | 侧栏、display RPC、配置档 | 与启用前一致（`docs/run-copy-release.md` 验收表的相应行） |
| 6 | `git status --porcelain`（开发仓库） | 没有 `.opencode/`（§1.4） |

---

## 7. 需要用户拍板（最多 2 条）

1. **若隔离实验结论是 C（只能全局）：接受全局 `remind`，还是继续 `off`？** 我的建议是接受：38/40 个分析目录非 git，2 个 git 仓库干净，`remind` 软提醒且封顶，一行可撤销；前提是 §2.2 的补充核查没有发现大量脏 git 仓库（`/project/glx/scripts/*`、`/data_0/panel_design/projects/*`）。
2. **项目级配置文件 `.opencode/opencode.json` 用 `.git/info/exclude` 本地忽略（建议），还是提交进仓库？** 它含本机绝对路径（`opencode-crew-live`），提交不合适且会在 `git status` 里造成噪音；提交需要你同意。

## 8. 未决（需验证，已给方法）

- 同一 `package` 的 options 在多层配置里是 A/B/C 哪一种：§1.3。
- 项目层配置写错时的影响面是否仅限该 Location：隔离环境里再建 `proj-bad`（`reviewGate.mode` 写成 `"bogus"`），跑 `opencode debug agents` 看 `proj-bad` 报错而 `proj-on`/`proj-off` 不受影响（单进程只能说明配置层面隔离；同一常驻服务内的跨 Location 影响无法由此证明，故 §2.3 的预检仍是硬要求）。
- 项目层配置变更是否仅重载该 Location，而非整个服务：只能在共享服务上观察（启用时看别的目录里运行中的子代理是否被打断）；未验证前一律按「会中断」处理。
- `opencode debug agents`、`command -v sqlite3`、`session_message.data` 的 JSON 层级。
