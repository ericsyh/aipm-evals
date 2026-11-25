import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../lib/rules.mjs';
import { scoreMembers } from '../lib/scoring.mjs';
import { sessionsFromEvents } from '../lib/model.mjs';
const event=(action,extra={})=>({id:action,sessionId:'s1',memberId:'pm-01',source:'codex',task:'requirements',action,timestamp:'2026-11-25T12:00:00Z',...extra});
test('behavior points count once per activity; inferred actions and workflows are discounted',async()=>{
  const config=await defaultRules();
  const records=[event('compare'),event('compare',{id:'repeated'}),event('verify')];
  const a=scoreMembers(sessionsFromEvents(records),config,{days:7}).find(m=>m.activities);
  assert.equal(a.rawPoints,18);assert.equal(a.points,18);assert.equal(a.behaviorBreakdown.find(b=>b.id==='compare').count,1);
  const inferred=scoreMembers(sessionsFromEvents(records.map(e=>({...e,taskMethod:'rules',actionMethod:'inferred'}))),config,{days:7}).find(m=>m.activities);
  assert.equal(inferred.points,9);assert.ok(!JSON.stringify(inferred).includes('memberId'));
});
test('activity caps and daily caps apply across platforms; contribution totals explain credited points',async()=>{
  const config=await defaultRules();config.scoring.perActivityCap=20;config.scoring.dailyCap=25;
  const actions=['context','compare','verify','revise','artifact','adopt'];
  const events=actions.flatMap(action=>[event(action),event(action,{id:action+'-other',source:'claude'})]);
  const m=scoreMembers(sessionsFromEvents(events),config,{days:7}).find(m=>m.activities);
  assert.equal(m.activities,2);assert.equal(m.points,25);assert.equal(m.rawPoints,64);assert.equal(m.cappedPoints,39);
  const total=[...m.workflowBreakdown,...m.behaviorBreakdown].reduce((n,b)=>n+b.creditedPoints,0);
  assert.ok(Math.abs(total-m.points)<.1);
});
test('targets scale with the reporting window; configured weights recalculate scores and roster members with no activity remain visible',async()=>{
  const config=await defaultRules();const sessions=sessionsFromEvents([event('compare')]);
  const first=scoreMembers(sessions,config,{days:7}).find(m=>m.activities);
  assert.equal(first.target,250);assert.equal(scoreMembers(sessions,config,{days:28}).find(m=>m.activities).target,1000);
  config.scoring.workflowPoints.requirements=20;
  assert.ok(scoreMembers(sessions,config,{days:7}).find(m=>m.activities).points>first.points);
  const empty=scoreMembers([],config,{days:7});assert.equal(empty.length,Object.keys(config.members).length);assert.ok(empty.every(m=>m.score===0&&m.level==='Not observed'));
});
