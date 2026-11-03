import { join, resolve } from "node:path"

// Scratch space for test fixtures. Set CREW_TEST_WORK to a directory outside the
// repository so generated fixture trees stay out of the workspace; file watchers
// otherwise index every directory under test/.work.
export const WORK = process.env.CREW_TEST_WORK
  ? resolve(process.env.CREW_TEST_WORK)
  : join(import.meta.dir, ".work")
