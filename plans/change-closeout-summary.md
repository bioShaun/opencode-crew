# 变更收尾与候选清单

日期：2026-11-02；基线 HEAD `27d12c33df700814781d25070075c1e28190f3c5`。本清单仅供审核，不代表已暂存、提交、发布或部署。

**分层结论：产品修复的既有测试和 r4 展示结果已记录；原包级最小权限完整验收仍为 partial / blocked。**缺少同一次最小权限下的 catalog 与 search 展示证据，不能合并 r4 的展示通过和 r5 的权限收窄当作完整通过。本文件就绪仅表示文档可审核，不表示包级验收通过。

## 建议审核的逻辑单元

1. **维护结案门禁**：[`src/tasks-maintenance.ts`](../src/tasks-maintenance.ts) 与 [`test/tasks-maintenance.test.ts`](../test/tasks-maintenance.test.ts)。首次 close 拒绝非 stop 阶段；历史幂等重放及现场安全边界见相关方案。该门禁不证明进程已停止或现场安全。
2. **工具展示摘要**：[`src/tasks.ts`](../src/tasks.ts) 与 [`test/tasks-interface.test.ts`](../test/tasks-interface.test.ts)。三个工具首行摘要及 start 长度回归；完整 description 仍供 search 使用。
3. **可选文档与忽略规则**：根目录 [`.gitignore`](../.gitignore) 已增加五个精确证据目录；可按需审核 [首轮方案](closeout-stop-gate-round1.md)、[修复方案](closeout-stop-gate-fix.md)、[异常证据可行性](closeout-exception-evidence-feasibility.md)、[包级展示验证方案](package-display-verification.md)、[实际验证结果](package-display-verification-results.md) 与本摘要。这些方案记录历史契约与授权边界；展示和权限须按结果文件的 r4、r5 分层理解。

候选单元及精确 ignore 规则已整理完成，但不暂存、不提交。用户原有未跟踪文件 `plans/worktree-stage1-closeout-spec.md` 明确排除，不改动、不纳入候选。原始证据、fixture、日志和缓存不纳入候选；精确 ignore 不删除原材料、不改变 tracked 文件归属。

## 已有验证事实与历史

维护门禁的修复前测试因旧实现允许非 stop 状态 close 而红灯，修复后验证见本地 [门禁证据索引](evidence/closeout-stop-gate-fix/report.md)。早期工具摘要仅验证注册文本；随后真实 host 的 display-r3 暴露 start 默认 catalog 截断，不能用 search 成功替代 catalog。之后新增长度测试先红：实际 159 字符，要求不超过 117；压缩后接口测试 14 pass，全量测试 216 pass，私有副本 build 成功。证据索引为 [首行压缩](evidence/tool-summary-compact/report.md) 和 [原摘要](evidence/tool-summary/report.md)。这些是此前运行的结果，本次收尾未重跑。

display-r4 在私有 OpenCode host **2.2.5** 与 fixture provider 上展示通过：包 SHA256 `41e200e0424d7426d04227f5a941726e465b3fe435b36e015d41e42069778dfa`；三个工具完整注册与源码预期一致，默认 catalog 的目标摘要均通过，start 实际首行 116 字符且与注册首行相同；关联固定调用的 search 返回三个完整 description，与源码及注册值相等。仅创建一个 Root session，实际仅固定 search，无 task 执行或 fixture task ledger，本轮进程组均已回收。fixture 将 Crew execute 替换为执行前拒绝的 stub，但 Root 为宽泛 allow，且无 OS sandbox，因此不满足最小权限，也不证明真实模型表现、task 业务行为或其他 host 的展示。

后续 display-r5 的有效权限为 deny `*` 加 allow `execute`，但 ping 中 catalog 边界为 0，未执行 search；内部过滤原因尚未证实。注册捕获不替代 catalog，r5 不能补齐 r4 的权限缺口。完整分层与历史见[实际验证结果](package-display-verification-results.md)。

本地索引还包括 [首轮门禁](evidence/closeout-stop-gate-round1/report.md) 和原始展示目录 `test/.work/package-display/display-r4/`；上述证据目录被 ignore，**不会随 Git 提交**，本摘要保留关键事实。原始材料可能含私有信息，不作为提交材料。

主 `dist` 在展示验证前后未变，不能据此视为最新构建或已部署；发布流程通过 `prepack` 重建。本轮没有发布、升级版本 `0.1.0` 或打 tag。

用户已于 2026-11-02 确认接受上述限制，按有界范围收尾：停止追加展示实验，不放宽权限，不运行白名单实验。该决定不将原包级最小权限完整验收从 partial / blocked 改判为通过，也不包含暂存、提交、推送、发布或部署授权。白名单加 mock 已验证 stub 仅保留为未来另行授权后的可选探索，并非已验证方案，也不要求用户再造异常。
