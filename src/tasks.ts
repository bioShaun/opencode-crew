import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@opencode/plugin/promise/plugin'
import { inspectProject, inspectProjectFromWorktree, TaskRegistryError, validateWorktree } from './tasks-registry'
import { Ledger, normalizeStoredInput, type Closeout, type LedgerEntry, type TaskRecord } from './tasks-state'
import { modelFamilyTaskHint } from './model-family'
import { REPORT_STATUS_PROMPT_HINT } from './report-status'

type Host = Context
type ModelRef = { providerID: string; id: string; variant?: string }
const marker = 'opencode-crew-stage1'
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x)
const ERROR_INFO: Record<string, { message: string; nextAction: string }> = {
 CAPACITY_RESERVED: {
  message: '已有 2 个未结案写入预留，本次未创建会话。',
  nextAction: '停止继续派发；需要释放容量时，按现有维护契约执行离线 close 的 plan/apply。不得删除 registry 或锁，也不要把 stop 当作释放。',
 },
 IDEMPOTENCY_CONFLICT: {
  message: 'key 已被不同输入或其他 Root 使用。',
  nextAction: '不要原样重试。若确为新 Assignment，使用新 key，并先排除旧任务仍有未确认的副作用。',
 },
 WRITER_RESERVED: {
  message: 'directory 已被历史任务占用（包括已结案任务）。',
  nextAction: '选择新的规范 worktree；不要复用、改名绕过或删除历史。',
 },
 DIRTY_PRIMARY: {
  message: '主 worktree 不干净，未创建会话。',
  nextAction: '不要自行 clean/reset；先由用户处理或明确保留现有修改。',
 },
 DIRTY_WORKTREE: {
  message: '目标 worktree 不干净，未创建会话。',
  nextAction: '不要自行清理成果；换干净目标或由用户处理。',
 },
 BASELINE_MISMATCH: {
  message: 'baseline 校验未通过，未创建会话。',
  nextAction: '不要启动；按 details 核对 baseline、主 HEAD、目标 HEAD 或当前 period baseline，准备一致的新目标。不得缩写 OID 或自动 checkout。',
 },
 PROJECT_MISMATCH: {
  message: '项目或 worktree 身份校验未通过。',
  nextAction: '核对调用 cwd、Root 身份及目标是否为同仓库的独立 registered detached worktree；不要原样重试。',
 },
 INVALID_SCOPE: {
  message: 'scope 不合法。',
  nextAction: '修正 scope：使用精确相对文件路径或以 / 结尾的目录前缀，不用 glob、绝对路径、..、symlink 逃逸或禁止路径；不得自行扩大 Scope。',
 },
 INVALID_INPUT: {
  message: '参数不合法。',
  nextAction: '按工具 schema 修正参数；不要加入未定义字段。',
 },
 FORBIDDEN_CALLER: {
  message: '当前调用方不是 Root，未执行任何操作。',
  nextAction: '只能由 Root 调用；当前调用方不要重试。',
 },
 TASK_NOT_FOUND: {
  message: '任务不存在或不属于当前 Root。',
  nextAction: '不要重试，也不要尝试操作其他 Root 的任务。',
 },
 SESSION_MISMATCH: {
  message: '会话身份不匹配，启动结果未确认。',
  nextAction: '保留预留与现场，用 status 获取记录并人工调查；不要换 key 重派，不要声称未创建会话或没有 orphan。',
 },
 START_UNCONFIRMED: {
  message: '启动结果未确认。',
  nextAction: '保留预留与现场，用 status 获取记录并人工调查；不要换 key 重派，不要声称未创建会话或没有 orphan。',
 },
 REGISTRY_LOCKED: {
  message: 'registry 被锁，写操作未执行。',
  nextAction: '停止写操作并人工调查；不得删锁、删库或自动抢占。',
 },
 REGISTRY_INVALID: {
  message: 'registry 内容或状态无效，操作未执行。',
  nextAction: '停止写操作并人工调查；不得删锁、删库或自动抢占。',
 },
 HOST_ERROR: {
  message: '宿主调用或内部校验失败。',
  nextAction: '保留现场并人工调查；不要假定失败没有副作用，不要自动重派。',
 },
}
const errorInfo = (code: string) => ERROR_INFO[code] ?? { message: `任务操作未完成（${code}）。`, nextAction: '停止重试并人工调查；保留现有预留与现场。' }
const errorPayload = (code: string, details?: Record<string, unknown>) => {
 const info = errorInfo(code)
 return { code, message: info.message, nextAction: info.nextAction, ...(details && Object.keys(details).length ? { details } : {}) }
}
const response = (output: any) => ({ output, content: output.ok ? '任务记录已处理；进程安全未确认。' : `${output.error.message} 下一步：${output.error.nextAction}` })
const failure = (code: string, details?: Record<string, unknown>) => response({ ok: false, error: errorPayload(code, details), warnings: [] })
const errorCode = (e: unknown) => e instanceof TaskRegistryError ? e.code : 'HOST_ERROR'
const failureFrom = (e: unknown) => e instanceof TaskRegistryError ? failure(e.code, e.details) : failure('HOST_ERROR')
const taskView = (t: TaskRecord, observed?: any, meta?: { lifecycle: 'active' | 'closed'; periodID?: string; closeout?: Closeout }) => ({taskID:t.taskID,directory:t.input.directory,baseline:t.input.baseline,scope:t.input.scope,...(meta ? {lifecycle:meta.lifecycle,...(meta.periodID ? {periodID:meta.periodID} : {}),...(meta.lifecycle==='closed' && meta.closeout ? {closeout:{closedAt:meta.closeout.closedAt,disposition:meta.closeout.disposition}} : {})} : {}),state:t.state,...(t.sessionID ? {sessionID:t.sessionID}:{}),...(t.lastErrorCode ? {lastErrorCode:t.lastErrorCode}:{}),...(t.interruptResult ? {interruptResult:t.interruptResult}:{}),...(observed ? {observed}:{}),processSafety:'unconfirmed',canCleanup:false,canIntegrate:false,nextAction:'保留预留，人工核实任务与进程状态。',createdAt:t.createdAt,updatedAt:t.updatedAt})
const projectHash = (commonDir: string) => createHash('sha256').update(commonDir).digest('hex')
const metadata = (t:TaskRecord, commonDir:string) => ({namespace:marker,taskID:t.taskID,requestDigest:t.requestDigest,ownerSessionID:t.ownerSessionID,project:projectHash(commonDir)})
const matches = (s:any,t:TaskRecord,commonDir:string) => {
 const expected=metadata(t,commonDir), got=s?.metadata?.crewTask
 return s?.id===t.sessionID && s?.agent==='engineer' && s?.location?.directory===t.input.directory && object(got) && Object.entries(expected).every(([k,v])=>got[k]===v)
}
const schema = (properties:Record<string,unknown>, required:string[]=[]) => ({type:'object',properties,required,additionalProperties:false}) as any
const str = {type:'string'}
const output = {type:'object',additionalProperties:true} as any

export async function registerTasks(ctx:Host, configuredModel?:ModelRef) {
 await ctx.session.hook('retry', async event => {
  try {
   const project=inspectProjectFromWorktree(ctx.location.directory)
   const task=new Ledger(project).read().find(t=>t.sessionID===event.sessionID)
   if (!task) return
   const session=await ctx.session.get({sessionID:event.sessionID})
   if (matches(session,task,project.commonDir)) event.decision={retry:false}
  } catch { /* No verified binding: leave the host decision untouched. */ }
 })
 async function caller(tc:any) {
  if (tc.agent !== 'root') throw new TaskRegistryError('HOST_ERROR')
  const project=inspectProject(ctx.location.directory)
  const owner=await ctx.session.get({sessionID:tc.sessionID})
  if (owner.id!==tc.sessionID || owner.agent!=='root' || owner.location?.directory!==project.primaryDirectory || ctx.location.directory!==project.primaryDirectory) throw new TaskRegistryError('PROJECT_MISMATCH')
  return {project,owner,ledger:new Ledger(project)}
 }
 async function authorize(tc:any,action:string,resources:string[]) {
  await ctx.permission.assert({sessionID:tc.sessionID,agent:tc.agent,action,resources,source:{type:'tool',messageID:tc.messageID,id:tc.id}})
 }
 async function identity(tc:any) {
  try { return await caller(tc) } catch(e) { return {error:tc.agent!=='root' ? 'FORBIDDEN_CALLER' : errorCode(e)} }
 }
 async function observe(t:TaskRecord,commonDir:string) {
  const checkedAt=new Date().toISOString()
  if (!t.sessionID) return undefined
  try {
   const s=await ctx.session.get({sessionID:t.sessionID})
   if (!matches(s,t,commonDir)) return {checkedAt,errorCode:'SESSION_MISMATCH'}
   return {checkedAt,agent:s.agent,...(s.outcome ? {outcome:s.outcome}:{}),...(s.time?.busy ? {busyAt:s.time.busy}:{}),...(s.time?.idle ? {idleAt:s.time.idle}:{})}
  } catch { return {checkedAt,errorCode:'HOST_ERROR'} }
 }
 const start = async (raw:unknown,tc:any) => {
  let input:ReturnType<typeof normalizeStoredInput>
   try {
    input=normalizeStoredInput(raw)
    try { input={...input,directory:realpathSync(input.directory)} }
    catch(e) { if ((e as NodeJS.ErrnoException).code!=='ENOENT') throw e }
   } catch(e) { return failureFrom(e) }
  const id=await identity(tc); if ('error' in id) return failure(id.error!)
  const {project,owner,ledger}=id
  await authorize(tc,'crew_task_start',[project.primaryDirectory])
  await authorize(tc,'subagent',['engineer'])
  await authorize(tc,'edit',[...input.scope.map(s=>s.endsWith('/') ? resolve(input.directory,s)+'/**' : resolve(input.directory,s)),join(project.commonDir,'opencode-crew-stage1','registry.json')])
  let task:TaskRecord, periodID:string|undefined
  try {
   const existing=ledger.findByKey(input.key)
   if (!existing && !(configuredModel ?? owner.model)) return failure('HOST_ERROR')
   const reservation=ledger.reserve(tc.sessionID,input,()=>validateWorktree(project.primaryDirectory,input.directory,input.baseline,input.scope))
   task=reservation.task; periodID=reservation.periodID
   if (reservation.replayed) return response({ok:true,task:taskView(task,undefined,{lifecycle:reservation.lifecycle,periodID:reservation.periodID,closeout:reservation.closeout}),warnings:['重放不会重新投递。']})
   } catch(e) { return failureFrom(e) }
  try {
   task=ledger.transition(tc.sessionID,task.taskID,'reserved','session_create_requested')
   const created=await ctx.session.create({agent:'engineer',location:{directory:input.directory},model:configuredModel ?? owner.model!,metadata:{crewTask:metadata(task,project.commonDir)}})
   task=ledger.transition(tc.sessionID,task.taskID,'session_create_requested','session_bound',{sessionID:created.id})
   const current=await ctx.session.get({sessionID:task.sessionID!})
   if (!matches(current,task,project.commonDir)) {
     try { task=ledger.transition(tc.sessionID,task.taskID,'session_bound','start_unconfirmed',{lastErrorCode:'SESSION_MISMATCH'}) } catch {}
    return response({ok:false,task:taskView(task,undefined,{lifecycle:'active',periodID}),error:errorPayload('SESSION_MISMATCH'),warnings:[]})
   }
   validateWorktree(project.primaryDirectory,input.directory,input.baseline,input.scope)
   task=ledger.transition(tc.sessionID,task.taskID,'session_bound','prompt_requested')
   const familyHint=modelFamilyTaskHint(configuredModel ?? owner.model)
   const text=`Goal:\n${input.goal}\nScope:\n${input.scope.join('\n')}\nDecided: bind-only，scope 不是沙箱。cwd: ${input.directory}; baseline: ${input.baseline}; key: ${input.key}。禁止 commit、push、merge、后台进程、脱离进程组、服务和范围外写入。\nApproach: 行为变更先仅写测试并运行红灯，再实现并运行绿灯；保留证据。\nAcceptance:\n${input.acceptance}\nCheck:\n${input.check}${familyHint ? '\n'+familyHint : ''}\n${REPORT_STATUS_PROMPT_HINT}`
   await ctx.session.prompt({sessionID:task.sessionID!,text,delivery:'queue',metadata:{crewTask:metadata(task,project.commonDir)}})
   task=ledger.transition(tc.sessionID,task.taskID,'prompt_requested','submitted')
   return response({ok:true,task:taskView(task,undefined,{lifecycle:'active',periodID}),warnings:[]})
  } catch {
   try { task=ledger.transition(tc.sessionID,task.taskID,task.state,'start_unconfirmed',{lastErrorCode:'START_UNCONFIRMED'}) } catch {}
   return response({ok:false,task:taskView(task,undefined,{lifecycle:'active',periodID}),error:errorPayload('START_UNCONFIRMED'),warnings:[]})
  }
 }
 const status = async(raw:unknown,tc:any) => {
  if (!object(raw) || Object.keys(raw).some(k=>k!=='taskID') || (raw.taskID!==undefined && (typeof raw.taskID!=='string' || !/^ct_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(raw.taskID)))) return failure('INVALID_INPUT')
  const id=await identity(tc);if ('error' in id) return failure(id.error!)
  await authorize(tc,'crew_task_status',[id.project.primaryDirectory])
  try {
   const entries:LedgerEntry[]=raw.taskID ? [id.ledger.find(tc.sessionID,raw.taskID)].filter((entry):entry is LedgerEntry=>!!entry) : id.ledger.active(tc.sessionID)
   const views=await Promise.all(entries.map(async entry=>taskView(entry.record,entry.lifecycle==='active'?await observe(entry.record,id.project.commonDir):undefined,{lifecycle:entry.lifecycle,periodID:entry.periodID,closeout:entry.closeout})))
   return response({ok:true,...(raw.taskID ? (views[0] ? {task:views[0]} : {}) : {tasks:views}),warnings:[]})
  } catch(e) { return failureFrom(e) }
 }
 const stop = async(raw:unknown,tc:any) => {
  if (!object(raw) || Object.keys(raw).length!==1 || typeof raw.taskID!=='string' || !/^ct_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(raw.taskID)) return failure('INVALID_INPUT')
  const id=await identity(tc);if ('error' in id) return failure(id.error!)
  await authorize(tc,'crew_task_stop',[id.project.primaryDirectory]);await authorize(tc,'subagent',['engineer'])
  try {
   const entry=id.ledger.find(tc.sessionID,raw.taskID)
   if (!entry) return failure('TASK_NOT_FOUND')
   if (entry.lifecycle==='closed') return response({ok:true,task:taskView(entry.record,undefined,{lifecycle:'closed',periodID:entry.periodID,closeout:entry.closeout}),warnings:['已结案，不会重复中断。']})
   let task=entry.record
   const meta={lifecycle:'active' as const,periodID:entry.periodID}
   if (task.state==='stop_requested' || task.state==='stop_unconfirmed') return response({ok:true,task:taskView(task,undefined,meta),warnings:['不会重复中断。']})
   if (task.sessionID) {
    let session:any;try { session=await ctx.session.get({sessionID:task.sessionID}) } catch { return failure('HOST_ERROR') }
    if (!matches(session,task,id.project.commonDir)) return failure('SESSION_MISMATCH')
   }
   task=id.ledger.transition(tc.sessionID,task.taskID,task.state,'stop_requested')
   let interruptResult: NonNullable<TaskRecord['interruptResult']> = {interrupted:'unknown',result:'not_requested'}
   if (task.sessionID) { try { await ctx.session.interrupt({sessionID:task.sessionID,resume:false}); interruptResult={interrupted:'unknown',result:'request_completed'} } catch { interruptResult={interrupted:'unknown',result:'error',errorCode:'HOST_ERROR'} } }
   task=id.ledger.transition(tc.sessionID,task.taskID,'stop_requested','stop_unconfirmed',{interruptResult})
   return response({ok:true,task:taskView(task,undefined,meta),warnings:['停止和进程安全均未确认。']})
  } catch(e) { return failureFrom(e) }
 }
 const descriptions = {
  start: [
   '在手工准备的独立 detached worktree 中启动 engineer 会话并一次性投递任务。',
   '前提：只能从主 worktree 根目录的 Root 会话调用；主、目标 worktree 均干净，目标属于同一仓库且不与主 worktree 嵌套，二者 HEAD 与 baseline 均为同一完整 commit OID。',
   '参数：key 在项目的 active 与 closed 任务历史中全局唯一；directory 为绝对路径；scope 为 1～32 个精确相对文件路径或以 / 结尾的目录前缀，不支持 glob；goal、acceptance、check 是任务文本，不作为插件 shell 命令执行。',
   '幂等：同一 Root 会话中，相同 key、相同输入返回原记录，包括已结案记录，不重新创建会话或投递；不同输入或其他 Root 复用 key 会冲突。重试必须换新的 key。',
   '容量：最多保留 2 个未结案写入预留；idle、出错和 stop 均不释放，只能通过离线维护结案释放。',
   '边界：worktree 和 scope 不是操作系统级隔离。',
  ].join('\n'),
  status: [
   '查询当前 Root 会话发起的任务，不能查询其他 Root 的任务。',
   '不传 taskID：只列出当前 Root 的未结案任务。传 taskID：可返回当前 Root 发起的对应未结案或已结案记录；任务不存在或不属于当前 Root 时成功返回，但不含 task 字段。',
  ].join('\n'),
  stop: [
   '对当前 Root 的未结案任务最多发送一次中断请求；重复调用不会再次中断。已结案记录直接返回，不发送中断。',
   '返回只说明请求结果，不能证明会话或进程树已经停止，processSafety 仍为 unconfirmed，也不会释放预留。任务不存在或不属于当前 Root 时拒绝，不要重试。',
  ].join('\n'),
 }
 await ctx.tool.transform(editor=>{
  editor.add({name:'crew_task_start',description:descriptions.start,input:schema({key:str,directory:str,baseline:str,scope:{type:'array',items:str},goal:str,acceptance:str,check:str},['key','directory','baseline','scope','goal','acceptance','check']),output,execute:start} as any)
  editor.add({name:'crew_task_status',description:descriptions.status,input:schema({taskID:str}),output,execute:status} as any)
  editor.add({name:'crew_task_stop',description:descriptions.stop,input:schema({taskID:str},['taskID']),output,execute:stop} as any)
 })
}
