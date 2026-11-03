/* @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { Sidebar } from "./sidebar"

export default Plugin.define({
  id: "opencode-crew",
  setup(context) {
    // prepend inside the native boundary keeps title/Todo/Context/footer intact.
    return context.ui.slot({
      prepend: "sidebar.content",
      render: ({ sessionID }) => <Sidebar sessionID={sessionID} />,
    })
  },
})
