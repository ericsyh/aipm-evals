import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { TASKS, ACTIONS } from './model.mjs';

export const OBSERVATION_KINDS = ['prompt_submitted', 'tool_completed', 'task_completed', 'adoption_confirmed'];
const fail = message => { throw new Error(message); };
const number = (value, min, max, name) => { if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${name} must be between ${min} and ${max}`);return value; };
const words = (value,name,allowEmpty=false) => {
  if(!Array.isArray(value)||value.length>50||(!allowEmpty&&!value.length))fail(`${name} must be an array of 1–50 keywords`);
  return [...new Set(value.map(v=>{if(typeof v!=='string'||!v.trim()||v.length>120)fail(`${name}: invalid keyword`);return v.trim();}))];
};
export function validateRules(input) {
  if(!input||input.version!==1)fail('Rules version must be 1');
  if(!Array.isArray(input.workflowRules)||input.workflowRules.length>40)fail('Invalid workflowRules');
  if(!Array.isArray(input.actionRules)||input.actionRules.length>30)fail('Invalid actionRules');
  const seen=new Set();
  const base=(rule)=>{
    if(!rule||typeof rule.id!=='string'||!/^[a-z0-9_-]{1,60}$/.test(rule.id)||seen.has(rule.id))fail('Rule IDs must be unique, lowercase identifiers');
    seen.add(rule.id);if(typeof rule.enabled!=='boolean')fail('Rule enabled must be boolean');
    return {id:rule.id,enabled:rule.enabled,keywords:words(rule.keywords,rule.id)};
  };
  const workflowRules=input.workflowRules.map(r=>{
    const b=base(r);if(!Object.hasOwn(TASKS,r.task)||r.task==='unknown')fail('Unsupported workflow rule category');
    const minMatches=number(r.minMatches,1,50,'minMatches');if(!Number.isInteger(minMatches)||minMatches>b.keywords.length)fail('minMatches must be a valid integer');
    return {...b,task:r.task,minMatches};
  });
  seen.clear();
  const actionRules=input.actionRules.map(r=>{
    const b=base(r);if(!['context','compare','verify','revise'].includes(r.action))fail('Only context, compare, verify and revise can be inferred by keyword rules');
    if(!Array.isArray(r.kinds)||!r.kinds.length||r.kinds.some(k=>!['prompt_submitted','tool_completed','task_completed'].includes(k)))fail('Invalid action rule kinds');
    if(['verify','revise'].includes(r.action)&&r.kinds.includes('prompt_submitted'))fail('Verification and revision cannot be inferred from requested prompts');
    return {...b,action:r.action,kinds:[...new Set(r.kinds)],excludeKeywords:words(r.excludeKeywords??[],r.id,true)};
  });
  const s=input.scoring;if(!s||typeof s!=='object')fail('Scoring configuration is required');
  const points=(values,keys,name)=>Object.fromEntries(keys.map(k=>[k,number(values?.[k],0,50,`${name}.${k}`)]));
  const scoring={workflowPoints:points(s.workflowPoints,Object.keys(TASKS),'workflowPoints'),actionPoints:points(s.actionPoints,ACTIONS,'actionPoints'),
    perActivityCap:number(s.perActivityCap,1,200,'perActivityCap'),dailyCap:number(s.dailyCap,1,1000,'dailyCap'),weeklyTarget:number(s.weeklyTarget,1,10000,'weeklyTarget'),inferredMultiplier:number(s.inferredMultiplier,0,1,'inferredMultiplier')};
  if(scoring.workflowPoints.unknown!==0)fail('Unclassified workflow points must remain zero');
  if(!input.members||typeof input.members!=='object'||Array.isArray(input.members)||Object.keys(input.members).length>200)fail('Invalid member directory');
  const members=Object.fromEntries(Object.entries(input.members).map(([id,label])=>{
    if(!id.trim()||id.length>160||typeof label!=='string'||!label.trim()||label.length>80)fail('Invalid member label');
    return [id,label.trim()];
  }));
  return {version:1,workflowRules,actionRules,scoring,members};
}
export const revision = config => createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0,16);
export async function defaultRules() { return validateRules(JSON.parse(await readFile(new URL('../config/default-rules.json',import.meta.url),'utf8'))); }
export class RuleStore {
  constructor(file=process.env.RULES_FILE||resolve(process.env.DATA_DIR||'./data','rules.json')) {this.file=file;this.queue=Promise.resolve();}
  async get() {
    let config;
    try {config=validateRules(JSON.parse(await readFile(this.file,'utf8')));}
    catch(error){if(error.code!=='ENOENT')throw error;config=await defaultRules();}
    return {config,revision:revision(config)};
  }
  async save(input,expectedRevision) {
    const config=validateRules(input);
    const operation=this.queue.then(async()=>{
      const current=await this.get();if(expectedRevision!==current.revision){const error=new Error('Rules changed. Reload before saving.');error.status=409;throw error;}
      await mkdir(dirname(this.file),{recursive:true});const temporary=`${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary,JSON.stringify(config,null,2)+'\n',{mode:0o600});await rename(temporary,this.file);
      return {config,revision:revision(config)};
    });
    this.queue=operation.catch(()=>{});return operation;
  }
}
