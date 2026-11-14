// Shared booking RPC safety. Never persist QR credentials or blindly resend an
// uncertain mutation: legacy endpoints may ignore requestId entirely.
const READS=new Set(['view','courses','getSettings','slots','slotDemand','roster','teachers','detail','getQr','capabilities','requestStatus','planStudentDelete','planSnapshotRestore','inspectCourse','inspectAvailability','inspectControl','listSnapshots','verifyIntegrity','planWithdrawal']);
const definite=new Set(['invalid-argument','permission-denied','unauthenticated','failed-precondition','not-found','already-exists','aborted','resource-exhausted']);
const blocked=message=>Object.assign(Error(message),{code:'booking/result-unconfirmed'});
// A resolved callable alone does not prove that its expected mutation completed.
// Keep both the deployed booking contract and the migrated seasonal contract.
const confirmedMutation=response=>{
 const d=response?.data;
 if(d?.protocolVersion===3)return d.ok!==false && Number.isSafeInteger(d.version) && d.version>=1 && Number.isSafeInteger(d.changed) && d.changed>=0;
 return d?.ok===true;
};
export const bookingMutation=action=>!READS.has(action);
export function createBookingTransport({call,getSession,newRequestId=()=>crypto.randomUUID()}){
 let session=null,generation=0,pending=null,inFlight=null,committed=0;
 function sync(){const next=getSession();if(next!==session){session=next;generation++;pending=null;inFlight=null;committed=0;}if(!next)throw blocked('ログイン状態を確認して再読み込みしてください。');return generation;}
 const check=epoch=>{if(sync()!==epoch)throw blocked('ログイン状態が変更されたため、以前の応答を破棄しました。');};
 return {
  reset(){session=null;generation++;pending=null;inFlight=null;committed=0;},
  commits:()=>committed,
  hasPending:()=>Boolean(pending),
  isMutation:bookingMutation,
  async call(fields){
   const epoch=sync(),mutation=bookingMutation(fields.action);
   if(['setTeacherLimit','setCapacity'].includes(fields.action))throw Object.assign(Error('個別定員の変更は廃止しました。講習の勤務希望と予約停止設定で調整してください。'),{code:'booking/unsupported-operation'});
   if(mutation&&(pending||inFlight))throw blocked('前の送信結果が未確認です。「送信結果を確認」を使い、同じ処理を繰り返さないでください。');
   const operation=mutation?{epoch,body:{...fields,requestId:newRequestId()}}:null;
   if(operation){pending=operation;inFlight=operation;}
   try{const response=await call(operation?.body||fields);check(epoch);if(operation){if(!confirmedMutation(response))throw blocked('保存結果を確認できません。「送信結果を確認」を使い、同じ処理を繰り返さないでください。');if(pending===operation)pending=null;committed++;}return response;}
   catch(e){if(operation&&pending===operation&&definite.has(String(e?.code||'').replace(/^functions\//,'')))pending=null;throw e;}
   finally{if(inFlight===operation)inFlight=null;}
  },
  async confirmPending(){
   const epoch=sync(),operation=pending;if(!operation)throw blocked('確認待ちの送信はありません。');if(inFlight)throw blocked('送信中です。完了を待ってください。');
   const source=operation.body,fields={action:'requestStatus',targetRequestId:source.requestId};
   for(const key of ['courseId','studentId','studentName','token'])if(source[key]!==undefined)fields[key]=source[key];
   const response=await call(fields);check(epoch);if(pending!==operation)throw blocked('送信の状態が変わりました。');
   if(response?.data?.protocolVersion!==2||response.data.committed!==true)throw blocked('送信結果をまだ確認できません。再送せず、最新の内容を確認するか教室へお問い合わせください。');
   pending=null;committed++;return {committed:true};
  }
 };
}
