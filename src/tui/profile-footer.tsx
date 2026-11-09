/* @jsxImportSource @opentui/solid */
import { Show, createMemo, onCleanup, onMount } from "solid-js"
import { usePlugin } from "@opencode/plugin/tui"
import { Row } from "./rows"
import { profileFooterLabel } from "./profile-menu"
import { PROFILE_MEMORY_KEY, refreshProfile, type ProfileMemory } from "./profile-actions"

/** One line in `sidebar.footer`, and nothing at all while no profile is active. */
export function ProfileFooter() {
  const context = usePlugin()
  const [state, setState] = context.storage.memory<ProfileMemory>(PROFILE_MEMORY_KEY, { initial: { active: "", error: "", at: 0 } })

  const refresh = async () => {
    const view = await refreshProfile(context)
    if (!view) return
    setState(draft => {
      draft.active = view.active ?? ""
      draft.error = view.error ?? ""
      draft.at = Date.now()
    })
  }

  onMount(() => { void refresh() })
  // Calibration only: a switch updates the store immediately, this repairs external edits.
  const timer = setInterval(() => { void refresh() }, 60_000)
  onCleanup(() => clearInterval(timer))

  const label = createMemo(() => profileFooterLabel({ active: state.active, error: state.error }))
  return (
    <Show when={label()}>
      {text => <Row spans={[{ text: text(), tone: state.active ? "muted" : "warning" }]} />}
    </Show>
  )
}
