import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { timingSafeEqual,randomBytes } from 'node:crypto';
import { createStorage } from './lib/storage.mjs';
import { validateEvent, makeDemoEvents, sessionsFromEvents } from './lib/model.mjs';
import { aggregateDashboard } from './lib/analytics.mjs';
import { RuleStore, validateRules } from './lib/rules.mjs';
import { PrivacyStore } from './lib/privacy.mjs';
import { recognizeObservation,validateObservation } from './lib/recognition.mjs';
import { scoreMembers } from './lib/scoring.mjs';

const publicDir = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const authorized = (req, token) => {
  if (!token) return true;
  const actual = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

async function readJson(req) {
  const error=(message,status)=>{const e=new Error(message);e.status=status;throw e;};
  if(!req.headers['content-type']?.startsWith('application/json'))error('Use application/json',415);
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>1024*1024)error('Request must not exceed 1 MB',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{error('Invalid JSON',400);}
}
export function createServer({ storage=createStorage(),ruleStore=new RuleStore(),privacyStore=new PrivacyStore(),token=process.env.INGEST_TOKEN,personalToken=process.env.PERSONAL_TOKEN||randomBytes(32).toString('hex'),memberId=process.env.PM_SIGNAL_MEMBER_ID||'pm-01',minParticipants=Number(process.env.TEAM_MIN_PARTICIPANTS||3),now=()=>new Date() }={}) {
  if(!Number.isInteger(minParticipants)||minParticipants<1||minParticipants>50)throw new Error('TEAM_MIN_PARTICIPANTS must be 1–50');
  const personal=req=>{
    const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('pm_signal_personal='))?.slice('pm_signal_personal='.length);
    const actual=Buffer.from(cookie||req.headers.authorization?.replace(/^Bearer /,'')||''),expected=Buffer.from(personalToken);
    return actual.length===expected.length&&timingSafeEqual(actual,expected);
  };
  const publicRules=snapshot=>({...snapshot,config:{...snapshot.config,members:{}}});
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    const url=new URL(req.url,'http://localhost');
    try{
      if(['POST','PUT','DELETE'].includes(req.method)&&req.headers.origin&&![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))return json(res,403,{error:'Cross-site requests are not accepted'});
      if(url.pathname.startsWith('/api/me/')){
        if(!personal(req))return json(res,401,{error:'This endpoint requires the personal workspace capability'});
        if(url.searchParams.has('memberId')&&url.searchParams.get('memberId')!==memberId)return json(res,403,{error:'Another member cannot be selected'});
        if(req.method==='GET'&&url.pathname==='/api/me/preferences')return json(res,200,{...await privacyStore.get(memberId),memberId});
        if(req.method==='PUT'&&url.pathname==='/api/me/preferences'){
          const payload=await readJson(req);let preference;try{preference=await privacyStore.update(memberId,payload);}catch(e){return json(res,400,{error:e.message});}return json(res,200,preference);
        }
        if(req.method==='DELETE'&&url.pathname==='/api/me/data'){
          const removed=await privacyStore.erase(memberId,()=>storage.deleteMember(memberId));return json(res,200,{removed,telemetryEnabled:false});
        }
      }
      if(req.method==='GET'&&url.pathname==='/api/telemetry/status'){
        if(!authorized(req,token))return json(res,401,{error:'Invalid ingestion token'});
        const id=url.searchParams.get('memberId');if(!id||id.length>160)return json(res,400,{error:'A member identifier is required'});
        if(id!==memberId)return json(res,200,{telemetryEnabled:false});
        const preference=await privacyStore.get(id);return json(res,200,{telemetryEnabled:preference.telemetryEnabled});
      }
      if(['POST','PUT'].includes(req.method)&&['/api/events','/api/observations','/api/rules'].includes(url.pathname)&&!authorized(req,token))return json(res,401,{error:'Invalid ingestion token'});
      if(req.method==='GET'&&url.pathname==='/api/rules')return json(res,200,publicRules(await ruleStore.get()));
      if(req.method==='PUT'&&url.pathname==='/api/rules'){
        const payload=await readJson(req);if(!req.headers['if-match'])return json(res,428,{error:'If-Match rule revision is required'});
        let result;try{const existing=await ruleStore.get();result=await ruleStore.save({...payload?.config,members:existing.config.members},req.headers['if-match']);}catch(e){return json(res,e.status||400,{error:e.message});}return json(res,200,publicRules(result));
      }
      if(req.method==='POST'&&url.pathname==='/api/recognize'){
        const payload=await readJson(req),snapshot=await ruleStore.get();
        try{const rules=payload?.config?validateRules(payload.config):snapshot.config;const result=recognizeObservation(payload?.observation,rules);const {events,...preview}=result;const score=scoreMembers(sessionsFromEvents(events),rules,{days:7}).find(m=>m.activities);return json(res,200,{...preview,activityPoints:score?.points??0,rawPoints:score?.rawPoints??0,actionMethods:events.filter(e=>e.action!=='observe').map(e=>({action:e.action,method:e.actionMethod}))});}catch(e){return json(res,400,{error:e.message});}
      }
      if(req.method==='POST'&&['/api/events','/api/observations'].includes(url.pathname)){
        const payload=await readJson(req),observations=url.pathname==='/api/observations',records=observations?payload?.observations:payload?.events;
        if(!Array.isArray(records)||!records.length||records.length>(observations?100:500))return json(res,400,{error:observations?'observations must contain 1–100 records':'events must contain 1–500 events'});
        let validated;try{validated=records.map(observations?validateObservation:validateEvent);}catch(e){return json(res,400,{error:e.message});}
        const write=await privacyStore.ingest([...new Set(validated.map(e=>e.memberId))],async()=>{
          if(!observations){const accepted=await storage.append(validated);return {accepted,duplicates:validated.length-accepted};}
          const snapshot=await ruleStore.get(),results=validated.map(o=>recognizeObservation(o,snapshot.config)),events=results.flatMap(r=>r.events),accepted=await storage.append(events);
          return {accepted,duplicates:events.length-accepted,classified:results.filter(r=>r.task!=='unknown').length,unclassified:results.filter(r=>r.task==='unknown').length,revision:snapshot.revision};
        });
        return json(res,write.paused?202:200,write.paused?{accepted:0,duplicates:0,paused:records.length}:write.value);
      }
      if(req.method==='GET'&&['/api/dashboard','/api/me/dashboard'].includes(url.pathname)){
        const mine=url.pathname==='/api/me/dashboard',demo=url.searchParams.get('mode')!=='collected',snapshot=await ruleStore.get();
        let events=demo?makeDemoEvents(now()):await storage.list();
        if(mine&&demo)events=events.map(e=>e.memberId==='pm-01'?{...e,memberId}:e);
        if(mine)events=events.filter(e=>e.memberId===memberId);
        else if(!demo){const shared=await privacyStore.sharedMemberIds();events=events.filter(e=>shared.has(e.memberId));}
        let aggregate;try{aggregate=aggregateDashboard(events,{now:now(),days:Number(url.searchParams.get('days')??28),source:url.searchParams.get('source')??'all',task:url.searchParams.get('task')??'all',rules:mine?{...snapshot.config,members:{[memberId]:'You'}}:null,rulesRevision:snapshot.revision});}catch(e){return json(res,400,{error:e.message});}
        const participantCount=aggregate.summary.members,suppressed=!mine&&!demo&&participantCount<minParticipants;
        if(suppressed)aggregate=aggregateDashboard([],{now:now(),...aggregate.filters});
        return json(res,200,{mode:demo?'demo':'collected',...aggregate,privacy:{scope:mine?'personal':'team',suppressed,minParticipants:mine?null:minParticipants,synthetic:demo},...(mine?{preferences:await privacyStore.get(memberId)}:{})});
      }
      if(req.method==='GET'&&url.pathname==='/api/config')return json(res,200,{storage:await storage.info(),ingestRequiresToken:Boolean(token),rulesEditable:!token,endpoint:'/api/events',observationEndpoint:'/api/observations',recognition:'keyword-rules-v1',telemetryDefault:false,minParticipants,adapters:SOURCES_INFO});
      if(url.pathname.startsWith('/api/'))return json(res,404,{error:'API endpoint not found'});
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
      const root=url.pathname==='/',entry=root||url.pathname==='/team';
      const path=resolve(publicDir,'.'+decodeURIComponent(entry?'/index.html':url.pathname));if(!path.startsWith(publicDir+sep))return json(res,403,{error:'Access denied'});
      try{
        const body=await readFile(path);
        if(root&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))res.setHeader('Set-Cookie',`pm_signal_personal=${personalToken}; HttpOnly; SameSite=Strict; Path=/`);
        res.writeHead(200,{'Content-Type':contentTypes[extname(path)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:body);
      }catch(e){if(['ENOENT','EISDIR'].includes(e.code))return json(res,404,{error:'File not found'});throw e;}
    }catch(e){console.error(e.message);if(!res.headersSent)json(res,[400,413,415].includes(e.status)?e.status:503,{error:[400,413,415].includes(e.status)?e.message:'Service unavailable. Check storage and privacy configuration.'});else res.end();}
  });
}
const SOURCES_INFO = [
  { source: 'claude', name: 'Claude', status: 'planned' },
  { source: 'codex', name: 'Codex', status: 'planned' },
  { source: 'copilot', name: 'GitHub Copilot', status: 'planned' },
];
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.INGEST_TOKEN) throw new Error('INGEST_TOKEN is required when binding a non-local address');
  createServer().listen(Number(process.env.PORT || 4310), host, () => console.log(`PM Signal → http://${host}:${process.env.PORT || 4310}`));
}
