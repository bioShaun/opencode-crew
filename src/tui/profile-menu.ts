// Dialog/list/footer projections for crew profiles; pure functions over the RPC view.

import type { DialogSelectOption } from "@opencode/plugin/tui/context"
import type { CrewProfilesView } from "../profile-rpc"

export type ProfilePick = { kind: "profile"; name: string } | { kind: "off" }

const OFF_TITLE = "关闭档位（回到 opencode.json）"
const summary = (profile: CrewProfilesView["profiles"][number]) =>
  `${profile.rootModel ? `root: ${profile.rootModel}` : "root: inherit"} · ${profile.models} 模型 / ${profile.steps} 步数 / ${profile.instructions} 补充规则`

/** One option per profile plus a permanent "off" entry, so the user can always cancel a profile. */
export function profileOptions(view: CrewProfilesView): {
  options: DialogSelectOption<ProfilePick>[]
  current: ProfilePick | undefined
} {
  const options: DialogSelectOption<ProfilePick>[] = view.profiles.map(profile => ({
    title: `${view.active === profile.name ? "● " : "  "}${profile.name}`,
    description: summary(profile),
    value: { kind: "profile", name: profile.name } as ProfilePick,
    ...(profile.source === "package" ? { footer: "内置" } : {}),
  }))
  options.push({ title: OFF_TITLE, value: { kind: "off" } })
  const current: ProfilePick = view.active && view.profiles.some(profile => profile.name === view.active)
    ? { kind: "profile", name: view.active }
    : { kind: "off" }
  return { options, current }
}

export function profileListText(view: CrewProfilesView): string {
  const lines: string[] = []
  if (view.dirs.length) {
    for (const root of view.dirs) {
      lines.push(`目录：${root.dir}（${root.source === "package" ? "内置" : "用户"}，${root.exists ? "存在" : "不存在"}）`)
    }
  } else {
    lines.push("目录：未配置（OPENCODE_CREW_PROFILES_DIR 为空）")
  }
  lines.push(view.active ? `当前档：${view.active}` : "当前档：off（按 opencode.json 运行）")
  if (view.requested && view.requested !== view.active) lines.push(`指针内容：${view.requested}`)
  if (view.error) lines.push(`回退原因：${view.error}`)
  if (!view.profiles.length) {
    lines.push("可用档：无")
  } else {
    lines.push("可用档：")
    for (const profile of view.profiles) {
      lines.push(`${view.active === profile.name ? "● " : "  "}${profile.name}  ${summary(profile)}`)
    }
  }
  if (view.errors.length) {
    lines.push("错误：")
    for (const error of view.errors) lines.push(`  ${error.name || "(目录)"}: ${error.message}`)
  }
  return lines.join("\n")
}

/**
 * Default zero visual footprint: nothing renders without an active profile or an error.
 * `undefined` also covers "RPC not ready yet".
 */
export function profileFooterLabel(view: { active?: string; error?: string } | undefined): string | undefined {
  if (!view) return undefined
  const active = view.active ? view.active : undefined
  const warning = view.error ? " ⚠" : ""
  if (active) return `profile: ${active}${warning}`
  if (view.error) return `profile: off${warning}`
  return undefined
}
