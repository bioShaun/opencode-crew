// Shared server/TUI contract: runtime imports must stay portable.
import type { Rpc } from "@opencode/plugin"
import type { Context } from "@opencode/plugin/promise/plugin"
import { object, parseCrewDisplay, type CrewDisplayConfig } from "./config"

export const crewDisplay = {
  id: "opencode-crew-display",
  methods: {
    get: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          aliases: { type: "object", additionalProperties: { type: "string" } },
          display: { type: "string", enum: ["inline", "off"] },
        },
        required: ["aliases", "display"],
        additionalProperties: false,
      },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export async function registerDisplayRpc(ctx: Context, display: CrewDisplayConfig): Promise<void> {
  const domain = ctx.rpc
  if (!domain || typeof domain.register !== "function") return
  try {
    await domain.register(crewDisplay, {
      async get() { return { aliases: { ...display.aliases }, display: display.display } },
    })
  } catch { /* A host without this RPC still has local sidebar settings. */ }
}

const control = /\p{Cc}/u
const isDisplayView = (value: unknown): value is { aliases: Record<string, unknown>; display?: unknown } =>
  object(value) && object(value.aliases)

export function parseDisplayView(value: unknown): CrewDisplayConfig {
  if (!isDisplayView(value)) return parseCrewDisplay(undefined)
  const aliases: Record<string, string> = {}
  let count = 0
  for (const [key, raw] of Object.entries(value.aliases)) {
    if (typeof raw !== "string" || control.test(key) || control.test(raw)) continue
    try {
      // Reuse the options validator one entry at a time so corrupt aliases do not poison the view.
      aliases[key] = parseCrewDisplay({ modelAliases: { [key]: raw } }).aliases[key]
      if (++count === 64) break
    } catch { /* Drop only this alias. */ }
  }
  return { aliases, display: value.display === "off" ? "off" : "inline" }
}

export function resolveDisplay(rpcValue: unknown, options: unknown): CrewDisplayConfig {
  if (isDisplayView(rpcValue)) return parseDisplayView(rpcValue)
  try { return parseCrewDisplay(options) }
  catch { return parseCrewDisplay(undefined) }
}
