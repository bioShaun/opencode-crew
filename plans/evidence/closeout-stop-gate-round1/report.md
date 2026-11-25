# 首轮 stop gate 红灯取证

cwd: `/home/tcuni-claw/opencode/opencode-crew`; HEAD: `27d12c33df700814781d25070075c1e28190f3c5`。TMPDIR: `$PWD/test/.work/tasks-maintenance/tmp`。

- `bun test test/tasks-maintenance.test.ts -t 'round1 stop gate'`：退出 1，完整合并 stdout/stderr：`red.log`，退出码：`red.exit`。2 个测试均因实际返回 `ok:true`、未抛预期证据不足异常失败；不是 fixture、schema 或导入错误。
- R1 私有 fixture：`test/.work/tasks-maintenance/92a9a1e1-c728-4be7-b997-947689a2acd4`。plan 返回成功，registry、active、closed、generation、backups、archives、evidence、target、worktree 均未变，未发现锁或临时文件残留。
- R2 私有 fixture：`test/.work/tasks-maintenance/40fe809d-47a0-4cfd-8184-eb0dbf8c3e4a`。plan 成功、apply 返回成功；generation 5→6，active 1→0，closed 0→1，新增 backup 和 archive；evidence、target、worktree 不变，无锁或临时文件残留。完整观测见 `red.log`。
- `bun test test/tasks-maintenance.test.ts -t 'plan is read-only|close apply moves|missing, mismatched, and unresolved'`：退出 0，4 pass（模式还匹配已有 migration plan 测试），见 `control.log`、`control.exit`。
- `git diff --check`：退出 0，见 `diff-check.log`、`diff-check.exit`。

仅写测试，未修复生产代码，未运行全套或构建。R2 将来 plan 门禁修复后不可直接作为可达 apply 回归测试，需要另行设计。测试不能证明真实进程安全或真实维护窗口合规。
