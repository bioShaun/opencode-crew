export default { id: "optprobe", async setup(ctx) {
  const fs = await import("node:fs")
  fs.appendFileSync("/project/tmp/tui-probe/out.log", "SERVER options=" + JSON.stringify(ctx.options) + "\n")
} }
