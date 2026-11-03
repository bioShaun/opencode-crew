/* @jsxImportSource @opentui/solid */
import { For } from "solid-js"
import type { AlertRow as AlertView } from "./view-model"
import { AlertRow } from "./rows"

/** Alert block: visible only when the server snapshot surfaces anything. */
export function Alerts(props: { rows: AlertView[] }) {
  return (
    <box flexDirection="column">
      <For each={props.rows}>{alert => <AlertRow alert={alert} />}</For>
    </box>
  )
}
