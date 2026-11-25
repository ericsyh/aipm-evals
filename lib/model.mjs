export const SOURCES = ['claude', 'codex', 'copilot'];
export const TASKS = {
  research: 'User research', requirements: 'Requirements', competition: 'Competitive research',
  design: 'Product design', data: 'Data analysis', prioritization: 'Prioritization & roadmaps',
  experimentation: 'Experiment design', validation: 'Prototype validation', documentation: 'PRDs & specifications',
  stakeholder: 'Stakeholder alignment', review: 'Launch reviews & retrospectives',
  writing: 'Everyday writing', unknown: 'Unclassified',
};
export const TASK_DESCRIPTIONS = {
  research: 'Interview planning, feedback synthesis and user needs', requirements: 'Problem framing, scope and acceptance criteria',
  competition: 'Competitor capabilities, pricing and positioning', design: 'Interaction flows, information architecture and solutions',
  data: 'Funnels, retention, cohorts and business diagnostics', prioritization: 'Opportunity sizing, trade-offs and roadmap planning',
  experimentation: 'Hypotheses, experiment plans and success metrics', validation: 'Prototype checks, usability and edge cases',
  documentation: 'Product requirements and implementation specifications', stakeholder: 'Decision alignment and cross-team coordination',
  review: 'Launch readiness, result reviews and learning', writing: 'Email, meeting notes and routine updates',
  unknown: 'Insufficient classification evidence; explicitly tracked',
};
export const ACTION_LABELS = { context: 'Provide business context', prompt: 'Initiate a task', compare: 'Compare alternatives', verify: 'Verify findings', revise: 'Revise output', artifact: 'Record a deliverable', adopt: 'Record adoption' };
export const ACTIONS = ['context', 'prompt', 'compare', 'verify', 'revise', 'artifact', 'adopt'];
export const MEMBERS = [
  { id: 'pm-01', name: 'PM 01', role: 'Product manager', color: '#dfe7cf', initials: 'P1' },
  { id: 'pm-02', name: 'PM 02', role: 'Product manager', color: '#e4def1', initials: 'P2' },
  { id: 'pm-03', name: 'PM 03', role: 'Product manager', color: '#f2dfce', initials: 'P3' },
  { id: 'pm-04', name: 'PM 04', role: 'Product manager', color: '#d4e5ec', initials: 'P4' },
  { id: 'pm-05', name: 'PM 05', role: 'Product manager', color: '#efdde0', initials: 'P5' },
];

export function validateEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Event must be a JSON object');
  const string = (key, max = 160) => {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${key} must be a string of 1–${max} characters`);
    return value.trim();
  };
  const event = {
    id: string('id'), sessionId: string('sessionId'), memberId: string('memberId'),
    source: string('source'), action: string('action'), timestamp: string('timestamp', 40),
  };
  if (!SOURCES.includes(event.source)) throw new Error('source must be claude / codex / copilot');
  if (![...ACTIONS, 'observe'].includes(event.action)) throw new Error('Unsupported action');
  if (!Number.isFinite(Date.parse(event.timestamp))) throw new Error('timestamp must be a valid date');
  event.timestamp = new Date(event.timestamp).toISOString();
  if (Date.parse(event.timestamp) > Date.now() + 300000) throw new Error('Event timestamps must not be more than 5 minutes in the future');
  event.task = input.task ?? 'unknown';
  if (!Object.hasOwn(TASKS, event.task)) throw new Error('Unsupported task');
  event.title = typeof input.title === 'string' ? input.title.trim().slice(0, 160) : 'Untitled work session';
  event.evidence = typeof input.evidence === 'string' ? input.evidence.trim().slice(0, 500) : '';
  event.origin = input.origin === 'sample' ? 'sample' : 'collector';
  event.taskMethod=input.taskMethod==='rules'?'rules':'manual';
  event.actionMethod=['observed','inferred','declared'].includes(input.actionMethod)?input.actionMethod:'declared';
  event.observationId=typeof input.observationId==='string'?input.observationId.slice(0,160):'';
  event.recognitionVersion=typeof input.recognitionVersion==='string'?input.recognitionVersion.slice(0,80):'';
  // Intentionally allowlist fields: raw prompts, credentials and arbitrary payloads are discarded.
  return event;
}

export function sessionsFromEvents(events) {
  const groups = new Map();
  for (const event of [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const key = `${event.memberId}:${event.source}:${event.sessionId}`;
    if (!groups.has(key)) groups.set(key, { id: key, sessionId: event.sessionId, memberId: event.memberId, source: event.source, title: event.title, task: 'unknown', timestamp: event.timestamp, events: [] });
    const session = groups.get(key);
    session.events.push(event);
    session.timestamp = event.timestamp;
    if (event.task !== 'unknown') session.task = event.task;
    if (event.title !== 'Untitled work session') session.title = event.title;
  }
  return [...groups.values()].map(session => {
    const actions = new Set(session.events.map(e => e.action));
    const depth = actions.has('verify') && actions.has('revise') ? 3 : actions.has('compare') || actions.has('context') || actions.has('verify') ? 2 : 1;
    const artifact = session.events.findLast(e => e.action === 'artifact');
    const adoption = session.events.findLast(e => e.action === 'adopt');
    const status = adoption ? 'confirmed' : artifact ? 'artifact' : 'insufficient';
    return { ...session, depth, status, evidence: adoption?.evidence || artifact?.evidence || '', actions: [...actions], eventCount: session.events.length };
  }).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function makeDemoEvents(now = new Date()) {
  const titles = {
    research: ['First-week churn interview analysis', 'Merchant workspace feedback clustering', 'Interview guide and hypothesis validation'],
    requirements: ['Subscription renewal requirements', 'Permission management scope review', 'Search improvement prioritization'],
    competition: ['Collaboration tools: pricing and capabilities', 'AI search competitor experience review', 'Competitive features and opportunities'],
    design: ['Onboarding interaction validation', 'Analytics dashboard information architecture', 'Approval flow prototype and edge cases'],
    data: ['Activation funnel anomaly investigation', 'Paid conversion experiment analysis', 'Feature usage and retention comparison'],
    writing: ['Weekly update and project progress', 'Meeting notes and action items', 'Cross-team requirements email'],
    prioritization: ['Opportunity prioritization', 'Quarterly roadmap planning', 'Delivery scope trade-offs'],
    experimentation: ['Activation experiment design', 'Conversion hypothesis planning', 'Experiment metrics review'],
    validation: ['Prototype usability review', 'Navigation prototype validation', 'Interaction edge case checks'],
    documentation: ['Requirements specification draft', 'Acceptance criteria specification', 'Product requirements review'],
    stakeholder: ['Cross-team decision alignment', 'Stakeholder requirements synthesis', 'Delivery dependency coordination'],
    review: ['Launch readiness review', 'Post-launch metrics review', 'Product delivery retrospective'],
    unknown: ['Unclassified work', 'Unclassified work', 'Unclassified work'],
  };
  const taskCycle = ['requirements', 'design', 'competition', 'research', 'prioritization', 'data', 'experimentation', 'validation', 'documentation', 'stakeholder', 'review', 'writing', 'requirements', 'competition', 'unknown'];
  const result = [];
  for (let day = 0; day < 56; day++) {
    const count = day < 28 ? 4 + day * 3 % 5 + Math.floor((27 - day) / 7) : 3 + day % 3;
    for (let i = 0; i < count; i++) {
      const index = day * 20 + i;
      const member = MEMBERS[index % MEMBERS.length];
      const task = taskCycle[index % taskCycle.length];
      const level = index % 7 < 3 ? 3 : index % 7 < 6 ? 2 : 1;
      const actions = level === 3 ? ['context', 'prompt', 'compare', 'verify', 'revise', 'artifact'] : level === 2 ? ['context', 'prompt', 'compare', 'artifact'] : ['prompt'];
      if (level > 1 && index % 3 === 0) actions.push('adopt');
      const time = new Date(now);
      time.setUTCHours(1 + i * 2, 15, 0, 0);
      time.setUTCDate(time.getUTCDate() - day);
      if (time > now) time.setTime(now.getTime() - (i + 1) * 60000);
      actions.forEach((action, step) => result.push({
        id: `demo-${index}-${action}`, sessionId: `demo-${index}`, memberId: member.id,
        source: SOURCES[index % 3], action, task, title: titles[task][index % 3],
        timestamp: new Date(time.getTime() - (actions.length - step) * 60000).toISOString(), origin: 'sample',
        evidence: action === 'artifact' ? 'Demo artifact: comparison, research findings or a design proposal recorded.' : action === 'adopt' ? 'Demo declaration: the project lead adopted the proposal. Business impact is not verified.' : action === 'verify' ? 'Demo behavior: check original sources and verify key findings.' : action === 'revise' ? 'Demo behavior: revise the proposal after checking findings.' : action === 'context' ? 'Demo behavior: provide business context and source materials.' : action === 'compare' ? 'Demo behavior: compare alternatives and trade-offs.' : '',
      }));
    }
  }
  return result;
}

export function summarize(sessions) {
  const total = sessions.length;
  const core = sessions.filter(s => s.task !== 'writing' && s.task !== 'unknown').length;
  const deep = sessions.filter(s => s.depth === 3).length;
  const confirmed = sessions.filter(s => s.status === 'confirmed').length;
  const artifacts = sessions.filter(s => s.actions.includes('artifact')).length;
  const coverage = new Set(sessions.map(s => s.task).filter(t => t !== 'writing' && t !== 'unknown')).size;
  return { total, core, deep, confirmed, artifacts, coverage, members: new Set(sessions.map(s => s.memberId)).size,
    coreRate: total ? Math.round(core / total * 100) : 0, deepRate: total ? Math.round(deep / total * 100) : 0 };
}
