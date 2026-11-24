import type { PermissionEvaluation } from "@opencode/plugin/promise/permission"

export type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }
export type ReadRole = "architect" | "explorer" | "reviewer"
export type Policies = Record<ReadRole, Rule[]>

function matches(pattern: string, value: string): boolean {
  return new RegExp("^" + pattern.split("").map(c => c === "*" ? ".*" : c === "?" ? "." : c.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")).join("") + "$", "s").test(value)
}

const severity = { allow: 0, ask: 1, deny: 2 } as const
const same = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect

export function hostBlock(policy: Rule[]): Rule[] {
  const actions = new Set(["shell", "edit", "execute", "subagent", "question", "webfetch", "websearch", ...policy.map(r => r.action).filter(a => !a.includes("*") && !a.includes("?") && a !== "external_directory")])
  return [...[...actions].map(action => ({ action, resource: "*", effect: "deny" as const })), ...policy.filter(r => !matches(r.action, "external_directory"))]
}

export function appendBlock(prefix: Rule[], block: Rule[]): Rule[] {
  const exists = prefix.some((_, i) => i + block.length <= prefix.length && block.every((rule, j) => same(rule, prefix[i + j])))
  return exists ? prefix : [...prefix, ...block.map(rule => ({ ...rule }))]
}

export function engineerDispatchDenied(action: string, resources: readonly string[], agent: string): boolean {
  return action === "subagent" && resources.includes("engineer") && agent !== "root"
}

export function guard(policies: Policies, getSession: (sessionID: PermissionEvaluation["sessionID"]) => Promise<{ agent?: unknown } | undefined>) {
  return async (event: PermissionEvaluation) => {
    if (event.action === "external_directory") return
    try {
      let agent: unknown = event.agent
      if (agent === undefined) agent = (await getSession(event.sessionID))?.agent
      if (typeof agent !== "string" || !agent.trim()) throw new Error("unknown agent")
      if (engineerDispatchDenied(event.action, event.resources, agent)) {
        event.effect = "deny"
        event.message = `Crew：engineer 只能由 Root 派发（调用者：${agent}）。请用 /crew 切到 Root，或改派 explorer / architect / reviewer。`
        return
      }
      if (!(agent === "architect" || agent === "explorer" || agent === "reviewer")) return
      const policy = policies[agent]
      const resources = event.resources.length ? event.resources : ["*"]
      let effect = event.effect
      for (const resource of resources) {
        const local = policy.filter(rule => matches(rule.action, event.action) && matches(rule.resource, resource)).at(-1)?.effect ?? "deny"
        if (severity[local] > severity[effect]) effect = local
      }
      if (effect !== event.effect) { event.effect = effect; event.message = "Crew 角色局部权限限制" }
    } catch {
      event.effect = "deny"
      event.message = "Crew 无法识别调用角色或求值权限"
    }
  }
}
