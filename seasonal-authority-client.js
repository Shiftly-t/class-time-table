import {askCorrectionReason,lessonEnded} from './ranking-correction-ui.js?v=prod-ranking-20261126-a';
// Opt-in seasonal/lifecycle adapter. Unsupported server contracts never fall back to writes.
import {createBookingTransport} from './booking-transport.js';
import {authorityValue} from './normal-authority-client.js';
const readActions=new Set(["exportSnapshot","inspectRestoreJob","planBatchedRestore",'capabilities','inspectCourse','inspectAvailability','inspectControl','requestStatus','planStudentDelete','listSnapshots','planSnapshotRestore','verifyIntegrity','planWithdrawal']);
const blocked=(message,operation)=>Object.assign(Error(message),{code:'seasonal-authority/blocked',userMessage:message,operation});
const operationLabels={
 capabilities:'対応機能の確認',inspectControl:'停止状態の確認',setMaintenance:'停止設定の確定',
 listSnapshots:'新形式バックアップの一覧取得',createSnapshot:'新形式バックアップの作成'
};
const diagnosticCodes=new Set(['failed-precondition','permission-denied','unauthenticated','invalid-argument','aborted','unavailable','deadline-exceeded','not-found','resource-exhausted']);
export function describeSeasonalOperationFailure(error,fallback){
 const label=Object.hasOwn(operationLabels,error?.operation)?operationLabels[error.operation]:null;
 if(!label||!error.userMessage)return fallback;
 const code=String(error.code||'').replace(/^functions\//,'');
 return `${label}で停止しました。${error.userMessage}${diagnosticCodes.has(code)?`（${code}）`:''}`;
}
const clean=v=>v==null?null:authorityValue(Object.fromEntries(Object.entries(v).filter(([k])=>!['id','virtual','displayPeriod','splitTotal','splitIndex','_delete'].includes(k))));
const same=(a,b)=>JSON.stringify(authorityValue(a))===JSON.stringify(authorityValue(b));
export function createSeasonalAuthorityClient({enabled=false,call,getSession,newRequestId}){
 let generation=0;const identity=()=>generation+':'+(getSession()||'');
 const guard=who=>{if(!getSession()||who!==identity())throw blocked('ログイン状態が変わりました。操作を停止しました。');};
 const transport=createBookingTransport({call:async fields=>{
  const response=await call(fields),data=response?.data;
  if(fields.action==='requestStatus')return response;
  if(data?.protocolVersion!==3)throw blocked('講習APIの応答形式を確認できません。保存操作の場合は再送せず、送信結果を確認してください。');
  if(fields.action==='withdrawStudent'&&(data.studentId!==fields.studentId||data.enrollmentStatus!=='withdrawn'||data.historyPreserved!==true||data.qrRevoked!==true))throw blocked('退塾の保存結果が不明です。再送せず送信結果を確認してください。');
  if(!readActions.has(fields.action)&&(!Number.isSafeInteger(data.version)||data.version<1||!Number.isSafeInteger(data.changed)||data.changed<0))throw blocked('講習APIの保存結果が不明です。再送せず送信結果を確認してください。');
  if(fields.action==='createSnapshot'&&(
   typeof data.archiveId!=='string'||!data.archiveId.trim()||!Number.isSafeInteger(data.count)||data.count<0||
   (data.formatVersion!=null&&![2,3].includes(data.formatVersion))
  ))throw blocked('バックアップの作成結果を確認できません。再送せず、送信結果を確認してください。');
  return response;
 },getSession,...(newRequestId?{newRequestId}:{})});
 async function request(action,fields={},who=identity()){
  guard(who);
  if(!enabled)throw blocked('講習API移行モードは無効です。',action);
  try{
   const response=await transport.call({action,...fields});
   guard(who);
   return response.data;
  }catch(error){
   error.operation=action;
   if(error.userMessage)throw error;
   const code=String(error.code||'').replace(/^functions\//,'');
   const message=String(error.message||'');
   const mapped=[
    ['Course opening changes require','このサーバーでは講習中の開閉変更は未実装です。データは変更しません。'],
    ['Availability deadline','勤務希望の提出締切を過ぎているか、締切が未設定です。'],
    ['Archived course','非表示の講習は変更できません。'],
    ['availability cannot be removed','担当授業のある勤務コマは解除できません。先に担当授業を調整してください。'],
    ['Dependent course structure','授業・予約・QRなどがある講習の期間やコマの移行は未対応です。'],
    ['Availability exists','勤務希望がある講習の期間・コマ変更は未対応です。'],
    ['Writer migration','全書き込み経路の移行と権限制御が未確認のため、業務を再開できません。'],
    ['Completed history','実施済み授業の削除・移動は未対応です。']
   ].find(([part])=>message.includes(part));
   const hints={
    aborted:'他の端末で内容が変更されました。再読み込みして確認してください。',
    'permission-denied':'この操作の権限を確認できません。保存を停止しました。',
    unauthenticated:'再ログインしてから内容を確認してください。',
    'failed-precondition':'現在の状態ではこの操作を実行できません。授業・予約・勤務設定を確認してください。',
    'resource-exhausted':'担当人数・予約枠または一括処理件数の上限を超えるため、保存を停止しました。',
    'invalid-argument':'入力内容と対象を確認してください。',
    'not-found':'対象が削除または変更されています。再読み込みしてください。',
    unavailable:'通信状態を確認してください。保存結果が不明な場合は再送せず、送信結果を確認してください。',
    'deadline-exceeded':'応答を取得できませんでした。保存結果が不明な場合は再送せず、送信結果を確認してください。'
   };
   if(code==='failed-precondition'&&message.trim()==='Coordinated deployment has not been activated'){
    error.userMessage='連携機能は有効化されていません。運営で移行状況と配備条件を確認してください。';
   }else if(['failed-precondition','unauthenticated'].includes(code)&&message.trim()==='Verified App Check required'){
    error.userMessage='アプリの認証（App Check）を確認できません。ページを開き直してください。';
   }else{
    const fallback=code==='booking/result-unconfirmed'?message:'操作結果を確認できません。保存操作の場合は再送せず、送信結果を確認してください。';
    error.userMessage=mapped?.[1]||(Object.hasOwn(hints,code)?hints[code]:fallback);
   }
   throw error;
  }
 }
 async function requireOperation(action,who){const c=await request('capabilities',{},who);if(!Array.isArray(c.operations)||!c.operations.includes(action))throw blocked('講習APIがこの操作への対応を報告していません。','capabilities');return c;}
 async function inspectCourse(courseId,before,who,dates=[]){const s=await request('inspectCourse',{courseId,...(dates.length?{correctionDates:dates}:{})},who);if(!s.course||!s.entries||!s.meta)throw blocked('講習の確認情報が不正です。');if(before!==undefined&&!same(clean(before),s.course.value))throw blocked('講習が別の端末で変更されました。再読み込みしてください。');return s;}
 const client={
  async inspectRestoreJob(){const r=await request("inspectRestoreJob");if(r.ok!==true||typeof r.active!=="boolean")throw blocked("復元状態を確認できません。");return r;},
  async planBatchedRestore(archiveId){const p=await request("planBatchedRestore",{archiveId});if(p.canApply!==true||!Number.isSafeInteger(p.revision)||!Number.isSafeInteger(p.operationCount)||p.operationCount<1||p.requiresQrReissue!==true)throw blocked("分割復元計画を確認できません。");return p;},
  async startBatchedRestore(archiveId,plan){if(plan?.canApply!==true||!Number.isSafeInteger(plan.revision)||plan.requiresQrReissue!==true)throw blocked("復元計画の再確認が必要です。");return request("startBatchedRestore",{archiveId,expectedRevision:plan.revision});},
  async startRollback(jobId){if(!/^job_[a-f0-9]{32}$/.test(jobId||""))throw blocked("巻き戻し対象を確認できません。");return request("startRollback",{jobId});},
  async applyRestoreBatch(jobId,expectedBatch){return request("applyRestoreBatch",{jobId,expectedBatch});},
  async finishBatchedRestore(jobId){return request("finishBatchedRestore",{jobId});},

  enabled:()=>enabled,reset:()=>{generation++;transport.reset();},hasPending:()=>transport.hasPending(),commits:()=>transport.commits(),confirmPending:()=>transport.confirmPending(),
  async saveAvailability({courseId,teacherUid,beforeSlots,slots}){const who=identity();await requireOperation('saveAvailability',who);const s=await request('inspectAvailability',{courseId,teacherUid},who);if(!s.course||!s.availability||!same([...(beforeSlots||[])].sort(),[...(s.availability.value?.slots||[])].sort()))throw blocked('勤務希望が別の端末で変更されました。再読み込みしてください。');return request('saveAvailability',{courseId,teacherUid,expectedCourse:s.course.token,expected:s.availability.token,slots},who);},
  async saveCourse({courseId,before,value}){const who=identity();await requireOperation('saveCourse',who);const s=await inspectCourse(courseId,before,who);return request('saveCourse',{courseId,expected:s.course.token,value:authorityValue(value)},who);},
  async patchCourse({courseId,before,patch}){const who=identity();await requireOperation('patchCourse',who);const s=await inspectCourse(courseId,before,who);return request('patchCourse',{courseId,expected:s.course.token,patch:authorityValue(patch)},who);},
  async deleteCourse({courseId,before}){const who=identity();await requireOperation('deleteCourse',who);const s=await inspectCourse(courseId,before,who);return request('deleteCourse',{courseId,expected:s.course.token},who);},
  async publish({courseId,beforeCourse,changes}){const who=identity(),capabilities=await requireOperation('publishManualCourse',who);if(!changes.length||changes.length>60)throw blocked('講習APIでは一度に60変更まで保存できます。');const records=changes.flatMap(change=>[change.before,change.remove?null:change.value].filter(Boolean));
   const dates=capabilities.rankingDateCorrections===true
     ? [...new Set(records.filter(row=>lessonEnded(row.date,row.end)).map(row=>row.date))]
     : [];
   const s=await inspectCourse(courseId,beforeCourse,who,dates);
   const mapped=changes.map(x=>{const old=s.entries[x.id];if(!same(clean(x.before),old?.value??null))throw blocked('授業が別の端末で変更されました。再読み込みしてください。');return {id:x.id,expected:old?.token??null,...(x.remove?{remove:true}:{value:clean(x.value)})};});let correction;
   if(s.correctionDates?.length){
    const [date]=s.correctionDates;
    if(s.correctionDates.length!==1||records.some(row=>row.date!==date||!lessonEnded(row.date,row.end)))throw blocked('事後訂正は終了済みの同じ日付の授業ごとに保存してください。');
    const reason=await askCorrectionReason(date);
    if(!reason)return {cancelled:true};
    correction={date,reason};
   }
   return request('publishManualCourse',{courseId,expectedCourse:s.course.token,expectedMeta:s.meta.token,changes:mapped,...(correction?{correction}:{})},who);},
  async saveMemo({before,memo}){const who=identity();await requireOperation('saveCourseMemo',who);const s=await inspectCourse(before.courseId,undefined,who);if(!same(clean(before),s.entries[before.id]?.value))throw blocked('授業が別の端末で変更されました。再読み込みしてください。');return request('saveCourseMemo',{courseId:before.courseId,lessonId:before.id,expected:s.entries[before.id].token,memo},who);},
  async saveCalendar({collection,date,before,value,remove=false}){const who=identity();await requireOperation('saveCalendar',who);return request('saveCalendar',{collection,date,expectedValue:clean(before),value:remove?null:{...clean(value),date,...(collection==='schoolEvents'?{type:'exam'}:{})},remove},who);},
  async setMaintenance({before,value}){
   const who=identity();await requireOperation('setMaintenance',who);
   const {maintenance}=await request('inspectControl',{},who);
   const token=maintenance?.token;
   const absent=token===null&&maintenance.value===null;
   if(!absent&&(typeof token!=='string'||!token.trim()||!maintenance.value||typeof maintenance.value.enabled!=='boolean')){
    throw blocked('停止設定と更新条件を確認できません。','inspectControl');
   }
   const fields=v=>authorityValue({enabled:v?.enabled??false,message:v?.message??'',version:v?.version??''});
   if(!same(fields(before),fields(maintenance.value)))throw blocked('停止設定が変更されました。再読み込みしてください。','inspectControl');
   return request('setMaintenance',{expected:token,value},who);
  },
  async planWithdrawal(studentId){const who=identity();await requireOperation('withdrawStudent',who);const p=await request('planWithdrawal',{studentId},who);if(typeof p.canApply!=='boolean'||typeof p.expectedStudent!=='string'||!Number.isSafeInteger(p.revision)||p.revision<0||p.preservesHistory!==true||p.revokesQr!==true)throw blocked('履歴保持とQR失効を確認できないため、退塾を停止しました。');return p;},
  async withdrawStudent({studentId,plan}){const who=identity();await requireOperation('withdrawStudent',who);if(plan?.canApply!==true||!plan.expectedStudent||!Number.isSafeInteger(plan.revision)||plan.revision<0||plan.preservesHistory!==true||plan.revokesQr!==true)throw blocked('この退塾操作は未対応です。');return request('withdrawStudent',{studentId,expectedStudent:plan.expectedStudent,expectedRevision:plan.revision},who);},
  async planStudentDelete(studentId){const who=identity();await requireOperation('deleteStudent',who);const p=await request('planStudentDelete',{studentId},who);if(typeof p.canApply!=='boolean'||typeof p.expectedStudent!=='string'||!Number.isSafeInteger(p.revision)||p.revision<0)throw blocked('削除計画を確認できません。');return p;},
  async deleteStudent({studentId,plan}){const who=identity();await requireOperation('deleteStudent',who);if(plan?.canApply!==true||!plan.expectedStudent||!Number.isSafeInteger(plan.revision))throw blocked('この削除は未対応です。');return request('deleteStudent',{studentId,expectedStudent:plan.expectedStudent,expectedRevision:plan.revision},who);},
  async verifyIntegrity(){const who=identity();await requireOperation('verifyIntegrity',who);const r=await request('verifyIntegrity',{},who);if(r.ok!==true||!r.counts||!['students','lessons','reservations','slots'].every(k=>Number.isSafeInteger(r.counts[k])&&r.counts[k]>=0)||!Array.isArray(r.checks)||!['references','counts','capacity'].every(x=>r.checks.includes(x)))throw blocked('整合性の検査結果を確認できません。');return r;},
  async createSnapshot(label=''){const who=identity();await requireOperation('createSnapshot',who);return request('createSnapshot',{label},who);},
  async listSnapshots(cursor=null){
   const who=identity();await requireOperation('listSnapshots',who);
   const result=await request('listSnapshots',cursor?{cursor}:{},who);
   const {archives,nextCursor}=result;
   if(!Array.isArray(archives)||archives.length>50||archives.some(archive=>typeof archive?.id!=='string'||!archive.id.trim())||
      (nextCursor!==null&&nextCursor!==archives.at(-1)?.id))throw blocked('バックアップ一覧の応答形式を確認できません。','listSnapshots');
   return result;
  },
  async exportSnapshot(archiveId){const who=identity();await requireOperation("exportSnapshot",who);const r=await request("exportSnapshot",{archiveId},who);if(r.ok!==true||r.archiveId!==archiveId||typeof r.json!=="string")throw blocked("バックアップ出力を確認できません。");const data=JSON.parse(r.json);if(data.format!=="Shiftly-T-coordinated-backup"||data.archiveId!==archiveId||![2,3].includes(data.formatVersion)||data.requiresQrReissue!==true||!Array.isArray(data.records)||data.records.length!==r.recordCount||data.recordCount!==r.recordCount)throw blocked("バックアップの整合性を確認できません。");return data;},
  async planRestore(archiveId){const who=identity();await requireOperation('restoreSnapshot',who);const p=await request('planSnapshotRestore',{archiveId},who);if(p.canApply!==true||!Number.isSafeInteger(p.revision)||p.requiresQrReissue!==true)throw blocked('完全復元の計画を確認できません。');return p;},
  async restore({archiveId,plan}){const who=identity();await requireOperation('restoreSnapshot',who);if(plan?.canApply!==true||!Number.isSafeInteger(plan.revision)||plan.requiresQrReissue!==true)throw blocked('この復元は未対応です。');return request('restoreSnapshot',{archiveId,expectedRevision:plan.revision},who);}
 };return client;
}
