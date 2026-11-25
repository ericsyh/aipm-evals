#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { validateObservation } from '../lib/recognition.mjs';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
if(args.includes('--help')){
  console.log('Usage: node collector/capture.mjs --provider claude|codex|copilot [--member ID] [--include-content]\nRead one native hook JSON payload on stdin. Content is omitted unless explicitly enabled. No automatic installation or persistent offline queue.');process.exit(0);
}
const source=option('--provider','codex'),memberId=option('--member',process.env.PM_SIGNAL_MEMBER_ID||'pm-01');
const includeContent=args.includes('--include-content')||process.env.PM_SIGNAL_CAPTURE_CONTENT==='1';
const endpoint=process.env.PM_SIGNAL_ENDPOINT||'http://127.0.0.1:4310/api/observations';
if(['0','off','false'].includes(process.env.PM_SIGNAL_TELEMETRY)||args.includes('--telemetry-off'))process.exit(0);
try{
  // Resolve consent before reading stdin or sending any hook content. Fail closed.
  const statusUrl=new URL('/api/telemetry/status',endpoint);statusUrl.searchParams.set('memberId',memberId);
  const status=await fetch(statusUrl,{headers:process.env.INGEST_TOKEN?{Authorization:`Bearer ${process.env.INGEST_TOKEN}`}:{},signal:AbortSignal.timeout(2000)});
  if(!status.ok||!(await status.json()).telemetryEnabled)process.exit(0);
  const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>1024*1024)throw new Error('Hook input exceeds 1 MB');chunks.push(chunk);}
  const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const name=raw.hook_event_name||raw.eventName||option('--event','');
  const kind={UserPromptSubmit:'prompt_submitted',userPromptSubmitted:'prompt_submitted',PostToolUse:'tool_completed',postToolUse:'tool_completed',Stop:'task_completed',agentStop:'task_completed'}[name];
  if(!kind)process.exit(0);
  const sessionId=raw.session_id||raw.sessionId;if(!sessionId)throw new Error('Hook payload has no session identifier');
  const correlation=kind==='tool_completed'?(raw.tool_use_id||raw.toolCallId):(raw.prompt_id||raw.turn_id);
  const id=correlation?`${sessionId}:${kind}:${correlation}`:randomUUID();
  let text='';
  if(includeContent){
    const value=kind==='prompt_submitted'?raw.prompt:kind==='tool_completed'?(raw.tool_response||raw.toolResult||raw.result):(raw.last_assistant_message||raw.summary||'');
    text=(typeof value==='string'?value:JSON.stringify(value??'')).slice(0,8000);
  }
  const observation=validateObservation({id,sessionId,memberId,source,kind,text,toolName:raw.tool_name||raw.toolName||'',timestamp:raw.timestamp?new Date(raw.timestamp).toISOString():new Date().toISOString()});
  let delivered=false;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.INGEST_TOKEN?{Authorization:`Bearer ${process.env.INGEST_TOKEN}`}:{})},body:JSON.stringify({observations:[observation]}),signal:AbortSignal.timeout(3000)});
      if(res.ok){delivered=true;break;}
      if(res.status<500)break;
    }catch{}
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
  }
  if(!delivered)console.error('PM Signal: observation delivery failed; no content was logged. There is no offline queue.');
}catch{console.error('PM Signal capture: invalid hook input or configuration. No content was logged.');}
// Empty stdout and successful exit keep monitoring failures out of the agent decision path.
