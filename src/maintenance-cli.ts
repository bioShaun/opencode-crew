import { lstatSync, readFileSync } from 'node:fs'
import { TaskRegistryError } from './tasks-registry'
import { applyMaintenance, planMaintenance } from './tasks-maintenance'

const MAX_INPUT_BYTES = 2 * 1024 * 1024
const usage = '用法：bun src/maintenance-cli.ts plan <operation.json> | apply <plan.json>'

function emit(output: unknown, status: number, summary: string) {
  process.stdout.write(JSON.stringify(output) + '\n')
  process.stderr.write(summary + '\n')
  process.exitCode = status
}
function readJSON(path: string): unknown {
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_INPUT_BYTES) throw new TaskRegistryError('INVALID_INPUT')
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error instanceof TaskRegistryError) throw error
    throw new TaskRegistryError('INVALID_INPUT')
  }
}

const args = process.argv.slice(2)
if (args.length !== 2 || (args[0] !== 'plan' && args[0] !== 'apply')) {
  emit({ v: 1, ok: false, error: { code: 'INVALID_INPUT' } }, 2, usage)
} else {
  try {
    const input = readJSON(args[1])
    if (args[0] === 'plan') {
      emit(planMaintenance(input), 0, '计划已生成。')
    } else {
      const output: any = applyMaintenance(input)
      emit(output, 0, output.replayed ? '维护已重放，无写入。' : '维护已提交。')
    }
  } catch (error) {
    const code = error instanceof TaskRegistryError ? error.code : 'HOST_ERROR'
    emit({ v: 1, ok: false, error: { code } }, code === 'INVALID_INPUT' ? 2 : 1, '维护被拒绝。')
  }
}
