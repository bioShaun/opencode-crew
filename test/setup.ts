// Keep the whole suite isolated from a developer machine's real profile directory.
// `??=` (not `=`) lets an explicit `OPENCODE_CREW_PROFILES_DIR=/tmp/x bun test` opt in.
process.env.OPENCODE_CREW_PROFILES_DIR ??= ""
