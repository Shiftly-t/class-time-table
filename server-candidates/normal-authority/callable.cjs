'use strict';
// Example factory ONLY. Wire in a private deployment repository after integration validation.
// No Admin initialization, project ID, credentials, deploy config, or private source is included.
const {createNormalAuthority}=require('./service.cjs');
function makeNormalCallable({onCall,HttpsError,db,serverTimestamp,todayKey,bookingFence=null}){
  const execute=createNormalAuthority({db,serverTimestamp,todayKey,bookingFence});
  return onCall({enforceAppCheck:true},async request=>{
    try{return await execute({auth:request.auth,app:request.app},request.data);}
    catch(error){const codes=['unauthenticated','permission-denied','invalid-argument','failed-precondition','not-found','already-exists','aborted','resource-exhausted'];throw new HttpsError(codes.includes(error.code)?error.code:'internal',codes.includes(error.code)?error.message:'Normal lesson update failed');}
  });
}
module.exports={makeNormalCallable};
