import { test, expect } from "bun:test"
import { parseProfileCommand, PROFILE_USAGE } from "../src/tui/profile-command"
import { profileFooterLabel, profileListText, profileOptions } from "../src/tui/profile-menu"
import type { CrewProfilesView } from "../src/profile-rpc"

const view: CrewProfilesView = {
  active: "fast",
  dirs: [{ dir: "/home/u/.config/opencode/crew-profiles", source: "user", exists: true }],
  profiles: [
    { name: "fast", source: "user", models: 2, steps: 1, instructions: 1, rootModel: "p/root#high", roles: ["root", "engineer"] },
    { name: "pkg", source: "package", models: 0, steps: 0, instructions: 0, roles: [] },
  ],
  errors: [{ name: "broken", message: '[opencode-crew] 档 "broken" 不是合法 JSON' }],
}

test("parseProfileCommand covers the whole command table", () => {
  expect(parseProfileCommand("")).toEqual({ kind: "menu" })
  expect(parseProfileCommand("   ")).toEqual({ kind: "menu" })
  expect(parseProfileCommand("  list  ")).toEqual({ kind: "list" })
  expect(parseProfileCommand("ls")).toEqual({ kind: "list" })
  expect(parseProfileCommand("off")).toEqual({ kind: "off" })
  expect(parseProfileCommand("none")).toEqual({ kind: "off" })
  expect(parseProfileCommand("help")).toEqual({ kind: "help" })
  expect(parseProfileCommand("-h")).toEqual({ kind: "help" })
  expect(parseProfileCommand("--help")).toEqual({ kind: "help" })
  expect(parseProfileCommand("fast")).toEqual({ kind: "switch", name: "fast" })
  expect(parseProfileCommand(" gpt-4.1_v2 ")).toEqual({ kind: "switch", name: "gpt-4.1_v2" })
  // The host may pass either only the arguments or the whole slash line.
  expect(parseProfileCommand("/crew-profile")).toEqual({ kind: "menu" })
  expect(parseProfileCommand("/crew-profile fast")).toEqual({ kind: "switch", name: "fast" })
  expect(parseProfileCommand("/crewprofile off")).toEqual({ kind: "off" })
  expect(parseProfileCommand("/crewprofile list")).toEqual({ kind: "list" })
  for (const raw of ["fast slow", "../escape", "/abs", ".hidden", "x".repeat(65), "Fast", "a b c"]) {
    expect(parseProfileCommand(raw).kind).toBe("invalid")
  }
  const invalid = parseProfileCommand("../escape")
  if (invalid.kind === "invalid") expect(invalid.message).toContain("不合法")
  expect(PROFILE_USAGE).toContain("/crew-profile off")
})

test("profileOptions marks the current profile and always offers off", () => {
  const { options, current } = profileOptions(view)
  expect(options.map(option => option.title)).toEqual(["● fast", "  pkg", "关闭档位（回到 opencode.json）"])
  expect(options[0].description).toBe("root: p/root#high · 2 模型 / 1 步数 / 1 补充规则")
  expect(options[1].description).toBe("root: inherit · 0 模型 / 0 步数 / 0 补充规则")
  expect(options[1].footer).toBe("内置")
  expect(options[0].footer).toBeUndefined()
  expect(options[2].value).toEqual({ kind: "off" })
  expect(current).toEqual({ kind: "profile", name: "fast" })

  const offView: CrewProfilesView = { dirs: [], profiles: view.profiles, errors: [] }
  expect(profileOptions(offView).current).toEqual({ kind: "off" })
  expect(profileOptions(offView).options.at(-1)).toMatchObject({ value: { kind: "off" } })

  const empty: CrewProfilesView = { dirs: [], profiles: [], errors: [] }
  const emptyOptions = profileOptions(empty)
  expect(emptyOptions.options).toHaveLength(1)
  expect(emptyOptions.options[0].value).toEqual({ kind: "off" })
  expect(emptyOptions.current).toEqual({ kind: "off" })
})

test("profileOptions treats a dangling active name as off", () => {
  const dangling: CrewProfilesView = { ...view, active: "ghost" }
  expect(profileOptions(dangling).current).toEqual({ kind: "off" })
  expect(profileOptions(dangling).options[0].title).toBe("  fast")
})

test("profileListText lists directories, the current profile, summaries and errors", () => {
  const text = profileListText(view)
  expect(text).toContain("目录：/home/u/.config/opencode/crew-profiles（用户，存在）")
  expect(text).toContain("当前档：fast")
  expect(text).toContain("● fast")
  expect(text).toContain("  pkg")
  expect(text).toContain("broken")
  expect(text).toContain("错误：")

  const fallback: CrewProfilesView = { dirs: [], profiles: [], errors: [], requested: "ghost", error: 'active 档 "ghost" 不存在；已回退到 opencode.json 配置。' }
  const fallbackText = profileListText(fallback)
  expect(fallbackText).toContain("目录：未配置")
  expect(fallbackText).toContain("当前档：off（按 opencode.json 运行）")
  expect(fallbackText).toContain("指针内容：ghost")
  expect(fallbackText).toContain("回退原因：")
  expect(fallbackText).toContain("可用档：无")
})

test("profileFooterLabel stays silent unless a profile is active or the pointer failed", () => {
  expect(profileFooterLabel(undefined)).toBeUndefined()
  expect(profileFooterLabel({})).toBeUndefined()
  expect(profileFooterLabel({ active: "", error: "" })).toBeUndefined()
  expect(profileFooterLabel({ active: "fast" })).toBe("profile: fast")
  expect(profileFooterLabel({ active: "fast", error: "warn" })).toBe("profile: fast ⚠")
  expect(profileFooterLabel({ error: "warn" })).toBe("profile: off ⚠")
})
