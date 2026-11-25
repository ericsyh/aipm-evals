import { sessionsFromEvents, summarize, SOURCES, TASKS, TASK_DESCRIPTIONS, ACTIONS, ACTION_LABELS } from './model.mjs';
import { scoreMembers } from './scoring.mjs';

const DAY = 86400000;
export function aggregateDashboard(events, { now = new Date(), days = 28, source = 'all', task = 'all', rules = null, rulesRevision = '' } = {}) {
  if (![7, 14, 28].includes(days)) throw new Error('days must be 7, 14 or 28');
  if (source !== 'all' && !SOURCES.includes(source)) throw new Error('Unsupported source filter');
  if (task !== 'all' && !Object.hasOwn(TASKS, task)) throw new Error('Unsupported workflow filter');
  const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - days * DAY + 1);
  const all = sessionsFromEvents(events).filter(s => (source === 'all' || s.source === source) && (task === 'all' || s.task === task));
  const inPeriod = (a, b) => all.filter(s => Date.parse(s.timestamp) >= a && Date.parse(s.timestamp) <= b);
  const current = inPeriod(start.getTime(), end.getTime());
  const previous = inPeriod(start.getTime() - days * DAY, start.getTime() - 1);
  const summary = summarize(current);
  const memberScores=rules?scoreMembers(current,rules,{days}):[];
  const previousScores=rules?scoreMembers(previous,rules,{days}):[];
  const adoption=rules?{
    revision:rulesRevision,target:rules.scoring.weeklyTarget*days/7,scoring:rules.scoring,
    averageScore:memberScores.some(m=>m.activities)?Math.round(memberScores.filter(m=>m.activities).reduce((n,m)=>n+m.score,0)/memberScores.filter(m=>m.activities).length):0,
    members:memberScores.map(m=>({...m,previousScore:previousScores.find(p=>p.key===m.key)?.score??0})),
  }:null;
  const countActions = sessions => Object.fromEntries(ACTIONS.map(action => [action, sessions.reduce((n, s) => n + s.events.filter(e => e.action === action).length, 0)]));
  return {
    generatedAt: now.toISOString(), taxonomyVersion: 'pm-workflows-v1', filters: { days, source, task }, adoption,
    period: { start: start.toISOString(), end: end.toISOString(), timezone: 'UTC' },
    summary, previous: summarize(previous),
    catalog: { workflows: TASKS, actions: ACTION_LABELS },
    workflows: Object.entries(TASKS).map(([id, label]) => {
      const sessions = current.filter(s => s.task === id), stats = summarize(sessions);
      return { id, label, description: TASK_DESCRIPTIONS[id], core: !['writing', 'unknown'].includes(id), total: stats.total,
        share: summary.total ? Math.round(stats.total / summary.total * 100) : 0,
        deep: stats.deep, deepRate: stats.deepRate, artifacts: stats.artifacts, confirmed: stats.confirmed, actions: countActions(sessions) };
    }),
    behaviors: ACTIONS.map(id => {
      const sessionCount = current.filter(s => s.actions.includes(id)).length;
      return { id, label: ACTION_LABELS[id], count: current.reduce((n, s) => n + s.events.filter(e => e.action === id).length, 0),
        sessionCount, rate: summary.total ? Math.round(sessionCount / summary.total * 100) : 0 };
    }),
    trend: Array.from({ length: 7 }, (_, i) => {
      const a = start.getTime() + i * days / 7 * DAY, b = a + days / 7 * DAY - 1;
      const stats = summarize(inPeriod(a, b));
      return { date: new Date(a).toISOString(), total: stats.total, deep: stats.deep, deepRate: stats.deepRate };
    }),
    platforms: SOURCES.map(id => ({ id, ...summarize(current.filter(s => s.source === id)) })),
    depth: [1, 2, 3].map(level => ({ level, count: current.filter(s => s.depth === level).length })),
    outcomes: { artifacts: summary.artifacts, adoption: summary.confirmed, insufficient: current.filter(s => s.status === 'insufficient').length },
    provenance: { sampleSessions: current.filter(s => s.events.some(e => e.origin === 'sample')).length,
      automaticallyClassified:current.filter(s=>s.events.some(e=>e.taskMethod==='rules')).length,
      unclassified:current.filter(s=>s.task==='unknown').length },
  };
}
