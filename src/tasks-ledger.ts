import { constants, closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, statfsSync, unlinkSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { randomBytes } from "node:crypto"
import { TaskRegistryError, type ProjectIdentity } from "./tasks-registry"

const MAX_BYTES = 1024 * 1024
// Linux filesystem magic values; this detects known remote filesystems, not all possible ones.
const REMOTE = new Set([0x6969, 0xff534d42, 0xfe534d42, 0x517b, 0x564c])
const invalid = (): never => { throw new TaskRegistryError("REGISTRY_INVALID") }
const locked = (): never => { throw new TaskRegistryError("REGISTRY_LOCKED") }
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT"

export interface AtomicStore { read(): unknown | undefined; write(payload: unknown): void }

/** Cooperative, local-filesystem lock; never automatically recovers a stale lock. */
export class AtomicRegistry {
  readonly directory: string
  private readonly file: string
  private readonly lock: string
  constructor(readonly commonDir: string, readonly identity: ProjectIdentity) {
    try {
      if (!isAbsolute(commonDir) || realpathSync(commonDir) !== commonDir || !statSync(commonDir).isDirectory() ||
          identity.commonDir !== commonDir || !isAbsolute(identity.primaryDirectory) ||
          realpathSync(identity.primaryDirectory) !== identity.primaryDirectory || !statSync(identity.primaryDirectory).isDirectory() ||
          REMOTE.has(Number(statfsSync(commonDir).type) >>> 0)) invalid()
    } catch { invalid() }
    this.directory = join(commonDir, "opencode-crew-stage1")
    this.file = join(this.directory, "registry.json")
    this.lock = join(this.directory, ".lock")
  }

  private base(create: boolean): boolean {
    try {
      if (create) { try { mkdirSync(this.directory, { mode: 0o700 }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e } }
      const s = lstatSync(this.directory)
      if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o777) !== 0o700) invalid()
      return true
    } catch (e) { if (!create && missing(e)) return false; return invalid() }
  }

  private checkFile(): boolean {
    try { const s = lstatSync(this.file); if (!s.isFile() || s.isSymbolicLink() || s.size > MAX_BYTES) invalid(); return true }
    catch (e) { if (missing(e)) return false; return invalid() }
  }

  read(): unknown | undefined {
    if (!this.base(false) || !this.checkFile()) return undefined
    let fd: number | undefined
    try {
      fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW)
      const s = fstatSync(fd)
      if (!s.isFile() || s.size > MAX_BYTES) invalid()
      const data = readFileSync(fd)
      if (data.length > MAX_BYTES) invalid()
      return JSON.parse(data.toString("utf8"))
    } catch { return invalid() } finally { if (fd !== undefined) closeSync(fd) }
  }

  private write(payload: unknown): void {
    let fd: number | undefined, temp: string | undefined
    try {
      this.base(false) || invalid()
      if (this.checkFile()) this.read()
      const json = JSON.stringify(payload)
      if (typeof json !== "string" || Buffer.byteLength(json) > MAX_BYTES) invalid()
      temp = join(this.directory, `.registry-${randomBytes(16).toString("hex")}.tmp`)
      fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      writeFileSync(fd, json); fsyncSync(fd); closeSync(fd); fd = undefined
      this.checkFile()
      renameSync(temp, this.file); temp = undefined
      const dirfd = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      try { fsyncSync(dirfd) } finally { closeSync(dirfd) }
    } catch { invalid() } finally {
      if (fd !== undefined) closeSync(fd)
      if (temp !== undefined) { try { unlinkSync(temp) } catch {} }
    }
  }

  withLock<T>(fn: (store: AtomicStore) => T): T {
    this.base(true)
    try { mkdirSync(this.lock, { mode: 0o700 }) } catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return locked(); return invalid() }
    let active = true
    try {
      const store: AtomicStore = { read: () => { if (!active) return invalid(); return this.read() }, write: value => { if (!active) return invalid(); this.write(value) } }
      const result = fn(store)
      if (result != null && typeof (result as any).then === "function") invalid()
      return result
    } finally { active = false; try { rmdirSync(this.lock) } catch { invalid() } }
  }
}
