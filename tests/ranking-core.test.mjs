import {aggregateRanking,rankTeachers,eligibleMilestones,RANKING_SLOT_LABEL,RANKING_SLOT_EXPLANATION} from '../ranking-core.mjs';
function tests(){
  const teachers=[{uid:'a',role:'employee'},{uid:'b',role:'admin'},{uid:'c',role:'employee'},{uid:'o',role:'owner'}];
  const base={status:'done',date:'2026-11-25',endedAt:'2026-11-25T18:25:00+09:00',studentId:'s1',kind:'regular',teacherUid:'a'};
  const fact=(slotId,extra={})=>({...base,slotId,...extra});
  const facts=[fact('1'),fact('1'),fact('2',{studentId:'s2'}),fact('3',{teacherUid:'b',kind:'seasonal'}),fact('4',{teacherUid:'b'}),fact('5',{status:'cancelled'}),fact('6',{status:'scheduled'}),fact('7',{teacherUid:'o'}),fact('8',{endedAt:'2026-11-25T21:25:00+09:00'}),fact('9',{date:'2026-10-31'}),fact('10',{teacherUid:'c'})];
  const args={facts,teachers,from:'2026-11-01',to:'2026-11-30',cutoff:'2026-11-25T20:00:00+09:00'};
  const rows=rankTeachers(aggregateRanking(args));const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Assertion failure: '+JSON.stringify(a)+' vs '+JSON.stringify(b));};
  eq(rows.map(t=>[t.teacherUid,t.slots,t.rank]),[['a',2,1],['b',2,1],['c',1,3]]);
  eq(rows[0].days,1);eq(rows[0].students,2);eq(rows[1].regular,1);eq(rows[1].seasonal,1);
  eq(rankTeachers(rows,'seasonal').map(t=>t.teacherUid),['b']);
  eq(eligibleMilestones(100,[{id:'x',slots:50},{id:'y',slots:100},{id:'z',slots:101}],['x']),['y']);
  const simultaneous=[fact('period1-s1'),fact('period1-s2',{studentId:'s2'}),fact('period2-s1',{endedAt:'2026-11-25T19:25:00+09:00'}),fact('period2-s2',{studentId:'s2',endedAt:'2026-11-25T19:25:00+09:00'})];
  eq(aggregateRanking({...args,facts:simultaneous.slice(0,2)})[0].slots,2);
  eq(aggregateRanking({...args,facts:simultaneous})[0].slots,4);
  eq(aggregateRanking({...args,facts:simultaneous})[0].students,2);
  eq(RANKING_SLOT_LABEL,'担当授業コマ数（延べ）');
  eq(RANKING_SLOT_EXPLANATION.includes('1コマで2人担当した場合は2コマ分'),true);
  let rejected=false;try{aggregateRanking({...args,facts:[fact('1'),fact('1',{teacherUid:'b'})]});}catch{rejected=true;}eq(rejected,true);
  return 'SUCCESS RANKING CORE FIXTURE TESTS';
}
console.log(tests());
