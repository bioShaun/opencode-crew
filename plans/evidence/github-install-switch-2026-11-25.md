# GitHub 固定 commit 安装切换验证（2026-11-25）

## 操作

- 备份：`~/.config/opencode/opencode.json.bak-github-install-20261125T141132`。
- `plugins[0].package` 从 `/project/glx/scripts/opencode-crew-live` 改为
  `github:bioShaun/opencode-crew#60b28dafb79b98cc9aa8afc87de8309b246ef284`，options 原样保留。
- 宿主：OpenCode v2.4.1；服务未重启，配置热加载。

## 结果

- 宿主日志已加载 GitHub 缓存入口：
  `~/.cache/opencode/npm/git-opencode-crew-d31ae483cf80/1795587138355/node_modules/opencode-crew/dist/index.js`。
- `opencode plugin list` 显示 `opencode-crew 60b28da github:bioShaun/opencode-crew#60b28da...`；`opencode plugin check` 显示 `60b28da (current)`。
- `opencode debug agents`：root/architect/engineer/explorer/reviewer 五个角色均存在。
- 烟测：`opencode run --agent root -m tcuni/gpt-6-luna#low '只回复 ok，不要调用任何工具。'` 退出码 0，输出 `ok`。

## 注意

- 本次直接改 package 后，宿主先在后台安装 GitHub 包；从配置热加载到插件入口出现约 46 秒，其间 Crew 角色短暂缺失。以后从本地路径切 GitHub 包时，应先预热全局插件缓存，或按 `opencode plugin add` 的安装语义避免这个空窗。
- 2026-11-24 的 `#main` 旧失败日志是生命周期脚本修复前/未固定验证 commit 的历史现象；本次固定 `60b28da` 已成功加载，不能混为一谈。
- 运行副本 `/project/glx/scripts/opencode-crew-live` 仍保留作为回滚/备用，不再参与当前运行。
