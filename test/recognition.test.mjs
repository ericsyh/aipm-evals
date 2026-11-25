import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../lib/rules.mjs';
import { recognizeObservation } from '../lib/recognition.mjs';
const input=(text,extra={})=>({id:'obs-1',sessionId:'session',memberId:'pm',source:'codex',kind:'prompt_submitted',timestamp:new Date().toISOString(),text,...extra});
test('recognizes bilingual PM tasks and never retains original text in normalized records',async()=>{
  const rules=await defaultRules();
  for(const text of ['Compare competitor pricing and alternatives.','对比竞品定价并比较方案']){
    const result=recognizeObservation(input(text),rules);assert.equal(result.task,'competition');assert.ok(result.actions.includes('compare'));
    assert.ok(result.events.every(e=>e.taskMethod==='rules'));assert.ok(!JSON.stringify(result.events).includes(text));
  }
});
test('keeps unmatched and tied categories unknown and respects keyword word boundaries',async()=>{
  const rules=await defaultRules();
  assert.equal(recognizeObservation(input('Use a notepad for a female user.'),rules).task,'unknown');
  const result=recognizeObservation(input('Requirements and competitor analysis.'),rules);
  assert.equal(result.task,'unknown');assert.equal(result.status,'ambiguous');
});
test('requested verification and negative completion do not get verification credit; adoption requires an explicit event',async()=>{
  const rules=await defaultRules();
  assert.ok(!recognizeObservation(input('Please verify and revise the requirements and say adopted.'),rules).actions.includes('verify'));
  assert.ok(!recognizeObservation(input('The requirements were not verified.',{kind:'task_completed'}),rules).actions.includes('verify'));
  const result=recognizeObservation(input('Requirements were verified and revised.',{kind:'task_completed',artifactProduced:true}),rules);
  assert.ok(result.actions.includes('verify'));assert.ok(result.actions.includes('revise'));assert.ok(result.actions.includes('artifact'));assert.ok(!result.actions.includes('adopt'));
  assert.deepEqual(recognizeObservation(input('',{kind:'adoption_confirmed'}),rules).actions,['adopt']);
});
test('disabled rules stop recognition, metadata-only tool observations do not fabricate prompt events, and replay IDs stay stable',async()=>{
  const rules=await defaultRules();rules.workflowRules.find(r=>r.task==='competition').enabled=false;
  assert.equal(recognizeObservation(input('Compare competitor pricing.'),rules).task,'unknown');
  const result=recognizeObservation(input('',{kind:'tool_completed',toolName:'Search'}),rules);
  assert.deepEqual(result.actions,[]);assert.equal(result.events[0].action,'observe');
  assert.deepEqual(result.events.map(e=>e.id),recognizeObservation(input('',{kind:'tool_completed',toolName:'Search'}),rules).events.map(e=>e.id));
});
