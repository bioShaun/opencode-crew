import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("default discovery excludes tests outside test directory", () => {
  const directory = mkdtempSync(join(process.cwd(), "discovery-sentinel-"));
  const marker = "crew-discovery-sentinel-unique";
  const name = "crew-discovery-probe-name";
  try {
    writeFileSync(join(directory, "sentinel.test.ts"), `import { test } from "bun:test"; test("${name}", () => console.log("${marker}"));\n`);
    // The name filter prevents this test from recursively executing itself.
    const result = Bun.spawnSync([process.execPath, "test", "--test-name-pattern", name, "--pass-with-no-tests"], {
      cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
    });
    const output = result.stdout.toString() + result.stderr.toString();
    expect(result.exitCode).toBe(0);
    expect(output).not.toContain(marker);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
