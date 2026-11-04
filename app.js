import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, query, where, setDoc, deleteDoc, onSnapshot, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
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
const state = { user:null, profile:null, date:todayKey(), scheduleView:'day', page:'', students:[], people:[], entries:[], notices:[], activeLesson:null, unsub:[] };
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
// Weekly/monthly cards may refer to a different day than the currently selected date.
// Resolve generated regular lessons using the date embedded in their stable ID.
function lessonById(id){
  const stored=state.entries.find(e=>e.id===id);
  if(stored)return stored;
  const occurrenceDate=/^rec_.+_(\d{4}-\d{2}-\d{2})$/.exec(id||'')?.[1];
  return lessonsOnDate(occurrenceDate||state.date).find(e=>e.id===id);
}
function timeMinutes(time){
  const [hours,minutes]=time.split(':').map(Number);
  return hours*60+minutes;
}
function periodCount(entry){
  const first=CLASS_PERIODS.findIndex(p=>p.start===entry.start);
  const last=CLASS_PERIODS.findIndex(p=>p.end===entry.end);
  return first>=0 && last>=first ? last-first+1 : 1;
}
// The next three visits after this lesson's date. Consecutive periods count as one visit.
function futureVisitsForLesson(lesson){
  const dates=new Set(state.entries
    .filter(e=>e.studentId===lesson.studentId && e.date>lesson.date && e.status!=='cancelled' && isVisibleEntry(e))
    .map(e=>e.date));
  for(let offset=1;offset<=112;offset++)dates.add(datePlus(lesson.date,offset));
  const visits=[];
  for(const date of [...dates].sort()){
    const lessons=lessonsOnDate(date)
      .filter(e=>e.studentId===lesson.studentId && e.status!=='cancelled' && e.start && e.end)
      .sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
    let current=null;
    for(const entry of lessons){
      if(!current){current={date,start:entry.start,end:entry.end,periods:periodCount(entry)};continue;}
      const gap=timeMinutes(entry.start)-timeMinutes(current.end);
      if(gap<=5){
        if(entry.end>current.end){current.periods+=periodCount(entry);current.end=entry.end;}
      }else{
        visits.push(current);
        current={date,start:entry.start,end:entry.end,periods:periodCount(entry)};
      }
    }
    if(current)visits.push(current);
    if(visits.length>=3)break;
  }
  return visits.slice(0,3);
}

$('studentLevel').addEventListener('change',renderCount);
$('studentSort').addEventListener('change',renderCount);
$('studentSearch').addEventListener('input',renderCount);
function renderAll() { if(!state.user) return; renderLessons(); if(isAdmin())renderCount(); else renderTeacherStudents(); renderNoticeButton(); }
// Shiftly's four fixed teaching periods. A continuous booking is split ONLY in
// the timetable UI. Both display cards keep the same source lesson ID and memo.
// A booking with non-standard start/end times remains a single card.
const CLASS_PERIODS = [
  {number:1,start:'17:30',end:'18:25'},
  {number:2,start:'18:30',end:'19:25'},
  {number:3,start:'19:30',end:'20:25'},
  {number:4,start:'20:30',end:'21:25'}
];
function splitLessonForDisplay(entry){
  const first=CLASS_PERIODS.findIndex(period=>period.start===entry.start);
  const last=CLASS_PERIODS.findIndex(period=>period.end===entry.end);
  if(first<0 || last<first)return [entry];
  const count=last-first+1;
  return CLASS_PERIODS.slice(first,last+1).map((period,index)=>({
    ...entry,
    start:period.start,
    end:period.end,
    displayPeriod:period.number,
    splitIndex:index+1,
    splitTotal:count,
    // Keep the original ID so every segment opens the SAME saved lesson.
    sourceLessonId:entry.id
  }));
}
function visibleLessonsOnDate(date){
  return lessonsOnDate(date)
    .filter(e=>isAdmin() || $('teacherFilter').value==='all' || e.teacherUid===state.user.uid)
    .flatMap(splitLessonForDisplay)
    .sort((a,b)=>a.start.localeCompare(b.start)||a.teacherName.localeCompare(b.teacherName)||a.studentName.localeCompare(b.studentName));
}
function openScheduleDay(date){state.date=date;selectScheduleView('day');}
function fullLessonCard(item){
  const time=`${item.displayPeriod?item.displayPeriod+'限　':''}${item.start} – ${item.end}`;
  const card=make('button',item.status==='cancelled'?'lesson-card is-absent':'lesson-card');card.type='button';
  const headline=make('div','lesson-topline');headline.append(make('span','lesson-time',time));
  if(item.splitTotal>1)headline.append(make('span','split-tag',`連続${item.splitTotal}コマ · ${item.splitIndex}/${item.splitTotal}`));
  const st=item.status==='done'?'実施済':item.status==='cancelled'?'欠席':'予定';
  headline.append(make('span',item.status==='cancelled'?'state-tag absent-tag':'state-tag',st));
  headline.append(make('span','origin-tag',item.regularId?'通常授業':'個別登録'));card.append(headline);
  card.append(make('div','lesson-student',`${item.grade||''} ${item.studentName||'生徒名未登録'}`));
  card.append(make('div','lesson-meta',`${item.subject||'教科未登録'}　/　${item.teacherName||'担当教師未登録'}`));
  if(item.memo?.trim())card.append(make('div','memo-preview',item.memo.length>170?item.memo.slice(0,170)+'…':item.memo));
  else card.append(make('div','lesson-meta','伝達事項なし'));
  card.addEventListener('click',()=>openLessonDetail(item.id));
  return card;
}
function renderDaySchedule(parent){
  parent.className='lesson-list';
  const rows=visibleLessonsOnDate(state.date);
  if(!rows.length){parent.append(make('div','empty','この日の授業はありません。'));return;}
  let lastTime='';
  for(const item of rows){
    const time=`${item.displayPeriod?item.displayPeriod+'限　':''}${item.start} – ${item.end}`;
    if(time!==lastTime){parent.append(make('div','time-group-title',time));lastTime=time;}
    parent.append(fullLessonCard(item));
  }
}
function renderWeekSchedule(parent){
  parent.className='lesson-list week-calendar';
  const monday=startOfWeek(state.date);
  for(let day=0;day<7;day++){
    const date=datePlus(monday,day);
    const rows=visibleLessonsOnDate(date);
    const section=make('section','week-day'+(date===todayKey()?' is-today':''));
    const head=make('div','week-day-head');
    const jump=make('button','week-day-button',prettyDate(date));jump.type='button';
    jump.title='この日の授業を詳しく見る';
    jump.addEventListener('click',()=>openScheduleDay(date));
    head.append(jump,make('span','week-day-count',`${rows.length}コマ`));section.append(head);
    if(!rows.length){section.append(make('p','week-day-empty','授業なし'));parent.append(section);continue;}
    for(const item of rows){
      const lesson=make('button',item.status==='cancelled'?'week-lesson is-absent':'week-lesson');lesson.type='button';
      const topline=make('div','week-lesson-top');
      topline.append(make('span','week-lesson-time',`${item.displayPeriod?item.displayPeriod+'限　':''}${item.start}–${item.end}`));
      if(item.status==='cancelled')topline.append(make('strong','week-absence','欠席'));
      else if(item.status==='done')topline.append(make('span','week-done','実施済'));
      lesson.append(topline);
      lesson.append(make('strong','week-student',`${item.grade||''} ${item.studentName||'生徒名未登録'}`));
      lesson.append(make('span','week-meta',`${item.subject||'教科未登録'} / ${item.teacherName||'担当教師未登録'}`));
      if(item.splitTotal>1)lesson.append(make('span','week-split-tag',`連続${item.splitTotal}コマ · ${item.splitIndex}/${item.splitTotal}`));
      if(item.memo?.trim())lesson.append(make('span','week-memo',`伝達：${item.memo.slice(0,90)}${item.memo.length>90?'…':''}`));
      lesson.addEventListener('click',()=>openLessonDetail(item.id));
      section.append(lesson);
    }
    parent.append(section);
  }
}
function renderMonthSchedule(parent){
  parent.className='lesson-list month-calendar-wrap';
  const current=jsDate(state.date);
  const year=current.getFullYear(),month=current.getMonth();
  const days=new Date(year,month+1,0).getDate();
  const leading=(new Date(year,month,1).getDay()+6)%7;
  const cells=Math.ceil((leading+days)/7)*7;
  const calendar=make('div','month-calendar');
  for(const dayName of ['月','火','水','木','金','土','日'])calendar.append(make('div','month-weekday',dayName));
  for(let index=0;index<cells;index++){
    const day=index-leading+1;
    const inMonth=day>=1&&day<=days;
    const date=dateKey(new Date(year,month,day));
    const cell=make('div','month-day'+(!inMonth?' is-outside':'')+(date===todayKey()?' is-today':''));
    if(!inMonth){calendar.append(cell);continue;}
    const rows=visibleLessonsOnDate(date);
    const header=make('button','month-day-head');header.type='button';
    header.title='この日の時間割を見る';header.setAttribute('aria-label',`${prettyDate(date)}の時間割 ${rows.length}コマ`);
    header.append(make('span','month-day-number',String(day)));
    if(rows.length)header.append(make('span','month-day-count',`${rows.length}コマ`));
    header.addEventListener('click',()=>openScheduleDay(date));
    cell.append(header);
    for(const item of rows.slice(0,3)){
      const mini=make('button',item.status==='cancelled'?'month-event is-absent':'month-event');mini.type='button';
      mini.textContent=`${item.displayPeriod?item.displayPeriod+'限 ':''}${item.start} ${item.studentName||'生徒名未登録'}${item.status==='cancelled'?'（欠席）':''}${item.memo?.trim()?' 📝':''}`;
      mini.title=`${item.start}〜${item.end} ${item.studentName||'生徒名未登録'} ${item.subject||''} ${item.teacherName||''}${item.splitTotal>1?' / 連続'+item.splitTotal+'コマ（'+item.splitIndex+'/'+item.splitTotal+'）':''}${item.status==='cancelled'?' 欠席':''}${item.memo?.trim()?' / 伝達事項あり':''}`;
      mini.addEventListener('click',()=>openLessonDetail(item.id));
      cell.append(mini);
    }
    if(rows.length>3){
      const more=make('button','month-day-more',`ほか${rows.length-3}コマ`);more.type='button';
      more.addEventListener('click',()=>openScheduleDay(date));cell.append(more);
    }
    calendar.append(cell);
  }
  parent.append(calendar);
  parent.append(make('p','month-help','日付をタップすると1日表示に切り替わります。授業名をタップすると詳細を開けます。'));
}
function renderLessons(){
  if(!state.user)return;
  const view=state.scheduleView;
  const heading=$('displayDate');
  if(view==='month'){
    const d=jsDate(state.date);
    heading.textContent=`${d.getFullYear()}年${d.getMonth()+1}月`;
  }else if(view==='week'){
    const start=startOfWeek(state.date),end=datePlus(start,6);
    heading.textContent=`${start.slice(0,4)}年${prettyDate(start)} 〜 ${start.slice(0,4)===end.slice(0,4)?'':end.slice(0,4)+'年'}${prettyDate(end)}`;
  }else heading.textContent=`${state.date.slice(0,4)}年${prettyDate(state.date)}`;
  $('prevDay').setAttribute('aria-label',`前の${view==='day'?'日':view==='week'?'週':'月'}`);
  $('nextDay').setAttribute('aria-label',`次の${view==='day'?'日':view==='week'?'週':'月'}`);
  const parent=$('lessonList');parent.replaceChildren();
  if(view==='week')renderWeekSchedule(parent);
  else if(view==='month')renderMonthSchedule(parent);
  else renderDaySchedule(parent);
}
// The admin and teacher directories use the exact same table-rendering path.
// Teacher rows never have an edit/action column or write handlers.
function renderStudentTable({searchId, levelId, sortId, resultsId, rowsId, canEdit}){
  const search=$(searchId).value;
  const sort=$(sortId).value;
  const students=sortedStudents(state.students,search,$(levelId).value,sort);
  $(resultsId).textContent=`${students.length}名を表示 / 全${state.students.length}名`;
  const tbody=$(rowsId);tbody.replaceChildren();
  const columns=canEdit?7:6;
  if(!students.length){
    const tr=make('tr');const td=cell(tr,'条件に合う生徒がいません');td.colSpan=columns;tbody.append(tr);return;
  }
  const labels={elementary:'小学生',middle:'中学生',high:'高校生',other:'その他・未分類'};
  let lastGroup='';
  for(const student of students){
    const group=gradeInfo(student.grade).level;
    if(['gradeAsc','gradeDesc'].includes(sort)&&group!==lastGroup){
      const groupRow=make('tr','group-row');const td=cell(groupRow,labels[group]);td.colSpan=columns;
      tbody.append(groupRow);lastGroup=group;
    }
    const tr=make('tr');
    cell(tr,student.name||'―','student-name-cell');
    cell(tr,student.grade||'―');
    cell(tr,student.school||'―');
    cell(tr,regularDescription(student),'regular-cell');
    cell(tr,student.textbook||'―');
    cell(tr,student.remarks||'―','remarks-cell');
    if(canEdit){
      const action=cell(tr,'');
      const edit=make('button','mini-button','編集');edit.type='button';
      edit.addEventListener('click',()=>openStudent(student.id));
      action.append(edit);
    }
    tbody.append(tr);
  }
}
function renderTeacherStudents(){
  if(isAdmin()||!state.user)return;
  renderStudentTable({searchId:'teacherStudentSearch',levelId:'teacherStudentLevel',sortId:'teacherStudentSort',resultsId:'teacherStudentResults',rowsId:'teacherStudentRows',canEdit:false});
}
function renderCount(){
  if(!isAdmin())return;
  renderStudentTable({searchId:'studentSearch',levelId:'studentLevel',sortId:'studentSort',resultsId:'studentResults',rowsId:'countRows',canEdit:true});
}
// All staff notifications are read-only. A teacher must never update Firestore,
// including the read flag; do not show a persistent unread badge that cannot clear.
function renderNoticeButton(){
  $('noticeCount').hidden=true;
}
function renderNotifications(){
  const parent=$('notificationList');parent.replaceChildren();
  if(!state.notices.length){parent.append(make('div','empty','お知らせはありません。'));return;}
  for(const n of [...state.notices].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).slice(0,50)){
    const node=make('div','notification');
    node.append(make('strong','',n.message||'授業が変更されました'));
    const time=n.createdAt?.toDate?.();
    node.append(make('small','',time?time.toLocaleString('ja-JP'):'日時情報なし'));
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
  if(!isAdmin())return;
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
  if(!isAdmin())return;
  if(!state.students.length||!state.people.length){showMessage('先に生徒と担当教師のアカウントを登録してください。');return;}
  const lesson=lessonById(id);
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
  event.preventDefault();if(!isAdmin())return;
  const id=$('lessonId').value||doc(collection(db,'timetableEntries')).id;
  const old=lessonById(id);
  const student=state.students.find(s=>s.id===$('lessonStudent').value);
  const teacher=state.people.find(p=>p.id===$('lessonTeacher').value);
  const date=$('lessonDate').value,start=$('lessonStart').value,end=$('lessonEnd').value;
  if(!student||!teacher||!date||!start||!end||start>=end){showMessage('入力内容と授業時間を確認してください。');return;}
  const data={studentId:student.id,studentName:student.name,grade:student.grade,school:student.school,teacherUid:teacher.id,teacherName:teacher.name,date,start,end,subject:$('lessonSubject').value.trim(),status:$('lessonStatus').value,memo:old?.memo||'',memoUpdatedAt:old?.memoUpdatedAt||null,nextDates:old?.nextDates||[]};
  if(old?.regularId)data.regularId=old.regularId;
  if(!data.subject){showMessage('教科を入力してください。');return;}
  const btn=event.submitter;btn.disabled=true;
  try{
    const batch=writeBatch(db);batch.set(doc(db,'timetableEntries',id),data);
    const affected=[teacher.id];if(old?.teacherUid&&old.teacherUid!==teacher.id)affected.push(old.teacherUid);
    await sendNotifications(affected,old?'担当授業の予定が更新されました':'新しい担当授業が登録されました',date,batch);
    await batch.commit();
    closeDialog('lessonFormDialog');showMessage('授業を保存し、関係する担当教師に通知しました。');
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
  const upcoming=futureVisitsForLesson(lesson);
  if(upcoming.length){
    upcoming.forEach((visit,i)=>{
      const label=`${i+1}回目：${prettyDate(visit.date)}　${visit.start}〜${visit.end}`;
      const suffix=visit.periods>1?`（${visit.periods}コマ連続）`:'';
      dates.append(make('div','future-date',label+suffix));
    });
  }else dates.append(make('div','future-date','今後の来塾予定はまだ登録されていません。'));
  // Employees see plain text only; no editable field or save button.
  const admin=isAdmin();
  $('memoForm').hidden=!admin;
  $('memoReadOnly').hidden=admin;
  $('memoReadOnly').textContent=lesson.memo?.trim()||'伝達事項はありません。';
  $('memoContent').value=admin?(lesson.memo||''):'';
  $('editLesson').hidden=!admin;
  showDialog('detailDialog');
}
$('editLesson').addEventListener('click',()=>{if(!isAdmin())return;const id=state.activeLesson;closeDialog('detailDialog');openLessonForm(id);});
$('memoForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!isAdmin())return; // UI protection; Firestore Rules enforce this on the server.
  const lesson=lessonById(state.activeLesson);if(!lesson)return;
  const content=$('memoContent').value.trim();const button=event.submitter;button.disabled=true;
  try{
    const batch=writeBatch(db);
    if(lesson.virtual){const {id,virtual,...stored}=lesson;batch.set(doc(db,'timetableEntries',lesson.id),{...stored,memo:content,memoUpdatedAt:serverTimestamp()});}
    else batch.update(doc(db,'timetableEntries',lesson.id),{memo:content,memoUpdatedAt:serverTimestamp()});
    await sendNotifications([lesson.teacherUid],'担当授業の伝達事項が更新されました',lesson.date,batch);
    await batch.commit();
    closeDialog('detailDialog');showMessage('伝達事項を保存しました。時間割にも反映されます。');
  }
  catch(e){trapError(e,'伝達事項の保存に失敗しました');}finally{button.disabled=false;}
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
  $('teacherFilter').value='mine';state.date=todayKey();state.scheduleView='day';document.querySelectorAll('[data-schedule-view]').forEach(button=>{const active=button.dataset.scheduleView==='day';button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
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
