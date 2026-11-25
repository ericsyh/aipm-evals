import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultRules,validateRules,RuleStore } from '../lib/rules.mjs';
test('rejects unsafe point values, unsupported inference and empty matching keywords',async()=>{
  const rules=await defaultRules();assert.ok(validateRules(rules));
  for(const mutate of [c=>c.scoring.weeklyTarget=0,c=>c.scoring.inferredMultiplier=2,c=>c.scoring.workflowPoints.unknown=10,c=>c.actionRules[0].action='adopt',c=>c.workflowRules[0].keywords=[],c=>c.actionRules[2].kinds=['prompt_submitted']]){
    const draft=structuredClone(rules);mutate(draft);assert.throws(()=>validateRules(draft));
  }
});
test('persists rule changes atomically and rejects stale concurrent edits',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'pm-rules-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new RuleStore(join(dir,'rules.json')),initial=await store.get();
  const draft=structuredClone(initial.config);draft.scoring.actionPoints.compare=7;
  const results=await Promise.allSettled([store.save(draft,initial.revision),store.save(initial.config,initial.revision)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const saved=await new RuleStore(join(dir,'rules.json')).get();assert.equal(saved.config.scoring.actionPoints.compare,7);assert.notEqual(saved.revision,initial.revision);
});
