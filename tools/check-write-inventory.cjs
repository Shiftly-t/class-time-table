// Reviewed call-site inventory, not an AST/taint proof. Changes require review.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sinkPattern=()=>/(?<![\w.])(?:setDoc|updateDoc|deleteDoc|addDoc|writeBatch|runTransaction)\s*\(|\b(?:tx|batch|writer|targetBatch)\.(?:set|update|delete|create|commit)\s*\(/g;
function verifyInventory({root=path.resolve(__dirname,'..'),inventory=JSON.parse(fs.readFileSync(path.join(root,'docs/stage3/write-inventory.json'),'utf8'))}={}){
 const files=fs.readdirSync(root).filter(x=>x.endsWith('.js')).sort();
 if(JSON.stringify(files)!==JSON.stringify(Object.keys(inventory.sourceHashes).sort()))throw Error('Web JavaScript一覧が変わりました。直接書込の再棚卸しが必要です');
 const sites=[];
 for(const file of files){const text=fs.readFileSync(path.join(root,file),'utf8');
  if(crypto.createHash('sha256').update(text).digest('hex')!==inventory.sourceHashes[file])throw Error(file+'が変更されました。直接書込の再レビューが必要です');
  for(const m of text.matchAll(sinkPattern())){const line=text.slice(0,m.index).split('\n').length,groups=inventory.groups.filter(g=>g.file===file&&g.from<=line&&line<=g.to);if(groups.length!==1)throw Error('未分類のFirestore書込候補: '+file+':'+line);sites.push({file,line,sink:m[0].replaceAll(' ',''),group:groups[0].id,lineSha256:crypto.createHash('sha256').update(text.split('\n')[line-1]).digest('hex')});}
 }
 if(JSON.stringify(sites)!==JSON.stringify(inventory.sites))throw Error('Firestore書込候補一覧とコードが一致しません');
 return {groups:inventory.groups.length,sites:sites.length,sourceCommit:inventory.sourceCommit,allReviewed:true};
}
if(require.main===module){try{console.log(JSON.stringify(verifyInventory(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={verifyInventory};
