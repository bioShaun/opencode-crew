# Sidebar recovery acceptance — 2026-11-03

## Delivered scope

- Local Solid error boundary around Sidebar initialization, reactive computations and child rendering; visible fallback instead of silent empty content.
- Three automatic retries (1/3/10 seconds), rate-limited manual retry, healthy-period budget reset, keyed-session isolation and cleanup.
- Fixed-category, bounded in-memory diagnostics only. Persistent diagnostics and comprehensive detached asynchronous error handling are not part of this delivery.
- Formal TUI build now uses the OpenTUI Solid transform; the default test configuration enables the actual client reactive runtime.
- Permanent integration test builds through the package script and mounts the emitted JavaScript using a real OpenTUI renderer.

## Red / green evidence

- `red.log`: original initialization fault escaped to the simulated host boundary (expected host fault count 0, actual 1).
- `build-fix/red.log`: the ordinary build emitted a bundle with no Crew fallback after initialization failure.
- `build-fix/green-final.log`: eight native rendering tests passed, including the formal bundle fallback-to-Subagents recovery.
- `root-check/full-rerun.log`: Root independently ran the full suite: 263 pass, 0 fail, exit 0.
- `root-check/full.log`: first independent run had one unrelated fixture-path assertion failure because `/project/tmp` appeared in a prompt's cwd. Rerun used the supported project-local fixture directory; no assertion or production code was changed to obtain green.
- `root-check/build.log`: independent formal staging build succeeded.

## Review and publication

- Static review found no confirmed P0/P1 defect, but the reviewer role could not execute Git commands. A separate independent read-only audit subsequently verified tracked/untracked scope, no staged changes, preservation of the direct-child data-source patch and the prepublication bundle baseline.
- The original `.scratch/` file remains present. No byte-for-byte preservation claim is made because it had no content-hash baseline.
- `root-check/publish.log`: published only the verified TUI artifact at 18:20:47 +08:00. No server artifact replacement, restart, navigation or input injection was used.
- Published TUI SHA-256: `47235ffb86b5556469e474c9727d9e04d99ae75d9c6aa4e7bf0200869b5fbafe`.
- Server SHA-256 unchanged: `1f0659b792c4b1d75e1199fd81c9005014362107fb89f03534523e28fe73c265`.

## Actual runtime observations

- Runtime captures are retained at `/project/tmp/crew-sidebar-runtime-20261103/`.
- `before.txt` / `prepublish.txt`: current TUI sidebar contained the native title, Context and Todo but no Crew contribution, while server-side child sessions existed.
- `after-settle.txt`: the same TUI process (PID 2999654) and same root session showed `Subagents (8 sessions · $1.86)` after publication; native Context and Todo remained.
- A subsequent independent read-only online check observed `Delegations (1 running)` and `Subagents (9 sessions · $1.87)`, with Context and Todo preserved and PID still 2999654. The extra session was the verifier itself. API direct-child counts and sidebar groups matched exactly: architect 1, engineer 2, explorer 2, reviewer 1, general 3. Both published artifact hashes were independently verified.
- These observations confirm current-window restoration. They do not prove the exact exception responsible for the original incident, cold-start reliability in every host version, or recovery from module-loading, registration, native-renderer or arbitrary detached async failures.

No commit or push was performed.
