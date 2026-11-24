import type { ReviewGateConfig } from "./config"

export interface ChangeFile {
  path: string
  type: "added" | "modified" | "deleted" | "renamed" | "unknown"
  token?: string
}

export interface ChangeSet {
  source: "native" | "task"
  dir: string
  taskID?: string
  head?: string
  files: ChangeFile[]
  outsideScope?: number
  complete: boolean
  planRef?: boolean
  latestChangeAt?: number
  degraded?: boolean
}

export interface Reason {
  rule: "fileCount" | "deletedTest" | "sensitivePath" | "planMultiFile" | "outsideScope" | "incomplete"
  detail: string
  paths?: string[]
}

export interface GateVerdict { hit: boolean; reasons: Reason[] }

export function globToRegExp(glob: string): RegExp {
  let pattern = "^"
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "?") pattern += "[^/]"
    else if (c !== "*") pattern += c.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
    else if (glob[i + 1] !== "*") pattern += "[^/]*"
    else {
      const atSegmentStart = i === 0 || glob[i - 1] === "/"
      while (glob[i + 1] === "*") i++
      if (atSegmentStart && glob[i + 1] === "/") {
        pattern += "(?:[^/]+/)*"
        i++
      } else pattern += "[\\s\\S]*"
    }
  }
  return new RegExp(pattern + "$", "u")
}

const unique = (paths: string[]): string[] => [...new Set(paths)]

export function evaluateGate(changes: ChangeSet, cfg: ReviewGateConfig): GateVerdict {
  const reasons: Reason[] = []
  const match = (globs: readonly string[]) => {
    const regexps = globs.map(globToRegExp)
    return (path: string) => regexps.some(re => re.test(path))
  }
  const paths = unique(changes.files.map(file => file.path))
  const ignore = match(cfg.ignoreGlobs)
  const counted = paths.filter(path => !ignore(path))
  if (counted.length > cfg.maxFiles) {
    reasons.push({ rule: "fileCount", detail: `${counted.length} 个文件，超过阈值 ${cfg.maxFiles}`, paths: counted })
  }
  const test = match(cfg.testGlobs)
  const deletedTests = unique(changes.files.filter(file => file.type === "deleted" && test(file.path)).map(file => file.path))
  if (deletedTests.length) reasons.push({ rule: "deletedTest", detail: `删除或移走了 ${deletedTests.length} 个测试文件`, paths: deletedTests })
  const sensitive = paths.filter(match(cfg.sensitiveGlobs))
  if (sensitive.length) reasons.push({ rule: "sensitivePath", detail: `改动涉及 ${sensitive.length} 个敏感路径`, paths: sensitive })
  if (changes.planRef && cfg.planMinFiles > 0 && counted.length >= cfg.planMinFiles) {
    reasons.push({ rule: "planMultiFile", detail: `任务引用 plans/ 方案，且改动了 ${counted.length} 个文件`, paths: counted })
  }
  if (changes.source === "task" && (changes.outsideScope ?? 0) > 0) {
    reasons.push({ rule: "outsideScope", detail: `${changes.outsideScope} 个路径超出任务 Scope` })
  }
  if (!changes.complete) reasons.push({ rule: "incomplete", detail: "改动清单不完整" })
  return { hit: reasons.length > 0, reasons }
}

export function gateFingerprint(changes: Pick<ChangeSet, "head" | "files">): string {
  const rows = changes.files.map(({ path, type, token }) => `${path}\0${type}\0${token ?? ""}`).sort()
  return Bun.CryptoHasher.hash("sha256", (changes.head ?? "") + rows.join("\n"), "hex").slice(0, 16)
}

function escapeText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, c => `\\u${c.codePointAt(0)!.toString(16).padStart(4, "0")}`)
}

export function renderReminder(changes: ChangeSet, verdict: GateVerdict): string {
  const paths = unique(verdict.reasons.flatMap(reason => reason.paths ?? []))
  const count = new Set(changes.files.map(file => file.path)).size
  return [
    "[crew-review-gate] 本轮改动命中审查门禁：",
    ...verdict.reasons.map(reason => `- ${escapeText(reason.rule)}：${escapeText(reason.detail)}`),
    `改动目录：${escapeText(changes.dir)}（${count} 个文件${changes.taskID ? `；${escapeText(changes.taskID)}` : ""}）`,
    ...(changes.degraded ? ["基线缺失，含既有改动。"] : []),
    ...(paths.length ? [`命中路径：${paths.slice(0, 10).map(escapeText).join("、")}${paths.length > 10 ? `（另有 ${paths.length - 10} 条）` : ""}`] : []),
    "请二选一：",
    "1. 派 reviewer；任务包写明 Goal/Scope/Acceptance、plans/ 方案、改动目录和 engineer 证据位置；",
    "2. 回复中写一行 `Review-Skip: <具体理由>`。",
    "这是提醒，不改变 crew_task 的 stop → close 顺序，也不表示已验收。",
  ].join("\n")
}

export function extractReviewSkip(text: string): string | undefined {
  for (const match of text.matchAll(/(?:^|\n)[ \t]*Review-Skip:[ \t]*(\S[^\r\n]*)/g)) {
    const reason = match[1].trimEnd()
    if (reason.length >= 10) return reason
  }
  return undefined
}
