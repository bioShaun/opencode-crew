import { spawnSync } from 'node:child_process'
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { inspectProject, normalizeScopeLexical, TaskRegistryError } from './tasks-registry'

export interface ReviewLimits { maxPaths:number; maxFileBytes:number; maxTotalBytes:number; timeoutMs:number }
export interface ReviewRequest { primaryDirectory:string; directory:string; taskID:string; baseline:string; scope:string[]; periodID?:string; limits?:Partial<ReviewLimits> }
export interface ReviewEntry { path:string; changeType:string; source:'index'|'worktree'|'head'; bytes?:number; sha256?:string; status:'hashed'|'unreadable'|'missing'|'changed'|'excluded'|'refused' }
export interface ReviewListing { v:1; taskID:string; periodID?:string; baseline:string; observedFrom:string; observedTo:string; head:{from:string|null;to:string|null;drifted:boolean|null}|null; completeness:'complete'|'incomplete'|'changed'; counts:Record<'tracked'|'staged'|'unstaged'|'untracked'|'deleted'|'renamed'|'binary'|'unknown'|'excluded'|'outsideScope',number>; entries:ReviewEntry[]; failures:{code:string;count:number}[]; warnings:string[]; limits:ReviewLimits }
const defaults:ReviewLimits={maxPaths:512,maxFileBytes:2*1024*1024,maxTotalBytes:16*1024*1024,timeoutMs:5000}
const fail=(code:'INVALID_INPUT'|'PROJECT_MISMATCH'|'HOST_ERROR'|'BASELINE_MISMATCH'):never=>{throw new TaskRegistryError(code)}
const contains=(a:string,b:string)=>{const r=relative(a,b);return !r || (r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r))}
export function reviewTask(request:ReviewRequest):ReviewListing {
 if (!request || typeof request!=='object' || Array.isArray(request)) return fail('INVALID_INPUT')
 const start=Date.now(), observedFrom=new Date().toISOString(); const limits={...defaults,...request.limits}
 if (!request || typeof request.taskID!=='string' || !request.taskID || (request.periodID!==undefined && typeof request.periodID!=='string') || Object.keys(limits).some(k=>!(k in defaults)) || Object.values(limits).some(n=>!Number.isSafeInteger(n)||n<=0)) return fail('INVALID_INPUT')
 const scope=normalizeScopeLexical(request.scope)
 const counts={tracked:0,staged:0,unstaged:0,untracked:0,deleted:0,renamed:0,binary:0,unknown:0,excluded:0,outsideScope:0}; const entries:ReviewEntry[]=[]; const failures:{code:string;count:number}[]=[]; const warnings:string[]=[]; let completeness:ReviewListing['completeness']='complete',total=0; let headFrom:string|null=null,headTo:string|null=null
 const preflightTimeout=():ReviewListing=>({v:1,taskID:request.taskID,...(request.periodID===undefined?{}:{periodID:request.periodID}),baseline:request.baseline,observedFrom,observedTo:new Date().toISOString(),head:null,completeness:'incomplete',counts,entries,failures:[{code:'REVIEW_LIMIT_EXCEEDED',count:1}],warnings,limits})
 let project:ReturnType<typeof inspectProject>
 // inspectProject uses its own Git timeouts; our budget can only be checked after it returns.
 try { project=inspectProject(request.primaryDirectory) } catch(error) { if(Date.now()-start>limits.timeoutMs)return preflightTimeout();throw error }
 if(Date.now()-start>limits.timeoutMs) return preflightTimeout()
 let root:string; try { if(!isAbsolute(request.directory)) return fail('PROJECT_MISMATCH'); root=realpathSync(request.directory) } catch { return fail('PROJECT_MISMATCH') }
 if(contains(project.primaryDirectory,root)||contains(root,project.primaryDirectory)||contains(resolve(project.commonDir,'opencode-crew-stage1'),root)||contains(root,resolve(project.commonDir,'opencode-crew-stage1'))) return fail('PROJECT_MISMATCH')
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_'))); env.GIT_OPTIONAL_LOCKS='0'
 const timeout=Symbol('timeout')
 function failure(code:string,changed=false){const f=failures.find(x=>x.code===code); if(f) f.count++; else failures.push({code,count:1}); if(code==='REVIEW_LIMIT_EXCEEDED')completeness='incomplete';else if(completeness!=='changed'&&!failures.some(x=>x.code==='REVIEW_LIMIT_EXCEEDED')) completeness=changed?'changed':'incomplete'}
 function git(cwd:string,args:string[],code:'PROJECT_MISMATCH'|'HOST_ERROR'|'BASELINE_MISMATCH'='HOST_ERROR'):string { const remaining=limits.timeoutMs-(Date.now()-start);if(remaining<=0)throw timeout;const r=spawnSync('git',['-c','core.fsmonitor=false',...args],{cwd,env,encoding:'utf8',timeout:remaining,maxBuffer:1024*1024}); if(r.error||r.status!==0||r.signal){if(['ETIMEDOUT','ENOBUFS'].includes((r.error as NodeJS.ErrnoException|undefined)?.code??'')||Date.now()-start>=limits.timeoutMs)throw timeout;return fail(code)} return r.stdout }
 try {
 const list=git(project.primaryDirectory,['worktree','list','--porcelain','-z'],'PROJECT_MISMATCH').split('\0\0')
 if(!list.some(x=>x.split('\0')[0]===`worktree ${root}`&&!x.split('\0').includes('bare'))) return fail('PROJECT_MISMATCH')
 try { if(realpathSync(git(root,['rev-parse','--path-format=absolute','--git-common-dir'],'PROJECT_MISMATCH').trimEnd())!==project.commonDir || realpathSync(git(root,['rev-parse','--show-toplevel'],'PROJECT_MISMATCH').trimEnd())!==root) return fail('PROJECT_MISMATCH') } catch(e) { if(e===timeout)throw e;return fail('PROJECT_MISMATCH') }
 const format=git(root,['rev-parse','--show-object-format']).trim(), len=format==='sha1'?40:format==='sha256'?64:0
 if(typeof request.baseline!=='string'||!len||!new RegExp(`^[0-9a-f]{${len}}$`).test(request.baseline)||git(root,['rev-parse','--verify',`${request.baseline}^{commit}`],'BASELINE_MISMATCH').trim()!==request.baseline) return fail('BASELINE_MISMATCH')
 git(root,['cat-file','-e',`${request.baseline}^{commit}`],'BASELINE_MISMATCH')
 headFrom=git(root,['rev-parse','HEAD']).trim()
 const raw=git(root,['status','--porcelain=v1','-z','--untracked-files=all']).split('\0')
 const ancestor=spawnSync('git',['-c','core.fsmonitor=false','merge-base','--is-ancestor',request.baseline,headFrom],{cwd:root,env,timeout:Math.max(1,limits.timeoutMs-(Date.now()-start)),maxBuffer:1024*1024})
 if(ancestor.status===1) warnings.push('BASELINE_NOT_ANCESTOR: baseline 不在 HEAD 祖先链上'); else if(ancestor.status!==0||ancestor.error||ancestor.signal) { if(Date.now()-start>=limits.timeoutMs) { failures.push({code:'REVIEW_LIMIT_EXCEEDED',count:1});completeness='incomplete' } else return fail('HOST_ERROR') }
 const trackedPaths=new Set<string>(),outsidePaths=new Set<string>(),entryKeys=new Set<string>()
 function tracked(path:string){if(!trackedPaths.has(path)){trackedPaths.add(path);counts.tracked++}}
 const added=(path:string,type:string,source:ReviewEntry['source'])=>{const before=entries.length;add(path,type,source);return entries.length>before}
 function add(path:string,type:string,source:ReviewEntry['source']) {
  if(entries.length>=limits.maxPaths||Date.now()-start>=limits.timeoutMs){failure('REVIEW_LIMIT_EXCEEDED'); return}
  const key=path+'\0'+source+'\0'+type;if(!path.includes('\ufffd')){if(entryKeys.has(key))return;entryKeys.add(key)}
  if(!scope.some(s=>s.endsWith('/')?path.startsWith(s):path===s)&&!outsidePaths.has(path)){outsidePaths.add(path);counts.outsideScope++}
  const e:ReviewEntry={path,changeType:type,source,status:'unreadable'}; entries.push(e)
  if(path.includes('\ufffd')){e.status='refused';failure('REVIEW_REFUSED');if(!warnings.includes('存在无法按 UTF-8 表示的路径，已保守拒绝'))warnings.push('存在无法按 UTF-8 表示的路径，已保守拒绝');return}
  if(type==='deleted'){e.status='missing';return}
  const parts=path.split('/'); if(!path||isAbsolute(path)||parts.some(p=>!p||p==='.'||p==='..')){e.status='refused';failure('REVIEW_REFUSED');return}
  if(parts.some(p=>['.git','.env','.ssh','.gnupg','node_modules','.cache','.venv','.opencode','secrets'].includes(p)||(p.startsWith('.env.')&&p!=='.env.example'))||/\.(?:sqlite|sqlite3|db|db-wal|db-shm|pem|key)$/i.test(parts[parts.length-1])){e.status='excluded';counts.excluded++;return}
  let fd=-1
  try {
   let p=root; for(let i=0;i<parts.length;i++){p=resolve(p,parts[i]);const st=lstatSync(p);if(st.isSymbolicLink()||(i<parts.length-1&&!st.isDirectory())){e.status='refused';failure('REVIEW_REFUSED');return} if(i===parts.length-1&&!st.isFile()){e.status='refused';failure('REVIEW_REFUSED');return}}
   // These checks detect some replacements, not all concurrent races; this is not a sandbox or snapshot.
   const actual=realpathSync(p); if(actual!==resolve(root,...parts)){e.status='refused';failure('REVIEW_REFUSED');return}
   const before=lstatSync(p); if(before.size>limits.maxFileBytes||total+before.size>limits.maxTotalBytes){failure('REVIEW_LIMIT_EXCEEDED');return}
   fd=openSync(p,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK); const opened=fstatSync(fd); if(realpathSync(p)!==actual){e.status='refused';failure('REVIEW_REFUSED');return} if(before.ino!==opened.ino||before.dev!==opened.dev||before.size!==opened.size||before.mtimeMs!==opened.mtimeMs){e.status='changed';failure('REVIEW_CHANGED',true);return}
   const hash=createHash('sha256'); const buf=Buffer.alloc(Math.min(65536,Math.max(1,before.size))); let n:number,bytes=0,binary=false
   while((n=readSync(fd,buf,0,buf.length,null))>0){total+=n;if(Date.now()-start>limits.timeoutMs||bytes+n>limits.maxFileBytes||total>limits.maxTotalBytes){failure('REVIEW_LIMIT_EXCEEDED');return} if(bytes<8000&&buf.subarray(0,Math.min(n,8000-bytes)).includes(0)) binary=true;hash.update(buf.subarray(0,n));bytes+=n}
   const after=fstatSync(fd),last=lstatSync(p);if(after.ino!==opened.ino||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||last.ino!==opened.ino||last.dev!==opened.dev||last.size!==opened.size||last.mtimeMs!==opened.mtimeMs){e.status='changed';failure('REVIEW_CHANGED',true);return}
   e.status='hashed';e.bytes=bytes;e.sha256=hash.digest('hex');if(binary&&type!=='unknown'){e.changeType='binary';counts.binary++}
  } catch(err) {if((err as NodeJS.ErrnoException).code==='ENOENT'){e.status='missing';if(type!=='deleted')failure('REVIEW_MISSING')}else{e.status='unreadable';failure('REVIEW_UNREADABLE')}} finally {if(fd!==-1)closeSync(fd)}
 }
 let stopped=false
 for(let i=0;i<raw.length&&raw[i];i++){if(entries.length>=limits.maxPaths||Date.now()-start>=limits.timeoutMs){failure('REVIEW_LIMIT_EXCEEDED');stopped=true;break}const record=raw[i],xy=record.slice(0,2),path=record.slice(3);if(xy==='??'){counts.untracked++;add(path,'untracked','worktree');continue} if(xy[0]!==' ')counts.staged++;if(xy[1]!==' ')counts.unstaged++;const source=xy[1]!==' '?'worktree':'index';if(xy.includes('R')){const old=raw[++i];counts.renamed++;counts.deleted++;if(added(old,'deleted',source))tracked(old);if(entries.length>=limits.maxPaths||Date.now()-start>=limits.timeoutMs){failure('REVIEW_LIMIT_EXCEEDED');stopped=true;break}if(added(path,'renamed',source))tracked(path)}else {const type=['DD','AU','UD','UA','DU','AA','UU'].includes(xy)?'unknown':xy.includes('D')?'deleted':xy.includes('A')?'added':/[MT]/.test(xy)?'modified':'unknown';if(type==='unknown')counts.unknown++;if(type==='deleted')counts.deleted++;if(added(path,type,source))tracked(path)}}
 const drift=stopped?[]:git(root,['diff','--name-status','-z','--no-renames',`${request.baseline}..${headFrom}`]).split('\0')
 for(let i=0;i<drift.length&&drift[i];i+=2){if(entries.length>=limits.maxPaths||Date.now()-start>=limits.timeoutMs){failure('REVIEW_LIMIT_EXCEEDED');break}const type=drift[i][0]==='D'?'deleted':drift[i][0]==='A'?'added':drift[i][0]==='M'?'modified':'unknown';if(type==='deleted')counts.deleted++;if(type==='unknown')counts.unknown++;if(added(drift[i+1],type,'head'))tracked(drift[i+1])}
 headTo=git(root,['rev-parse','HEAD']).trim();if(headFrom!==null&&headTo!==null&&headFrom!==headTo)failure('REVIEW_CHANGED',true)
 } catch(e) { if(e!==timeout) throw e; failure('REVIEW_LIMIT_EXCEEDED') }
 entries.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)))
 for(const e of entries)e.path=e.path.replace(/[\x00-\x1f\x7f-\x9f]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`)
 if(counts.outsideScope)warnings.push(`有 ${counts.outsideScope} 个路径在 scope 外`);if(counts.renamed)warnings.push('rename 按旧路径 deleted 和新路径 renamed 计数')
 const head=headFrom===null&&headTo===null?null:{from:headFrom,to:headTo,drifted:headFrom===null||headTo===null?null:headFrom!==request.baseline||headTo!==request.baseline}
 return {v:1,taskID:request.taskID,...(request.periodID===undefined?{}:{periodID:request.periodID}),baseline:request.baseline,observedFrom,observedTo:new Date().toISOString(),head,completeness,counts,entries,failures,warnings,limits}
}
