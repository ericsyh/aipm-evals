import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { PrivacyStore } from '../lib/privacy.mjs';
import { RuleStore } from '../lib/rules.mjs';
import { FileStorage } from '../lib/storage.mjs';
import { createServer } from '../server.mjs';
import { validateEvent } from '../lib/model.mjs';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'pm-privacy-'));const privacy=new PrivacyStore(join(dir,'privacy.json')),storage=new FileStorage(join(dir,'events'));
  const server=createServer({privacyStore:privacy,storage,ruleStore:new RuleStore(join(dir,'rules.json')),memberId:'pm-01'});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;
  const cookie=(await fetch(base+'/')).headers.get('set-cookie').split(';')[0];
  return {privacy,storage,base,cookie,request:(path,options={})=>fetch(base+path,{...options,headers:{'Content-Type':'application/json',Cookie:cookie,...options.headers}})};
}
const observation={id:'private-observation',sessionId:'private-session',memberId:'pm-01',source:'codex',kind:'prompt_submitted',text:'Compare competitor pricing: PRIVATE-TEXT',timestamp:new Date().toISOString()};
test('telemetry is off by default; private recording and team contribution are separate, and disabling stops later writes',async t=>{
  const f=await fixture(t);
  const post=()=>f.request('/api/observations',{method:'POST',body:JSON.stringify({observations:[observation]})});
  assert.equal((await(await f.request('/api/me/preferences')).json()).telemetryEnabled,false);
  assert.equal((await(await post()).json()).paused,1);assert.equal((await f.storage.list()).length,0);
  await f.request('/api/me/preferences',{method:'PUT',body:JSON.stringify({telemetryEnabled:true,teamSharingEnabled:false})});
  assert.ok((await(await post()).json()).accepted>0);
  const mine=await(await f.request('/api/me/dashboard?mode=collected')).json();assert.equal(mine.summary.total,1);assert.equal(mine.adoption.members.length,1);
  const team=await(await fetch(f.base+'/api/dashboard?mode=collected')).json();assert.equal(team.summary.total,0);assert.equal(team.adoption,null);assert.equal(team.privacy.suppressed,true);
  await f.request('/api/me/preferences',{method:'PUT',body:JSON.stringify({telemetryEnabled:true,teamSharingEnabled:true})});
  assert.equal((await(await fetch(f.base+'/api/dashboard?mode=collected')).json()).privacy.suppressed,true);
  const off=await(await f.request('/api/me/preferences',{method:'PUT',body:JSON.stringify({telemetryEnabled:false,teamSharingEnabled:true})})).json();assert.equal(off.teamSharingEnabled,false);
  assert.equal((await(await post()).json()).accepted,0);assert.equal((await(await f.request('/api/me/dashboard?mode=collected')).json()).summary.total,1);
});
test('personal endpoints require a capability and cannot select other members; method-sharing APIs are removed',async t=>{
  const f=await fixture(t);
  assert.equal((await fetch(f.base+'/api/me/dashboard')).status,401);
  assert.equal((await fetch(f.base+'/team')).headers.get('set-cookie'),null);
  assert.equal((await f.request('/api/me/dashboard?memberId=pm-02')).status,403);
  assert.equal((await f.request('/api/me/shares')).status,404);
  assert.equal((await fetch(f.base+'/api/team/shares')).status,404);
  assert.equal((await f.request('/api/me/shares',{method:'POST',body:JSON.stringify({task:'competition',outcome:'helpful',confirmed:true})})).status,404);
});
test('deletion removes only personal metadata, disables capture, and preserves other members',async t=>{
  const f=await fixture(t);await f.privacy.update('pm-01',{telemetryEnabled:true,teamSharingEnabled:true});
  await f.request('/api/observations',{method:'POST',body:JSON.stringify({observations:[observation]})});
  await f.storage.append([{id:'other',memberId:'pm-02'}]);
  const response=await f.request('/api/me/data',{method:'DELETE'});assert.equal(response.status,200);assert.ok((await response.json()).removed>0);
  assert.deepEqual(await f.storage.list(),[{id:'other',memberId:'pm-02'}]);assert.equal((await f.privacy.get('pm-01')).telemetryEnabled,false);assert.equal((await f.privacy.get('pm-01')).teamSharingEnabled,false);
});
test('consent changes serialize with writes; after disable acknowledgment no queued write can record',async t=>{
  const f=await fixture(t);await f.privacy.update('pm-01',{telemetryEnabled:true,teamSharingEnabled:true});
  let release,start;const blocked=new Promise(r=>release=r),started=new Promise(r=>start=r);
  const first=f.privacy.ingest(['pm-01'],async()=>{start();await blocked;return 1;});await started;
  const disable=f.privacy.update('pm-01',{telemetryEnabled:false,teamSharingEnabled:false});release();assert.equal((await first).value,1);await disable;
  let called=false;assert.equal((await f.privacy.ingest(['pm-01'],()=>{called=true;})).paused,true);assert.equal(called,false);
  assert.equal((await new PrivacyStore(f.privacy.file).get('pm-01')).telemetryEnabled,false);
});
test('capture honors the explicit off override without making any network request',async t=>{
  let requests=0;const server=http.createServer((req,res)=>{requests++;res.end('{}');});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const child=spawn(process.execPath,['collector/capture.mjs','--include-content'],{env:{...process.env,PM_SIGNAL_TELEMETRY:'off',PM_SIGNAL_ENDPOINT:`http://127.0.0.1:${server.address().port}/api/observations`}});child.stdin.end(JSON.stringify({prompt:'PRIVATE-TEXT'}));let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
  const [code]=await once(child,'exit');assert.equal(code,0);assert.equal(output,'');assert.equal(requests,0);
});
test('team counts require a sufficiently large voluntarily opted-in cohort and never include personal scores',async t=>{
  const f=await fixture(t);
  for(const memberId of ['pm-01','pm-02','pm-05']){await f.privacy.update(memberId,{telemetryEnabled:true,teamSharingEnabled:true});await f.storage.append([validateEvent({id:'cohort-'+memberId,memberId,sessionId:'cohort-'+memberId,source:'codex',task:'competition',action:'prompt',timestamp:new Date().toISOString()})]);}
  const shared=await(await fetch(f.base+'/api/dashboard?mode=collected')).json();assert.equal(shared.summary.total,3);assert.equal(shared.privacy.suppressed,false);assert.equal(shared.adoption,null);
  assert.deepEqual((await(await fetch(f.base+'/api/rules')).json()).config.members,{});
  assert.equal((await(await fetch(f.base+'/api/telemetry/status?memberId=pm-02')).json()).telemetryEnabled,false);
  await f.privacy.update('pm-01',{telemetryEnabled:false,teamSharingEnabled:false});
  const withdrawn=await(await fetch(f.base+'/api/dashboard?mode=collected')).json();assert.equal(withdrawn.privacy.suppressed,true);assert.equal(withdrawn.summary.total,0);
});
test('a disabled server preference makes native capture stop before processing stdin',async t=>{
  const f=await fixture(t);const child=spawn(process.execPath,['collector/capture.mjs','--provider','claude','--include-content'],{env:{...process.env,PM_SIGNAL_MEMBER_ID:'pm-01',PM_SIGNAL_TELEMETRY:'1',PM_SIGNAL_ENDPOINT:f.base+'/api/observations'}});
  let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.stdin.end('PRIVATE-INVALID-JSON');const [code]=await once(child,'exit');assert.equal(code,0);assert.equal(output,'');assert.equal((await f.storage.list()).length,0);
});
