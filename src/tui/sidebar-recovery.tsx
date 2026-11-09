/* @jsxImportSource @opentui/solid */
import { createSignal, ErrorBoundary, onCleanup, onMount, Show } from "solid-js"
import type { usePlugin } from "@opencode/plugin/tui"
import { Sidebar } from "./sidebar"

type Context = ReturnType<typeof usePlugin>

export interface RecoveryClock {
  now(): number
  schedule(fn: () => void, delay: number): unknown
  cancel(handle: unknown): void
}
const clock: RecoveryClock = {
  now: () => Date.now(),
  schedule: (fn, delay) => setTimeout(fn, delay),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

// Only fixed categories are retained; never inspect or stringify thrown values.
export const recoveryEvents: Array<{ id: string; phase: "component"; category: string }> = []
const delays = [1000, 3000, 10000]

export function SidebarRecovery(props: { context: Context; sessionID: string; clock?: RecoveryClock }) {
  return <Show when={props.sessionID} keyed>{sessionID =>
    <SessionRecovery context={props.context} sessionID={sessionID} clock={props.clock ?? clock} />
  }</Show>
}

function SessionRecovery(props: { context: Context; sessionID: string; clock: RecoveryClock }) {
  let attempts = 0
  let lastManual = Number.NEGATIVE_INFINITY
  let retry: (() => void) | undefined
  let disposed = false
  const [failed, setFailed] = createSignal(false)
  onCleanup(() => { disposed = true; retry = undefined })
  try {
    props.context.keymap?.layer(() => ({ commands: [{
      id: "crew.sidebar.retry", title: "Retry Crew sidebar", palette: true, bind: false,
      enabled: failed, run: () => { retry?.() },
    }] }))
  } catch { /* Mouse retry remains available if command registration fails. */ }

  function Healthy() {
    onMount(() => {
      setFailed(false)
      const timer = props.clock.schedule(() => { if (!disposed) attempts = 0 }, 60_000)
      onCleanup(() => props.clock.cancel(timer))
    })
    return <Sidebar sessionID={props.sessionID} />
  }

  function Fallback(p: { error: unknown; reset: () => void }) {
    const id = Math.random().toString(36).slice(2, 10).padEnd(8, "0")
    recoveryEvents.push({ id, phase: "component", category: p.error === null ? "null" : typeof p.error })
    if (recoveryEvents.length > 50) recoveryEvents.shift()
    setFailed(true)
    let timer: unknown
    let active = true
    const reset = () => {
      if (!active || disposed) return
      active = false
      if (timer !== undefined) props.clock.cancel(timer)
      retry = undefined
      p.reset()
    }
    retry = () => {
      const now = props.clock.now()
      if (now - lastManual < 1000) return
      lastManual = now
      reset()
    }
    const delay = delays[attempts]
    if (delay !== undefined) {
      timer = props.clock.schedule(() => { attempts++; reset() }, delay)
    }
    onCleanup(() => {
      active = false
      if (timer !== undefined) props.clock.cancel(timer)
      retry = undefined
    })
    return <box flexDirection="column">
      <text>Crew 暂时不可用</text>
      <text>诊断 {id}（仅内存）</text>
      <text>{delay === undefined ? "自动重试已用尽" : `自动重试 ${attempts + 1}/3`}</text>
      <text onMouseDown={() => retry?.()}>点击重试</text>
    </box>
  }

  return <ErrorBoundary fallback={(error, reset) => <Fallback error={error} reset={reset} />}>
    <Healthy />
  </ErrorBoundary>
}
