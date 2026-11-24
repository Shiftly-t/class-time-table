// Approved counting method, shared by ranking and profile UI.
export const RANKING_SLOT_LABEL = '担当授業コマ数（延べ）';
export const RANKING_SLOT_EXPLANATION = "集計方法：担当した生徒の人数分をカウントします（1コマで2人担当した場合は2コマ分として集計）。";

export function aggregateRanking({facts,teachers,from,to,cutoff}){
  // Each fact is one verified student-lesson slot. The caller must establish historical accuracy.
  const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  if(!iso(from)||!iso(to)||from>to||typeof cutoff!=='string'||!Number.isFinite(Date.parse(cutoff)))throw Error('Invalid aggregation window');
  const limit=Date.parse(cutoff);
  const roster=new Map(teachers.filter(t=>['admin','employee'].includes(t.role)).map(t=>[t.uid,t]));
  const seen=new Map(),totals=new Map();
  for(const f of facts){
    if(f.status!=='done'||!roster.has(f.teacherUid)||!iso(f.date)||f.date<from||f.date>to)continue;
    if(typeof f.slotId!=='string'||!f.slotId||!f.studentId||!['regular','seasonal'].includes(f.kind)||typeof f.endedAt!=='string'||!Number.isFinite(Date.parse(f.endedAt)))throw Error('Invalid verified fact');
    if(Date.parse(f.endedAt)>limit)continue;
    const signature=JSON.stringify([f.teacherUid,f.studentId,f.date,f.kind,f.endedAt]);
    if(seen.has(f.slotId)){if(seen.get(f.slotId)!==signature)throw Error('Conflicting slot identity');continue;}
    seen.set(f.slotId,signature);
    if(!totals.has(f.teacherUid))totals.set(f.teacherUid,{teacherUid:f.teacherUid,slots:0,regular:0,seasonal:0,days:new Set(),students:new Set()});
    const t=totals.get(f.teacherUid);t.slots++;t[f.kind]++;t.days.add(f.date);t.students.add(f.studentId);
  }
  return [...totals.values()].map(t=>({...t,days:t.days.size,students:t.students.size}));
}

export function rankTeachers(totals,metric='slots'){
  if(!['slots','regular','seasonal','days','students'].includes(metric))throw Error('Unknown ranking metric');
  const rows=totals.filter(t=>t[metric]>0).sort((a,b)=>b[metric]-a[metric]||(a.teacherUid<b.teacherUid?-1:a.teacherUid>b.teacherUid?1:0));
  let rank=0,previous=null;
  return rows.map((t,i)=>{if(t[metric]!==previous){rank=i+1;previous=t[metric];}return {...t,rank};});
}

export function eligibleMilestones(total,thresholds,alreadyGranted=[]){
  if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid total');
  const seen=new Set(alreadyGranted),out=[];
  for(const rule of thresholds){if(!rule.id||!Number.isSafeInteger(rule.slots)||rule.slots<=0)throw Error('Invalid milestone');if(total>=rule.slots&&!seen.has(rule.id)){out.push(rule.id);seen.add(rule.id);}}
  return out;
}
