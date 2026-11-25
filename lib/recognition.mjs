import { createHash } from 'node:crypto';
import { validateEvent, SOURCES } from './model.mjs';
import { OBSERVATION_KINDS, revision } from './rules.mjs';

export function validateObservation(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Observation must be an object');
  const string=(key,max=160)=>{const value=input[key];if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`Invalid observation ${key}`);return value.trim();};
  const o={id:string('id'),sessionId:string('sessionId'),memberId:string('memberId'),source:string('source'),kind:string('kind'),timestamp:string('timestamp',40)};
  if(!SOURCES.includes(o.source)||!OBSERVATION_KINDS.includes(o.kind))throw new Error('Unsupported observation provider or kind');
  if(!Number.isFinite(Date.parse(o.timestamp))||Date.parse(o.timestamp)>Date.now()+300000)throw new Error('Invalid observation timestamp');
  o.timestamp=new Date(o.timestamp).toISOString();
  for(const key of ['text','toolName']){if(input[key]!=null&&(typeof input[key]!=='string'||input[key].length>(key==='text'?8000:160)))throw new Error(`Invalid observation ${key}`);o[key]=input[key]??'';}
  for(const key of ['contextProvided','artifactProduced']){if(input[key]!=null&&typeof input[key]!=='boolean')throw new Error(`Invalid observation ${key}`);o[key]=input[key]===true;}
  o.origin=input.origin==='sample'?'sample':'collector';return o;
}
function contains(text,phrase) {
  const value=phrase.toLocaleLowerCase().replace(/\s+/g,' ');let from=0;
  while(from<=text.length){const at=text.indexOf(value,from);if(at<0)return false;
    const before=text[at-1]??'',after=text[at+value.length]??'';
    if(!/^[a-z0-9]/.test(value)||(!/[a-z0-9]/.test(before)&&(!/[a-z0-9]$/.test(value)||!/[a-z0-9]/.test(after))))return true;
    from=at+1;
  }return false;
}
export function recognizeObservation(input,config) {
  const o=validateObservation(input),text=o.text.toLocaleLowerCase().replace(/\s+/g,' ');
  const candidates=config.workflowRules.filter(r=>r.enabled).map(r=>({rule:r,matches:r.keywords.filter(k=>contains(text,k))})).filter(c=>c.matches.length>=c.rule.minMatches).sort((a,b)=>b.matches.length-a.matches.length);
  const best=candidates[0],ambiguous=Boolean(best&&candidates.some(c=>c.rule.task!==best.rule.task&&c.matches.length===best.matches.length));
  const task=best&&!ambiguous?best.rule.task:'unknown';
  const methods=new Map();
  if(o.kind==='prompt_submitted')methods.set('prompt','observed');
  if(o.contextProvided)methods.set('context','declared');
  if(o.artifactProduced&&['tool_completed','task_completed'].includes(o.kind))methods.set('artifact','declared');
  if(o.kind==='adoption_confirmed')methods.set('adopt','declared');
  const matchedActions=[];
  for(const rule of config.actionRules){
    if(!rule.enabled||!rule.kinds.includes(o.kind)||rule.excludeKeywords.some(k=>contains(text,k)))continue;
    if(rule.keywords.some(k=>contains(text,k))){matchedActions.push(rule.id);if(!methods.has(rule.action))methods.set(rule.action,'inferred');}
  }
  // A classification-only record can carry a category without inventing a tool completion as a user prompt.
  if(!methods.size)methods.set('observe','observed');
  const recognitionVersion=revision(config);
  const events=[...methods].map(([action,actionMethod])=>validateEvent({
    id:createHash('sha256').update(`observation:${o.source}:${o.memberId}:${o.id}:${action}`).digest('hex'),
    sessionId:o.sessionId,memberId:o.memberId,source:o.source,timestamp:o.timestamp,task,action,
    origin:o.origin,observationId:o.id,taskMethod:'rules',actionMethod,recognitionVersion,
    title:'Automatically classified activity',evidence:'Rule-derived metadata; original observation text is not retained.',
  }));
  return {task,status:ambiguous?'ambiguous':best?'matched':'unclassified',workflowRuleId:task==='unknown'?null:best.rule.id,
    matchedActionRules:matchedActions,matchCount:best?.matches.length??0,actions:[...methods.keys()].filter(a=>a!=='observe'),recognitionVersion,events};
}
