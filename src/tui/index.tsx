/* @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { SidebarRecovery } from "./sidebar-recovery"
import { ProfileFooter } from "./profile-footer"
import { runProfileCommand } from "./profile-actions"

export default Plugin.define({
  id: "opencode-crew",
  setup(context) {
    // prepend inside the native boundary keeps title/Todo/Context/footer intact.
    const sidebar = context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => <SidebarRecovery context={context} sessionID={props.sessionID} />,
    })
    // Renders nothing unless a profile is active or the pointer failed; profiles are
    // user-level state, so this slot ignores the session input.
    const footer = context.ui.slot({
      append: "sidebar.footer",
      render: () => <ProfileFooter />,
    })
    // Registered on the TUI side only: server commands have no UI channel to report
    // success or a broken profile. Layer removal is host-managed.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "opencode-crew.profile",
        title: "Crew 配置档",
        group: "Crew",
        palette: true,
        slash: { name: "crew-profile", arguments: true },
        run: input => runProfileCommand(context, input ?? ""),
      }],
    }))
    return () => { sidebar(); footer() }
  },
})
