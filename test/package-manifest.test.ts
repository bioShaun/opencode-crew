import { readFileSync } from "node:fs"
import { expect, test } from "bun:test"

// npm runs a "git dep preparation" step (clone, then `npm install` inside the
// clone) for any Git dependency whose package.json declares one of these
// scripts, or a `workspaces` field. On compiled OpenCode binaries that step
// re-executes the OpenCode CLI and fails with "git dep preparation failed",
// so `github:` installs only work while the manifest stays clean.
const LIFECYCLE_TRIGGERS = ["postinstall", "build", "preinstall", "install", "prepack", "prepare"]

test("package.json declares no lifecycle script that triggers git dep preparation", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  for (const name of LIFECYCLE_TRIGGERS) expect(pkg.scripts?.[name]).toBeUndefined()
  expect(pkg.workspaces).toBeUndefined()
})

test("package.json still ships the prebuilt entry point and role prompts", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  expect(pkg.files).toContain("dist")
  expect(pkg.files).toContain("agents")
  expect(pkg.exports?.["."]).toBe("./dist/index.js")
})
