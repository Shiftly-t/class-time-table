// Single entry for migrated business writes. No SDK import and no direct-write fallback.
export function createAuthorityCommands({normal,seasonal}){
 const invoke=(service,name,args)=>{if(!service.enabled())throw Error('管理用APIの準備ができていないため、保存を停止しました。');return service[name](args);};
 return Object.freeze({
  saveStudent:args=>invoke(normal,'saveStudent',args),
  saveDay:args=>invoke(normal,'saveDay',args),
  saveWork:args=>invoke(normal,'saveWork',args),
  moveLesson:args=>invoke(normal,'moveLesson',args),
  saveAvailability:args=>invoke(seasonal,'saveAvailability',args),
  saveCourse:args=>invoke(seasonal,'saveCourse',args),
  patchCourse:args=>invoke(seasonal,'patchCourse',args),
  deleteCourse:args=>invoke(seasonal,'deleteCourse',args),
  publishCourse:args=>invoke(seasonal,'publish',args),
  saveMemo:args=>invoke(seasonal,'saveMemo',args),
  saveCalendar:args=>invoke(seasonal,'saveCalendar',args),
  planWithdrawal:studentId=>invoke(seasonal,'planWithdrawal',studentId),
  withdrawStudent:args=>invoke(seasonal,'withdrawStudent',args)
 });
}
