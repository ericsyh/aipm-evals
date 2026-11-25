import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDashboard } from '../lib/analytics.mjs';

const now=new Date('2026-11-25T12:00:00Z');
const event=(id,action,extra={})=>({id,action,sessionId:'private-session',memberId:'private-member',source:'codex',task:'requirements',title:'private task text',evidence:'private evidence text',timestamp:'2026-11-25T10:00:00Z',origin:'collector',...extra});
test('aggregates repeated behavior events separately from activity incidence and excludes private content',()=>{
  const events=[event('1','prompt'),event('2','verify'),event('3','verify'),event('4','revise'),event('5','artifact')];
  const data=aggregateDashboard(events,{now,days:7});
  assert.equal(data.summary.total,1);assert.equal(data.summary.deepRate,100);
  const verify=data.behaviors.find(b=>b.id==='verify');
  assert.equal(verify.count,2);assert.equal(verify.sessionCount,1);assert.equal(verify.rate,100);
  assert.equal(data.workflows.find(w=>w.id==='requirements').actions.verify,2);
  for(const value of ['private-session','private-member','private task text','private evidence text'])assert.ok(!JSON.stringify(data).includes(value));
  assert.equal(data.trend.reduce((n,p)=>n+p.total,0),1);
});
test('keeps all 13 named workflows including zero and unclassified, and filters periods and platforms correctly',()=>{
  const data=aggregateDashboard([event('1','prompt',{task:'unknown'}),event('2','prompt',{sessionId:'older',source:'claude',timestamp:'2026-11-15T12:00:00Z'})],{now,days:7});
  assert.equal(data.workflows.length,13);assert.equal(data.workflows.find(w=>w.id==='unknown').total,1);
  assert.equal(data.workflows.find(w=>w.id==='experimentation').total,0);assert.equal(data.previous.total,1);
  assert.ok(!data.workflows.some(w=>w.id==='others'));assert.equal(data.summary.coreRate,0);
  assert.equal(aggregateDashboard([event('1','prompt')],{now,source:'claude'}).summary.total,0);
  assert.equal(aggregateDashboard([],{now}).summary.deepRate,0);
  assert.throws(()=>aggregateDashboard([],{now,task:'others'}));
});
