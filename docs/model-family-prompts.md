# 模型族提示词差异（轻量适配）

OmO 一类编排会按模型族切换**整段 preset**（Claude 偏 mechanics：checklist / 委派表；GPT 偏 principle：短原则 / XML 边界）。Crew **不做**双轨整段引擎；只提供：

1. 共享角色契约（`agents/*.md` 正文）
2. **可选短附录**（同文件 `## 附录 · …`，默认不进 system；配置了可识别模型时再叠）
3. `crew_task_start` 任务包上的**短 family hint**（`src/model-family.ts`）

与 dsh 对照（Ticket / Report / 薄 Root）正交，不改 Source/Eval/Policy，不改 stage2 ledger。

## 何时用哪套

| 模型族 | 风格 | 怎么用 |
|---|---|---|
| **GPT**（OpenAI / `gpt-*` / ChatGPT / o-series / Codex） | principle：短原则、XML 式边界、少堆清单 | 配置 `options.models.<role>` 为 GPT 族 id 时，插件自动叠该角色的 **GPT 附录**，并在 `crew_task_start` 注入 GPT 短 hint |
| **Claude**（Anthropic / `claude*`） | mechanics：清单、委派表 | 正文默认已偏 mechanics；配置 Claude 族 id 时叠 **Claude 附录**（多为对照强化），并注入 Claude 短 hint |
| 其他 / 省略模型 | — | 只加载正文契约；不猜族、不叠附录、不注入 family hint |

识别逻辑见 `detectModelFamily`：provider/model 字符串匹配；**GPT 优先**于模糊情况。

## 角色 md 附录约定

每个 `agents/<role>.md` 正文之后可有：

- `## 附录 · GPT / principle（选用）` — **优先维护**；短原则 + 少量 XML 边界
- `## 附录 · Claude / mechanics（选用）` — 正文已够用时写「沿用上文」即可

`loadRole` 会把 `## 附录` 起的段落从默认 system **剥离**；仅当该角色 `options.models.<role>` 可识别为 gpt/claude 时再拼回对应附录。手工改提示时也可直接把某附录拷进正文（不再依赖运行时）。

## 运行时短 hint

`crew_task_start` 在任务包末尾追加 `modelFamilyTaskHint(engineerModel)`（几句，不是 OmO 整段）。engineer 模型取自 `options.models.engineer`，否则回退 Root 会话模型。

## 刻意不做

- 整段双轨 preset 引擎 / 按模型复制两套完整角色 md
- 调度器、Source/Eval/Policy、stage2 ledger 大改
- 把「换模型」做成必须换插件版本才能用

## 相关文件

- 本文
- `agents/*.md` 附录
- `src/model-family.ts`、`src/index.ts`（角色 system）、`src/tasks.ts`（任务 hint）
