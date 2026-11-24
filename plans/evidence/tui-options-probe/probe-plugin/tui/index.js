export default { id: "optprobe.tui", setup(ctx) {
  const fs = require ? null : null
  return import("node:fs").then(fs => fs.appendFileSync("/project/tmp/tui-probe/out.log", "TUI options=" + JSON.stringify(ctx.options) + "\n"))
} }
