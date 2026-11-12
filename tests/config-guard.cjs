const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
for(const file of ['app.js','course-booking.js','course-booking-admin.js']){
 let initialized=false;
 const source=fs.readFileSync(path.resolve(__dirname,'..',file),'utf8').replace(/^import .*;\n/gm,'');
 const context={document:{documentElement:{dataset:{shiftlyEnvironment:'test'}},body:{}},firebaseConfig:{projectId:'shiftly-d02f6'},initializeApp:()=>{initialized=true}};
 assert.throws(()=>vm.runInNewContext(source,context),/本番|テスト用/);
 assert.equal(initialized,false);console.log('PASS production initialization blocked: '+file);
}
