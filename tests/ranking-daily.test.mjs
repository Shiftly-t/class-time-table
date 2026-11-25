import {deriveDailyRanking} from '../ranking-daily.mjs';
function testDaily(){
 const date='2026-11-25',teachers=[{uid:'a',role:'employee'},{uid:'b',role:'admin'}],base={id:'1',status:'scheduled',date,studentId:'s1',teacherUid:'a',start:'17:30',end:'19:25',virtual:true};
 // Test adapter models the existing normalizer's verified input contract. Integration tests with actual module are also saved.
 const snapshot={date,complete:true,closed:false,capturedAt:date+'T23:55:00+09:00',courses:[],unavailableSlots:[],entries:[base,{...base,id:'2',studentId:'s2'},{...base,id:'3',studentId:'s3',status:'cancelled'}]};
 const run=(over={},args={})=>deriveDailyRanking({snapshot:{...snapshot,...over},trackingStart:date,cutoff:'2026-11-26T00:01:00+09:00',teachers,...args});
 const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Assertion failed: '+JSON.stringify(a));};
 eq(run().facts.length,4);eq(run().canPublish,true);eq(run({closed:true}).facts.length,0);
 eq(run({unavailableSlots:[{teacherUid:'a',start:'18:30',end:'19:25'}]}).facts.length,2);
 eq(run({entries:[{...base,teacherUid:'b'}]}).facts[0].teacherUid,'b');
 eq(run({complete:false}).canPublish,false);eq(run({capturedAt:date+'T18:00:00+09:00'}).canPublish,false);
 eq(run({}, {trackingStart:'2026-11-26'}).canPublish,false);eq(run({}, {cutoff:date+'T23:59:00+09:00'}).canPublish,false);
 eq(run({entries:[base,{...base,id:'duplicate'}]}).canPublish,false);
 return 'SUCCESS RANKING AUTO DAILY FIXTURE TESTS';
}
console.log(testDaily());
