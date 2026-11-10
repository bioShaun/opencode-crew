import { expect, test } from "bun:test"
import { defaultDisplay, parseCrewConfig, parseCrewDisplay, parseCrewOptions } from "../src/config"

const aliases = (count: number): Record<string, string> => {
  const out: Record<string, string> = {}
  for (let i = 0; i < count; i++) out[`provider/model${i}`] = "ok"
  return out
}

test("missing modelAliases and modelDisplay yield defaultDisplay", () => {
  expect(parseCrewDisplay({})).toEqual(defaultDisplay)
  expect(parseCrewDisplay(undefined)).toEqual(defaultDisplay)
  expect(parseCrewDisplay(null)).toEqual(defaultDisplay)
  expect(parseCrewOptions({}).display).toEqual(defaultDisplay)
  expect(parseCrewOptions({}).baseline).toEqual({ models: {}, steps: {}, engineerInstructions: [] })
})

test("parseCrewDisplay ignores models, steps, and engineerInstructions", () => {
  expect(parseCrewDisplay({
    models: { engineer: "not-a-model" },
    steps: { engineer: 0 },
    engineerInstructions: "nope",
  })).toEqual(defaultDisplay)
})

test("alias keys must be provider/model with one slash, both sides set, and no whitespace", () => {
  for (const key of ["provider", "a/b/c", "a/b c", "a b/c", " /model", "provider/ ", "/model", "provider/", "a/\tb"]) {
    expect(() => parseCrewDisplay({ modelAliases: { [key]: "ok" } })).toThrow("[opencode-crew] options.modelAliases")
    expect(() => parseCrewDisplay({ modelAliases: { [key]: "ok" } })).toThrow("provider/model")
  }
})

test("alias values must be a trimmed string of 1 to 12 characters without control characters", () => {
  for (const value of ["", "   ", "\t  "]) {
    expect(() => parseCrewDisplay({ modelAliases: { "provider/model": value } })).toThrow("options.modelAliases.provider/model 不能为空")
  }
  expect(() => parseCrewDisplay({ modelAliases: { "provider/model": "1234567890123" } })).toThrow("options.modelAliases.provider/model 最多 12 字符")
  for (const value of ["a\nb", "a\rb", "tail\n", "\nok", "a\x01b", "a\x7fb", "\x7f", "mid\x09tab"]) {
    expect(() => parseCrewDisplay({ modelAliases: { "provider/model": value } })).toThrow("options.modelAliases.provider/model 不能包含控制字符")
  }
  expect(() => parseCrewDisplay({ modelAliases: { "provider/model": 1 } })).toThrow("options.modelAliases.provider/model 必须为字符串")
  expect(parseCrewDisplay({ modelAliases: { "provider/model": "  gpt-4o  " } }).aliases).toEqual({ "provider/model": "gpt-4o" })
  expect(parseCrewDisplay({ modelAliases: { "provider/model": "123456789012" } }).aliases["provider/model"]).toBe("123456789012")
})

test("modelAliases accepts 64 entries and rejects 65", () => {
  expect(parseCrewDisplay({ modelAliases: aliases(64) }).aliases).toEqual(aliases(64))
  expect(() => parseCrewDisplay({ modelAliases: aliases(65) })).toThrow("[opencode-crew] options.modelAliases 最多 64 项")
})

test("modelAliases must be a plain object and modelDisplay is inline or off", () => {
  expect(() => parseCrewDisplay({ modelAliases: ["provider/model"] })).toThrow("options.modelAliases 必须是对象")
  expect(() => parseCrewDisplay({ modelAliases: null })).toThrow("options.modelAliases 必须是对象")
  expect(parseCrewDisplay({ modelDisplay: "off" }).display).toBe("off")
  expect(parseCrewDisplay({ modelDisplay: "inline" }).display).toBe("inline")
  for (const value of ["", "both", "INLINE", "off ", 1, null]) {
    expect(() => parseCrewDisplay({ modelDisplay: value })).toThrow("[opencode-crew] options.modelDisplay 必须为 inline 或 off")
  }
})

test("parseCrewOptions keeps baseline models and a valid display config", () => {
  const parsed = parseCrewOptions({
    models: { engineer: "anthropic/claude" },
    steps: { reviewer: 4 },
    engineerInstructions: ["  stay focused  "],
    modelDisplay: "off",
    modelAliases: { "openai/gpt-4": "  gpt4  " },
  })
  expect(parsed.baseline).toEqual({
    models: { engineer: { providerID: "anthropic", id: "claude" } },
    steps: { reviewer: 4 },
    engineerInstructions: ["stay focused"],
  })
  expect(parsed.display).toEqual({
    display: "off",
    aliases: { "openai/gpt-4": "gpt4" },
  })
})

test("parseCrewOptions still rejects unknown keys and non-objects", () => {
  expect(() => parseCrewOptions({ workerSteps: 1 })).toThrow("[opencode-crew] 未知 options.workerSteps")
  expect(() => parseCrewOptions(null)).toThrow("[opencode-crew] options 必须是对象")
  expect(() => parseCrewOptions([])).toThrow("[opencode-crew] options 必须是对象")
})

test("parseCrewConfig still rejects display keys so profile files stay strict", () => {
  expect(() => parseCrewConfig({ modelAliases: { "provider/model": "ok" } })).toThrow("[opencode-crew] 未知 options.modelAliases")
  expect(() => parseCrewConfig({ modelDisplay: "off" })).toThrow("[opencode-crew] 未知 options.modelDisplay")
})
