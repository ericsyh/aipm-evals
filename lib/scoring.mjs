import { createHash } from 'node:crypto';
import { TASKS, ACTIONS } from './model.mjs';

const round=n=>Math.round(n*100)/100;
export function scoreMembers(sessions,config,{days=28}={}) {
  const s=config.scoring,target=s.weeklyTarget*days/7;
  const ids=new Set([...Object.keys(config.members),...sessions.map(x=>x.memberId)]);
  return [...ids].map(memberId=>{
    const activities=sessions.filter(x=>x.memberId===memberId),byDay=new Map();
    const workflowBreakdown=Object.keys(TASKS).map(id=>({id,count:0,rawPoints:0,creditedPoints:0}));
    const behaviorBreakdown=ACTIONS.map(id=>({id,count:0,rawPoints:0,creditedPoints:0}));
    for(const activity of activities){
      const taskEvent=activity.events.findLast(e=>e.task!=='unknown');
      const workflowWeight=taskEvent?.taskMethod==='rules'?s.inferredMultiplier:1;
      const components=[{kind:'workflow',id:activity.task,points:s.workflowPoints[activity.task]*workflowWeight}];
      for(const action of ACTIONS){
        const records=activity.events.filter(e=>e.action===action);if(!records.length)continue;
        const weight=Math.max(...records.map(e=>e.actionMethod==='inferred'?s.inferredMultiplier:1));
        components.push({kind:'behavior',id:action,points:s.actionPoints[action]*weight});
      }
      const raw=components.reduce((n,c)=>n+c.points,0),scale=raw?Math.min(1,s.perActivityCap/raw):1;
      const day=activity.timestamp.slice(0,10);if(!byDay.has(day))byDay.set(day,[]);
      byDay.get(day).push({components,scale,raw,limited:Math.min(raw,s.perActivityCap)});
    }
    let rawPoints=0,activityLimitedPoints=0,points=0;
    for(const records of byDay.values()){
      const total=records.reduce((n,r)=>n+r.limited,0),dayScale=total?Math.min(1,s.dailyCap/total):1;
      for(const record of records){rawPoints+=record.raw;activityLimitedPoints+=record.limited;points+=record.limited*dayScale;
        for(const c of record.components){const b=(c.kind==='workflow'?workflowBreakdown:behaviorBreakdown).find(x=>x.id===c.id);b.count++;b.rawPoints+=c.points;b.creditedPoints+=c.points*record.scale*dayScale;}
      }
    }
    for(const b of [...workflowBreakdown,...behaviorBreakdown]){b.rawPoints=round(b.rawPoints);b.creditedPoints=round(b.creditedPoints);}
    const score=Math.min(100,Math.round(points/target*100));
    return {key:createHash('sha256').update(memberId).digest('hex').slice(0,12),label:Object.hasOwn(config.members,memberId)?config.members[memberId]:`PM ${createHash('sha256').update(memberId).digest('hex').slice(0,6)}`,
      score,points:round(points),rawPoints:round(rawPoints),cappedPoints:round(rawPoints-points),target:round(target),activities:activities.length,activeDays:byDay.size,
      coverage:new Set(activities.map(a=>a.task).filter(t=>!['unknown','writing'].includes(t))).size,
      inferredActivities:activities.filter(a=>a.events.some(e=>e.taskMethod==='rules'||e.actionMethod==='inferred')).length,
      level:!activities.length?'Not observed':score<25?'Exploring':score<50?'Developing':score<75?'Consistent':'Established',workflowBreakdown,behaviorBreakdown};
  }).sort((a,b)=>a.label.localeCompare(b.label));
}
