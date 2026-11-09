// TUI side effects of `/crew-profile`. Every branch is defensive: the keymap layer
// must never receive a rejected promise, and the footer is refreshed from RPC data.

import type { Context } from "@opencode/plugin/tui/context"
import { crewProfiles, parseProfilesView, parseSwitchView, type CrewProfilesView } from "../profile-rpc"
import { PROFILE_USAGE, parseProfileCommand } from "./profile-command"
import { profileListText, profileOptions, type ProfilePick } from "./profile-menu"

export const PROFILE_MEMORY_KEY = "opencode-crew-profile"

/** Footer cache only: the pointer file on disk stays the single source of truth. */
export type ProfileMemory = { active: string; error: string; at: number }

const TITLE = "Crew 配置档"
const UNAVAILABLE = "宿主不支持 RPC，暂时无法读取或切换档位。"

export function profileRpc(context: Context) {
  return context.client.rpc(crewProfiles)
}

const callOptions = (context: Context) => (context.location ? { location: context.location } : undefined)

export async function refreshProfile(context: Context): Promise<CrewProfilesView | undefined> {
  try {
    return parseProfilesView(await profileRpc(context).list({}, callOptions(context)))
  } catch {
    return undefined
  }
}

/** Mirrors the response into the shared memory store so the footer updates immediately. */
export function rememberProfile(context: Context, view: CrewProfilesView | undefined): void {
  if (!view) return
  try {
    const [, mutate] = context.storage.memory<ProfileMemory>(PROFILE_MEMORY_KEY, { initial: { active: "", error: "", at: 0 } })
    mutate(draft => {
      draft.active = view.active ?? ""
      draft.error = view.error ?? ""
      draft.at = Date.now()
    })
  } catch {
    // The footer is presentation only; a store failure must not break the command.
  }
}

async function alert(context: Context, title: string, message: string): Promise<void> {
  try { await context.ui.dialog.alert({ title, message }) } catch { /* closing renderer */ }
}

async function switchTo(context: Context, name: string): Promise<void> {
  try {
    const view = parseSwitchView(await profileRpc(context).switch({ name }, callOptions(context)))
    if (!view) {
      await alert(context, "切换失败", "宿主返回了无法识别的结果；档位状态未确认。")
      return
    }
    rememberProfile(context, view.profiles)
    if (!view.ok) {
      await alert(context, "切换失败", view.message ?? view.code ?? "未知原因；档位状态未改变。")
      return
    }
    context.ui.toast.show({ variant: "success", message: `已切换到档 "${name}"（新会话/下一次请求生效）` })
    for (const warning of view.warnings) context.ui.toast.show({ variant: "warning", message: warning })
  } catch {
    await alert(context, "切换失败", "宿主调用失败；档位状态未确认。")
  }
}

async function switchOff(context: Context): Promise<void> {
  try {
    const view = parseSwitchView(await profileRpc(context).off({}, callOptions(context)))
    if (!view) {
      await alert(context, "关闭失败", "宿主返回了无法识别的结果；档位状态未确认。")
      return
    }
    rememberProfile(context, view.profiles)
    if (!view.ok) {
      await alert(context, "关闭失败", view.message ?? view.code ?? "未知原因；档位状态未改变。")
      return
    }
    context.ui.toast.show({
      variant: "success",
      message: view.changed ? "已关闭档位，回到 opencode.json 配置（新会话/下一次请求生效）" : "档位已是关闭状态",
    })
    for (const warning of view.warnings) context.ui.toast.show({ variant: "warning", message: warning })
  } catch {
    await alert(context, "关闭失败", "宿主调用失败；档位状态未确认。")
  }
}

async function openMenu(context: Context): Promise<void> {
  const view = await refreshProfile(context)
  if (!view) {
    await alert(context, TITLE, UNAVAILABLE)
    return
  }
  rememberProfile(context, view)
  const { options, current } = profileOptions(view)
  let picked: ProfilePick | undefined
  try {
    picked = await context.ui.dialog.select<ProfilePick>({ title: TITLE, options, current })
  } catch {
    return
  }
  if (!picked) return
  if (picked.kind === "off") await switchOff(context)
  else await switchTo(context, picked.name)
}

export async function runProfileCommand(context: Context, raw: string): Promise<void> {
  const command = parseProfileCommand(raw)
  switch (command.kind) {
    case "help":
      await alert(context, TITLE, PROFILE_USAGE)
      return
    case "invalid":
      await alert(context, "用法", `${command.message}\n\n${PROFILE_USAGE}`)
      return
    case "list": {
      const view = await refreshProfile(context)
      if (!view) {
        await alert(context, TITLE, UNAVAILABLE)
        return
      }
      rememberProfile(context, view)
      await alert(context, TITLE, profileListText(view))
      return
    }
    case "menu":
      await openMenu(context)
      return
    case "switch":
      await switchTo(context, command.name)
      return
    case "off":
      await switchOff(context)
      return
  }
}
