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
const response = (output: any) => ({ output, content: output.ok ? '任务记录已处理；进程安全未确认。' : '任务操作未完成。' })
const failure = (code: string) => response({ ok:false, error:{code,message:'任务操作未完成，请检查状态并人工调查。'}, warnings:[] })
const errorCode = (e: unknown) => e instanceof TaskRegistryError ? e.code : 'HOST_ERROR'
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
   } catch(e) { return failure(errorCode(e)) }
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
  } catch(e) { return failure(errorCode(e)) }
  try {
   task=ledger.transition(tc.sessionID,task.taskID,'reserved','session_create_requested')
   const created=await ctx.session.create({agent:'engineer',location:{directory:input.directory},model:configuredModel ?? owner.model!,metadata:{crewTask:metadata(task,project.commonDir)}})
   task=ledger.transition(tc.sessionID,task.taskID,'session_create_requested','session_bound',{sessionID:created.id})
   const current=await ctx.session.get({sessionID:task.sessionID!})
   if (!matches(current,task,project.commonDir)) {
     try { task=ledger.transition(tc.sessionID,task.taskID,'session_bound','start_unconfirmed',{lastErrorCode:'SESSION_MISMATCH'}) } catch {}
    return response({ok:false,task:taskView(task,undefined,{lifecycle:'active',periodID}),error:{code:'SESSION_MISMATCH',message:'会话身份不匹配。'},warnings:[]})
   }
   validateWorktree(project.primaryDirectory,input.directory,input.baseline,input.scope)
   task=ledger.transition(tc.sessionID,task.taskID,'session_bound','prompt_requested')
   const familyHint=modelFamilyTaskHint(configuredModel ?? owner.model)
   const text=`Goal:\n${input.goal}\nScope:\n${input.scope.join('\n')}\nDecided: bind-only，scope 不是沙箱。cwd: ${input.directory}; baseline: ${input.baseline}; key: ${input.key}。禁止 commit、push、merge、后台进程、脱离进程组、服务和范围外写入。禁止使用 /tmp。重活先 slot audit/status 留日志并经 slot 提交。\nApproach: 行为变更先仅写测试并运行红灯，再实现并运行绿灯；保留证据。\nAcceptance:\n${input.acceptance}\nCheck:\n${input.check}${familyHint ? '\n'+familyHint : ''}\n${REPORT_STATUS_PROMPT_HINT}`
   await ctx.session.prompt({sessionID:task.sessionID!,text,delivery:'queue',metadata:{crewTask:metadata(task,project.commonDir)}})
   task=ledger.transition(tc.sessionID,task.taskID,'prompt_requested','submitted')
   return response({ok:true,task:taskView(task,undefined,{lifecycle:'active',periodID}),warnings:[]})
  } catch {
   try { task=ledger.transition(tc.sessionID,task.taskID,task.state,'start_unconfirmed',{lastErrorCode:'START_UNCONFIRMED'}) } catch {}
   return response({ok:false,task:taskView(task,undefined,{lifecycle:'active',periodID}),error:{code:'START_UNCONFIRMED',message:'启动结果未确认，请人工调查。'},warnings:[]})
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
  } catch(e) { return failure(errorCode(e)) }
 }
 const stop = async(raw:unknown,tc:any) => {
  if (!object(raw) || Object.keys(raw).length!==1 || typeof raw.taskID!=='string' || !/^ct_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(raw.taskID)) return failure('INVALID_INPUT')
  const id=await identity(tc);if ('error' in id) return failure(id.error!)
  await authorize(tc,'crew_task_stop',[id.project.primaryDirectory]);await authorize(tc,'subagent',['engineer'])
  try {
   const entry=id.ledger.find(tc.sessionID,raw.taskID)
   if (!entry) return failure('HOST_ERROR')
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
  } catch(e) { return failure(errorCode(e)) }
 }
 await ctx.tool.transform(editor=>{
  editor.add({name:'crew_task_start',description:'绑定手工准备的工作区并一次性投递任务',input:schema({key:str,directory:str,baseline:str,scope:{type:'array',items:str},goal:str,acceptance:str,check:str},['key','directory','baseline','scope','goal','acceptance','check']),output,execute:start} as any)
  editor.add({name:'crew_task_status',description:'查询当前 Root 的任务',input:schema({taskID:str}),output,execute:status} as any)
  editor.add({name:'crew_task_stop',description:'最多请求一次中断；停止状态未确认',input:schema({taskID:str},['taskID']),output,execute:stop} as any)
 })
}
