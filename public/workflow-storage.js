import { DEFAULT_TEMPLATES } from './workflow-templates.js';
import { validateTemplate,validateRun } from './workflow-engine.js';
export const TEMPLATE_KEY='pm-signal-workflow-templates';
export const RUN_KEY='pm-signal-workflow-runs';
function read(key,validator,storage){try{const data=JSON.parse(storage.getItem(key)||'[]');if(!Array.isArray(data))return [];return data.flatMap(item=>{try{return [validator(item)];}catch{return [];}});}catch{return [];}}
export function listTemplates(storage=globalThis.localStorage){const result=new Map(DEFAULT_TEMPLATES.map(t=>[t.id,validateTemplate(t)]));for(const t of read(TEMPLATE_KEY,validateTemplate,storage))result.set(t.id,t);return [...result.values()];}
export function isPersonalTemplate(id,storage=globalThis.localStorage){return read(TEMPLATE_KEY,validateTemplate,storage).some(t=>t.id===id);}
export function saveTemplate(input,storage=globalThis.localStorage){const template=validateTemplate(input),existing=listTemplates(storage).find(t=>t.id===template.id);template.version=existing?existing.version+1:1;if(template.version>999)throw new Error('Template version limit reached');const personal=read(TEMPLATE_KEY,validateTemplate,storage).filter(t=>t.id!==template.id);personal.push(template);if(personal.length>50)throw new Error('At most 50 personal templates can be saved');storage.setItem(TEMPLATE_KEY,JSON.stringify(personal));return template;}
export function resetTemplate(id,storage=globalThis.localStorage){if(!DEFAULT_TEMPLATES.some(t=>t.id===id))throw new Error('Only a preset can be reset');storage.setItem(TEMPLATE_KEY,JSON.stringify(read(TEMPLATE_KEY,validateTemplate,storage).filter(t=>t.id!==id)));}
export function listRuns(storage=globalThis.localStorage){return read(RUN_KEY,validateRun,storage).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));}
export function saveRun(run,confirmed,storage=globalThis.localStorage){if(confirmed!==true)throw new Error('Confirm local storage of the brief and step results first');const valid=validateRun(run),runs=listRuns(storage).filter(r=>r.id!==valid.id);runs.unshift(valid);storage.setItem(RUN_KEY,JSON.stringify(runs.slice(0,20)));return valid;}
export function removeRun(id,storage=globalThis.localStorage){storage.setItem(RUN_KEY,JSON.stringify(listRuns(storage).filter(r=>r.id!==id)));}
export function clearRuns(storage=globalThis.localStorage){storage.removeItem(RUN_KEY);}
