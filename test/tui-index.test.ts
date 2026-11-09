import { expect, mock, test } from "bun:test"
import tui from "../src/tui/index"

test("profile command stays reachable when slash completion or the palette changes input mode", async () => {
  let factory: (() => any) | undefined
  const disposers: Array<() => void> = []
  const context = {
    ui: { slot: () => { const dispose = mock(() => {}); disposers.push(dispose); return dispose } },
    keymap: { layer: (input: () => any) => { factory = input } },
  }

  const cleanup = await tui.setup(context as any)
  expect(factory).toBeDefined()
  const layer = factory!()
  expect(layer.mode).toBe("global")
  expect(layer.commands).toHaveLength(1)
  expect(layer.commands[0]).toMatchObject({
    id: "opencode-crew.profile",
    palette: true,
    slash: { name: "crew-profile", arguments: true },
  })
  expect(layer.commands[0].slash.aliases).toBeUndefined()

  cleanup?.()
  expect(disposers).toHaveLength(2)
  for (const dispose of disposers) expect(dispose).toHaveBeenCalled()
})
