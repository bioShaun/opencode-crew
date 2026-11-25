# 注册首行摘要验证

工作目录：`/home/tcuni-claw/opencode/opencode-crew`；HEAD `27d12c33df700814781d25070075c1e28190f3c5`。仅改 `src/tasks.ts` 三条首行与 `test/tasks-interface.test.ts` 三个新增测试；既有 maintenance 修改保留。

| 检查 | 日志 | 退出码 / 结果 |
|---|---|---|
| 仅新增测试后 `bun test test/tasks-interface.test.ts -t 'description first line'` | red.log | 1；0 pass、3 fail，分别缺少同一 Root、缺少不传 taskID、缺少停止不证明；非语法或导入错误 |
| 红灯源文件哈希 / diff | src-red.sha256、red.diff | 源文件当时未修改，diff 仅新增测试 |
| 相同定向测试 | green.log | 0；3 pass、0 fail |
| `bun test test/tasks-interface.test.ts` | interface.log | 0；13 pass、0 fail |
| `slot audit`、`slot status` | preflight-full.log | 均 0；audit 未发现绕过 slot 的重进程 |
| `slot cpu -- bun test` | full.log | 0；215 pass、0 fail |
| 隔离副本 `bun run build` | build.log | 0；src 与 package 前后均一致，使用主依赖；主 dist/index.js 前后 SHA256 一致 |
| `git diff --check`、范围 diff 与状态 | diff.log | diff --check 0；保留其他既有修改 |

测试与主检查 cwd 为上述工作目录，build cwd 在 `test/.work/tool-summary/build`；TMPDIR 为 `test/.work/tool-summary/tmp`。本轮仅验证注册文本，不操作真实 host/ledger，不声称新 host 实测或模型误用率改善；未提交推送。
