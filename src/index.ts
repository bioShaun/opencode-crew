import { Plugin } from "@opencode/plugin"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "yaml"
import { registerTasks } from "./tasks"

const IDS = ["root", "architect", "engineer", "explorer", "reviewer"] as const
type RoleID = typeof IDS[number]
type ModelRef = { providerID: string; id: string; variant?: string }
type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }
type Role = { description: string; mode: "primary" | "subagent"; steps?: number; permissions: Rule[]; system: string }

function fail(message: string): never { throw new Error(`[opencode-crew] ${message}`) }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function options(input: unknown) {
  if (!object(input)) fail("options 必须是对象")
  for (const key of Object.keys(input)) if (!["models", "steps"].includes(key)) fail(`未知 options.${key}`)
  const models: Partial<Record<RoleID, ModelRef>> = {}, steps: Partial<Record<RoleID, number>> = {}
  for (const field of ["models", "steps"] as const) {
    const map = input[field] ?? {}
    if (!object(map)) fail(`options.${field} 必须是角色映射`)
    for (const [id, value] of Object.entries(map)) {
      if (!IDS.includes(id as RoleID)) fail(`未知角色 options.${field}.${id}`)
      if (field === "steps") {
        if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(`options.steps.${id} 必须为正整数`)
        steps[id as RoleID] = value as number
      } else {
        if (typeof value !== "string" || !/^[^\s/#]+\/[^\s#]+(?:#[^\s#]+)?$/.test(value)) {
          fail(`options.models.${id} 必须为 provider/model[#variant]；省略即可继承会话模型`)
        }
        const [left, variant] = value.split("#"), slash = left.indexOf("/")
        models[id as RoleID] = { providerID: left.slice(0, slash), id: left.slice(slash + 1), ...(variant ? { variant } : {}) }
      }
    }
  }
  return { models, steps }
}

function loadRole(id: RoleID): Role {
  const text = readFileSync(new URL(`../agents/${id}.md`, import.meta.url), "utf8")
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(text)
  if (!match) fail(`agents/${id}.md 缺少 frontmatter 或正文`)
  const meta = parse(match[1])
  if (!object(meta)) fail(`agents/${id}.md 元数据必须是对象`)
  for (const key of Object.keys(meta)) if (!["description", "mode", "steps", "permissions"].includes(key)) fail(`agents/${id}.md 不支持 ${key}；模型请写 options.models`)
  if (typeof meta.description !== "string" || !meta.description.trim() || meta.mode !== (id === "root" ? "primary" : "subagent")) fail(`agents/${id}.md 的 description/mode 无效`)
  if (meta.steps !== undefined && (!Number.isSafeInteger(meta.steps) || (meta.steps as number) <= 0)) fail(`agents/${id}.md steps 无效`)
  if (!Array.isArray(meta.permissions) || !meta.permissions.every(r => object(r) && typeof r.action === "string" && typeof r.resource === "string" && ["allow", "ask", "deny"].includes(String(r.effect)))) fail(`agents/${id}.md permissions 无效`)
  return { ...meta, system: match[2].trim() } as Role
}

export default Plugin.define({
  id: "opencode-crew",
  async setup(ctx) {
    // Validate every input before registering anything; prompts/policies exist only in Markdown.
    const config = options(ctx.options ?? {})
    const roles = Object.fromEntries(IDS.map(id => [id, loadRole(id)])) as Record<RoleID, Role>
    await ctx.agent.transform(editor => {
      for (const id of IDS) editor.update(id, agent => {
        const role = roles[id]
        agent.name = id
        agent.description = role.description
        agent.mode = role.mode
        agent.system = role.system
        agent.steps = config.steps[id] ?? role.steps
        agent.model = config.models[id]
        // An empty Root policy adds no rules; retain the host's existing permissions.
        if (id === "engineer") agent.permissions = [...agent.permissions, ...role.permissions.map(rule => ({ ...rule }))]
        else if (id !== "root" || role.permissions.length > 0) agent.permissions = role.permissions.map(rule => ({ ...rule }))
        // Match absolute lexical tool paths too; this is not symlink isolation.
        if (id === "architect") agent.permissions.push({ action: "edit", resource: resolve(ctx.location.directory, "plans") + "/**", effect: "allow" })
      })
    })
    await ctx.command.transform(editor => editor.add({
      name: "crew",
      description: "切换到 Crew Root；简单任务直接做，复杂任务按需分工",
      async execute({ sessionID, prompt, delivery }) {
        await ctx.session.switchAgent({ sessionID, agent: "root" })
        if (config.models.root) await ctx.session.switchModel({ sessionID, model: config.models.root })
        if (!prompt.text?.trim() && !prompt.files?.length && !prompt.agents?.length && !prompt.skills?.length) return
        await ctx.session.prompt({ ...prompt, sessionID, delivery })
      },
    }))
    await registerTasks(ctx, config.models.engineer)
  },
})
