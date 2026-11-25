'use strict';

function hasRankingSourceLock(coordination,normalAuthority) {
  return coordination?.protocolVersion === 2 && coordination.enabled === true &&
    coordination.enforceDirectWriteDeny === true && normalAuthority?.enabled === true &&
    normalAuthority.schemaVersion === 1;
}

function withRankingSourceLock(db) {
  return {
    projectId:db.projectId,databaseId:db.databaseId,
    doc:path=>db.doc(path),collection:name=>db.collection(name),
    runTransaction:(work,options)=>db.runTransaction(async tx=>{
      const runtime=(await tx.get(db.doc('rankingInternalConfig/runtime'))).data();
      if (runtime?.enabled === true && (runtime.automationEnabled === true ||
          runtime.publicationEnabled === true || runtime.achievementsEnabled === true)) {
        const [coordination,normalAuthority]=await Promise.all([
          tx.get(db.doc('systemConfig/coordination')),tx.get(db.doc('systemConfig/normalAuthority'))
        ]);
        if (!hasRankingSourceLock(coordination.data(),normalAuthority.data())) throw Error('RANKING_UNAVAILABLE');
      }
      return work(tx);
    },options)
  };
}

module.exports={hasRankingSourceLock,withRankingSourceLock};
