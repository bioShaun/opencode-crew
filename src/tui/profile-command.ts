// Slash-command parsing for `/crew-profile`; pure so it stays unit-testable.

import { isProfileName } from "../config"

export const PROFILE_USAGE = [
  "用法：",
  "/crew-profile            选择档位（Enter 切换，Esc 取消）",
  "/crew-profile <name>     直接切换到指定档",
  "/crew-profile list       列出档目录、可用档与错误",
  "/crew-profile off        关闭档位，回到 opencode.json 配置",
  "/crew-profile help       显示本帮助",
  "",
  "档位是用户级全局设置，文件位于 OPENCODE_CREW_PROFILES_DIR 或 ${XDG_CONFIG_HOME:-~/.config}/opencode/crew-profiles。",
].join("\n")

export type ProfileCommand =
  | { kind: "menu" } | { kind: "list" } | { kind: "off" } | { kind: "help" }
  | { kind: "switch"; name: string }
  | { kind: "invalid"; message: string }

export function parseProfileCommand(raw: string): ProfileCommand {
  // The host may pass only the argument text or the raw slash line depending on
  // its `slash.arguments` implementation; accept both without changing the grammar.
  const text = (raw ?? "").trim().replace(/^\/(?:crew-profile|crewprofile)(?:\s+|$)/i, "").trim()
  if (!text) return { kind: "menu" }
  const parts = text.split(/\s+/)
  if (parts.length > 1) return { kind: "invalid", message: `只接受单个档名，收到 "${text}"。` }
  const token = parts[0]
  switch (token) {
    case "list": case "ls": return { kind: "list" }
    case "off": case "none": return { kind: "off" }
    case "help": case "-h": case "--help": return { kind: "help" }
  }
  if (isProfileName(token)) return { kind: "switch", name: token }
  return { kind: "invalid", message: `档名 "${token}" 不合法（只允许小写字母 a-z、数字 0-9 与 . _ -）。` }
}
