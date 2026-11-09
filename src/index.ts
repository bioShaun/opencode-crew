import { Plugin } from "@opencode/plugin"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "yaml"
import { registerTasks } from "./tasks"
import { registerTaskSnapshot } from "./tasks-snapshot"
import { composeRoleSystem, splitRoleBody, type RoleAppendices } from "./model-family"
import { IDS, fail, object, parseCrewConfig, type RoleID } from "./config"
import { createCrewProfiles } from "./profile-state"
import { registerProfileRpc } from "./profile-rpc"

type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }
type Role = { description: string; mode: "primary" | "subagent"; steps?: number; permissions: Rule[]; system: string }

type LoadedRole = Role & { appendices: RoleAppendices }

function loadRole(id: RoleID): LoadedRole {
  const text = readFileSync(new URL(`../agents/${id}.md`, import.meta.url), "utf8")
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(text)
  if (!match) fail(`agents/${id}.md 缺少 frontmatter 或正文`)
  const meta = parse(match[1])
  if (!object(meta)) fail(`agents/${id}.md 元数据必须是对象`)
  for (const key of Object.keys(meta)) if (!["description", "mode", "steps", "permissions"].includes(key)) fail(`agents/${id}.md 不支持 ${key}；模型请写 options.models`)
  if (typeof meta.description !== "string" || !meta.description.trim() || meta.mode !== (id === "root" ? "primary" : "subagent")) fail(`agents/${id}.md 的 description/mode 无效`)
  if (meta.steps !== undefined && (!Number.isSafeInteger(meta.steps) || (meta.steps as number) <= 0)) fail(`agents/${id}.md steps 无效`)
  if (!Array.isArray(meta.permissions) || !meta.permissions.every(r => object(r) && typeof r.action === "string" && typeof r.resource === "string" && ["allow", "ask", "deny"].includes(String(r.effect)))) fail(`agents/${id}.md permissions 无效`)
  const { base, gpt, claude } = splitRoleBody(match[2].trim())
  return { ...meta, system: base, appendices: { gpt, claude } } as LoadedRole
}

export default Plugin.define({
  id: "opencode-crew",
  async setup(ctx) {
    // Validate every input before registering anything; prompts/policies exist only in Markdown.
    const baseline = parseCrewConfig(ctx.options ?? {})
    // Profiles are an optional overlay: a broken profile or pointer must never block
    // plugin load, otherwise the only self-rescue command (`/crew-profile off`) is gone.
    const profiles = createCrewProfiles({
      baseline,
      reload: async () => {
        if (typeof ctx.agent.reload !== "function") throw new Error("宿主未提供 agent.reload")
        await ctx.agent.reload()
      },
    })
    const roles = Object.fromEntries(IDS.map(id => [id, loadRole(id)])) as Record<RoleID, LoadedRole>
    await ctx.agent.transform(editor => {
      // Read inside the callback: switching a profile must apply on the next transform.
      const config = profiles.config()
      for (const id of IDS) editor.update(id, agent => {
        const role = roles[id]
        agent.name = id as typeof agent.name
        agent.description = role.description
        agent.mode = role.mode
        agent.system = composeRoleSystem(role.system, role.appendices, config.models[id], id === "engineer" ? config.engineerInstructions : undefined)
        agent.steps = config.steps[id] ?? role.steps
        agent.model = config.models[id] as typeof agent.model
        // An empty Root policy adds no rules; retain the host's existing permissions.
        // agent.reload() re-runs this transform, so appended rules must be idempotent.
        if (id === "engineer") {
          const extra = role.permissions.filter(rule => !agent.permissions.some(existing =>
            existing.action === rule.action && existing.resource === rule.resource && existing.effect === rule.effect))
          agent.permissions = [...agent.permissions, ...extra.map(rule => ({ ...rule }))]
        }
        else if (id !== "root" || role.permissions.length > 0) agent.permissions = role.permissions.map(rule => ({ ...rule }))
        // Match absolute lexical tool paths too; this is not symlink isolation.
        if (id === "architect") {
          const resource = resolve(ctx.location.directory, "plans") + "/**"
          const present = agent.permissions.some(rule => rule.action === "edit" && rule.resource === resource && rule.effect === "allow")
          if (!present) agent.permissions.push({ action: "edit", resource, effect: "allow" })
        }
      })
    })
    await ctx.command.transform(editor => editor.add({
      name: "crew",
      description: "切换到 Crew Root；简单任务直接做，复杂任务按需分工",
      async execute({ sessionID, prompt, delivery }) {
        const config = profiles.config()
        await ctx.session.switchAgent({ sessionID, agent: "root" })
        if (config.models.root) await ctx.session.switchModel({ sessionID, model: config.models.root })
        if (!prompt.text?.trim() && !prompt.files?.length && !prompt.agents?.length && !prompt.skills?.length) return
        await ctx.session.prompt({ ...prompt, sessionID, delivery })
      },
    }))
    // A getter, not a snapshot: the next launch must use the currently active profile.
    await registerTasks(ctx, () => profiles.config().models.engineer)
    await registerProfileRpc(ctx, profiles)
    await registerTaskSnapshot(ctx)
  },
})
