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
const state = { user:null, profile:null, date:todayKey(), page:'', students:[], people:[], entries:[], notices:[], activeLesson:null, unsub:[] };
const WEEKDAYS = ['日','月','火','水','木','金','土'];
const everySlot = student => Object.values(student.regularSlots || {}).filter(s=>s && typeof s==='object');
const slotDescription = s => `${WEEKDAYS[Number(s.weekday)]||'?'}曜 ${s.start}〜${s.end}`;
function formatRegular(slots){return Object.values(slots).map(slotDescription).join(' / ');}
const collator = new Intl.Collator('ja-JP', {numeric:true,sensitivity:'base'});
function gradeInfo(value=''){
  const raw=String(value||'').trim();
  // Examples: 小2 / 小学2年 / 小学校2年 / 中3 / 中学3年 / 高校1年.
  const m=raw.match(/^(小学生|小学(?:校)?|小|中学生|中学(?:校)?|中|高校生|高校|高)\s*([1-6一二三四五六１-６]?)/);
  if(!m)return {level:'other',rank:3,year:99};
  const prefix=m[1];const level=prefix.startsWith('小')?'elementary':prefix.startsWith('中')?'middle':'high';
  const ranks={elementary:0,middle:1,high:2};
  const numerals={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6};
  const year=m[2]?Number(m[2].normalize('NFKC'))||numerals[m[2]]||99:99;
  return {level,rank:ranks[level],year};
}
function sortedStudents(students, search, level, sort){
  const term=(search||'').trim().toLocaleLowerCase('ja');
  const list=students.filter(s=>{
    if(level!=='all' && gradeInfo(s.grade).level!==level)return false;
    return [s.name,s.grade,s.school,s.textbook,s.remarks, s.regular].some(v=>String(v||'').toLocaleLowerCase('ja').includes(term));
  });
  const name=(a,b)=>collator.compare(a.name||'',b.name||'');
  list.sort((a,b)=>{
    const ag=gradeInfo(a.grade),bg=gradeInfo(b.grade);
    if(sort==='nameAsc')return name(a,b);
    if(sort==='nameDesc')return name(b,a);
    if(sort==='schoolAsc')return collator.compare(a.school||'',b.school||'')||name(a,b);
    if(sort==='lessonCountDesc')return everySlot(b).length-everySlot(a).length||name(a,b);
    const gradeOrder=ag.rank-bg.rank||ag.year-bg.year||collator.compare(a.grade||'',b.grade||'')||name(a,b);
    return sort==='gradeDesc'?-gradeOrder:gradeOrder;
  });
  return list;
}
function regularDescription(student){
  const slots=everySlot(student);
  if(!slots.length)return student.regular||'―';
  return slots.sort((a,b)=>Number(a.weekday)-Number(b.weekday)||a.start.localeCompare(b.start))
    .map(slot=>{
      const teacher=state.people.find(p=>p.id===slot.teacherUid);
      return `${slotDescription(slot)}　${slot.subject||''} / ${teacher?.name||'担当未登録'}`;
    }).join('\n');
}

// A regular occurrence may have been saved as a separate Firestore document when
// someone edited that day's lesson or memo. If its parent weekly slot is later
// removed or moved to another weekday, don't show the obsolete future lesson.
// Historical entries stay visible to preserve records, and independently added
// one-off lessons are never removed by changing a weekly schedule.
function isCurrentRegularOccurrence(entry){
  if(!entry.regularId)return true;
  const student=state.students.find(s=>s.id===entry.studentId);
  const slot=student?.regularSlots?.[entry.regularId];
  if(!slot)return false;
  const [year,month,day]=entry.date.split('-').map(Number);
  const weekday=new Date(year,month-1,day).getDay();
  return Number(slot.weekday)===weekday
    && (!slot.activeFrom || entry.date>=slot.activeFrom)
    && (!slot.activeUntil || entry.date<=slot.activeUntil);
}
function isVisibleEntry(entry){
  return !entry.regularId || entry.date<todayKey() || isCurrentRegularOccurrence(entry);
}
function lessonsOnDate(date){
  const stored = state.entries.filter(e=>e.date===date && isVisibleEntry(e));
  const storedIds = new Set(stored.map(e=>e.id));
  const weekday = new Date(...date.split('-').map((n,i)=>i===1?Number(n)-1:Number(n))).getDay();
  const result = [...stored];
  for(const s of state.students){
    for(const slot of everySlot(s)){
      if(Number(slot.weekday)!==weekday || (slot.activeFrom && date<slot.activeFrom) || (slot.activeUntil && date>slot.activeUntil))continue;
      const id=`rec_${s.id}_${slot.id}_${date}`;
      if(storedIds.has(id))continue;
      // Keep already-registered one-off lessons from appearing twice.
      if(stored.some(e=>e.studentId===s.id && e.start===slot.start && e.end===slot.end))continue;
      const teacher = state.people.find(p=>p.id===slot.teacherUid);
      result.push({id,regularId:slot.id,virtual:true,studentId:s.id,studentName:s.name,grade:s.grade,school:s.school,
        teacherUid:slot.teacherUid,teacherName:teacher?.name||'担当教師',date,start:slot.start,end:slot.end,
        subject:slot.subject,status:'scheduled',memo:'',nextDates:[]});
    }
  }
  return result;
}
function lessonById(id){return state.entries.find(e=>e.id===id) || lessonsOnDate(state.date).find(e=>e.id===id);}
function futureDatesForLesson(lesson){
  const dates=new Set(state.entries.filter(e=>e.studentId===lesson.studentId && e.date>lesson.date && e.status!=='cancelled' && isVisibleEntry(e)).map(e=>e.date));
  // 16 weeks is enough for recurring lessons; one-off distant dates are included above.
  for(let offset=1;offset<=112;offset++){
    const date=datePlus(lesson.date,offset);
    if(lessonsOnDate(date).some(e=>e.studentId===lesson.studentId && e.status!=='cancelled'))dates.add(date);
  }
  return [...dates].sort().slice(0,2);
}

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
$('teacherStudentLevel').addEventListener('change',renderTeacherStudents);
$('teacherStudentSort').addEventListener('change',renderTeacherStudents);
$('prevDay').addEventListener('click',()=>{state.date=datePlus(state.date,-1);renderLessons();});
$('nextDay').addEventListener('click',()=>{state.date=datePlus(state.date,1);renderLessons();});
$('today').addEventListener('click',()=>{state.date=todayKey();renderLessons();});
$('studentLevel').addEventListener('change',renderCount);
$('studentSort').addEventListener('change',renderCount);
$('studentSearch').addEventListener('input',renderCount);
function renderAll() { if(!state.user) return; renderLessons(); if(isAdmin())renderCount(); else renderTeacherStudents(); renderNoticeButton(); }
function renderLessons() {
  if(!state.user) return;
  $('displayDate').textContent=prettyDate(state.date);
  const parent=$('lessonList'); parent.replaceChildren();
  const rows=lessonsOnDate(state.date).filter(e=>(isAdmin() || $('teacherFilter').value==='all' || e.teacherUid===state.user.uid)).sort((a,b)=>a.start.localeCompare(b.start)||a.teacherName.localeCompare(b.teacherName)||a.studentName.localeCompare(b.studentName));
  if(!rows.length){parent.append(make('div','empty','この日の授業はありません。'));return;}
  let lastTime='';
  for(const item of rows){
    const time=`${item.start} – ${item.end}`;
    if(time!==lastTime){parent.append(make('div','time-group-title',time)); lastTime=time;}
    const card=make('button',item.status==='cancelled'?'lesson-card is-absent':'lesson-card');card.type='button';
    const headline=make('div','lesson-topline');headline.append(make('span','lesson-time',time));
    const st=item.status==='done'?'実施済':item.status==='cancelled'?'欠席':'予定';headline.append(make('span',item.status==='cancelled'?'state-tag absent-tag':'state-tag',st));
    headline.append(make('span','origin-tag',item.regularId?'通常授業':'個別登録'));card.append(headline);
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
  const students=sortedStudents(state.students,$('teacherStudentSearch').value,$('teacherStudentLevel').value,$('teacherStudentSort').value);
  $('teacherStudentResults').textContent=`${students.length}名を表示 / 全${state.students.length}名`;
  if(!students.length){parent.append(make('div','empty','条件に合う生徒がいません。'));return;}
  const groupOrder=['elementary','middle','high','other'];
  const labels={elementary:'小学生',middle:'中学生',high:'高校生',other:'その他・未分類'};
  let lastGroup='';
  for(const s of students){
    const group=gradeInfo(s.grade).level;
    if(['gradeAsc','gradeDesc'].includes($('teacherStudentSort').value) && group!==lastGroup){
      parent.append(make('div','directory-group-title',labels[group]));lastGroup=group;
    }
    const card=make('article','student-directory-card');
    card.append(make('h3','',s.name||'生徒名未登録'));
    card.append(make('p','',[s.grade,s.school].filter(Boolean).join(' / ')||'学年・学校の登録なし'));
    for(const [label,value] of [['通常授業',regularDescription(s)],['教材',s.textbook],['備考',s.remarks]]){
      if(!value||value==='―')continue;
      card.append(make('div','directory-label',label));card.append(make('p','',value));
    }
    parent.append(card);
  }
}
function renderCount(){
  if(!isAdmin())return;
  const search=$('studentSearch').value;
  const filtered=sortedStudents(state.students,search,$('studentLevel').value,$('studentSort').value);
  $('studentResults').textContent=`${filtered.length}名を表示 / 全${state.students.length}名`;
  const tbody=$('countRows');tbody.replaceChildren();
  if(!filtered.length){const tr=make('tr');const td=cell(tr,'条件に合う生徒がいません');td.colSpan=7;tbody.append(tr);return;}
  const labels={elementary:'小学生',middle:'中学生',high:'高校生',other:'その他・未分類'};
  let lastGroup='';
  for(const student of filtered){
    const group=gradeInfo(student.grade).level;
    if(['gradeAsc','gradeDesc'].includes($('studentSort').value) && group!==lastGroup){
      const groupRow=make('tr','group-row');const td=cell(groupRow,labels[group]);td.colSpan=7;tbody.append(groupRow);lastGroup=group;
    }
    const tr=make('tr');
    cell(tr,student.name||'―','student-name-cell');cell(tr,student.grade||'―');cell(tr,student.school||'―');
    cell(tr,regularDescription(student),'regular-cell');cell(tr,student.textbook||'―');cell(tr,student.remarks||'―','remarks-cell');
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
function addRegularRow(slot={}){
  const row=make('div','regular-row');row.dataset.slotId=slot.id||doc(collection(db,'schoolStudents')).id;
  const fields=[
    ['weekday','曜日','select'],['start','開始','time'],['end','終了','time'],
    ['teacherUid','担当教師','select'],['subject','教科','text'],['activeFrom','適用開始','date']
  ];
  for(const [key,label,type] of fields){
    const wrap=make('label','',label);
    const el=make(type==='select'?'select':'input');el.dataset.field=key;
    if(type!=='select')el.type=type;
    if(key==='weekday')WEEKDAYS.forEach((w,i)=>{const opt=make('option','',w+'曜日');opt.value=String(i);el.append(opt);});
    if(key==='teacherUid')state.people.filter(p=>p.role==='employee'||p.role==='admin').forEach(p=>{const opt=make('option','',p.name||'教師名未登録');opt.value=p.id;el.append(opt);});
    const defaultValue={weekday:'3',start:'17:30',end:'18:25',teacherUid:state.people.find(p=>p.role==='employee')?.id||state.people[0]?.id||'',subject:'',activeFrom:todayKey()};
    el.value=String(slot[key]??defaultValue[key]);
    if(key==='subject')el.placeholder='例：数学';
    el.required=true;wrap.append(el);row.append(wrap);
  }
  const remove=make('button','danger-soft','削除');remove.type='button';remove.addEventListener('click',()=>row.remove());row.append(remove);
  $('regularRows').append(row);
}
$('addRegularRow').addEventListener('click',()=>addRegularRow());
function collectRegularSlots(){
  const slots={};
  for(const row of $('regularRows').children){
    const info={id:row.dataset.slotId};
    for(const field of row.querySelectorAll('[data-field]'))info[field.dataset.field]=field.value.trim();
    info.weekday=Number(info.weekday);
    if(!info.teacherUid||!info.subject||!info.activeFrom||!info.start||!info.end||info.start>=info.end){throw Error('通常授業の曜日・時間・教師・教科・適用開始日を確認してください。');}
    slots[info.id]=info;
  }
  return slots;
}

function openStudent(id){
  const student=state.students.find(s=>s.id===id);
  $('studentForm').reset();$('studentId').value=id||'';$('studentDialogTitle').textContent=student?'生徒情報を編集':'生徒を登録';$('deleteStudent').hidden=!student;
  for(const [field,key] of [['studentName','name'],['studentGrade','grade'],['studentSchool','school'],['studentTextbook','textbook'],['studentRemarks','remarks']])$(field).value=student?.[key]||'';
  $('regularRows').replaceChildren();
  everySlot(student||{}).forEach(slot=>addRegularRow(slot));
  const note=$('legacyRegularNote');
  note.hidden=!(student?.regular && !everySlot(student).length);
  if(!note.hidden)note.textContent=`以前の通常予定：${student.regular}（旧形式のため、自動反映するには上の「通常授業を追加」で担当教師・教科も設定してください）`;
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
  const before=state.students.find(s=>s.id===id);
  let slots;try{slots=collectRegularSlots();}catch(error){showMessage(error.message);return;}
  const regular=Object.keys(slots).length?formatRegular(slots):(Object.keys(before?.regularSlots||{}).length?'':before?.regular||'');
  const data={name:$('studentName').value.trim(),grade:$('studentGrade').value.trim(),school:$('studentSchool').value.trim(),regular,regularSlots:slots,textbook:$('studentTextbook').value.trim(),remarks:$('studentRemarks').value.trim()};
  if(!data.name||!data.grade){showMessage('生徒名と学年を入力してください。');return;}
  const button=event.submitter;button.disabled=true;
  try{
    await setDoc(doc(db,'schoolStudents',id),data);
    if($('studentId').value)await updateStudentEntryLabels(id,data);
    if(JSON.stringify(before?.regularSlots||{})!==JSON.stringify(data.regularSlots)){
      const affected=[...everySlot(before||{}),...everySlot(data)].map(s=>s.teacherUid);
      await sendNotifications(affected,'担当生徒の通常授業（曜日・時間など）が更新されました',todayKey());
    }
    closeDialog('studentDialog');showMessage('生徒情報を保存しました。通常授業は指定曜日の時間割に自動表示されます。');
  }
  catch(e){trapError(e,'生徒情報の保存に失敗しました');}finally{button.disabled=false;}
});
// The deletion preview is separate from the confirmation action. This protects
// against accidentally deleting historical lesson records and teaching notes.
let pendingStudentDeletion = null;
$('deleteStudent').addEventListener('click', async () => {
  if(!isAdmin())return;
  const studentId=$('studentId').value;
  const student=state.students.find(s=>s.id===studentId);
  if(!student){showMessage('削除する生徒が見つかりません。');return;}
  pendingStudentDeletion=null;
  $('confirmStudentDeletion').disabled=true;
  $('deleteStudentSummary').textContent='関連する授業記録を確認しています…';
  showDialog('deleteStudentDialog');
  try{
    const [lessons,targets]=await Promise.all([
      getDocs(query(collection(db,'timetableEntries'),where('studentId','==',studentId))),
      getDocs(query(collection(db,'monthlyTargets'),where('studentId','==',studentId)))
    ]);
    if(!$('deleteStudentDialog').open)return;
    pendingStudentDeletion={studentId,studentName:student.name,lessons:lessons.docs,targets:targets.docs};
    const slots=everySlot(student).length;
    $('deleteStudentSummary').textContent=
      `「${student.name}」さんの情報を完全に削除します。\n`+
      `通常授業：${slots}件（生徒データ内）\n`+
      `保存済み授業記録：${lessons.size}件\n`+
      `旧・月別回数記録：${targets.size}件\n\n`+
      '過去の授業履歴・欠席情報・伝達事項も削除され、元には戻せません。';
    $('confirmStudentDeletion').disabled=false;
  }catch(error){
    trapError(error,'削除対象の確認に失敗しました');
    $('deleteStudentSummary').textContent='関連データを確認できませんでした。削除は実行できません。';
  }
});
$('confirmStudentDeletion').addEventListener('click', async () => {
  if(!isAdmin()||!pendingStudentDeletion)return;
  const request=pendingStudentDeletion;
  const button=$('confirmStudentDeletion');
  button.disabled=true;
  const original=button.textContent;
  button.textContent='削除中…';
  try{
    // Keep the student record until all linked records are removed. Use chunks
    // well under Firestore's write-batch limit. If a chunk fails, the student
    // remains and the operation can be retried safely.
    const linked=[...request.lessons,...request.targets];
    for(let offset=0;offset<linked.length;offset+=400){
      const batch=writeBatch(db);
      for(const snapshot of linked.slice(offset,offset+400))batch.delete(snapshot.ref);
      await batch.commit();
    }
    await deleteDoc(doc(db,'schoolStudents',request.studentId));
    pendingStudentDeletion=null;
    closeDialog('deleteStudentDialog');
    closeDialog('studentDialog');
    showMessage('生徒と関連する授業記録を削除しました。');
  }catch(error){
    trapError(error,'生徒の削除に失敗しました。関連データを再確認してからやり直してください');
    $('deleteStudentSummary').textContent='削除が途中で停止しました。生徒情報は残っています。画面を閉じて、もう一度「生徒を削除」から確認してください。';
  }finally{
    button.textContent=original;
    button.disabled=true;
  }
});
$('cancelStudentDeletion').addEventListener('click',()=>closeDialog('deleteStudentDialog'));

function selectOptions(select, array, labelFn){select.replaceChildren();for(const o of array){const option=make('option','',labelFn(o));option.value=o.id;select.append(option);}}
function openLessonForm(id=''){
  if(!isAdmin()&&!id)return;
  if(!state.students.length||!state.people.length){showMessage('先に生徒と担当教師のアカウントを登録してください。');return;}
  const lesson=lessonById(id);
  if(!isAdmin()&&!lesson)return;
  $('lessonForm').reset();$('lessonId').value=id;$('lessonFormTitle').textContent=lesson?'授業を編集':'授業を登録';
  const isRegular=Boolean(lesson?.regularId);
  $('deleteLesson').hidden=!lesson||!isAdmin()||Boolean(lesson?.virtual);
  $('deleteLesson').textContent=isRegular?'この日の変更を取り消す':'この授業を削除';
  $('regularEditHint').hidden=!isRegular;
  $('lessonStudent').disabled=isRegular;$('lessonDate').disabled=isRegular;
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
$('lessonForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin()&&!$('lessonId').value)return;
  const id=$('lessonId').value||doc(collection(db,'timetableEntries')).id;
  const old=lessonById(id);
  if(!isAdmin()&&!old){showMessage('既存授業のみ編集できます。');return;}
  const student=state.students.find(s=>s.id===$('lessonStudent').value);
  const teacher=state.people.find(p=>p.id===$('lessonTeacher').value);
  const date=$('lessonDate').value,start=$('lessonStart').value,end=$('lessonEnd').value;
  if(!student||!teacher||!date||!start||!end||start>=end){showMessage('入力内容と授業時間を確認してください。');return;}
  const data={studentId:student.id,studentName:student.name,grade:student.grade,school:student.school,teacherUid:teacher.id,teacherName:teacher.name,date,start,end,subject:$('lessonSubject').value.trim(),status:$('lessonStatus').value,memo:old?.memo||'',memoUpdatedAt:old?.memoUpdatedAt||null,nextDates:old?.nextDates||[]};
  if(old?.regularId)data.regularId=old.regularId;
  if(!data.subject){showMessage('教科を入力してください。');return;}
  const btn=event.submitter;btn.disabled=true;
  try{
    if(isAdmin()){
      const batch=writeBatch(db);batch.set(doc(db,'timetableEntries',id),data);
      const affected=[teacher.id];if(old?.teacherUid&&old.teacherUid!==teacher.id)affected.push(old.teacherUid);
      await sendNotifications(affected,old?'担当授業の予定が更新されました':'新しい担当授業が登録されました',date,batch);
      await batch.commit();
    } else {
      if(old?.virtual)await setDoc(doc(db,'timetableEntries',id),data);else await updateDoc(doc(db,'timetableEntries',id),data);
    }
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
    await batch.commit();
    closeDialog('lessonFormDialog');showMessage('授業を削除しました。');
  }catch(e){trapError(e,'授業の削除に失敗しました');}
});
function openLessonDetail(id){
  const lesson=lessonById(id);if(!lesson)return;
  state.activeLesson=id;
  $('detailTitle').textContent=lesson.studentName||'授業詳細';
  $('detailDate').textContent=`${prettyDate(lesson.date)} ${lesson.start}〜${lesson.end}`;
  $('detailAbsenceStatus').hidden=lesson.status!=='cancelled';
  $('detailSubject').textContent=lesson.subject;
  $('detailTeacher').textContent=lesson.teacherName;
  $('detailGrade').textContent=[lesson.grade,lesson.school].filter(Boolean).join(' / ');
  const dates=$('futureDates');dates.replaceChildren();
  const upcoming=futureDatesForLesson(lesson);
  if(upcoming.length){upcoming.forEach((date,i)=>dates.append(make('div','future-date',`${i===0?'次回':'次々回'}：${prettyDate(date)}`)));}
  else dates.append(make('div','future-date','今後の来塾予定はまだ登録されていません。'));
  $('memoContent').value=lesson.memo||'';$('editLesson').hidden=false;showDialog('detailDialog');
}
$('editLesson').addEventListener('click',()=>{const id=state.activeLesson;closeDialog('detailDialog');openLessonForm(id);});
$('memoForm').addEventListener('submit',async event=>{
  event.preventDefault();const lesson=lessonById(state.activeLesson);if(!lesson)return;
  const content=$('memoContent').value.trim();const button=event.submitter;button.disabled=true;
  try{
    if(isAdmin()){
      const batch=writeBatch(db);
      if(lesson.virtual){const {id,virtual,...stored}=lesson;batch.set(doc(db,'timetableEntries',lesson.id),{...stored,memo:content,memoUpdatedAt:serverTimestamp()});}
      else batch.update(doc(db,'timetableEntries',lesson.id),{memo:content,memoUpdatedAt:serverTimestamp()});
      await sendNotifications([lesson.teacherUid],'担当授業の伝達事項が更新されました',lesson.date,batch);
      await batch.commit();
    } else {
      if(lesson.virtual){const {id,virtual,...stored}=lesson;await setDoc(doc(db,'timetableEntries',lesson.id),{...stored,memo:content,memoUpdatedAt:serverTimestamp()});}
      else await updateDoc(doc(db,'timetableEntries',lesson.id),{memo:content,memoUpdatedAt:serverTimestamp()});
    }
    closeDialog('detailDialog');showMessage('伝達事項を保存しました。時間割にも反映されます。');
  }
  catch(e){trapError(e,'メモの保存に失敗しました');}finally{button.disabled=false;}
});
function loggedOut(){
  resetSubscriptions();state.user=null;state.profile=null;state.entries=[];state.students=[];state.people=[];state.notices=[];
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
  $('teacherFilter').value='mine';state.date=todayKey();
  state.unsub.push(onSnapshot(collection(db,'schoolStudents'),snap=>{state.students=snap.docs.map(d=>({id:d.id,...d.data()}));renderAll();},err=>trapError(err,'生徒情報を取得できません')));
  state.unsub.push(onSnapshot(collection(db,'users'),snap=>{state.people=snap.docs.map(d=>({id:d.id,...d.data()}));renderAll();},err=>trapError(err,'教師情報を取得できません')));
  state.unsub.push(onSnapshot(collection(db,'timetableEntries'),snap=>{state.entries=snap.docs.map(d=>({id:d.id,...d.data()}));renderAll();},err=>trapError(err,'時間割を取得できません')));
  if(isAdmin()){
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
