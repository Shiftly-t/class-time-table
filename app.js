import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const $ = id => document.getElementById(id);
const todayKey = () => dateKey(new Date());
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const datePlus = (value, increment) => { const [y,m,d] = value.split('-').map(Number); return dateKey(new Date(y,m-1,d+increment)); };
const prettyDate = value => { if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')) return value||''; const [y,m,d] = value.split('-').map(Number); return `${m}月${d}日（${'日月火水木金土'[new Date(y,m-1,d).getDay()]}）`; };
const isAdmin = () => state.profile?.role === 'admin';
const state = { user:null, profile:null, date:todayKey(), month:todayKey().slice(0,7), page:'', students:[], people:[], entries:[], targets:[], notices:[], activeLesson:null, unsub:[] };
let messageTimer;
function showMessage(message) { $('message').textContent=message; clearTimeout(messageTimer); if(message) messageTimer=setTimeout(()=>$('message').textContent='',7000); }
function trapError(e, fallback='処理に失敗しました') { console.error(e); showMessage(`${fallback}${e?.code ? '（'+e.code+'）' : ''}`); }
function make(tag, className='', text='') { const node=document.createElement(tag); if(className) node.className=className; if(text!==undefined && text!==null) node.textContent=String(text); return node; }
function cell(row,value,className='') { const td=make('td',className,value); row.append(td); return td; }
function showDialog(id) { $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>closeDialog(button.dataset.close)));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));
function resetSubscriptions(){state.unsub.forEach(fn=>fn());state.unsub=[];}
function nav(page) {
  state.page=page;
  $('adminCountPage').hidden=page!=='count';
  $('teacherStudentsPage').hidden=page!=='students';
  $('lessonsPage').hidden=page==='count'||page==='students';
  for(const [id,p] of [['navCount','count'],['navAdminLessons','adminLessons'],['navTeacherLessons','teacherLessons'],['navTeacherStudents','students']]) $(''+id).classList.toggle('active',page===p);
  if(page==='count')renderCount();
  else if(page==='students')renderTeacherStudents();
  else {
    $('scheduleHeading').textContent=isAdmin()?'授業管理':'今日の時間割';
    $('scheduleDescription').textContent=isAdmin()?'全教師の授業を確認・変更できます。':'自分と他の教師の授業を切り替えて確認・編集できます。';
    renderLessons();
  }
}
$('navCount').addEventListener('click',()=>nav('count'));
$('navAdminLessons').addEventListener('click',()=>nav('adminLessons'));
$('navTeacherLessons').addEventListener('click',()=>nav('teacherLessons'));
$('navTeacherStudents').addEventListener('click',()=>nav('students'));
$('teacherFilter').addEventListener('change',renderLessons);
$('teacherStudentSearch').addEventListener('input',renderTeacherStudents);
$('prevDay').addEventListener('click',()=>{state.date=datePlus(state.date,-1);renderLessons();});
$('nextDay').addEventListener('click',()=>{state.date=datePlus(state.date,1);renderLessons();});
$('today').addEventListener('click',()=>{state.date=todayKey();renderLessons();});
$('countMonth').addEventListener('change',()=>{state.month=$('countMonth').value||todayKey().slice(0,7);renderCount();});
$('studentSearch').addEventListener('input',renderCount);
function renderAll() { if(!state.user) return; renderLessons(); if(isAdmin())renderCount(); else renderTeacherStudents(); renderNoticeButton(); }
function renderLessons() {
  if(!state.user) return;
  $('displayDate').textContent=prettyDate(state.date);
  const parent=$('lessonList'); parent.replaceChildren();
  const rows=state.entries.filter(e=>e.date===state.date && (isAdmin() || $('teacherFilter').value==='all' || e.teacherUid===state.user.uid)).sort((a,b)=>a.start.localeCompare(b.start)||a.teacherName.localeCompare(b.teacherName)||a.studentName.localeCompare(b.studentName));
  if(!rows.length){parent.append(make('div','empty','この日の授業はありません。'));return;}
  let lastTime='';
  for(const item of rows){
    const time=`${item.start} – ${item.end}`;
    if(time!==lastTime){parent.append(make('div','time-group-title',time)); lastTime=time;}
    const card=make('button','lesson-card');card.type='button';
    const headline=make('div','lesson-topline');headline.append(make('span','lesson-time',time));
    const st=item.status==='done'?'実施済':item.status==='cancelled'?'休講':'予定';headline.append(make('span','state-tag',st));card.append(headline);
    card.append(make('div','lesson-student',`${item.grade||''} ${item.studentName||'生徒名未登録'}`));
    card.append(make('div','lesson-meta',`${item.subject||'教科未登録'}　/　${item.teacherName||'担当教師未登録'}`));
    if(item.memo?.trim())card.append(make('div','memo-preview',item.memo.length>170?item.memo.slice(0,170)+'…':item.memo));
    else card.append(make('div','lesson-meta','伝達事項なし'));
    card.addEventListener('click',()=>openLessonDetail(item.id));parent.append(card);
  }
}
function renderTeacherStudents(){
  if(isAdmin()||!state.user)return;
  const parent=$('teacherStudentList'); parent.replaceChildren();
  const search=$('teacherStudentSearch').value.trim().toLowerCase();
  const students=state.students.filter(s=>[s.name,s.grade,s.school,s.regular,s.textbook].join(' ').toLowerCase().includes(search)).sort((a,b)=>(a.grade||'').localeCompare(b.grade||'','ja')||(a.name||'').localeCompare(b.name||'','ja'));
  if(!students.length){parent.append(make('div','empty',search?'該当する生徒はいません。':'登録された生徒はいません。'));return;}
  for(const s of students){
    const card=make('article','student-directory-card');
    card.append(make('h3','',s.name||'生徒名未登録'));
    card.append(make('p','',[s.grade,s.school].filter(Boolean).join(' / ')||'学年・学校の登録なし'));
    for(const [label,value] of [['通常授業',s.regular],['教材',s.textbook],['備考',s.remarks]]){
      if(!value)continue;
      card.append(make('div','directory-label',label));
      card.append(make('p','',value));
    }
    parent.append(card);
  }
}
function renderCount(){
  if(!isAdmin())return;
  $('countMonth').value=state.month;
  $('studentTotal').textContent=state.students.length;
  const monthEntries=state.entries.filter(e=>e.date?.startsWith(state.month));
  $('completedTotal').textContent=monthEntries.filter(e=>e.status==='done').length;
  $('scheduledTotal').textContent=monthEntries.filter(e=>e.status==='scheduled').length;
  const search=$('studentSearch').value.trim().toLowerCase();
  const filtered=state.students.filter(s=>[s.name,s.grade,s.school].join(' ').toLowerCase().includes(search)).sort((a,b)=>(a.grade||'').localeCompare(b.grade||'','ja')||(a.name||'').localeCompare(b.name||'','ja'));
  const tbody=$('countRows');tbody.replaceChildren();
  if(!filtered.length){const tr=make('tr');const td=cell(tr,search?'該当する生徒がいません':'生徒がまだ登録されていません');td.colSpan=8;tbody.append(tr);return;}
  for(const student of filtered){
    const related=monthEntries.filter(e=>e.studentId===student.id);
    const done=related.filter(e=>e.status==='done').length;
    const scheduled=related.filter(e=>e.status==='scheduled').length;
    const target=state.targets.find(t=>t.studentId===student.id && t.month===state.month)?.target;
    const tr=make('tr');
    cell(tr,student.name);cell(tr,[student.grade,student.school].filter(Boolean).join(' / '));cell(tr,student.regular||'―');
    const targetCell=cell(tr,target??'未設定');
    const targetBtn=make('button','mini-button','設定');targetBtn.type='button';targetBtn.addEventListener('click',()=>openTarget(student.id));targetCell.append(targetBtn);
    cell(tr,done,'count-good');cell(tr,scheduled);
    cell(tr,Number.isInteger(target)?Math.max(target-done,0):'―',Number.isInteger(target)&&done>target?'count-bad':'');
    const action=cell(tr,'');const edit=make('button','mini-button','編集');edit.type='button';edit.addEventListener('click',()=>openStudent(student.id));action.append(edit);tbody.append(tr);
  }
}
function renderNoticeButton(){
  if(isAdmin())return;
  const unread=state.notices.filter(n=>!n.read).length;
  $('noticeCount').hidden=unread===0;$('noticeCount').textContent=unread>99?'99+':unread;
}
function renderNotifications(){
  const parent=$('notificationList');parent.replaceChildren();
  if(!state.notices.length){parent.append(make('div','empty','新しいお知らせはありません。'));return;}
  for(const n of [...state.notices].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).slice(0,50)){
    const node=make('div','notification'+(n.read?'':' unread'));node.append(make('strong','',n.message||'授業が変更されました'));
    const time=n.createdAt?.toDate?.();node.append(make('small','',time?time.toLocaleString('ja-JP'):'日時情報なし'));
    if(!n.read){const btn=make('button','mini-button','確認済みにする');btn.type='button';btn.addEventListener('click',async()=>{try{await updateDoc(doc(db,'notifications',state.user.uid,'items',n.id),{read:true});}catch(e){trapError(e,'通知の更新に失敗しました')}});node.append(btn);}
    parent.append(node);
  }
}
$('notificationButton').addEventListener('click',()=>{renderNotifications();showDialog('notificationDialog');});
function openStudent(id){
  const student=state.students.find(s=>s.id===id);
  $('studentForm').reset();$('studentId').value=id||'';$('studentDialogTitle').textContent=student?'生徒情報を編集':'生徒を登録';$('deleteStudent').hidden=!student;
  for(const [field,key] of [['studentName','name'],['studentGrade','grade'],['studentSchool','school'],['studentRegular','regular'],['studentTextbook','textbook'],['studentRemarks','remarks']])$(field).value=student?.[key]||'';
  showDialog('studentDialog');
}
$('addStudent').addEventListener('click',()=>openStudent(''));
async function updateStudentEntryLabels(studentId, studentData){
  const docs=await getDocs(query(collection(db,'timetableEntries'),where('studentId','==',studentId)));
  let batch=writeBatch(db),count=0;
  for(const snapshot of docs.docs){
    batch.update(snapshot.ref,{studentName:studentData.name,grade:studentData.grade,school:studentData.school});count++;
    if(count===400){await batch.commit();batch=writeBatch(db);count=0;}
  }
  if(count)await batch.commit();
  const recipients=[...new Set(docs.docs.filter(d=>d.data().date>=todayKey()).map(d=>d.data().teacherUid).filter(Boolean))];
  await sendNotifications(recipients,'担当生徒の情報が更新されました',state.date);
}
$('studentForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin())return;
  const id=$('studentId').value||doc(collection(db,'schoolStudents')).id;
  const data={name:$('studentName').value.trim(),grade:$('studentGrade').value.trim(),school:$('studentSchool').value.trim(),regular:$('studentRegular').value.trim(),textbook:$('studentTextbook').value.trim(),remarks:$('studentRemarks').value.trim()};
  if(!data.name||!data.grade){showMessage('生徒名と学年を入力してください。');return;}
  const button=event.submitter;button.disabled=true;
  try{await setDoc(doc(db,'schoolStudents',id),data);if($('studentId').value)await updateStudentEntryLabels(id,data);closeDialog('studentDialog');showMessage('生徒情報を保存しました。');}
  catch(e){trapError(e,'生徒情報の保存に失敗しました');}finally{button.disabled=false;}
});
$('deleteStudent').addEventListener('click',async()=>{
  if(!isAdmin())return;
  const id=$('studentId').value;const matches=await getDocs(query(collection(db,'timetableEntries'),where('studentId','==',id)));
  if(!matches.empty){showMessage('この生徒の授業が残っています。先に授業を削除してください。');return;}
  if(!confirm('生徒情報を削除しますか？'))return;
  try{await deleteDoc(doc(db,'schoolStudents',id));closeDialog('studentDialog');showMessage('生徒情報を削除しました。');}catch(e){trapError(e,'削除に失敗しました');}
});
function openTarget(id){const student=state.students.find(s=>s.id===id);if(!student)return;
 $('targetStudentId').value=id;$('targetStudentName').textContent=student.name;$('targetMonth').value=state.month;
 const target=state.targets.find(t=>t.studentId===id&&t.month===state.month);$('targetCount').value=target?.target??0;showDialog('targetDialog');
}
$('targetForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!isAdmin())return;
  const studentId=$('targetStudentId').value,month=$('targetMonth').value,target=Number($('targetCount').value);
  if(!/^\d{4}-\d{2}$/.test(month)||!Number.isInteger(target)||target<0||target>200){showMessage('対象月と回数を確認してください。');return;}
  try{await setDoc(doc(db,'monthlyTargets',`${month}_${studentId}`),{studentId,month,target});state.month=month;closeDialog('targetDialog');showMessage('月別の目標回数を保存しました。');}
  catch(error){trapError(error,'保存に失敗しました');}
});
function selectOptions(select, array, labelFn){select.replaceChildren();for(const o of array){const option=make('option','',labelFn(o));option.value=o.id;select.append(option);}}
function openLessonForm(id=''){
  if(!isAdmin()&&!id)return;
  if(!state.students.length||!state.people.length){showMessage('先に生徒と担当教師のアカウントを登録してください。');return;}
  const lesson=state.entries.find(e=>e.id===id);
  if(!isAdmin()&&!lesson)return;
  $('lessonForm').reset();$('lessonId').value=id;$('lessonFormTitle').textContent=lesson?'授業を編集':'授業を登録';$('deleteLesson').hidden=!lesson||!isAdmin();
  selectOptions($('lessonStudent'),state.students,s=>`${s.grade||''} ${s.name}`);
  selectOptions($('lessonTeacher'),state.people,p=>`${p.name||p.id}${p.role==='admin'?'（管理者）':''}`);
  if(lesson){$('lessonStudent').value=lesson.studentId;$('lessonTeacher').value=lesson.teacherUid;}
  $('lessonDate').value=lesson?.date||state.date;$('lessonStart').value=lesson?.start||'17:30';$('lessonEnd').value=lesson?.end||'18:25';$('lessonSubject').value=lesson?.subject||'';$('lessonStatus').value=lesson?.status||'scheduled';
  showDialog('lessonFormDialog');
}
$('addLesson').addEventListener('click',()=>openLessonForm());
async function sendNotifications(uids,message,date,batch=null){
  const unique=[...new Set(uids.filter(Boolean))];
  if(!unique.length)return;
  const targetBatch=batch||writeBatch(db);
  for(const uid of unique){const ref=doc(collection(db,'notifications',uid,'items'));targetBatch.set(ref,{message,date,read:false,createdAt:serverTimestamp()});}
  if(!batch)await targetBatch.commit();
}
async function syncUpcoming(studentId){
  if(!studentId)return;
  const snap=await getDocs(query(collection(db,'timetableEntries'),where('studentId','==',studentId)));
  const records=snap.docs.map(d=>({id:d.id,...d.data()}));
  const planned=records.filter(e=>e.status!=='cancelled').sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
  let batch=writeBatch(db),count=0;
  for(const entry of records){
    const dates=[...new Set(planned.filter(e=>e.date>entry.date).map(e=>e.date))].slice(0,2);
    if(JSON.stringify(entry.nextDates||[])===JSON.stringify(dates))continue;
    batch.update(doc(db,'timetableEntries',entry.id),{nextDates:dates});count++;
    if(count===400){await batch.commit();batch=writeBatch(db);count=0;}
  }
  if(count)await batch.commit();
}
$('lessonForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin()&&!$('lessonId').value)return;
  const id=$('lessonId').value||doc(collection(db,'timetableEntries')).id;
  const old=state.entries.find(e=>e.id===id);
  if(!isAdmin()&&!old){showMessage('既存授業のみ編集できます。');return;}
  const student=state.students.find(s=>s.id===$('lessonStudent').value);
  const teacher=state.people.find(p=>p.id===$('lessonTeacher').value);
  const date=$('lessonDate').value,start=$('lessonStart').value,end=$('lessonEnd').value;
  if(!student||!teacher||!date||!start||!end||start>=end){showMessage('入力内容と授業時間を確認してください。');return;}
  const data={studentId:student.id,studentName:student.name,grade:student.grade,school:student.school,teacherUid:teacher.id,teacherName:teacher.name,date,start,end,subject:$('lessonSubject').value.trim(),status:$('lessonStatus').value,memo:old?.memo||'',memoUpdatedAt:old?.memoUpdatedAt||null,nextDates:old?.nextDates||[]};
  if(!data.subject){showMessage('教科を入力してください。');return;}
  const btn=event.submitter;btn.disabled=true;
  try{
    if(isAdmin()){
      const batch=writeBatch(db);batch.set(doc(db,'timetableEntries',id),data);
      const affected=[teacher.id];if(old?.teacherUid&&old.teacherUid!==teacher.id)affected.push(old.teacherUid);
      await sendNotifications(affected,old?'担当授業の予定が更新されました':'新しい担当授業が登録されました',date,batch);
      await batch.commit();
    } else {
      await updateDoc(doc(db,'timetableEntries',id),data);
    }
    await syncUpcoming(student.id);if(old?.studentId&&old.studentId!==student.id)await syncUpcoming(old.studentId);
    closeDialog('lessonFormDialog');showMessage(isAdmin()?'授業を保存し、関係する担当教師に通知しました。':'授業の変更を保存しました。');
  }catch(e){trapError(e,'授業の保存に失敗しました');}finally{btn.disabled=false;}
});
$('deleteLesson').addEventListener('click',async()=>{
  if(!isAdmin())return;
  const old=state.entries.find(e=>e.id===$('lessonId').value);if(!old)return;
  if(!confirm('この授業を削除しますか？'))return;
  try{
    const batch=writeBatch(db);batch.delete(doc(db,'timetableEntries',old.id));
    await sendNotifications([old.teacherUid],'担当授業が削除されました',old.date,batch);
    await batch.commit();await syncUpcoming(old.studentId);
    closeDialog('lessonFormDialog');showMessage('授業を削除しました。');
  }catch(e){trapError(e,'授業の削除に失敗しました');}
});
function openLessonDetail(id){
  const lesson=state.entries.find(e=>e.id===id);if(!lesson)return;
  state.activeLesson=id;
  $('detailTitle').textContent=lesson.studentName||'授業詳細';
  $('detailDate').textContent=`${prettyDate(lesson.date)} ${lesson.start}〜${lesson.end}`;
  $('detailSubject').textContent=lesson.subject;
  $('detailTeacher').textContent=lesson.teacherName;
  $('detailGrade').textContent=[lesson.grade,lesson.school].filter(Boolean).join(' / ');
  const dates=$('futureDates');dates.replaceChildren();
  if(Array.isArray(lesson.nextDates)&&lesson.nextDates.length){lesson.nextDates.forEach((date,i)=>dates.append(make('div','future-date',`${i===0?'次回':'次々回'}：${prettyDate(date)}`)));}
  else dates.append(make('div','future-date','今後の来塾予定はまだ登録されていません。'));
  $('memoContent').value=lesson.memo||'';$('editLesson').hidden=false;showDialog('detailDialog');
}
$('editLesson').addEventListener('click',()=>{const id=state.activeLesson;closeDialog('detailDialog');openLessonForm(id);});
$('memoForm').addEventListener('submit',async event=>{
  event.preventDefault();const lesson=state.entries.find(e=>e.id===state.activeLesson);if(!lesson)return;
  const content=$('memoContent').value.trim();const button=event.submitter;button.disabled=true;
  try{
    if(isAdmin()){
      const batch=writeBatch(db);
      batch.update(doc(db,'timetableEntries',lesson.id),{memo:content,memoUpdatedAt:serverTimestamp()});
      await sendNotifications([lesson.teacherUid],'担当授業の伝達事項が更新されました',lesson.date,batch);
      await batch.commit();
    } else {
      await updateDoc(doc(db,'timetableEntries',lesson.id),{memo:content,memoUpdatedAt:serverTimestamp()});
    }
    closeDialog('detailDialog');showMessage('伝達事項を保存しました。時間割にも反映されます。');
  }
  catch(e){trapError(e,'メモの保存に失敗しました');}finally{button.disabled=false;}
});
function loggedOut(){
  resetSubscriptions();state.user=null;state.profile=null;state.entries=[];state.students=[];state.people=[];state.notices=[];state.targets=[];
  $('loginPanel').hidden=false;$('appPanel').hidden=true;$('logout').hidden=true;$('notificationButton').hidden=true;$('identity').textContent='';$('password').value='';
  for(const d of document.querySelectorAll('dialog'))if(d.open)d.close();
}
async function loggedIn(user){
  resetSubscriptions();state.user=user;
  const profileSnap=await getDoc(doc(db,'users',user.uid));
  if(!profileSnap.exists()||!['admin','employee'].includes(profileSnap.data().role)){showMessage('利用者登録がありません。管理者に連絡してください。');await signOut(auth);return;}
  if(auth.currentUser?.uid!==user.uid)return;
  state.profile=profileSnap.data();
  const name=state.profile.name?.trim()||user.email||'ユーザー';
  $('welcomeName').textContent=`ようこそ、${name}さん`;
  $('identity').textContent=`${name}（${isAdmin()?'管理者':'教師'}）`;
  $('welcomeSub').textContent=isAdmin()?'生徒情報と授業の状況をまとめて管理できます。':'今日の授業・全教師の時間割・生徒情報を確認できます。';
  $('loginPanel').hidden=true;$('appPanel').hidden=false;$('logout').hidden=false;
  $('navCount').hidden=!isAdmin();$('navAdminLessons').hidden=!isAdmin();$('navTeacherLessons').hidden=isAdmin();$('navTeacherStudents').hidden=isAdmin();$('addLesson').hidden=!isAdmin();$('notificationButton').hidden=isAdmin();$('teacherFilterWrap').hidden=isAdmin();
  $('teacherFilter').value='mine';state.date=todayKey();state.month=state.date.slice(0,7);
  state.unsub.push(onSnapshot(collection(db,'schoolStudents'),snap=>{state.students=snap.docs.map(d=>({id:d.id,...d.data()}));if(isAdmin())renderCount();else renderTeacherStudents();},err=>trapError(err,'生徒情報を取得できません')));
  state.unsub.push(onSnapshot(collection(db,'users'),snap=>{state.people=snap.docs.map(d=>({id:d.id,...d.data()}));},err=>trapError(err,'教師情報を取得できません')));
  state.unsub.push(onSnapshot(collection(db,'timetableEntries'),snap=>{state.entries=snap.docs.map(d=>({id:d.id,...d.data()}));renderAll();},err=>trapError(err,'時間割を取得できません')));
  if(isAdmin()){
    state.unsub.push(onSnapshot(collection(db,'monthlyTargets'),snap=>{state.targets=snap.docs.map(d=>({id:d.id,...d.data()}));renderCount();},err=>trapError(err,'月別回数を取得できません')));
    nav('count');
  } else {
    state.unsub.push(onSnapshot(collection(db,'notifications',user.uid,'items'),snap=>{state.notices=snap.docs.map(d=>({id:d.id,...d.data()}));renderNoticeButton();if($('notificationDialog').open)renderNotifications();},err=>trapError(err,'通知を取得できません')));
    nav('teacherLessons');
  }
}
$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;
  try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);}
  catch(e){showMessage('ログインできません。メールアドレスとパスワードを確認してください。');}finally{button.disabled=false;}
});
$('logout').addEventListener('click',async()=>{try{await signOut(auth);}catch(e){trapError(e,'ログアウトに失敗しました');}});
onAuthStateChanged(auth,user=>{if(!user)loggedOut();else loggedIn(user).catch(e=>{trapError(e,'ログイン後の読み込みに失敗しました');});});
