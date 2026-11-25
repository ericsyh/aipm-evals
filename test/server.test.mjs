import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';
import { FileStorage } from '../lib/storage.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RuleStore } from '../lib/rules.mjs';
import { PrivacyStore } from '../lib/privacy.mjs';

async function fixture(t, token, {optIn=true,minParticipants=1}={}) {
  const dir=await mkdtemp(join(tmpdir(),'pm-signal-api-'));
  const privacyStore=new PrivacyStore(join(dir,'privacy.json'));
  if(optIn)for(const id of ['pm-01','private-member-id','local-pm'])await privacyStore.update(id,{telemetryEnabled:true,teamSharingEnabled:true});
  const server=createServer({storage:new FileStorage(dir),ruleStore:new RuleStore(join(dir,'rules.json')),privacyStore,token,minParticipants,memberId:'pm-01'});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  return `http://127.0.0.1:${server.address().port}`;
}
async function personalCookie(base){const response=await fetch(base+'/');return response.headers.get('set-cookie').split(';')[0];}
async function personalDashboard(base){return(await fetch(base+'/api/me/dashboard?mode=collected',{headers:{Cookie:await personalCookie(base)}})).json();}
const sample={id:'test-1',sessionId:'private-session-id',memberId:'private-member-id',source:'codex',action:'artifact',task:'design',title:'PRIVATE-PROPOSAL-TEXT',evidence:'PRIVATE-EVIDENCE-CONTENT',timestamp:new Date(Date.now()-60000).toISOString()};
test('ingestion → durable storage → dashboard, idempotent retries and demo isolation', async t=>{
  const base=await fixture(t);
  const post=()=>fetch(base+'/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[sample]})});
  assert.deepEqual(await(await post()).json(),{accepted:1,duplicates:0});
  assert.deepEqual(await(await post()).json(),{accepted:0,duplicates:1});
  const live=await(await fetch(base+'/api/dashboard?mode=collected')).json();
  assert.equal(live.summary.total,1);assert.equal(live.workflows.find(w=>w.id==='design').artifacts,1);
  assert.ok(!Object.hasOwn(live,'sessions'));assert.ok(!Object.hasOwn(live,'members'));
  for(const value of [sample.id,sample.sessionId,sample.memberId,sample.title,sample.evidence])assert.ok(!JSON.stringify(live).includes(value));
  const demo=await(await fetch(base+'/api/dashboard?mode=demo')).json();
  assert.ok(demo.summary.total>100);assert.equal(demo.workflows.length,13);
  assert.equal((await(await fetch(base+'/api/dashboard?mode=collected')).json()).summary.total,1);
});
test('automatically recognizes observations, keeps input text out of storage and scores aggregate PM adoption',async t=>{
  const base=await fixture(t),text='Compare competitors and alternatives: PRIVATE-OBSERVATION-TEXT';
  const observation={id:'recognition-1',sessionId:'recognition-session',memberId:'pm-01',source:'codex',kind:'prompt_submitted',timestamp:new Date().toISOString(),text};
  const request=()=>fetch(base+'/api/observations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({observations:[observation]})});
  const first=await(await request()).json();assert.equal(first.classified,1);assert.ok(first.accepted>0);
  const retry=await(await request()).json();assert.equal(retry.accepted,0);
  const dashboard=await(await fetch(base+'/api/dashboard?mode=collected')).json();
  assert.equal(dashboard.workflows.find(w=>w.id==='competition').total,1);assert.equal(dashboard.provenance.automaticallyClassified,1);
  assert.equal(dashboard.adoption,null);const mine=await personalDashboard(base);
  const pm=mine.adoption.members.find(m=>m.activities);assert.equal(pm.label,'You');assert.equal(pm.points,5.5);
  assert.ok(!JSON.stringify(dashboard).includes('PRIVATE-OBSERVATION-TEXT'));assert.ok(!JSON.stringify(dashboard).includes('recognition-session'));
});
test('rule preview writes nothing; authenticated configuration uses revision checks and recalculates targets',async t=>{
  const base=await fixture(t,'rules-secret'),initial=await(await fetch(base+'/api/rules')).json();
  const draft=structuredClone(initial.config);draft.scoring.weeklyTarget=400;
  const body=JSON.stringify({config:draft}),headers={'Content-Type':'application/json','If-Match':initial.revision};
  assert.equal((await fetch(base+'/api/rules',{method:'PUT',headers,body})).status,401);
  const response=await fetch(base+'/api/rules',{method:'PUT',headers:{...headers,Authorization:'Bearer rules-secret'},body});assert.equal(response.status,200);
  assert.equal((await fetch(base+'/api/rules',{method:'PUT',headers:{...headers,Authorization:'Bearer rules-secret'},body})).status,409);
  const preview=await fetch(base+'/api/recognize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({observation:{id:'preview',sessionId:'preview',memberId:'pm-01',source:'codex',kind:'prompt_submitted',text:'Compare competitor pricing.',timestamp:new Date().toISOString()}})});
  assert.equal(preview.status,200);assert.equal((await preview.json()).task,'competition');
  const data=await personalDashboard(base);assert.equal(data.summary.total,0);assert.equal(data.adoption.target,1600);
});
test('native hook handler sends authorized content for recognition and metadata-only mode remains unclassified',async t=>{
  const base=await fixture(t,'capture-secret');
  async function capture(payload,includeContent){
    const child=(await import('node:child_process')).spawn(process.execPath,['collector/capture.mjs','--provider','claude',...(includeContent?['--include-content']:[])],{env:{...process.env,PM_SIGNAL_ENDPOINT:base+'/api/observations',PM_SIGNAL_MEMBER_ID:'pm-01',PM_SIGNAL_TELEMETRY:'1',PM_SIGNAL_CAPTURE_CONTENT:'0',INGEST_TOKEN:'capture-secret'}});
    let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.stdin.end(JSON.stringify(payload));
    const [code]=await once(child,'exit');assert.equal(code,0);assert.equal(stdout,'');assert.equal(stderr,'');
  }
  await capture({session_id:'native-1',prompt_id:'p1',hook_event_name:'UserPromptSubmit',prompt:'Compare competitor pricing.'},true);
  await capture({session_id:'native-2',prompt_id:'p2',hook_event_name:'UserPromptSubmit',prompt:'Compare competitor pricing.'},false);
  const data=await(await fetch(base+'/api/dashboard?mode=collected')).json();assert.equal(data.summary.total,2);
  assert.equal(data.workflows.find(w=>w.id==='competition').total,1);assert.equal(data.workflows.find(w=>w.id==='unknown').total,1);
});
test('validates batches atomically, authentication, cross-site requests and public configuration',async t=>{
  const base=await fixture(t,'secret');
  const request=(body,headers={})=>fetch(base+'/api/events',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await request({events:[sample]})).status,401);
  const headers={Authorization:'Bearer secret'};
  assert.equal((await request(null,headers)).status,400);
  assert.equal((await request({events:[sample,{...sample,id:'bad',action:'invalid'}]},headers)).status,400);
  assert.equal((await(await fetch(base+'/api/dashboard?mode=collected')).json()).summary.total,0);
  assert.equal((await request({events:[sample]},{...headers,Origin:'https://untrusted.example'})).status,403);
  assert.equal((await request({events:[sample]},headers)).status,200);
  const config=await(await fetch(base+'/api/config')).json();
  assert.equal(config.ingestRequiresToken,true);assert.ok(!JSON.stringify(config).includes('secret'));
});
test('serves the app and assets, rejects missing files and unsupported methods',async t=>{
  const base=await fixture(t);
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/Signal/);
  assert.equal((await fetch(base+'/styles.css')).status,200);
  assert.equal((await fetch(base+'/app.js')).status,200);
  assert.equal((await fetch(base+'/missing')).status,404);
  assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/%2e%2e%2fserver.mjs')).status,403);
});
test('CLI sends example records through authenticated API and can safely replay stable IDs',async t=>{
  const base=await fixture(t,'cli-secret');
  const run=()=>promisify(execFile)(process.execPath,['collector/collect.mjs','--source','codex','--member','pm-01','--file','examples/session.jsonl','--endpoint',base+'/api/events'],{env:{...process.env,INGEST_TOKEN:'cli-secret'}});
  assert.match((await run()).stdout,/stored 7 events/);
  assert.match((await run()).stdout,/skipped 7 duplicates/);
  const data=await(await fetch(base+'/api/dashboard?mode=collected')).json();
  assert.equal(data.summary.total,1);assert.equal(data.summary.deep,1);assert.equal(data.summary.confirmed,1);
  const observations=await promisify(execFile)(process.execPath,['collector/collect.mjs','--observations','--source','codex','--member','pm-01','--file','examples/observations.jsonl','--endpoint',base+'/api/observations'],{env:{...process.env,INGEST_TOKEN:'cli-secret'}});
  assert.match(observations.stdout,/Collection complete/);
  const recognized=await(await fetch(base+'/api/dashboard?mode=collected')).json();
  assert.equal(recognized.summary.total,4);assert.equal(recognized.workflows.find(w=>w.id==='competition').total,1);assert.equal(recognized.provenance.automaticallyClassified,3);
  assert.equal((await fetch(base+'/api/dashboard?days=6')).status,400);
  assert.equal((await fetch(base+'/api/dashboard?task=others')).status,400);
});
