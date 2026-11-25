'use strict';
const {resolveSeasonalDay}=require('./ranking-seasonal.cjs');
function testSeasonal(){
 const date='2026-12-22',course={id:'c',startDate:date,endDate:date,periods:[{start:'13:00',end:'13:55'}]};
 const base={date,courseId:'c',id:'b_1',studentId:'s1',teacherUid:'a',start:'13:00',end:'13:55',status:'scheduled'};
 const args={date,course,lessons:[base,{...base,id:'manual',studentId:'s2'}],bookings:[{courseId:'c',studentId:'s1',confirmed:[{slotId:'fixture',teacherUid:'a',published:true}]},{courseId:'c',studentId:'s3',confirmed:[{slotId:'fixture',teacherUid:'a',published:false}]}],teachers:[{uid:'a',role:'employee'}],students:[{id:'s1'},{id:'s2'}],availability:new Map([['a',[date+'_0']]]),periodFromSlot:()=>({date,index:0}),allows:()=>true,closed:false};
 const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('ASSERT '+JSON.stringify(a));};
 const rejects=(over,code)=>{let message;try{resolveSeasonalDay({...args,...over});}catch(e){message=e.message;}eq(message,code);};
 eq(resolveSeasonalDay(args).entries.length,2);
 eq(resolveSeasonalDay({...args,lessons:[{...base,status:'cancelled'}]}).entries.length,0);
 rejects({bookings:[]},'RANKING_UNMATCHED_BOOKING_LESSON');
 rejects({lessons:[base,{...base,id:'b_duplicate'}]},'RANKING_BOOKING_MATCH_FAILED');
 rejects({availability:new Map()},'RANKING_SEASONAL_AVAILABILITY_CONFLICT');
 rejects({closed:true},'RANKING_CLOSED_DAY_HAS_LESSON');
 eq(resolveSeasonalDay({...args,allows:s=>s.id==='s1'}).entries.length,1);
 return 'SUCCESS RANKING SEASONAL RESOLVER FIXTURE TESTS';
}
console.log(testSeasonal());
