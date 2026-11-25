'use strict';
// Read-only callable wrapper. Never expose internal exception details to clients.
function createRankingCallable({onCall,HttpsError,read}){
 if(typeof onCall!=='function'||typeof HttpsError!=='function'||typeof read!=='function')throw Error('RANKING_WRAPPER_DEPENDENCIES');
 const mapping={
  RANKING_UNAUTHENTICATED:['unauthenticated','ログイン情報を確認してください。'],
  RANKING_FORBIDDEN:['permission-denied','ランキングを閲覧できません。'],
  INVALID_RANKING_QUERY:['invalid-argument','集計条件を確認してください。'],
  INVALID_RANKING_PERIOD:['invalid-argument','集計期間を確認してください。'],
  'Invalid period':['invalid-argument','集計期間を確認してください。'],
  RANKING_UNAVAILABLE:['unavailable','現在ランキングを利用できません。'],
  RANKING_NOT_PUBLISHED:['failed-precondition','ランキングはまだ公開されていません。']
 };
 return onCall({region:'asia-northeast1',enforceAppCheck:true,timeoutSeconds:60,maxInstances:3},async request=>{
  if(!request?.auth?.uid)throw new HttpsError('unauthenticated','ログイン情報を確認してください。');
  if(!request.app)throw new HttpsError('permission-denied','アプリの確認に失敗しました。');
  try{return await read(request);}
  catch(e){
   const known=Object.hasOwn(mapping,e?.message)?mapping[e.message]:null;
   if(known)throw new HttpsError(...known);
   throw new HttpsError('internal','ランキングの取得に失敗しました。');
  }
 });
}
module.exports={createRankingCallable};
