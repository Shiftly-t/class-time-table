import {aggregateRanking,rankTeachers} from './ranking-core.mjs';
import {rankingWindow} from './ranking-view-model.mjs';
// Internal QA-only read handler; deployment requires a verified onCall wrapper.
export function buildRankingRead({db,aggregate=aggregateRanking,rank=rankTeachers,window=rankingWindow,clock=()=>new Date().toISOString()}){
 if(db.projectId!=='shiftly-t-test'||db.databaseId!=='shiftly-qa-v1')throw Error('QA_RANKING_TARGET_MISMATCH');
 const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 const metrics=['slots','regular','seasonal','days','students'];
 const read=(tx,path)=>tx.get(db.doc(path)).then(s=>s.exists?s.data():null);
 // Only call after Firebase callable authentication and App Check verification.
 // request.auth/app are trusted runtime context, not fields in request.data.
 return async function readRanking(request){
  const uid=request?.auth?.uid;
  if(typeof uid!=='string'||!uid||uid.includes('/')||!request.app)throw Error('RANKING_UNAUTHENTICATED');
  const input=request.data;
  if(!input||Object.keys(input).some(k=>!['kind','key','metric'].includes(k))||!['month','year'].includes(input.kind)||!metrics.includes(input.metric)||typeof input.key!=='string')throw Error('INVALID_RANKING_QUERY');
  const w=window(input.kind,input.key);
  const now=clock(),today=new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
  if(!iso(w.from)||!iso(w.to)||w.from>today||w.from<'2000-01-01')throw Error('INVALID_RANKING_PERIOD');
  const yesterday=new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
  return db.runTransaction(async tx=>{
   const [user,config,maintenance,restore]=await Promise.all([read(tx,'users/'+uid),read(tx,'rankingInternalConfig/runtime'),read(tx,'systemConfig/maintenance'),read(tx,'systemConfig/restoreJob')]);
   if(!['employee','admin','owner'].includes(user?.role))throw Error('RANKING_FORBIDDEN');
   if(restore||maintenance?.enabled===true)throw Error('RANKING_UNAVAILABLE');
   if(config?.enabled!==true||config.publicationEnabled!==true||!iso(config.trackingStart))throw Error('RANKING_NOT_PUBLISHED');
   const start=w.from>config.trackingStart?w.from:config.trackingStart;
   const end=w.to<yesterday?w.to:yesterday;
   if(start>end)return {period:w.label,rows:[],coverage:{expected:0,recorded:0,complete:true,from:null,to:null},asOf:now};
   const [days,users]=await Promise.all([
    tx.get(db.collection('rankingInternalDays').where('date','>=',start).where('date','<=',end).limit(367)),
    tx.get(db.collection('users').limit(301))
   ]);
   if(days.docs.length>366||users.docs.length>300)throw Error('RANKING_READ_LIMIT');
   const teachers=users.docs.map(d=>({uid:d.id,role:d.get('role'),name:d.get('name')})).filter(t=>['employee','admin'].includes(t.role));
   if(teachers.some(t=>typeof t.name!=='string'||!t.name.trim()||t.name.length>100))throw Error('RANKING_INVALID_ROSTER');
   const ids=new Set(teachers.map(t=>t.uid)),names=new Map(teachers.map(t=>[t.uid,t.name]));
   const recorded=new Set(),facts=[];
   for(const d of days.docs){
    const x=d.data();
    if(d.id!==x.date||!iso(x.date)||x.date<start||x.date>end||recorded.has(x.date)||!Number.isSafeInteger(x.revision)||x.revision<1||!Array.isArray(x.facts)||x.facts.length>4000)throw Error('RANKING_INVALID_LEDGER');
    recorded.add(x.date);
    for(const f of x.facts){
     if(f.date!==x.date||f.status!=='done'||typeof f.studentId!=='string'||!f.studentId||typeof f.slotId!=='string'||!f.slotId||!['regular','seasonal'].includes(f.kind)||typeof f.endedAt!=='string'||!Number.isFinite(Date.parse(f.endedAt))||Date.parse(f.endedAt)>Date.parse(now))throw Error('RANKING_INVALID_FACT');
     // Never silently omit historical teachers until an approved archival roster is implemented.
     if(!ids.has(f.teacherUid))throw Error('RANKING_HISTORICAL_ROSTER_REQUIRED');
     facts.push(f);
    }
    if(facts.length>150000)throw Error('RANKING_FACT_LIMIT');
   }
   const expected=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
   const complete=expected===recorded.size;
   // Missing days are not equivalent to zero lessons. Withhold standings until resolved.
   const rows=complete?rank(aggregate({facts,teachers,from:start,to:end,cutoff:now}),input.metric).map(t=>({teacherUid:t.teacherUid,name:names.get(t.teacherUid),rank:t.rank,slots:t.slots,regular:t.regular,seasonal:t.seasonal,days:t.days,students:t.students})):[];
   return {period:w.label,rows,coverage:{expected,recorded:recorded.size,complete,from:start,to:end},asOf:now};
  },{readOnly:true});
 };
}
