'use strict';
const assert = require('node:assert/strict');
const {withRankingSourceLock} = require('./ranking-authority-lock.cjs');

async function main() {
  const docs = new Map();
  const db = withRankingSourceLock({
    projectId:'shiftly-t-test',databaseId:'shiftly-qa-v1',doc:path=>path,
    runTransaction: (callback,options)=>callback({
      options, get:async path=>({data:()=>docs.get(path)})
    })
  });
  assert.equal(await db.runTransaction(()=>42),42);
  docs.set('rankingInternalConfig/runtime',{enabled:true,automationEnabled:true});
  await assert.rejects(db.runTransaction(()=>assert.fail('Source must be locked')),/RANKING_UNAVAILABLE/);
  docs.set('systemConfig/coordination',{enabled:true,protocolVersion:2,enforceDirectWriteDeny:false});
  docs.set('systemConfig/normalAuthority',{enabled:true,schemaVersion:1});
  await assert.rejects(db.runTransaction(()=>assert.fail('Direct writes must be denied')),/RANKING_UNAVAILABLE/);
  docs.get('systemConfig/coordination').enforceDirectWriteDeny=true;
  assert.equal(await db.runTransaction(tx=>tx.options.readOnly,{readOnly:true}),true);
  console.log('SUCCESS RANKING SOURCE WRITE LOCK TESTS');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
