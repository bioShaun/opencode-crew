# 首行压缩验证索引

cwd：仓库根目录 `/home/tcuni-claw/opencode/opencode-crew`；基线 HEAD `27d12c33df700814781d25070075c1e28190f3c5`。原有四个 tracked 修改及未跟踪证据保留。`before.diff`、`after.diff` 记录本轮前后已有差异。

- 红灯：`red.log`，仅新增测试后运行长度测试，退出 1；实际 159，要求 <=117，失败为目标行为缺失。117 是本次 OpenCode 2.2.5 catalog 实测前缀预算，不是其他宿主的保证。
- 绿灯：`interface.log`，`bun test test/tasks-interface.test.ts` 退出 0，14 pass；包括长度、同 Root 同 key 同输入及结案、重投、重试、容量释放等首行语义测试，以及原完整描述契约测试。
- 全量：`preflight.log` 中 slot audit/status 均退出 0，未发现绕过 slot 的重进程；`full.log` 中 `slot cpu -- bun test` 退出 0，216 pass。
- 构建：`build.log`，私有副本的 src 和 package.json 与当前源逐项一致，使用同一 node_modules，隔离 `bun run build` 退出 0；主 dist 构建前后 SHA256 均为 `e9a6f385c2c00bc5fe339c0d03f423fcfefc17e600b0e917eea948937847d206`。
- `diff-check.log`：`git diff --check` 退出 0。命令均设置项目内 TMPDIR/TMP/TEMP；未提交或推送。

本轮只改产品 start 首行及对应测试，未修改 status/stop 或后续正文。未运行真实宿主或 ledger；实际宿主 catalog 展示须由 Root 后续独立验证，不宣称宿主验收通过。
