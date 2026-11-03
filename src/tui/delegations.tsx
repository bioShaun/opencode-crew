/* @jsxImportSource @opentui/solid */
import { For } from "solid-js"
import type { SidebarView } from "./view-model"
import { Row } from "./rows"

/** Delegations block: running subagents and crew_task rows. */
export function Delegations(props: { block: NonNullable<SidebarView["delegations"]> }) {
  return (
    <box flexDirection="column">
      <Row spans={props.block.title} />
      <For each={props.block.rows}>{row => <Row spans={row} />}</For>
    </box>
  )
}
