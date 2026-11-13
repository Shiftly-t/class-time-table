// Opt-in migration adapter. No direct Firestore write fallback exists here.
const displayKeys=new Set(['id','virtual','displayPeriod','splitTotal','splitIndex']);
export function authorityValue(value){
  if(value==null)return null;
  if(value instanceof Date)return {__shiftlyType:'timestamp',value:value.toISOString()};
  if(typeof value?.toDate==='function')return {__shiftlyType:'timestamp',value:value.toDate().toISOString()};
  if(Array.isArray(value))return value.map(authorityValue);
  if(typeof value==='object')return Object.fromEntries(Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>[k,authorityValue(value[k])]));
  return value;
}
const key=value=>JSON.stringify(authorityValue(value));
const stored=value=>value?.virtual?null:value==null?null:authorityValue(Object.fromEntries(Object.entries(value).filter(([k])=>!displayKeys.has(k))));
const error=message=>Object.assign(Error(message),{code:'normal-authority/blocked'});
const dto=value=>{
  const fields=['studentId','studentName','grade','school','teacherUid','teacherName','date','start','end','subject','status','memo','nextDates','regularId'];
  const result=Object.fromEntries(fields.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));result.memoUpdatedAt=null;return result;
};
export function createNormalAuthorityClient({enabled=false,call,getSession,newRequestId=()=>crypto.randomUUID()}){
  let generation=0,pending=null,active=false;
  const session=()=>`${generation}:${getSession()||''}`;
  function check(who){if(who!==session()||!getSession())throw error('ログイン状態が変わりました。再読み込みしてください。');}
  async function inspect(fields,who){check(who);const response=await call({kind:'inspect',requestId:newRequestId(),...fields});check(who);const data=response?.data;if(!data||data.protocolVersion!==1||!Number.isSafeInteger(data.version)||data.version<0)throw error('通常授業APIの応答を確認できません。');if(fields.date&&(!data.entries||!data.absences||!data.calendar)||fields.work&&!data.work)throw error('通常授業APIの読取結果が不正です。');return data;}
  async function perform(intent,prepare){
    if(!enabled)throw error('通常授業API移行モードは無効です。');
    if(active)throw error('通常授業の保存中です。完了を待ってください。');
    const who=session(),intentKey=key(intent);check(who);
    if(pending&&(pending.who!==who||pending.intentKey!==intentKey))throw error('前の保存結果が不明です。同じ内容で再送し、結果を確認してから変更してください。');
    active=true;
    try{
      if(!pending){const command=await prepare(who);check(who);pending={who,intentKey,intent,command:{...command,requestId:newRequestId()}};}
      const response=await call(pending.command);check(who);
      if(response?.data?.protocolVersion!==1||!Number.isSafeInteger(response?.data?.version)||response.data.version<1||!Number.isSafeInteger(response?.data?.changed)||response.data.changed<1)throw error('保存結果が不明です。同じ内容で再送してください。');
      pending=null;return response.data;
    }catch(e){
      // Preserve an uncertain request and its id. Explicit policy rejection is safe to clear.
      const code=String(e?.code||'').replace(/^functions\//,'');
      if(['invalid-argument','permission-denied','unauthenticated','failed-precondition','not-found','already-exists','aborted','resource-exhausted'].includes(code))pending=null;
      throw e;
    }finally{active=false;}
  }
  function equalBefore(before,current){if(key(stored(before))!==key(current?.value??null))throw error('他の端末で内容が変更されました。画面を閉じて再読み込みしてください。');}
  return {
    enabled:()=>enabled,
    reset(){generation++;pending=null;},
    hasPending:()=>Boolean(pending),
    retryPending(){if(!pending)throw error('確認待ちの保存はありません。');return perform(pending.intent,()=>pending.command);},
    unsupported(label){if(enabled)throw error(`${label}は通常授業APIへ未移行です。移行モードでは実行できません。`);},
    saveDay({date,changes=[],absences=[]}){
      return perform({date,changes,absences},async who=>{
        if(changes.length+absences.length>20)throw error('一度に保存できる授業・欠席変更は合計20件です。分けて保存してください。');
        const snapshot=await inspect({date},who);
        const mapped=changes.map(c=>{if(c.before&&c.before.date!==date)throw error('日付をまたぐ授業移動はAPI未対応です。');if(c.value?.courseId||c.before?.courseId||c.id.startsWith('b_'))throw error('講習・予約授業は通常授業APIで変更できません。');const row=snapshot.entries?.[c.id];equalBefore(c.before,row);return {id:c.id,expected:row?.token??null,...(c.remove?{remove:true}:{value:dto(c.value)})};});
        const absent=absences.map(c=>{const row=snapshot.absences?.[c.teacherUid];equalBefore(c.before,row);return {teacherUid:c.teacherUid,periods:c.periods,expected:row?.token??null};});
        return {kind:'day',date,changes:mapped,absences:absent};
      });
    },
    saveWork({type,teacherUid,date,values,clear=false,before}){
      return perform({type,teacherUid,date,values,clear,before},async who=>{const snapshot=await inspect({work:{type,teacherUid,...(date?{date}:{})}},who);const field={weekly:'weekdays',date:'availablePeriods',absence:'absentPeriods'}[type];const project=v=>v==null?null:{[field]:v[field]};if(key(project(before))!==key(project(snapshot.work.value)))throw error('他の端末で勤務設定が変更されました。再読み込みしてください。');return {kind:'work',type,teacherUid,...(date?{date}:{}),values,clear,expectedVersion:snapshot.version};});
    },
    saveCalendar({collection,date,before,value,remove=false}){
      return perform({collection,date,before,value,remove},async who=>{const snapshot=await inspect({date},who);const row=snapshot.calendar?.[collection];equalBefore(before,row);return {kind:'calendar',collection,date,expected:row?.token??null,...(remove?{remove:true}:{value})};});
    }
  };
}
