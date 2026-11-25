# Evidence 索引与保留策略

`plans/evidence/` 同时包含两类材料：

1. **已提交的证据**：小型、精选、可随仓库分发的索引或摘要。
2. **本机保留的原始现场**：被 `.gitignore` 忽略的 fixture、数据库、缓存、完整日志、嵌套 worktree 和模型原生载荷。它们可能包含私有路径、私有数据或大量冗余内容，不能因为被 ignore 就视为已脱敏。

因此，历史文档中出现 `plans/evidence/...` 路径时，只表示该路径在生成文档的本机现场中存在或曾存在；不表示克隆仓库后一定存在。本文是当前索引，历史 plan 的日期、结论和授权边界不因本文改写。

## 已提交的精选证据

| 路径 | 内容 |
|---|---|
| `review-gate-probe/` | 审查门禁 S0/S7/S8 探针、真机摘要与精选 JSONL；包括 `summary.md`、`s7-real-machine.md`、`s8-enforce.md` |
| `root-only-probe/` | engineer 只能由 Root 派发的 R0/R4 探针与摘要 |
| `tui-options-probe/` | `plugins[].options` 不转发到 TUI 的真机探针、probe 插件与摘要 |
| `sidebar-recovery/` | 侧栏恢复的验收摘要、baseline patch/status/hash；原始日志仍留在本机 |
| `closeout-stop-gate-fix/report.md` | close stop gate 修复的红绿、全量测试与溯源索引 |
| `closeout-stop-gate-round1/report.md` | 首轮 close stop gate 行为证据索引 |
| `tool-summary-compact/report.md` | 工具首行压缩修复的红绿与全量测试索引 |
| `tool-summary/report.md` | 原工具摘要修复的红绿与全量测试索引 |

## 本机保留、默认不可分发的现场

以下目录或文件被 `.gitignore` 忽略；引用它们的历史文档在本机可溯源，但克隆仓库后通常不可复现：

- `worktree-stage0/`、`worktree-stage1/`：真实宿主 fixture、私有数据库、缓存、嵌套 clone/worktree、provider payload 和完整运行日志。
- `crew-followup/`：host-verify fixture、provider/witness 原始事件与多轮 attempt 现场。
- `closeout-stop-gate-fix/`、`closeout-stop-gate-round1/`、`tool-summary/`、`tool-summary-compact/` 中除上述 `report.md` 外的日志、diff、退出码和临时材料。
- `closeout-exception-evidence-feasibility/`、`sidebar-recovery/` 的日志目录、`review-gate-probe/*.log`、`root-only-probe/build.log`、`tui-options-probe/*screen*.log`、顶层 `s2-*.log` / `s3-*.log`。

不要 `git add -f` 整个 ignored 目录，也不要把数据库、cache、嵌套 worktree、provider payload 或认证材料复制到仓库。确需分享时，另建白名单导出：只带必要摘要、脚本、哈希清单和脱敏片段。

## 计划产出但尚未生成

`plans/gate-rollout-decision.md` 中提到的以下文件是观察期或后续实验的计划输出，当前不存在不代表链接损坏：

- `review-gate-probe/s9-scope.md`
- `review-gate-probe/s10-observation.md`

## 新增证据的规则

1. 优先提交小型 `report.md` / `summary.md` / 哈希清单；原始日志和 fixture 默认留在 ignored 现场。
2. 提交前扫描密钥、token、cookie、认证头和隐私数据；路径泄露按项目敏感度判断，不要把“扫描未命中”当作脱敏证明。
3. 需要永久引用的证据必须提交，或在外部持久化系统给出稳定位置；只在 ignored 现场存在的材料要写成“本机证据”。
4. 不用 Git LFS 迁移大 evidence；当前威胁模型没有“外部人员必须复现完整真机现场”的需求。
