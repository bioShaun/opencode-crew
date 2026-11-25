# Close stop gate 验证与溯源报告

## 范围与结果

首次 close 的共享校验仅接受 `stop_requested` 或 `stop_unconfirmed`；六种非 stop 状态在 plan 和 apply 均拒绝，错误码为 `MAINTENANCE_EVIDENCE_INSUFFICIENT`。历史凭据重放顺序不变。永久测试包括六状态双入口、无持久副作用快照、builder parity、stop 兼容控制，以及删除证据后的私有合成 submitted 历史记录重放。

本报告记录执行时事实；A/B 是**修复前**历史表征与红灯，C 和其后的检查是**修复后**结果，不应将 A/B 的测试文件版本当作最终交付版本。除本报告外，本次整理未再次运行测试或修改源码、测试、既有日志。

## Engineer 原始执行记录

以下命令中 `TMPDIR="$PWD/test/.work/tasks-maintenance/tmp"` 指向项目内临时目录。除 build 外，cwd 均为 `/home/tcuni-claw/opencode/opencode-crew`。日志和退出码文件均相对于本报告所在目录。表中命令不含重定向；输出分别保存至对应日志。

| 阶段 | 实际命令 | 退出码 | 结果与证据 |
|---|---|---:|---|
| A，修复前 | `TMPDIR="$PWD/test/.work/tasks-maintenance/tmp" bun test test/tasks-maintenance.test.ts -t 'legacy close characterization|legacy builder parity'` | 0 | `A.log`、`A.exit`、`A.diff`：7 pass；六状态各自 builder 与旧 planner 完整相等，builder 产物交旧 apply 成功，closed、backup、archive 等断言通过。 |
| B，修复前 | `TMPDIR="$PWD/test/.work/tasks-maintenance/tmp" bun test test/tasks-maintenance.test.ts -t 'close stop gate|round1 stop gate'` | 1 | `B.log`、`B.exit`、`B.diff`：14 fail，包含六状态各自 plan/apply 共 12 个独立行为红灯；旧实现返回成功，apply 实际产生结案写入。并非导入或语法错误。 |
| C 定向，修复后 | `TMPDIR="$PWD/test/.work/tasks-maintenance/tmp" bun test test/tasks-maintenance.test.ts -t 'close stop gate|round1 stop gate|legacy builder parity|compatibility|historical submitted'` | 0 | `C-targeted.log`、`C-targeted.exit`：18 pass，0 fail；拒绝快照不变，兼容和历史控制通过。 |
| maintenance 全文件，修复后 | `TMPDIR="$PWD/test/.work/tasks-maintenance/tmp" bun test test/tasks-maintenance.test.ts` | 0 | `C-maintenance.log`、`C-maintenance.exit`：34 pass，0 fail。 |
| 全量，修复后 | `TMPDIR="$PWD/test/.work/tasks-maintenance/tmp" slot cpu -- bun test` | 0 | `full.log`、`full.exit`：212 pass，0 fail；预检见 `preflight-test.log`。 |
| 隔离构建，修复后 | `TMPDIR="$OLDPWD/test/.work/tasks-maintenance/tmp" bun run build` | 0 | cwd 为 `/home/tcuni-claw/opencode/opencode-crew/test/.work/tasks-maintenance/build-fixture`；`build.log`、`build.exit`。该 fixture 使用项目 `package.json` 和 `src` 副本及项目 `node_modules` 链接，避免覆盖主目录已有 dist。 |

修复前 `src-before.sha256`、`src-after-A.sha256`、`src-after-B.sha256` 均为 `eb5f3140b3489fdf8aac41d8c0db6ba77ed081952bd242ba9b9d385cffed5d8c`；与 `root-final-git.log` 末尾 `git show HEAD` 源码哈希一致，证明 A/B 源码为未修基线。A/B 测试差异分别保存在上述 diff 中。

## Root 最终版本复跑及文件溯源

- `root-preflight-test.log`：Root 全量测试前的资源预检记录。
- `root-full.log`：记录项目 cwd、`slot cpu -- bun test`、测试前后源码及测试哈希；最终版本全量 212 pass、退出码 0。最终 `src/tasks-maintenance.ts` 哈希为 `897eafc5b60792105264e99e03812cfd7a0b1cc5d7ccede53e54f878714d8891`，`test/tasks-maintenance.test.ts` 为 `11d8a576b1d0b534220671ea2723c9a086ddfc3844043f9ecd6e3a9ea63aae0e`；详见日志前后记录。
- `root-build.log`：记录隔离构建 cwd、命令、当前源码与 package 副本逐文件一致的检查（均退出 0）、构建退出 0，以及主 `dist/index.js` 前后哈希相同。
- `root-final-git.log`：HEAD 为 `27d12c33df700814781d25070075c1e28190f3c5`；最终 tracked diff 为生产文件增加 1 行、测试文件增加 121 行，`diff_check_exit=0`、`other_tracked_diff_exit=0`。同日志的用户文件 `plans/worktree-stage1-closeout-spec.md` 哈希为 `63955f4bedd6ace450ddf4d2ab54c7c28129c1eab1937efc2e82c7b88d8a56a9`，可与首轮 `../closeout-stop-gate-round1/root-git-check.log` 对照。

## 限制

`stop_requested` 和现有 interrupt 字段组合的测试仅验证兼容性，并不认证停止已完成、进程安全或异常结案政策正确；完整异常政策仍待决定。静态私有 fixture 不代表真实现场排空或真实历史来源。未提交、未推送，未对真实 ledger、宿主执行维护或清理 worktree。
