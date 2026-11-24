import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { parseReviewGate } from "../src/config"
import { evaluateGate, extractReviewSkip, gateFingerprint, globToRegExp, renderReminder } from "../src/review-gate"
import type { ChangeFile, ChangeSet } from "../src/review-gate"

const file = (path: string, type: ChangeFile["type"] = "modified", token?: string): ChangeFile => ({ path, type, token })
const changes = (files: ChangeFile[], more: Partial<ChangeSet> = {}): ChangeSet => ({ source: "native", dir: "/repo", complete: true, files, ...more })
const cfg = parseReviewGate({ mode: "remind" })
const rules = (data: ChangeSet, options = cfg) => evaluateGate(data, options).reasons.map(r => r.rule)

test("globstar matches zero or multiple directories; single star and question do not cross slashes", () => {
  const glob = globToRegExp("**/*.test.?")
  for (const path of ["a.test.t", "a/b/c.test.t", "x\ny/a.test.t"]) expect(glob.test(path)).toBe(true)
  for (const path of ["a.test.ts", "a.test./", "a.test.t/x"]) expect(glob.test(path)).toBe(false)
  expect(globToRegExp("a/*").test("a/b/c")).toBe(false)
  expect(globToRegExp("a/*").test("a/b")).toBe(true)
  expect(globToRegExp("a/**/b").test("a/b")).toBe(true)
  expect(globToRegExp("a/**").test("a/b/c")).toBe(true)
})

test("glob anchors and quotes regex metacharacters", () => {
  const glob = globToRegExp("a.[b](c){d}+^$|\\z")
  expect(glob.test("a.[b](c){d}+^$|\\z")).toBe(true)
  expect(glob.test("prefix/a.[b](c){d}+^$|\\z")).toBe(false)
  expect(glob.test("a.[b](c){d}+^$|\\z\n")).toBe(false)
})

test("fileCount only hits above maxFiles and counts distinct non-ignored paths", () => {
  const five = Array.from({ length: 5 }, (_, i) => file(`src/${i}`))
  expect(evaluateGate(changes([...five, file("plans/p.md"), file("bun.lock"), file("src/0", "added")]), cfg)).toEqual({ hit: false, reasons: [] })
  const result = evaluateGate(changes([...five, file("src/5")]), cfg)
  expect(result.hit).toBe(true)
  expect(result.reasons[0]).toMatchObject({ rule: "fileCount", paths: [...five.map(p => p.path), "src/5"] })
})

test("a deleted test or the old path of a renamed test hits even if ignored", () => {
  expect(rules(changes([file("core.test.ts"), file("test/new.ts", "added")]))).toEqual([])
  const verdict = evaluateGate(changes([file("test/old.ts", "deleted"), file("src/new.ts", "renamed")]), { ...cfg, ignoreGlobs: ["test/**"] })
  expect(verdict.reasons).toEqual([expect.objectContaining({ rule: "deletedTest", paths: ["test/old.ts"] })])
  expect(rules(changes([file("core.test.ts", "deleted")]))).toEqual(["deletedTest"])
})

test("sensitive paths see all statuses and are not ignored", () => {
  const listing = changes([file("AGENTS.md"), file("dist/AGENTS.md", "renamed"), file("agents/root.md")])
  const result = evaluateGate(listing, cfg)
  expect(result.reasons).toEqual([expect.objectContaining({ rule: "sensitivePath", paths: ["AGENTS.md", "dist/AGENTS.md"] })])
})

test("plan threshold requires a plan reference, ignores configured paths, and 0 disables", () => {
  const one = [file("src/a"), file("plans/p.md")]
  const two = [...one, file("src/b")]
  expect(rules(changes(one, { planRef: true }))).toEqual([])
  expect(rules(changes(two))).toEqual([])
  expect(rules(changes(two, { planRef: true }))).toEqual(["planMultiFile"])
  expect(rules(changes(two, { planRef: true }), { ...cfg, planMinFiles: 0 })).toEqual([])
})

test("incomplete applies to both sources; outsideScope applies only to tasks", () => {
  expect(rules(changes([], { complete: false, outsideScope: 1 }))).toEqual(["incomplete"])
  expect(rules(changes([], { source: "task", outsideScope: 0 }))).toEqual([])
  expect(rules(changes([], { source: "task", outsideScope: 1, complete: false }))).toEqual(["outsideScope", "incomplete"])
})

test("fingerprint hashes HEAD and sorted status/token tuples into 16 hex digits", () => {
  const a = file("a", "deleted", "missing"), b = file("b", "added", "7:12")
  const data = { head: "head", files: [b, a] }
  const expected = createHash("sha256").update("head" + ["a\0deleted\0missing", "b\0added\x007:12"].join("\n")).digest("hex").slice(0, 16)
  expect(gateFingerprint(data)).toBe(expected)
  expect(gateFingerprint({ ...data, files: [a, b] })).toBe(expected)
  expect(gateFingerprint({ ...data, head: "new" })).not.toBe(expected)
  expect(gateFingerprint({ ...data, files: [{ ...b, token: "7:13" }, a] })).not.toBe(expected)
})

test("reminder lists at most ten unique paths globally and escapes unsafe text", () => {
  const paths = ["p00\nFAKE\x1b\u2028tail", ...Array.from({ length: 11 }, (_, i) => `p${String(i + 1).padStart(2, "0")}`)]
  const data = changes(paths.map(path => file(path)), { source: "task", dir: "/repo\rx", taskID: "ct_test", degraded: true })
  const text = renderReminder(data, { hit: true, reasons: [
    { rule: "fileCount", detail: "detail\nFAKE", paths: paths.slice(0, 7) },
    { rule: "sensitivePath", detail: "detail2", paths },
  ] })
  expect(text).toContain("[crew-review-gate] 本轮改动命中审查门禁：")
  expect(text).toContain("p00\\u000aFAKE\\u001b\\u2028tail")
  expect(text).toContain("/repo\\u000dx")
  expect(text).not.toMatch(/\nFAKE|\r|\x1b|\u2028/)
  expect(text.match(/p\d\d/g)).toHaveLength(10)
  expect(text).not.toContain("p10")
  expect(text).toContain("ct_test")
  expect(text).toContain("基线缺失，含既有改动")
  expect(text).toContain("Review-Skip:")
  expect(text).toContain("stop → close")
})

test("Review-Skip is a line-start marker with a reason of at least ten characters", () => {
  expect(extractReviewSkip("前文\n  Review-Skip:  1234567890  \r\n下一行")).toBe("1234567890")
  expect(extractReviewSkip("Review-Skip: 1234567890a")).toBe("1234567890a")
  for (const text of ["Review-Skip:", "Review-Skip: 123456789", "Review-Skip: 123456789  ", "inline Review-Skip: 1234567890"]) {
    expect(extractReviewSkip(text)).toBeUndefined()
  }
})

test("R3 Review-Skip cannot borrow a reason from the following line", () => {
  expect(extractReviewSkip("Review-Skip:\n理由在这里够十个字符了吧")).toBeUndefined()
  expect(extractReviewSkip("前文\r\n\tReview-Skip: \t\r\nLong text on the next line")).toBeUndefined()
  expect(extractReviewSkip("前文\r\n\tReview-Skip:\t1234567890\r\n后文")).toBe("1234567890")
  expect(extractReviewSkip("Review-Skip: 123456789\r\nMore text")).toBeUndefined()
})
