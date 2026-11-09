import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { join } from "node:path"

// Set CREW_BUILD_OUTDIR to build for inspection without touching the live dist.
const outdir = process.env.CREW_BUILD_OUTDIR || "dist"
const common = { target: "bun" as const, outdir }
for (const options of [
  { ...common, entrypoints: ["src/index.ts"], external: ["@opencode/plugin"], naming: "index.js" },
  { ...common, entrypoints: ["src/tui/index.tsx"], external: ["@opencode/plugin", "solid-js", "@opentui/core", "@opentui/solid", "@opencode/theme"], naming: "tui.js", plugins: [createSolidTransformPlugin()] },
]) {
  const result = await Bun.build(options)
  for (const log of result.logs) console.error(log)
  if (!result.success) process.exit(1)
  console.log(`Built ${join(outdir, options.naming)}`)
}
