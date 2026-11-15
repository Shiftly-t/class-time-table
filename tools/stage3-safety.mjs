// Offline preparation checks. This is not a replacement for Firebase IAM/rules.
const fail=message=>{throw Error('第3段階の準備を停止：'+message);};
const exactKeys=(value,keys,label)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail(label+'に未許可の項目があります');};
export function validateStage3Manifest(m,{productionFirebase={},productionAppCheckSiteKey=''}={}){
 exactKeys(m,['version','environment','approvedProjectId','approvedProjectNumber','approvedTestOrigin','functionsRegion','firebaseConfig','appCheckSiteKey','teacherWorkFeatureEnabled','normalAuthorityApiEnabled'],'設定');
 if(m.version!==1||m.environment!=='test')fail('テスト構成だけを受理します');
 const id=m.approvedProjectId,number=m.approvedProjectNumber;
 if(typeof id!=='string'||!/^shiftly-t-it-[a-z0-9-]+[a-z0-9]$/.test(id)||id.length>30||id==='shiftly-d02f6'||id===productionFirebase.projectId)fail('承認した独立テストprojectIdが必要です');
 if(typeof number!=='string'||!/^\d{6,20}$/.test(number)||number===String(productionFirebase.messagingSenderId||''))fail('本番と異なるテストproject numberが必要です');
 if(![`https://${id}.web.app`,`https://${id}.firebaseapp.com`].includes(m.approvedTestOrigin))fail('テスト専用のFirebase Hosting originを指定してください');
 if(m.functionsRegion!=='asia-northeast1')fail('Web実装とFunctionsのregionが一致しません');
 if(m.teacherWorkFeatureEnabled!==false||m.normalAuthorityApiEnabled!==false)fail('両機能フラグはfalseを維持してください');
 const c=m.firebaseConfig;exactKeys(c,['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'],'Firebase Web設定');
 if(c.projectId!==id||c.authDomain!==`${id}.firebaseapp.com`||(Object.hasOwn(c,'storageBucket')&&![`${id}.firebasestorage.app`,`${id}.appspot.com`].includes(c.storageBucket))||c.messagingSenderId!==number)fail('Firebase設定に別プロジェクトが混在しています');
 if(typeof c.apiKey!=='string'||!/^AIza[A-Za-z0-9_-]{30,45}$/.test(c.apiKey)||c.apiKey===productionFirebase.apiKey)fail('テスト専用のWeb API keyが必要です');
 if(typeof c.appId!=='string'||!new RegExp('^1:'+number+':web:[a-f0-9]{10,64}$').test(c.appId)||c.appId===productionFirebase.appId)fail('テスト用Web App IDを確認してください');
 if(typeof m.appCheckSiteKey!=='string'||!/^6[A-Za-z0-9_-]{20,100}$/.test(m.appCheckSiteKey)||m.appCheckSiteKey===productionAppCheckSiteKey)fail('テストドメイン用の独立したApp Check site keyが必要です');
 return {projectId:id,origin:m.approvedTestOrigin,region:m.functionsRegion,flagsEnabled:false};
}
export function assertStage3Runtime({manifest,firebaseConfig,appCheckSiteKey,flags,dataset,origin}){
 validateStage3Manifest(manifest);
 if(dataset?.shiftlyEnvironment!=='test'||dataset?.shiftlyProject!==manifest.approvedProjectId||origin!==manifest.approvedTestOrigin)fail('承認したテストサイトではありません');
 if(flags?.teacherWorkFeatureEnabled!==false||flags?.normalAuthorityApiEnabled!==false)fail('機能フラグの有効化は準備の対象外です');
 exactKeys(firebaseConfig,Object.keys(manifest.firebaseConfig),'読込済みFirebase設定');
 for(const [key,value]of Object.entries(manifest.firebaseConfig))if(firebaseConfig?.[key]!==value)fail('読込済みFirebase設定が承認構成と一致しません');
 if(appCheckSiteKey!==manifest.appCheckSiteKey)fail('App Check構成が一致しません');
}
