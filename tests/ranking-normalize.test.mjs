import {normalizeRankingEntries} from '../ranking-normalize.mjs';
function verify(){
 const teachers=[{uid:'a',role:'employee'},{uid:'b',role:'admin'}],courses=[{id:'winter',startDate:'2026-12-20',endDate:'2026-12-31',periods:[{start:'13:00',end:'13:55'}]}];
 const base={id:'1',status:'done',date:'2026-11-25',studentId:'s1',teacherUid:'a',start:'17:30',end:'19:25'};
 const run=entries=>normalizeRankingEntries({entries,courses,teachers,from:'2026-11-01',to:'2026-12-31',cutoff:'2026-12-31T23:59:59+09:00'});
 const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Assertion failure '+JSON.stringify(a));};
 let x=run([base,{...base,id:'2',studentId:'s2'},{...base,id:'3',status:'cancelled'},{...base,id:'4',status:'scheduled'}]);eq(x.facts.length,4);eq(x.canPublish,true);
 x=run([base,{...base,id:'2',teacherUid:'b'}]);eq(x.facts.length,0);eq(x.canPublish,false);eq(x.issues[0].code,'CONFLICTING_ASSIGNMENT');
 x=run([base,{...base,id:'2'}]);eq(x.facts.length,2);eq(x.canPublish,false);
 x=run([{...base,date:'2026-12-22',courseId:'winter',start:'13:00',end:'13:55',teacherUid:'b'}]);eq(x.facts.length,1);eq(x.facts[0].kind,'seasonal');
 x=run([{...base,start:'17:40'}]);eq(x.canPublish,true);eq(x.facts.length,1);
 x=run([{...base,start:'19:40'}]);eq(x.canPublish,false);eq(x.facts.length,0);
 x=run([{...base,virtual:true}]);eq(x.facts.length,0);eq(x.canPublish,true);
 x=normalizeRankingEntries({entries:[base],courses,teachers,from:'2026-11-01',to:'2026-12-31',cutoff:'2026-11-25T18:00:00+09:00'});eq(x.facts.length,0);
 return 'SUCCESS RANKING NORMALIZATION FIXTURE TESTS';
}
console.log(verify());
