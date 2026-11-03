/* @jsxImportSource @opentui/solid */
import { createSignal, For } from "solid-js"
import type { RGBA } from "@opentui/core"
import { usePlugin } from "@opencode/plugin/tui"
import type { AlertRow as AlertView, Span, Tone } from "./view-model"

const useTone = () => {
  const theme = usePlugin().theme
  return (tone: Tone): RGBA => {
    switch (tone) {
      case "muted": return theme.text.muted
      case "faint": return theme.text.faint
      case "info": return theme.text.feedback.info.base
      case "warning": return theme.text.feedback.warning.base
      case "error": return theme.text.feedback.error.base
      default: return theme.text.base
    }
  }
}

/** One pre-measured row of spans; text is already cell-truncated to WIDTH. */
export function Row(props: { spans: Span[] }) {
  const fg = useTone()
  return (
    <text>
      <For each={props.spans}>
        {s => <span style={{ fg: fg(s.tone), bold: s.bold }}>{s.text}</span>}
      </For>
    </text>
  )
}

/** Alert row: hover underline, click navigates to the crew_task session. */
export function AlertRow(props: { alert: AlertView }) {
  const context = usePlugin()
  const fg = useTone()
  const [hover, setHover] = createSignal(false)
  const navigate = () => {
    if (props.alert.sessionID) {
      context.ui.router.navigate({ type: "session", sessionID: props.alert.sessionID })
    }
  }
  return (
    <box onMouseDown={navigate} onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)}>
      <text>
        <For each={props.alert.spans}>
          {s => <span style={{ fg: fg(s.tone), bold: s.bold, underline: hover() }}>{s.text}</span>}
        </For>
      </text>
    </box>
  )
}
