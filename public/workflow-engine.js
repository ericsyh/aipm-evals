export const WORKFLOW_TASKS=['research','requirements','competition','design','data','prioritization','experimentation','validation','documentation','stakeholder','review','writing'];
const text=(value,name,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${name} must contain 1–${max} characters`);return value.trim();};
const list=(value,name,max=20)=>{if(!Array.isArray(value)||!value.length||value.length>max)throw new Error(`${name} must contain 1–${max} items`);return value.map((v,i)=>text(v,`${name} ${i+1}`,500));};
export function validateTemplate(input){
  if(!input||typeof input!=='object')throw new Error('A workflow template object is required');
  const id=text(input.id,'Template ID',80);if(!/^[a-z][a-z0-9_-]*$/.test(id))throw new Error('Template ID must be a lowercase identifier');
  if(!WORKFLOW_TASKS.includes(input.task))throw new Error('Choose a supported PM workflow category');
  if(!Array.isArray(input.steps)||!input.steps.length||input.steps.length>12)throw new Error('A workflow needs 1–12 ordered steps');
  const seen=new Set();
  const steps=input.steps.map((step,index)=>{
    if(!step||typeof step!=='object'||(step.requiredOutput!==undefined&&typeof step.requiredOutput!=='boolean'))throw new Error('Invalid step configuration');
    const stepId=text(step.id,'Step ID',80);if(!/^[a-z][a-z0-9_-]*$/.test(stepId)||seen.has(stepId))throw new Error('Step IDs must be unique lowercase identifiers');seen.add(stepId);
    return {id:stepId,title:text(step.title,`Step ${index+1} title`,100),instructions:text(step.instructions,`Step ${index+1} instructions`,6000),output:text(step.output,`Step ${index+1} output`,1500),checks:list(step.checks,`Step ${index+1} checks`,12),requiredOutput:step.requiredOutput!==false};
  });
  return {id,task:input.task,title:text(input.title,'Template title',100),description:text(input.description,'Template description',1000),tag:typeof input.tag==='string'?input.tag.slice(0,40):'PERSONAL',icon:typeof input.icon==='string'?input.icon.slice(0,40):'book',version:Number.isInteger(input.version)&&input.version>0&&input.version<=999?input.version:1,inputs:list(input.inputs,'Input requirements'),output:text(input.output,'Final deliverable',1500),steps};
}
export function createRun(template,{brief='',agent='Claude Code',id='local-run',now=new Date().toISOString()}={}){
  const snapshot=validateTemplate(template);if(typeof brief!=='string'||brief.length>12000)throw new Error('Brief must be at most 12,000 characters');
  return {id,template:structuredClone(snapshot),brief,agent:String(agent).slice(0,80),status:'running',currentStep:0,startedAt:now,updatedAt:now,steps:snapshot.steps.map(step=>({id:step.id,status:'pending',output:'',checked:step.checks.map(()=>false)}))};
}
export function updateCurrentStep(run,{output,checked}){
  if(run.status!=='running')throw new Error('Reopen a step before changing a completed run');
  if(typeof output!=='string'||output.length>20000)throw new Error('Step result must be at most 20,000 characters');
  const step=run.template.steps[run.currentStep];if(!Array.isArray(checked)||checked.length!==step.checks.length||checked.some(v=>typeof v!=='boolean'))throw new Error('Invalid review checklist');
  const next=structuredClone(run);next.steps[next.currentStep].output=output;next.steps[next.currentStep].checked=[...checked];next.updatedAt=new Date().toISOString();return next;
}
export function canCompleteStep(run){if(run.status!=='running')return false;const definition=run.template.steps[run.currentStep],result=run.steps[run.currentStep];return (!definition.requiredOutput||Boolean(result.output.trim()))&&result.checked.every(Boolean);}
export function completeStep(run){
  if(!canCompleteStep(run))throw new Error('Provide the step result and confirm every review check before continuing');
  const next=structuredClone(run);next.steps[next.currentStep].status='completed';next.updatedAt=new Date().toISOString();
  if(next.currentStep===next.steps.length-1)next.status='completed';else next.currentStep++;
  return next;
}
export function reopenStep(run,index){
  if(!Number.isInteger(index)||index<0||index>run.currentStep)throw new Error('Only the current or an earlier step can be reopened');
  const next=structuredClone(run);next.status='running';next.currentStep=index;next.updatedAt=new Date().toISOString();
  next.steps=next.steps.map((step,i)=>i<index?step:{...step,status:'pending',output:i===index?step.output:'',checked:next.template.steps[i].checks.map(()=>false)});return next;
}
export function validateRun(input){
  if(!input||typeof input!=='object'||!['running','completed'].includes(input.status))throw new Error('Invalid saved workflow run');
  const run=createRun(input.template,{id:text(input.id,'Run ID',100),brief:input.brief,agent:input.agent,now:input.startedAt});
  if(!Number.isFinite(Date.parse(input.startedAt))||!Number.isFinite(Date.parse(input.updatedAt))||!Number.isInteger(input.currentStep)||input.currentStep<0||input.currentStep>=run.steps.length||!Array.isArray(input.steps)||input.steps.length!==run.steps.length)throw new Error('Invalid saved progress');
  run.status=input.status;run.currentStep=input.currentStep;run.updatedAt=input.updatedAt;
  run.steps=input.steps.map((step,i)=>{
    if(step.id!==run.template.steps[i].id||typeof step.output!=='string'||step.output.length>20000||!Array.isArray(step.checked)||step.checked.length!==run.template.steps[i].checks.length||step.checked.some(v=>typeof v!=='boolean'))throw new Error('Invalid saved step data');
    const completed=i<input.currentStep||input.status==='completed';
    if(completed&&(step.status!=='completed'||!step.checked.every(Boolean)||(run.template.steps[i].requiredOutput&&!step.output.trim())))throw new Error('Saved completed steps must retain their review evidence');
    if(!completed&&step.status!=='pending')throw new Error('Invalid pending step');
    if(input.status==='completed'&&input.currentStep!==run.steps.length-1)throw new Error('Invalid completion position');
    return {id:step.id,status:step.status,output:step.output,checked:[...step.checked]};
  });return run;
}
export function buildStepPrompt(run){
  const step=run.template.steps[run.currentStep];const earlier=run.steps.slice(0,run.currentStep).map((result,i)=>`Step ${i+1}: ${run.template.steps[i].title}\n${result.output}`).join('\n\n');
  const variables={brief:run.brief||'[Ask me for the missing business context]',previous_output:run.currentStep?run.steps[run.currentStep-1].output:'[No previous step]',previous_outputs:earlier||'[No previous steps]'};
  const instructions=step.instructions.replace(/\{\{(brief|previous_output|previous_outputs)\}\}/g,(_,key)=>variables[key]);
  return `Act as a careful product partner.\nWorkflow: ${run.template.title} (v${run.template.version})\nStep ${run.currentStep+1}/${run.template.steps.length}: ${step.title}\nTarget agent: ${run.agent}\n\nBusiness brief:\n${variables.brief}\n\nInput requirements:\n${run.template.inputs.map(v=>'- '+v).join('\n')}\n\nPrevious reviewed outputs:\n${variables.previous_outputs}\n\nInstructions:\n${instructions}\n\nExpected step output:\n${step.output}\n\nReview checks:\n${step.checks.map(v=>'- '+v).join('\n')}\n\nDo not invent evidence or sources. Mark uncertainty and ask for missing input. Complete only this step; wait for my review before proceeding.`;
}
export function templateMarkdown(template){const t=validateTemplate(template);return `# ${t.title}\n\n${t.description}\n\nCategory: ${t.task}\nVersion: ${t.version}\n\n## Input requirements\n\n${t.inputs.map(v=>'- '+v).join('\n')}\n\n## Final deliverable\n\n${t.output}\n\n## Ordered workflow\n\n${t.steps.map((s,i)=>`### ${i+1}. ${s.title}\n\n${s.instructions}\n\nExpected output: ${s.output}\n\nReview before proceeding:\n\n${s.checks.map(v=>'- '+v).join('\n')}`).join('\n\n')}\n\nPause after each step for a human review. Never invent sources or treat checklist confirmation as independent validation.\n`;
}
