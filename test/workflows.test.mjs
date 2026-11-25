import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATES } from '../public/workflow-templates.js';
import { validateTemplate,createRun,updateCurrentStep,canCompleteStep,completeStep,reopenStep,validateRun,buildStepPrompt,templateMarkdown } from '../public/workflow-engine.js';
import { listTemplates,saveTemplate,resetTemplate,listRuns,saveRun,removeRun,clearRuns,TEMPLATE_KEY,RUN_KEY } from '../public/workflow-storage.js';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
const reviewed=run=>updateCurrentStep(run,{output:'Evidence-backed result '+run.currentStep,checked:run.steps[run.currentStep].checked.map(()=>true)});

test('all six presets have validated ordered reviewable steps',()=>{
  assert.equal(DEFAULT_TEMPLATES.length,6);
  for(const t of DEFAULT_TEMPLATES){assert.ok(validateTemplate(t).steps.length>=4);assert.ok(t.steps.every(s=>s.checks.length>0));}
});
test('edits and reordered steps persist locally without changing a preset or active run',()=>{
  const db=storage(),original=structuredClone(DEFAULT_TEMPLATES[0]),run=createRun(original);
  const edit=structuredClone(original);edit.steps.reverse();edit.title='My comparison';
  const saved=saveTemplate(edit,db);assert.equal(saved.version,2);
  assert.equal(listTemplates(db)[0].steps[0].id,edit.steps[0].id);
  assert.deepEqual(DEFAULT_TEMPLATES[0],original);assert.deepEqual(run.template,original);
  resetTemplate(original.id,db);assert.deepEqual(listTemplates(db)[0],original);
});
test('step gate requires both output and review; only reviewed outputs pass to next step',()=>{
  let run=createRun(DEFAULT_TEMPLATES[0],{brief:'PRIVATE context'});
  assert.equal(canCompleteStep(run),false);assert.throws(()=>completeStep(run),/review/);
  run=updateCurrentStep(run,{output:'PRIVATE result',checked:run.steps[0].checked});assert.equal(canCompleteStep(run),false);
  run=updateCurrentStep(run,{output:'',checked:run.steps[0].checked.map(()=>true)});assert.equal(canCompleteStep(run),false);
  run=completeStep(reviewed(run));assert.equal(run.currentStep,1);
  assert.match(buildStepPrompt(run),/Evidence-backed result 0/);assert.match(buildStepPrompt(run),/PRIVATE context/);
  while(run.status==='running')run=completeStep(reviewed(run));
  assert.equal(run.currentStep,run.steps.length-1);assert.deepEqual(validateRun(run),run);
});
test('reopening a step invalidates later results and all downstream confirmations',()=>{
  let run=createRun(DEFAULT_TEMPLATES[0]);run=completeStep(reviewed(run));run=completeStep(reviewed(run));
  const reopened=reopenStep(run,0);assert.equal(reopened.steps[0].output,'Evidence-backed result 0');
  assert.equal(reopened.steps[1].output,'');assert.ok(reopened.steps.every(s=>s.status==='pending'&&s.checked.every(v=>!v)));
  assert.throws(()=>reopenStep(reopened,1),/earlier/);
});
test('full run persistence requires explicit consent and stores independent snapshots',()=>{
  const db=storage();let run=createRun(DEFAULT_TEMPLATES[0],{brief:'PRIVATE brief',id:'my-run'});
  assert.throws(()=>saveRun(run,false,db),/Confirm/);assert.equal(db.getItem(RUN_KEY),null);
  saveRun(run,true,db);run=completeStep(reviewed(run));assert.equal(listRuns(db)[0].currentStep,0);
  saveRun(run,true,db);assert.equal(listRuns(db).length,1);assert.equal(listRuns(db)[0].currentStep,1);
  removeRun(run.id,db);assert.equal(listRuns(db).length,0);saveRun(run,true,db);clearRuns(db);assert.equal(db.getItem(RUN_KEY),null);
});
test('malformed imports and saved progress are rejected; broken storage falls back to presets',()=>{
  const db=storage(),bad=structuredClone(DEFAULT_TEMPLATES[0]);bad.steps[1].id=bad.steps[0].id;
  assert.throws(()=>saveTemplate(bad,db),/unique/);
  bad.id='invalid\"id';assert.throws(()=>validateTemplate(bad),/identifier/);
  const run=createRun(DEFAULT_TEMPLATES[0]);run.currentStep=1;assert.throws(()=>validateRun(run),/review evidence/);
  run.currentStep=0;run.updatedAt='invalid';assert.throws(()=>validateRun(run),/progress/);
  db.setItem(TEMPLATE_KEY,'broken');db.setItem(RUN_KEY,JSON.stringify([run]));assert.equal(listTemplates(db).length,6);assert.equal(listRuns(db).length,0);
});
test('placeholders substitute context as literal text and exports contain templates only',()=>{
  const t=structuredClone(DEFAULT_TEMPLATES[0]);t.steps[1].instructions='Use {{brief}} and {{previous_output}} and {{previous_outputs}}';
  let run=createRun(t,{brief:'PRIVATE $(command) context'});run=completeStep(reviewed(run));
  assert.match(buildStepPrompt(run),/PRIVATE \$\(command\) context/);assert.ok(!buildStepPrompt(run).includes('{{previous_output}}'));
  assert.ok(!templateMarkdown(t).includes('PRIVATE'));assert.match(templateMarkdown(t),/Pause after each step/);
});
