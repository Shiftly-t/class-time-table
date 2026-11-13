// Local files only. No Firebase SDK, credentials, CLI, HTTP or deployment call.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const files=['index.html','course-booking.html','course-booking-admin.html','app.js','course-booking.js','course-booking-admin.js','booking-transport.js','normal-authority-client.js','seasonal-authority-client.js','normal-editor.js','teacher-work.js','style.css','booking.css','normal-editor.css','teacher-work.css'];
async function prepare(manifest,output){
 require('./check-write-inventory.cjs').verifyInventory();
 const {validateStage3Manifest}=await import('./stage3-safety.mjs');
 const productionFirebase=vm.runInNewContext(fs.readFileSync(path.join(root,'config.js'),'utf8').replace(/^export /gm,'')+';firebaseConfig');
 const productionAppCheckSiteKey=vm.runInNewContext(fs.readFileSync(path.join(root,'booking-config.js'),'utf8').replace(/^export /gm,'')+';bookingAppCheckSiteKey');
 const summary=validateStage3Manifest(manifest,{productionFirebase,productionAppCheckSiteKey});
 if(!path.isAbsolute(output)||fs.existsSync(output))throw Error('新規の絶対出力パスを指定してください。既存ディレクトリは上書きしません。');
 const parent=fs.realpathSync(path.dirname(output)),destination=path.join(parent,path.basename(output));
 for(let p=parent;;p=path.dirname(p)){if((fs.existsSync(path.join(p,'.git'))&&fs.statSync(path.join(p,'.git')).isFile())||fs.existsSync(path.join(p,'.git','HEAD')))throw Error('Gitリポジトリ内にはテスト設定を出力しません');if(p===path.dirname(p))break;}
 if(destination===root||destination.startsWith(root+path.sep))throw Error('ソースツリーには出力しません');
 const rendered=new Map();
 for(const file of files){let content=fs.readFileSync(path.join(root,file),'utf8');
  if(file.endsWith('.html')){content=content.replace(/<html\b[^>]*>/,`<html lang="ja" data-shiftly-environment="test" data-shiftly-project="${summary.projectId}">`).replace(/<title>/,'<title>[TEST] ');content=content.replace(/<body([^>]*)>/,`<body$1><aside role="note" style="padding:10px;background:#fff2a8;color:#111">Firebase結合テスト専用：${summary.projectId} / 両機能フラグ無効</aside>`);}
  if(['app.js','course-booking.js','course-booking-admin.js'].includes(file)){
   const imports=[...content.matchAll(/^import .*;\n/gm)];if(!imports.length)throw Error('Entry imports not found');const index=imports.at(-1).index+imports.at(-1)[0].length;
   const guard="import {assertStage3Runtime} from './stage3-safety.mjs';\nimport {stage3Manifest} from './stage3-manifest.js';\nimport {teacherWorkFeatureEnabled as stage3Work,normalAuthorityApiEnabled as stage3Api} from './config.js';\nassertStage3Runtime({manifest:stage3Manifest,firebaseConfig,appCheckSiteKey:bookingAppCheckSiteKey,flags:{teacherWorkFeatureEnabled:stage3Work,normalAuthorityApiEnabled:stage3Api},dataset:document.documentElement.dataset,origin:location.origin});\n";
   content=content.slice(0,index)+guard+content.slice(index);
  }
  rendered.set(file,content);
 }
 rendered.set('config.js',`export const firebaseConfig = ${JSON.stringify(manifest.firebaseConfig,null,2)};\nexport const teacherWorkFeatureEnabled = false;\nexport const normalAuthorityApiEnabled = false;\n`);
 rendered.set('booking-config.js',`export const bookingAppCheckSiteKey = ${JSON.stringify(manifest.appCheckSiteKey)};\n`);
 rendered.set('stage3-manifest.js',`export const stage3Manifest = ${JSON.stringify(manifest,null,2)};\n`);
 rendered.set('stage3-safety.mjs',fs.readFileSync(path.join(__dirname,'stage3-safety.mjs'),'utf8'));
 // No project creation, deploy config, service account, QR key or Functions source is emitted.
 const hashes=Object.fromEntries([...rendered].map(([name,content])=>[name,crypto.createHash('sha256').update(content).digest('hex')]));
 rendered.set('LOCAL_PREPARATION.json',JSON.stringify({...summary,networkUsed:false,deploymentPerformed:false,hashes},null,2)+'\n');
 fs.mkdirSync(destination,{mode:0o700});
 try{for(const [name,content]of rendered)fs.writeFileSync(path.join(destination,name),content,{flag:'wx',mode:0o600});}catch(error){fs.rmSync(destination,{recursive:true,force:true});throw error;}
 return {...summary,fileCount:rendered.size,output:destination};
}
if(require.main===module){
 const [, ,input,output]=process.argv;
 if(!input||!output){console.error('Usage: node tools/prepare-stage3-site.cjs /absolute/approved-test-manifest.json /absolute/NEW-output');process.exitCode=1;}
 else{let manifest;try{manifest=JSON.parse(fs.readFileSync(input,'utf8'));}catch{console.error('設定JSONを読み込めません。内容は安全のため表示しません。');process.exitCode=1;}
  if(manifest)prepare(manifest,output).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1});
  else if(!process.exitCode){console.error('設定JSONが空です。');process.exitCode=1;}
 }
}
module.exports={prepare};
