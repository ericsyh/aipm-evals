import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, sessionsFromEvents, summarize, makeDemoEvents } from '../lib/model.mjs';
const event = (action, extra = {}) => validateEvent({ id: action, sessionId: 'session', memberId: 'pm', source: 'codex', timestamp: '2026-01-01T12:00:00Z', task: 'requirements', action, ...extra });

test('captures only allowlisted metadata and rejects invalid event types', () => {
  const result = event('prompt', { rawPrompt: 'private', apiKey: 'secret' });
  assert.equal(result.rawPrompt, undefined); assert.equal(result.apiKey, undefined);
  assert.throws(() => event('invalid')); assert.throws(() => event('prompt', { source: 'other' }));
  assert.throws(() => event('prompt', { timestamp: 'not-a-date' }));
  assert.throws(() => event('prompt', { task: '__proto__' }));
  assert.throws(() => event('prompt', { timestamp: '2099-01-01T00:00:00Z' }));
});
test('depth requires both verification and revision; missing outcomes are insufficient evidence', () => {
  const shallow = sessionsFromEvents([event('prompt')])[0];
  assert.equal(shallow.depth, 1); assert.equal(shallow.status, 'insufficient');
  const explored = sessionsFromEvents([event('prompt'), event('verify')])[0];
  assert.equal(explored.depth, 2);
  const deep = sessionsFromEvents([event('verify'), event('revise'), event('artifact', { evidence: 'deliverable' })])[0];
  assert.equal(deep.depth, 3); assert.equal(deep.status, 'artifact'); assert.equal(deep.evidence, 'deliverable');
});
test('adoption does not fabricate an artifact event or business impact', () => {
  const sessions = sessionsFromEvents([event('adopt', { evidence: 'declared adoption' })]);
  assert.equal(sessions[0].status, 'confirmed');
  assert.equal(summarize(sessions).confirmed, 1); assert.equal(summarize(sessions).artifacts, 0);
});
test('separates matching session IDs across platforms and members; safely handles unknown tasks', () => {
  const sessions = sessionsFromEvents([event('prompt'), event('prompt', { id: '2', source: 'claude' }), event('prompt', { id: '3', memberId: 'other', task: 'unknown' })]);
  assert.equal(sessions.length, 3); assert.equal(summarize(sessions).core, 2);
  assert.equal(summarize([]).deepRate, 0);
});
test('demo events are uniquely identified, explicitly marked and never in the future', () => {
  const now = new Date('2026-11-25T02:00:00Z'), events = makeDemoEvents(now);
  assert.equal(new Set(events.map(e=>e.id)).size, events.length);
  assert.ok(events.every(e=>e.origin==='sample' && new Date(e.timestamp)<=now));
  assert.ok(sessionsFromEvents(events).length>200);
});
