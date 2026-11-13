// Offline browser regression tests: no production Firebase requests are allowed.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs');const http=require('node:http');const assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..');
const stub=`
const teacherWorkFeatureEnabled=false,normalAuthorityApiEnabled=false;
const initializeApp=()=>({}), getAuth=()=>({}),getFirestore=()=>({}),getFunctions=()=>({}),httpsCallable=()=>()=>{},initializeAppCheck=()=>{},ReCaptchaEnterpriseProvider=class{},onAuthStateChanged=()=>{},signInWithEmailAndPassword=()=>{},signOut=()=>{},firebaseConfig={},bookingAppCheckSiteKey='';
const collection=(...a)=>({path:a.filter(x=>typeof x==='string').join('/')}), doc=(...a)=>({path:a.map(x=>typeof x==='string'?x:x.path||'').filter(Boolean).join('/'),id: 'auto-'+(++window.seq)}),query=(c,...q)=>c,where=()=>{},serverTimestamp=()=>({timestamp:true}),onSnapshot=()=>()=>{},getDoc=async()=>({exists:()=>false}),setDoc=()=>{},deleteDoc=()=>{},updateDoc=()=>{},runTransaction=()=>{},increment=()=>{},arrayUnion=()=>{},Timestamp=class{},orderBy=()=>{},limit=()=>{};
const getDocs=async ref=>{if(window.pauseReads)await new Promise(r=>window.resumeRead=r);return {docs:(ref.path==='timetableEntries'?state.entries:Object.values(state.teacherAbsences)).map(e=>({id:e.id,data:()=>{const {id,...data}=e;return data}}))}};
const writeBatch=()=>{const ops=[];return {set:(r,d)=>ops.push(['set',r.path,d]),update:(r,d)=>ops.push(['update',r.path,d]),delete:r=>ops.push(['delete',r.path]),commit:async()=>{window.writes.push(...ops);for(const [op,path,data]of ops){const id=path.split('/').at(-1);if(path.startsWith('timetableEntries/')){let old=state.entries.find(e=>e.id===id);if(old)Object.assign(old,data);else state.entries.push({id,...data});}if(path.startsWith('teacherDayAbsences/')){if(op==='delete')delete state.teacherAbsences[id];else state.teacherAbsences[id]={id,...data};}if(path.startsWith('specialCourses/'))Object.assign(state.courses.find(e=>e.id===id),data);}}}};
window.seq=0;window.writes=[];
`;
let app=fs.readFileSync(root+'/app.js','utf8').replace(/^import .*;\n/gm,'');
app=`import {installNormalEditor} from '/normal-editor.js';\nimport {installTeacherWorkPage} from '/teacher-work.js';\nimport {createNormalAuthorityClient} from '/normal-authority-client.js';\n`+stub+app+`\nwindow.test={state,nav,regularEditor,visibleLessonsOnDate,lessonsOnDate,renderCourses,renderAvailabilityPage,renderCourseEditor,setCourseArchived,courseDisplayName};`;
const server=http.createServer((req,res)=>{const path=req.url.split('?')[0];res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');try{res.end(path==='/app.js'?app:fs.readFileSync(root+(path==='/'?'/index.html':path)))}catch{res.statusCode=404;res.end('')}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));
for(const [name,type]of Object.entries({chromium,webkit})){
console.log('starting '+name);let browser;try{browser=await type.launch({headless:true,...(name==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}: {})});}catch(e){console.log(name+' unavailable: '+e.message);continue;}
console.log('launched '+name);const context=await browser.newContext({viewport:{width:1024,height:1366},hasTouch:true,isMobile:true});
const page=await context.newPage();const errors=[];page.on('console',m=>{if(m.type()==='error')console.log('browser:',m.text())});page.setDefaultTimeout(10000);page.on('pageerror',e=>{errors.push(e.message);console.log('pageerror',e.message)});
await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
page.on('dialog',d=>d.accept());
console.log('opening app');await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.test);
await page.evaluate(()=>{const {state:s,nav}=test;Object.assign(s,{user:{uid:'mgr'},profile:{role:'admin'},date:'2026-11-12',people:[{id:'a',name:'講師A',role:'employee'},{id:'b',name:'講師B',role:'employee'},{id:'mgr',name:'管理者',role:'owner'}],students:[{id:'s',name:'生徒S',regularSlots:{r:{id:'r',weekday:4,start:'19:30',end:'21:25',teacherUid:'a',subject:'数学'}}}],entriesStatus:'ready',coursesStatus:'ready',closuresStatus:'ready',openDaysStatus:'ready',examStatus:'ready',teacherAbsencesStatus:'ready'});document.getElementById('appPanel').hidden=false;document.getElementById('loginPanel').hidden=true;nav('adminLessons');});
const cell=(uid,p)=>page.locator(`.normal-cell[data-uid="${uid}"][data-period="${p}"]`);
// Stage only period 3 as absent; period 4 stays available.
await page.getByRole('button',{name:'講師A',exact:true}).click();await page.locator('#normalAbsenceOptions input[value="3"]').check();await page.locator('#normalAbsenceForm button[type=submit]').click();
assert.equal(await cell('a',3).getAttribute('class'),'normal-cell is-absent');assert.equal(await cell('a',4).getAttribute('class'),'normal-cell');
assert.equal(await page.evaluate(()=>writes.length),0);
// Continuous booking must refuse destination if either constituent period absent.
await page.getByRole('button',{name:'講師B',exact:true}).click();await page.locator('#normalAbsenceOptions input[value="4"]').check();await page.locator('#normalAbsenceForm button[type=submit]').click();
await cell('a',3).locator('.normal-entry').click();await cell('b',3).click();assert.equal(await cell('a',3).locator('.normal-entry').count(),1);
await page.locator('#normalUndo').click(); // Undo B absence.
// Touch pointer drag from black source to available B (real browser hit testing).
if(name==='chromium'){
const cdp=await context.newCDPSession(page);
const from=await cell('a',3).locator('.normal-entry').boundingBox(),to=await cell('b',3).boundingBox();
const point={x:from.x+20,y:from.y+20};
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+(to.x+30-point.x)*i/8,y:point.y+(to.y+30-point.y)*i/8}]});
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}else{
await cell('a',3).locator('.normal-entry').evaluate(el=>{const r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,pointerId:10,pointerType:'touch',clientX:r.x+15,clientY:r.y+15}));const t=document.querySelector('.normal-cell[data-uid="b"][data-period="3"]').getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,isPrimary:true,pointerId:10,pointerType:'touch',clientX:t.x+25,clientY:t.y+25}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,isPrimary:true,pointerId:10,pointerType:'touch',clientX:t.x+25,clientY:t.y+25}));});
}
assert.equal(await cell('b',3).locator('.normal-entry').count(),1);
// The first tap after drag must select, rather than being swallowed.
await cell('b',3).locator('.normal-entry').click();assert.equal(await cell('b',3).locator('.is-selected').count(),1);
await page.locator('#normalUndo').click();assert.equal(await cell('a',3).locator('.normal-entry').count(),1);
// Save absence alone; warning must be specific to the split period.
await page.locator('#normalPublish').click();await page.waitForFunction(()=>writes.some(x=>x[1].startsWith('teacherDayAbsences/')));
assert.deepEqual(await page.evaluate(()=>test.visibleLessonsOnDate('2026-11-12').map(x=>x.teacherAbsent)),[true,false]);
// Tap reassignment; block date and navigation during async save.
await cell('a',3).locator('.normal-entry').click();await cell('b',3).click();await page.evaluate(()=>pauseReads=true);await page.locator('#normalPublish').click();assert.equal(await page.locator('#normalNext').isDisabled(),true);
await page.evaluate(()=>test.nav('adminSchedule'));assert.equal(await page.evaluate(()=>test.state.page),'adminLessons');
await page.evaluate(()=>{pauseReads=false;resumeRead()});await page.waitForFunction(()=>!test.regularEditor.isBusy());
assert.deepEqual(await page.evaluate(()=>test.lessonsOnDate('2026-11-12').map(e=>e.teacherUid)),['b']);
assert.deepEqual(await page.evaluate(()=>test.lessonsOnDate('2026-11-19').map(e=>e.teacherUid)),['a']);
assert.equal(await page.evaluate(()=>test.state.students[0].regularSlots.r.teacherUid),'a');
assert.equal(await page.evaluate(()=>writes.some(x=>x[1].startsWith('schoolStudents/'))),false);
assert.equal(await page.evaluate(()=>writes.filter(x=>x[1].startsWith('notifications/')).length),2);
// Capacity and concurrent changes while the preflight read is pending.
await page.evaluate(()=>{const s=test.state;s.entries.push(...['p','q'].map(id=>({id,studentId:id,studentName:id,date:s.date,start:'19:30',end:'20:25',teacherUid:'a',teacherName:'講師A',status:'scheduled'})));s.teacherAbsences={};test.regularEditor.onData();});
await cell('b',3).locator('.normal-entry').click();await cell('a',3).click();assert.equal(await cell('b',3).locator('.normal-entry').count(),1);
await page.evaluate(()=>{test.state.entries=test.state.entries.filter(e=>!['p','q'].includes(e.id));test.regularEditor.onData();});
await cell('b',3).locator('.normal-entry').click();await cell('a',3).click();
const beforeConflict=await page.evaluate(()=>writes.length);
await page.evaluate(()=>pauseReads=true);await page.locator('#normalPublish').click();
await page.evaluate(()=>{test.state.entries[0].teacherName='別端末の変更';pauseReads=false;resumeRead()});
await page.waitForFunction(()=>!test.regularEditor.isBusy());assert.equal(await page.evaluate(()=>writes.length),beforeConflict);
await page.locator('#normalDiscard').click();
// Instructor view only shows that instructor's assigned day override.
await page.evaluate(()=>{test.state.profile={role:'employee'};test.state.user={uid:'b'};document.getElementById('teacherFilter').value='mine';});
assert.deepEqual(await page.evaluate(()=>test.visibleLessonsOnDate('2026-11-12').map(e=>e.teacherUid)),['b','b']);
await page.evaluate(()=>{test.state.profile={role:'admin'};test.state.user={uid:'mgr'};});
// Course archive/restore keeps lesson and availability data; hides both selectors.
await page.evaluate(()=>{const s=test.state;s.courses=[{id:'old',name:'冬季講習',startDate:'2025-12-20',endDate:'2026-01-10',periods:[{start:'17:30',end:'18:25'}]}];s.courses[0].availabilityDeadline={toDate:()=>new Date('2030-01-01T00:00:00Z')};s.availability=new Map([['old/a',{slots:[]}]]);s.availabilityStatus.old='ready';test.nav('availability');});
assert.match(await page.locator('#availabilityPeriodOverview').innerText(),/受付中/);assert.match(await page.locator('#availabilityPeriodOverview').innerText(),/提出済み/);assert.equal(await page.locator('#availabilityHomePanel').isHidden(),true);
await page.evaluate(()=>test.nav('courses'));
await page.getByRole('button',{name:'非表示にする',exact:true}).click();await page.waitForFunction(()=>test.state.courses[0].archived===true);
await page.evaluate(()=>test.nav('availability'));assert.equal(await page.locator('#availabilityCourse option').count(),0);assert.equal(await page.locator('#availabilityPeriodOverview').innerText(),'');
await page.evaluate(()=>test.nav('courseEditor'));assert.equal(await page.locator('#editorCourse option').count(),0);
await page.evaluate(()=>test.nav('courses'));await page.getByRole('button',{name:/非表示一覧/}).click();await page.getByRole('button',{name:'↩ 再表示する'}).click();await page.waitForFunction(()=>test.state.courses[0].archived===false);
assert.equal(await page.evaluate(()=>test.state.availability.has('old/a')),true);
assert.equal(await page.evaluate(()=>test.courseDisplayName(test.state.courses[0])),'2025年度 冬期講習');
assert.deepEqual(errors,[]);console.log(name+': PASS absence staging, blocked destination, touch drag, next tap, undo, split warnings, save guard, daily override, weekly preservation, notifications, archive/restore');
await browser.close();}
server.close();})().catch(e=>{console.error(e);server.close();process.exit(1)});
