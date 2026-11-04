/* @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { SidebarView } from "./view-model"
import { Row } from "./rows"

/** Subagents block: per-role cumulative usage for the whole Root family. */
export function Subagents(props: { block: NonNullable<SidebarView["subagents"]> }) {
  return (
    <box flexDirection="column">
      <Row spans={props.block.title} />
      <Row spans={props.block.header} />
      <For each={props.block.rows}>{row => <Row spans={row} />}</For>
      <Show when={props.block.footnote}>
        <Row spans={props.block.footnote!} />
      </Show>
    </box>
  )
}
