import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, query, where, setDoc, deleteDoc, onSnapshot, serverTimestamp, writeBatch, runTransaction } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
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
const state = { user:null, profile:null, date:todayKey(), scheduleView:'day', page:'', students:[], people:[], entries:[], entriesStatus:'loading', closures:{}, closuresStatus:'loading', courses:[], coursesStatus:'loading', notices:[], activeLesson:null, unsub:[] };
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
function courseFor(date){
  return state.courses.find(c=>c.startDate<=date && date<=c.endDate) || null;
}
function hasCourseConflict(date){
  return state.courses.filter(c=>c.startDate<=date && date<=c.endDate).length>1;
}
function lessonsOnDate(date){
  const course=courseFor(date);
  if(hasCourseConflict(date))return [];
  const stored = state.entries.filter(e=>e.date===date && isVisibleEntry(e) && (course ? e.courseId===course.id : !e.courseId));
  // Regular weekly lessons and regular one-off lessons are left in Firestore,
  // but never shown or regenerated for any date inside a special course.
  if(course)return stored;

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
function closureFor(date){ return state.closures[date] || null; }
function lessonPeriodCount(entry){
  if(entry.courseId)return 1;
  const first=CLASS_PERIODS.findIndex(p=>p.start===entry.start);
  const last=CLASS_PERIODS.findIndex(p=>p.end===entry.end);
  return first>=0 && last>=first ? last-first+1 : 1;
}
function canJoinVisits(date, previousEnd, nextStart){
  const [ah,am]=previousEnd.split(':').map(Number), [bh,bm]=nextStart.split(':').map(Number);
  const gap=(bh*60+bm)-(ah*60+am);
  if(gap<0 || gap>15)return false;
  const course=courseFor(date);
  if(!course)return true;
  // Only adjacent course periods count as continuous (not an unrelated booking).
  const before=course.periods.findIndex(p=>p.end===previousEnd);
  const after=course.periods.findIndex(p=>p.start===nextStart);
  return before>=0 && after===before+1;
}
function futureVisitsForLesson(lesson){
  const dates=new Set(state.entries.filter(e=>e.studentId===lesson.studentId && e.date>lesson.date).map(e=>e.date));
  for(let offset=1;offset<=112;offset++)dates.add(datePlus(lesson.date,offset));
  const visits=[];
  for(const date of [...dates].sort()){
    const entries=lessonsOnDate(date)
      .filter(e=>e.studentId===lesson.studentId && e.status!=='cancelled' && e.start && e.end)
      .sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
    if(!entries.length)continue;
    const closure=closureFor(date), course=courseFor(date);
    if(closure){
      // A cancelled visit is still shown as 休校, preserving the original time.
      const timeText=entries.map(e=>`${e.start}〜${e.end}`).filter((v,i,a)=>a.indexOf(v)===i).join('、');
      visits.push({date,closed:true,note:closure.note||'',timeText,courseName:course?.name||''});
    }else{
      let current=null;
      for(const entry of entries){
        if(!current){current={date,start:entry.start,end:entry.end,periods:lessonPeriodCount(entry),courseName:course?.name||''};continue;}
        if(canJoinVisits(date,current.end,entry.start)){
          if(entry.end>current.end)current.end=entry.end;
          current.periods+=lessonPeriodCount(entry);
        }else{
          visits.push(current);
          current={date,start:entry.start,end:entry.end,periods:lessonPeriodCount(entry),courseName:course?.name||''};
        }
      }
      if(current)visits.push(current);
    }
    if(visits.length>=3)break;
  }
  return visits.slice(0,3);
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

// iPad Safari: when an input/textarea still has focus, the first tap on a
// dialog's Save button can be consumed by the virtual keyboard dismissing.
// Treat that touch as an explicit form submission while retaining native
// required-field validation and the existing Firebase save handlers.
function enableOneTapSave(formId) {
  const form = $(formId);
  const save = form.querySelector('button[type="submit"]');
  if (!save) return;

  function submitFromFocusedField(event) {
    const active = document.activeElement;
    // Do not intercept mouse/keyboard clicks or touches unrelated to an
    // active input in this form. Native form submission remains the default.
    if (event.type === 'pointerdown' && event.pointerType !== 'touch') return;
    if (event.isPrimary === false || save.disabled || !active || active === save ||
        !form.contains(active) || !['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) ||
        active.type === 'hidden') return;
    if (event.cancelable) event.preventDefault();
    // reportValidity() highlights the first missing field as usual.
    if (!form.reportValidity()) return;
    // Blurring commits Japanese IME input before collecting form values.
    active.blur();
    form.requestSubmit(save);
  }

  if (window.PointerEvent) {
    save.addEventListener('pointerdown', submitFromFocusedField, {passive:false});
  } else {
    save.addEventListener('touchstart', submitFromFocusedField, {passive:false});
  }
}
['studentForm', 'lessonForm', 'memoForm', 'closureForm', 'courseForm'].forEach(enableOneTapSave);

function resetSubscriptions(){state.unsub.forEach(fn=>fn());state.unsub=[];}
function nav(page) {
  state.page=page;
  $('adminCountPage').hidden=page!=='count';
  $('teacherStudentsPage').hidden=page!=='students';
  $('closuresPage').hidden=page!=='closures';
  $('coursesPage').hidden=page!=='courses';
  $('courseEditorPage').hidden=page!=='courseEditor';
  $('lessonsPage').hidden=page==='count'||page==='students'||page==='closures'||page==='courses'||page==='courseEditor';
  for(const [id,p] of [['navCount','count'],['navAdminLessons','adminLessons'],['navClosures','closures'],['navCourses','courses'],['navCourseEditor','courseEditor'],['navTeacherLessons','teacherLessons'],['navTeacherStudents','students']]) $(''+id).classList.toggle('active',page===p);
  if(page==='count')renderCount();
  else if(page==='students')renderTeacherStudents();
  else if(page==='closures')renderClosures();
  else if(page==='courses')renderCourses();
  else if(page==='courseEditor')renderCourseEditor();
  else {
    $('scheduleHeading').textContent=isAdmin()?'授業管理':'今日の時間割';
    $('scheduleDescription').textContent=isAdmin()?'全教師の授業を確認・変更できます。':'全教師の時間割と伝達事項を閲覧できます。';
    renderLessons();
  }
}
$('navCount').addEventListener('click',()=>nav('count'));
$('navAdminLessons').addEventListener('click',()=>nav('adminLessons'));
$('navClosures').addEventListener('click',()=>{if(isAdmin())nav('closures');});
$('navCourses').addEventListener('click',()=>{if(isAdmin())nav('courses');});
$('navCourseEditor').addEventListener('click',()=>{if(isAdmin())nav('courseEditor');});
$('navTeacherLessons').addEventListener('click',()=>nav('teacherLessons'));
$('navTeacherStudents').addEventListener('click',()=>nav('students'));
$('teacherFilter').addEventListener('change',renderLessons);
$('teacherStudentSearch').addEventListener('input',renderTeacherStudents);
$('teacherStudentLevel').addEventListener('change',renderTeacherStudents);
$('teacherStudentSort').addEventListener('change',renderTeacherStudents);
// Day / week / month select both the displayed range and arrow navigation step.
const jsDate = value => { const [year,month,day]=value.split('-').map(Number); return new Date(year,month-1,day); };
const startOfWeek = value => datePlus(value,-((jsDate(value).getDay()+6)%7)); // Monday first
function shiftMonth(value,delta){
  const [year,month,day]=value.split('-').map(Number);
  const target=new Date(year,month-1+delta,1);
  const last=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();
  return dateKey(new Date(target.getFullYear(),target.getMonth(),Math.min(day,last)));
}
function moveSchedule(direction){
  state.date=state.scheduleView==='month'?shiftMonth(state.date,direction):datePlus(state.date,direction*(state.scheduleView==='week'?7:1));
  renderLessons();
}
function selectScheduleView(view){
  if(!['day','week','month'].includes(view))return;
  state.scheduleView=view;
  document.querySelectorAll('[data-schedule-view]').forEach(button=>{
    const active=button.dataset.scheduleView===view;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  renderLessons();
}
document.querySelectorAll('[data-schedule-view]').forEach(button=>button.addEventListener('click',()=>selectScheduleView(button.dataset.scheduleView)));
$('prevDay').addEventListener('click',()=>moveSchedule(-1));
$('nextDay').addEventListener('click',()=>moveSchedule(1));
$('today').addEventListener('click',()=>{state.date=todayKey();renderLessons();});
$('studentLevel').addEventListener('change',renderCount);
$('studentSort').addEventListener('change',renderCount);
$('studentSearch').addEventListener('input',renderCount);
function renderAll() { if(!state.user) return; renderLessons(); if(isAdmin()){renderCount();renderClosures();renderCourses();if(state.page==='courseEditor')renderCourseEditor();}else renderTeacherStudents(); renderNoticeButton(); }
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
  if(entry.courseId){
    const course=state.courses.find(c=>c.id===entry.courseId);
    const period=course?.periods.findIndex(p=>p.start===entry.start && p.end===entry.end) ?? -1;
    return [{...entry,displayPeriod:period>=0?period+1:undefined}];
  }
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
  if(closureFor(date))return [];
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
  headline.append(make('span','origin-tag',item.courseId?'講習授業':item.regularId?'通常授業':'個別登録'));card.append(headline);
  card.append(make('div','lesson-student',`${item.grade||''} ${item.studentName||'生徒名未登録'}`));
  card.append(make('div','lesson-meta',`${item.subject||'教科未登録'}　/　${item.teacherName||'担当教師未登録'}`));
  if(item.memo?.trim())card.append(make('div','memo-preview',item.memo.length>170?item.memo.slice(0,170)+'…':item.memo));
  else card.append(make('div','lesson-meta','伝達事項なし'));
  card.addEventListener('click',()=>openLessonDetail(item.id));
  return card;
}
function closureCard(date, compact=false){
  const closure=closureFor(date);
  const card=make('div',compact?'closure-card compact':'closure-card');
  card.append(make('strong','closure-title','休校'));
  if(closure?.note)card.append(make('div','closure-note',closure.note));
  else card.append(make('div','closure-note','この日は塾がお休みです。'));
  return card;
}
function courseBanner(date, compact=false){
  const course=courseFor(date);
  if(!course)return null;
  const banner=make('div',compact?'course-banner compact':'course-banner');
  banner.append(make('strong','',`${course.name}期間`));
  if(!compact)banner.append(make('span','',`${prettyDate(course.startDate)}〜${prettyDate(course.endDate)}　通常授業は表示せず、講習専用の授業だけを表示しています。`));
  if(hasCourseConflict(date))banner.append(make('span','course-overlap-warning','講習期間が重複しています。管理者に確認してください。'));
  return banner;
}
function renderDaySchedule(parent){
  parent.className='lesson-list';
  const banner=courseBanner(state.date);if(banner)parent.append(banner);
  if(closureFor(state.date)){parent.append(closureCard(state.date));return;}
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
    const closure=closureFor(date);
    const rows=visibleLessonsOnDate(date);
    const section=make('section','week-day'+(date===todayKey()?' is-today':'')+(closure?' is-closed':''));
    const head=make('div','week-day-head');
    const jump=make('button','week-day-button',prettyDate(date));jump.type='button';
    jump.title='この日の授業を詳しく見る';
    jump.addEventListener('click',()=>openScheduleDay(date));
    head.append(jump,make('span','week-day-count',closure?'休校':`${rows.length}コマ`));section.append(head);
    const banner=courseBanner(date,true);if(banner)section.append(banner);
    if(closure){section.append(closureCard(date,true));parent.append(section);continue;}
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
    const closure=closureFor(date);
    if(closure)cell.classList.add('is-closed');
    const rows=visibleLessonsOnDate(date);
    const header=make('button','month-day-head');header.type='button';
    header.title=closure?'休校日の詳細を見る':'この日の時間割を見る';header.setAttribute('aria-label',closure?`${prettyDate(date)}は休校`: `${prettyDate(date)}の時間割 ${rows.length}コマ`);
    header.append(make('span','month-day-number',String(day)));
    const course=courseFor(date);
    if(course)header.append(make('span','month-course-label',`${course.name}期間`));
    if(closure)header.append(make('span','month-closed-label','休校'));
    else if(rows.length)header.append(make('span','month-day-count',`${rows.length}コマ`));
    header.addEventListener('click',()=>openScheduleDay(date));
    cell.append(header);
    if(closure){
      cell.append(make('div','month-closed-note',closure.note||'塾はお休みです'));
      calendar.append(cell);continue;
    }
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
  }else heading.textContent=`${state.date.slice(0,4)}年${prettyDate(state.date)}${courseFor(state.date)?' · '+courseFor(state.date).name+'期間':''}`;
  $('prevDay').setAttribute('aria-label',`前の${view==='day'?'日':view==='week'?'週':'月'}`);
  $('nextDay').setAttribute('aria-label',`次の${view==='day'?'日':view==='week'?'週':'月'}`);
  const parent=$('lessonList');parent.replaceChildren();
  if(isAdmin())$('addLesson').disabled=state.coursesStatus!=='ready'||state.entriesStatus!=='ready';
  if(state.closuresStatus!=='ready'||state.coursesStatus!=='ready'){
    parent.className='lesson-list';
    parent.append(make('div','closure-load-warning',state.closuresStatus==='error'||state.coursesStatus==='error'?'休校日または講習期間を読み込めません。Firebaseのルールを確認してください。':'休校日・講習期間情報を読み込んでいます…'));
    return;
  }
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
// Full-school closure management: only administrators may mutate this collection.
// Stored lesson data remains untouched and becomes visible again if closure is removed.
function renderClosures(){
  if(!isAdmin())return;
  const host=$('closureList');host.replaceChildren();
  if(state.closuresStatus!=='ready'){
    host.append(make('div','empty',state.closuresStatus==='error'?'休校日を読み込めません。Firebaseルールを確認してください。':'休校日を読み込んでいます…'));
    return;
  }
  const records=Object.values(state.closures).sort((a,b)=>a.date.localeCompare(b.date));
  if(!records.length){host.append(make('div','empty','登録された休校日はありません。'));return;}
  for(const closure of records){
    const item=make('div','closure-list-item');
    const info=make('div','closure-list-info');
    info.append(make('strong','',prettyDate(closure.date)));
    info.append(make('span','closure-list-note',closure.note||'備考なし'));
    const edit=make('button','mini-button','編集');edit.type='button';
    edit.addEventListener('click',()=>openClosureForm(closure.date));
    item.append(info,edit);host.append(item);
  }
}
function openClosureForm(date=''){
  if(!isAdmin())return;
  $('closureForm').reset();
  const closure=closureFor(date);
  $('closureEditingDate').value=closure?.date||'';
  $('closureDate').value=closure?.date||date||state.date;
  $('closureDate').disabled=Boolean(closure);
  $('closureNote').value=closure?.note||'';
  $('closureDialogTitle').textContent=closure?'休校日を編集':'休校日を登録';
  $('deleteClosure').hidden=!closure;
  showDialog('closureDialog');
}
$('addClosure').addEventListener('click',()=>openClosureForm(''));
$('closureForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin())return;
  if(state.closuresStatus!=='ready'){showMessage('休校日情報の読み込み完了後に操作してください。');return;}
  const date=$('closureDate').value, note=$('closureNote').value.trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||note.length>500){showMessage('日付と備考を確認してください。');return;}
  if(closureFor(date)&&!$('closureEditingDate').value){showMessage('この日はすでに休校登録されています。「編集」から変更してください。');return;}
  const button=event.submitter;button.disabled=true;
  try{
    await setDoc(doc(db,'schoolClosures',date),{date,note,updatedAt:serverTimestamp(),updatedBy:state.user.uid});
    closeDialog('closureDialog');showMessage(`${prettyDate(date)}を休校日に設定しました。授業データは削除されません。`);
  }catch(e){trapError(e,'休校日の保存に失敗しました');}
  finally{button.disabled=false;}
});
$('deleteClosure').addEventListener('click',async()=>{
  if(!isAdmin())return;
  const date=$('closureEditingDate').value;
  if(!date||!closureFor(date))return;
  if(!confirm(`${prettyDate(date)}の休校設定を解除しますか？元の時間割が再び表示されます。`))return;
  const button=$('deleteClosure');button.disabled=true;
  try{
    await deleteDoc(doc(db,'schoolClosures',date));
    closeDialog('closureDialog');showMessage('休校日を解除しました。元の授業予定が再表示されます。');
  }catch(e){trapError(e,'休校日の解除に失敗しました');}
  finally{button.disabled=false;}
});

// Seasonal courses are separate from normal recurring lessons.
// Never delete normal timetable entries when the course becomes active.
const COURSE_NAMES={spring:'春期講習',summer:'夏期講習',winter:'冬季講習'};
function courseLessons(courseId){return state.entries.filter(e=>e.courseId===courseId);}
function renderCourses(){
  if(!isAdmin())return;
  const host=$('courseList');host.replaceChildren();
  if(state.coursesStatus!=='ready'){
    host.append(make('div','empty',state.coursesStatus==='error'?'講習データを読み込めません。Firestoreルールを確認してください。':'講習期間を読み込んでいます…'));
    return;
  }
  const courses=[...state.courses].sort((a,b)=>a.startDate.localeCompare(b.startDate));
  if(!courses.length){host.append(make('div','empty','講習期間は未登録です。「＋ 講習期間を登録」から設定できます。'));return;}
  for(const course of courses){
    const record=make('div','course-list-item');
    const info=make('div','course-list-info');
    info.append(make('strong','',course.name+'期間'));
    info.append(make('span','',`${prettyDate(course.startDate)} 〜 ${prettyDate(course.endDate)}`));
    info.append(make('span','',`${course.periods.length}コマ構成 / 講習授業 ${state.entriesStatus==='ready'?courseLessons(course.id).length+'件':'読込中'}`));
    info.append(make('span','',course.periods.map((r,i)=>`${i+1}限 ${r.start}〜${r.end}`).join(' · ')));
    const actions=make('div','course-list-actions');
    const edit=make('button','mini-button','編集');edit.type='button';edit.addEventListener('click',()=>openCourseForm(course.id));
    const jump=make('button','mini-button','開始日の時間割');jump.type='button';jump.addEventListener('click',()=>{state.date=course.startDate;nav('adminLessons');});
    const grid=make('button','mini-button','表で配置');grid.type='button';grid.addEventListener('click',()=>{if(openCourseEditor(course.id))nav('courseEditor');});
    actions.append(edit,jump,grid);record.append(info,actions);host.append(record);
  }
}
function addCoursePeriodRow(period={}){
  const root=$('coursePeriodRows');
  if(root.children.length>=12){showMessage('講習は最大12コマまで登録できます。');return;}
  const row=make('div','course-period-row');
  const start=make('input');start.type='time';start.required=true;start.value=period.start||'';start.setAttribute('aria-label','コマ開始時刻');
  const end=make('input');end.type='time';end.required=true;end.value=period.end||'';end.setAttribute('aria-label','コマ終了時刻');
  const remove=make('button','mini-button','削除');remove.type='button';remove.addEventListener('click',()=>{if(root.children.length<=1){showMessage('最低1コマ必要です。');return;}row.remove();});
  row.append(make('span','course-period-number','時間'),start,make('span','','〜'),end,remove);root.append(row);
}
function openCourseForm(courseId=''){
  if(!isAdmin())return;
  const course=state.courses.find(c=>c.id===courseId);
  $('courseForm').reset();
  $('courseId').value=course?.id||'';
  $('courseDialogTitle').textContent=course?'講習期間を編集':'講習期間を登録';
  $('courseType').value=course?.type||'spring';
  $('courseStart').value=course?.startDate||'';
  $('courseEnd').value=course?.endDate||'';
  $('coursePeriodRows').replaceChildren();
  (course?.periods||[{start:'09:00',end:'09:55'},{start:'10:00',end:'10:55'},{start:'11:00',end:'11:55'}]).forEach(addCoursePeriodRow);
  $('deleteCourse').hidden=!course;
  showDialog('courseDialog');
}
$('addCourse').addEventListener('click',()=>openCourseForm());
$('addCoursePeriod').addEventListener('click',()=>addCoursePeriodRow());
$('courseForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin())return;
  if(state.coursesStatus!=='ready'||state.entriesStatus!=='ready'){showMessage('講習・時間割データの読込完了後に操作してください。');return;}
  const id=$('courseId').value||doc(collection(db,'specialCourses')).id;
  const type=$('courseType').value,name=COURSE_NAMES[type],startDate=$('courseStart').value,endDate=$('courseEnd').value;
  const periods=[...$('coursePeriodRows').children].map(row=>({start:row.querySelectorAll('input')[0].value,end:row.querySelectorAll('input')[1].value}));
  if(!name||!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate){showMessage('講習の種類と開始日・終了日を確認してください。');return;}
  if(!periods.length||periods.length>12||periods.some(p=>!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(p.start)||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(p.end)||p.start>=p.end)){
    showMessage('コマの開始・終了時刻を確認してください（最大12コマ）。');return;
  }
  periods.sort((a,b)=>a.start.localeCompare(b.start));
  if(periods.some((p,i)=>i>0&&p.start<periods[i-1].end)){showMessage('コマ同士の時間が重複しています。');return;}
  if(state.courses.some(c=>c.id!==id && startDate<=c.endDate && endDate>=c.startDate)){
    showMessage('他の講習期間と日付が重複しています。期間を確認してください。');return;
  }
  const existing=courseLessons(id);
  if(existing.some(e=>e.date<startDate||e.date>endDate||!periods.some(p=>p.start===e.start&&p.end===e.end))){
    showMessage('登録済み講習授業が新しい期間・コマから外れます。先に授業の日付・時間を調整してください。');return;
  }
  const button=event.submitter;button.disabled=true;
  try{
    await setDoc(doc(db,'specialCourses',id),{type,name,startDate,endDate,periods,updatedBy:state.user.uid,updatedAt:serverTimestamp()});
    closeDialog('courseDialog');showMessage(`${name}期間を保存しました。期間内は講習授業だけが表示されます。`);
  }catch(e){trapError(e,'講習期間の保存に失敗しました');}finally{button.disabled=false;}
});
$('deleteCourse').addEventListener('click',async()=>{
  if(!isAdmin())return;
  if(state.entriesStatus!=='ready'){showMessage('時間割データの読込完了後に操作してください。');return;}
  const id=$('courseId').value,course=state.courses.find(c=>c.id===id);if(!course)return;
  if(courseLessons(id).length){showMessage('講習授業が登録されています。削除前に講習授業をすべて削除してください。');return;}
  if(!confirm(`${course.name}（${prettyDate(course.startDate)}〜${prettyDate(course.endDate)}）を削除しますか？期間内の通常授業が再表示されます。`))return;
  const button=$('deleteCourse');button.disabled=true;
  try{await deleteDoc(doc(db,'specialCourses',id));closeDialog('courseDialog');showMessage('講習期間を解除しました。通常授業が再表示されます。');}
  catch(e){trapError(e,'講習期間の削除に失敗しました');}finally{button.disabled=false;}
});

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
  if(state.coursesStatus!=='ready'||state.entriesStatus!=='ready'){showMessage('授業と講習期間の読み込みが終わってから登録してください。');return;}
  if(closureFor(state.date)&&!id){showMessage('この日は休校です。休校日を解除してから授業を登録してください。');return;}
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
  $('lessonDate').value=lesson?.date||state.date;$('lessonStart').value=lesson?.start||'17:30';$('lessonEnd').value=lesson?.end||'18:25';syncLessonCoursePeriod(lesson);$('lessonSubject').value=lesson?.subject||'';$('lessonStatus').value=lesson?.status||'scheduled';
  showDialog('lessonFormDialog');
}
function syncLessonCoursePeriod(lesson=null){
  const date=$('lessonDate').value,course=courseFor(date);
  $('lessonCourseHint').hidden=!course;
  $('lessonNormalTime').hidden=Boolean(course);
  $('lessonCoursePeriodWrap').hidden=!course;
  $('lessonStart').required=!course;
  $('lessonEnd').required=!course;
  $('lessonCoursePeriod').replaceChildren();
  if(course){
    $('lessonCourseHint').textContent=`${course.name}期間：この日は講習専用の授業を登録します。通常授業は保存済みのまま非表示です。`;
    course.periods.forEach((p,i)=>{const option=make('option','',`${i+1}限　${p.start}〜${p.end}`);option.value=String(i);$('lessonCoursePeriod').append(option);});
    const current=course.periods.findIndex(p=>p.start===(lesson?.start||$('lessonStart').value) && p.end===(lesson?.end||$('lessonEnd').value));
    $('lessonCoursePeriod').value=String(Math.max(0,current));
    $('lessonCoursePeriod').required=true;
  }else $('lessonCoursePeriod').required=false;
}
$('lessonDate').addEventListener('change',()=>syncLessonCoursePeriod());
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
  if(state.coursesStatus!=='ready'||state.entriesStatus!=='ready'){showMessage('時間割と講習データの読込完了後に保存してください。');return;}
  const id=$('lessonId').value||doc(collection(db,'timetableEntries')).id;
  const old=lessonById(id);
  const student=state.students.find(s=>s.id===$('lessonStudent').value);
  const teacher=state.people.find(p=>p.id===$('lessonTeacher').value);
  const date=$('lessonDate').value,course=courseFor(date);
  if(hasCourseConflict(date)){showMessage('講習期間が重複しているため授業を保存できません。期間設定を修正してください。');return;}
  if(hasCourseConflict(date)){showMessage('この日に複数の講習期間が重複しています。講習期間管理から修正してください。');return;}
  if(old && Boolean(old.courseId)!==Boolean(course)){
    showMessage('通常授業と講習授業の間では移動できません。それぞれの時間割から登録してください。');return;
  }
  if(old?.courseId && old.courseId!==course?.id){showMessage('別の講習期間への直接移動はできません。');return;}
  const period=course?.periods[Number($('lessonCoursePeriod').value)];
  const start=course?period?.start:$('lessonStart').value;
  const end=course?period?.end:$('lessonEnd').value;
  if(!student||!teacher||!date||!start||!end||start>=end){showMessage('入力内容と授業時間を確認してください。');return;}
  if(closureFor(date)){showMessage('指定日は休校です。休校日を解除してから授業を保存してください。');return;}
  const data={studentId:student.id,studentName:student.name,grade:student.grade,school:student.school,teacherUid:teacher.id,teacherName:teacher.name,date,start,end,subject:$('lessonSubject').value.trim(),status:$('lessonStatus').value,memo:old?.memo||'',memoUpdatedAt:old?.memoUpdatedAt||null,nextDates:old?.nextDates||[]};
  if(old?.regularId)data.regularId=old.regularId;
  if(course)data.courseId=course.id;
  if(!data.subject){showMessage('教科を入力してください。');return;}
  // A student can attend at most one class in a given course period; a
  // teacher can handle up to two students in the same period (1:2 maximum).
  if(course && data.status!=='cancelled'){
    const peers=lessonsOnDate(date).filter(e=>e.id!==id && e.status!=='cancelled' && e.start===start && e.end===end);
    if(peers.some(e=>e.studentId===student.id)){showMessage('同じ生徒が同じ講習コマで重複しています。');return;}
    if(peers.filter(e=>e.teacherUid===teacher.id).length>=2){showMessage('このコマの担当講師はすでに2人の生徒を担当しています。');return;}
  }
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
function renderUpcomingForLesson(lesson){
  const dates=$('futureDates');dates.replaceChildren();
  const upcoming=futureVisitsForLesson(lesson);
  if(upcoming.length){
    upcoming.forEach((visit,i)=>{
      const node=make('div',visit.closed?'future-date is-closed':'future-date');
      if(visit.closed){
        node.append(make('strong','',`${i+1}回目：${prettyDate(visit.date)}　${visit.timeText}　休校${visit.courseName?'（'+visit.courseName+'期間）':''}`));
        if(visit.note)node.append(make('span','future-closed-note',`備考：${visit.note}`));
      }else{
        const suffix=visit.periods>1?`（${visit.periods}コマ連続）`:'';
        node.textContent=`${i+1}回目：${prettyDate(visit.date)}　${visit.start}〜${visit.end}${suffix}${visit.courseName?'　'+visit.courseName+'期間':''}`;
      }
      dates.append(node);
    });
  }
  else dates.append(make('div','future-date','今後の来塾予定はまだ登録されていません。'));
}
function openLessonDetailContents(id){
  const lesson=lessonById(id);if(!lesson)return;
  state.activeLesson=id;
  $('detailTitle').textContent=lesson.studentName||'授業詳細';
  const detailCourse=courseFor(lesson.date);
  $('detailDate').textContent=`${prettyDate(lesson.date)} ${lesson.start}〜${lesson.end}${detailCourse?'（'+detailCourse.name+'期間）':''}`;
  $('detailAbsenceStatus').hidden=lesson.status!=='cancelled';
  $('detailSubject').textContent=lesson.subject;
  $('detailTeacher').textContent=lesson.teacherName;
  $('detailGrade').textContent=[lesson.grade,lesson.school].filter(Boolean).join(' / ');
  renderUpcomingForLesson(lesson);
  // Employees see plain text only; no editable field or save button.
  const admin=isAdmin();
  $('memoForm').hidden=!admin;
  $('memoReadOnly').hidden=admin;
  $('memoReadOnly').textContent=lesson.memo?.trim()||'伝達事項はありません。';
  $('memoContent').value=admin?(lesson.memo||''):'';
  $('editLesson').hidden=!admin;
  return true;
}
function openLessonDetail(id){
  if(!openLessonDetailContents(id))return;
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
// Spreadsheet-style seasonal course editor. All drag/tap edits are local drafts
// until an administrator explicitly publishes the changed entries.
let courseEditor;
function resetCourseEditor(){
  courseEditor={courseId:'',date:todayKey(),mode:'day',originals:new Map(),draft:new Map(),history:[],selectedId:'',drag:null,suppressClick:false,busy:false,courseSignature:'',warning:''};
}
resetCourseEditor();
const courseEditorKey=e=>JSON.stringify([e?.courseId||'',e?.studentId||'',e?.date||'',e?.start||'',e?.end||'',e?.teacherUid||'',e?.status||'']);
const courseEditorSettings=c=>JSON.stringify([c?.type,c?.name,c?.startDate,c?.endDate,c?.periods]);
function courseEditorChanges(){
  return [...courseEditor.draft.values()].filter(e=>courseEditorKey(e)!==courseEditorKey(courseEditor.originals.get(e.id)));
}
function openCourseEditor(id){
  if(!isAdmin())return false;
  const course=state.courses.find(c=>c.id===id);
  if(!course||courseEditor.busy)return false;
  if(courseEditorChanges().length&&!confirm('講習配置の未反映の変更があります。破棄して別の講習を開きますか？'))return false;
  courseEditor.courseId=id;
  courseEditor.date=course.startDate;
  courseEditor.originals=new Map(courseLessons(id).map(e=>[e.id,{...e}]));
  courseEditor.draft=new Map(courseLessons(id).map(e=>[e.id,{...e}]));
  courseEditor.history=[];courseEditor.selectedId='';courseEditor.warning='';courseEditor.courseSignature=courseEditorSettings(course);
  return true;
}
function courseEditorEntries(){return [...courseEditor.draft.values()];}
function courseEditorPeriod(course,entry){return course.periods.findIndex(p=>p.start===entry.start&&p.end===entry.end);}
function courseEditorValidate(id,target){
  const item=courseEditor.draft.get(id),course=state.courses.find(c=>c.id===courseEditor.courseId);
  if(!item||!course)return '講習または授業が見つかりません。';
  if(item.status!=='scheduled')return '実施済み・欠席の授業はこの画面から移動できません。';
  if(courseEditorSettings(course)!==courseEditor.courseSignature)return '講習期間・コマ設定が変更されています。変更を破棄して読み直してください。';
  if(target.date<course.startDate||target.date>course.endDate||courseFor(target.date)?.id!==course.id||hasCourseConflict(target.date))return '指定日は、この講習期間に含まれていません。';
  if(closureFor(target.date))return `${prettyDate(target.date)}は休校日です。`;
  if(!course.periods.some(p=>p.start===target.start&&p.end===target.end))return '講習で設定したコマを選択してください。';
  if(!state.people.some(p=>p.id===target.teacherUid))return '担当講師のアカウントが見つかりません。';
  const peer=courseEditorEntries().filter(e=>e.id!==id&&e.status!=='cancelled'&&e.date===target.date&&e.start<target.end&&e.end>target.start);
  if(peer.some(e=>e.studentId===item.studentId))return 'この時間帯は、同じ生徒の授業がすでに登録されています。';
  if(peer.filter(e=>e.teacherUid===target.teacherUid).length>=2)return '担当講師の同時指導は最大2人までです。';
  return '';
}
function courseEditorGapCount(entries,teacherUid,date,course){
  const periods=entries.filter(e=>e.teacherUid===teacherUid&&e.date===date&&e.status!=='cancelled')
    .map(e=>courseEditorPeriod(course,e)).filter(i=>i>=0);
  if(periods.length<2)return 0;
  const indices=[...new Set(periods)];
  return Math.max(0,Math.max(...indices)-Math.min(...indices)+1-indices.length);
}
function courseEditorMove(id,target){
  if(!isAdmin()||courseEditor.busy)return;
  const old=courseEditor.draft.get(id);
  if(!old)return;
  const next={...old,...target};
  if(courseEditorKey(next)===courseEditorKey(old)){courseEditor.selectedId='';renderCourseEditor();return;}
  const validation=courseEditorValidate(id,next);
  if(validation){showMessage(validation);return;}
  const course=state.courses.find(c=>c.id===courseEditor.courseId);
  const before=courseEditorEntries();
  const after=before.map(e=>e.id===id?next:e);
  const keys=[`${old.date}\u0000${old.teacherUid}`,`${next.date}\u0000${next.teacherUid}`];
  const worsened=keys.some(key=>{
    const [date,uid]=key.split('\u0000');
    return courseEditorGapCount(after,uid,date,course)>courseEditorGapCount(before,uid,date,course);
  });
  if(worsened&&!confirm('この移動により講師の勤務に空きコマが増えます。例外として配置しますか？'))return;
  const teacher=state.people.find(p=>p.id===next.teacherUid);
  courseEditor.history.push({id,previous:{...old}});
  courseEditor.draft.set(id,{...next,teacherName:teacher?.name||old.teacherName});
  courseEditor.selectedId='';
  courseEditor.warning='';
  renderCourseEditor();
}
function courseEditorSelect(id){
  const item=courseEditor.draft.get(id);
  if(item?.status!=='scheduled'){showMessage('この授業は移動できません。');return;}
  courseEditor.selectedId=courseEditor.selectedId===id?'':id;
  renderCourseEditor();
}
function courseEditorCellTarget(cell){
  const chosen=courseEditor.draft.get(courseEditor.selectedId);
  const course=state.courses.find(c=>c.id===courseEditor.courseId);
  if(!chosen||!course)return null;
  const period=course.periods[Number(cell.dataset.period)];
  if(!period)return null;
  return {date:cell.dataset.date,teacherUid:cell.dataset.teacher||chosen.teacherUid,start:period.start,end:period.end};
}
function courseEditorFromCell(cell){
  if(!courseEditor.selectedId)return;
  const target=courseEditorCellTarget(cell);
  if(target)courseEditorMove(courseEditor.selectedId,target);
}
function courseEditorCard(item){
  const card=make('button','editor-lesson'+(courseEditor.selectedId===item.id?' selected':'')+(item.status==='cancelled'?' is-absent':item.status==='done'?' is-done':''));
  card.type='button';card.dataset.lessonId=item.id;
  card.setAttribute('aria-pressed',String(courseEditor.selectedId===item.id));
  card.append(make('strong','',`${item.grade||''} ${item.studentName||'生徒名未設定'}`));
  card.append(make('small','',`${item.subject||'教科未設定'} / ${item.teacherName||'担当講師未設定'}${item.status==='done'?'（実施済）':item.status==='cancelled'?'（欠席）':''}`));
  card.title=`${prettyDate(item.date)} ${item.start}〜${item.end}。タップして移動先を選択、またはドラッグ。`;
  card.addEventListener('click',event=>{
    event.stopPropagation();
    if(courseEditor.suppressClick){courseEditor.suppressClick=false;return;}
    courseEditorSelect(item.id);
  });
  if(item.status!=='scheduled')return card;
  // Pointer events work in iPad Safari, unlike native HTML5 drag-and-drop.
  card.addEventListener('pointerdown',event=>{
    if(event.button!==0||courseEditor.busy)return;
    courseEditor.drag={id:item.id,pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false,target:null};
    try{card.setPointerCapture(event.pointerId);}catch(_e){}
  });
  card.addEventListener('pointermove',event=>{
    const drag=courseEditor.drag;
    if(!drag||drag.id!==item.id||drag.pointerId!==event.pointerId)return;
    if(!drag.moved && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<9)return;
    drag.moved=true;card.classList.add('dragging');
    const node=document.elementFromPoint(event.clientX,event.clientY);
    const slot=node?.closest?.('.editor-slot');
    document.querySelectorAll('.editor-slot.is-target').forEach(el=>el.classList.remove('is-target'));
    if(slot&&!slot.classList.contains('is-blocked')){slot.classList.add('is-target');drag.target=slot;}
    else drag.target=null;
  });
  card.addEventListener('pointerup',event=>{
    const drag=courseEditor.drag;
    if(!drag||drag.id!==item.id||drag.pointerId!==event.pointerId)return;
    courseEditor.drag=null;
    document.querySelectorAll('.editor-slot.is-target').forEach(el=>el.classList.remove('is-target'));
    card.classList.remove('dragging');
    if(drag.moved){
      courseEditor.suppressClick=true;
      // A capture target may have disappeared during touch scrolling.
      if(drag.target){courseEditor.selectedId=item.id;courseEditorFromCell(drag.target);}
      else showMessage('移動先のマスまでドラッグしてください。');
    }
  });
  card.addEventListener('pointercancel',()=>{courseEditor.drag=null;card.classList.remove('dragging');document.querySelectorAll('.editor-slot.is-target').forEach(el=>el.classList.remove('is-target'));});
  return card;
}
function courseEditorCell(date,periodIndex,teacherUid=''){
  const course=state.courses.find(c=>c.id===courseEditor.courseId),period=course.periods[periodIndex];
  const cell=make('td','editor-slot');cell.dataset.date=date;cell.dataset.period=String(periodIndex);if(teacherUid)cell.dataset.teacher=teacherUid;
  const closed=Boolean(closureFor(date)),outside=date<course.startDate||date>course.endDate||courseFor(date)?.id!==course.id||hasCourseConflict(date);
  if(closed||outside)cell.classList.add('is-blocked');
  if(closed)cell.classList.add('is-closed');
  cell.tabIndex=0;cell.setAttribute('role','button');
  cell.title=closed?'休校日':outside?'講習期間外':`${prettyDate(date)} ${periodIndex+1}限への移動先`;
  const contained=courseEditorEntries().filter(e=>e.date===date&&e.start===period.start&&e.end===period.end&&(!teacherUid||e.teacherUid===teacherUid));
  if(teacherUid && contained.filter(e=>e.status!=='cancelled').length>=2)cell.classList.add('is-full');
  const title=make('div','editor-slot-note',closed?'休校':outside?'期間外':teacherUid?`${contained.filter(e=>e.status!=='cancelled').length}/2人`:contained.length?`${contained.length}件`:'');
  cell.append(title);
  const bag=make('div','editor-slot-bag');contained.forEach(item=>bag.append(courseEditorCard(item)));cell.append(bag);
  if(!contained.length)cell.append(make('div','editor-slot-empty',closed?'休校':outside?'—':'+ 移動先'));
  cell.addEventListener('click',()=>{if(!closed&&!outside)courseEditorFromCell(cell);});
  cell.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!closed&&!outside){e.preventDefault();courseEditorFromCell(cell);}});
  return cell;
}
function renderCourseEditor(){
  if(!isAdmin()||state.page!=='courseEditor')return;
  const chooser=$('editorCourse'),keep=courseEditor.courseId;
  chooser.replaceChildren();
  for(const c of state.courses){const opt=make('option','',`${c.name}　${prettyDate(c.startDate)}〜${prettyDate(c.endDate)}`);opt.value=c.id;chooser.append(opt);}
  if(!courseEditor.courseId && state.courses.length && state.entriesStatus==='ready' && state.coursesStatus==='ready')openCourseEditor(state.courses.find(c=>c.endDate>=todayKey())?.id||state.courses.at(-1).id);
  if(courseEditor.courseId && !state.courses.some(c=>c.id===courseEditor.courseId))resetCourseEditor();
  chooser.value=courseEditor.courseId||'';
  const course=state.courses.find(c=>c.id===courseEditor.courseId);
  const host=$('editorGrid');host.replaceChildren();
  const ok=Boolean(course&&state.entriesStatus==='ready'&&state.coursesStatus==='ready'&&state.closuresStatus==='ready');
  $('editorDayMode').classList.toggle('active',courseEditor.mode==='day');$('editorWeekMode').classList.toggle('active',courseEditor.mode==='week');
  $('editorDayMode').setAttribute('aria-pressed',String(courseEditor.mode==='day'));
  $('editorWeekMode').setAttribute('aria-pressed',String(courseEditor.mode==='week'));
  $('editorDate').value=courseEditor.date;
  $('editorDate').disabled=!course;
  $('editorPrevious').disabled=!course;$('editorNext').disabled=!course;
  $('editorCancelSelection').hidden=!courseEditor.selectedId;
  $('editorUndo').disabled=!courseEditor.history.length||courseEditor.busy;
  const changes=courseEditorChanges();
  $('editorReset').disabled=!changes.length||courseEditor.busy;
  $('editorSave').disabled=!changes.length||!ok||courseEditor.busy;
  $('editorSave').textContent=courseEditor.busy?'反映中…':`確定して反映${changes.length?'（'+changes.length+'件）':''}`;
  $('editorStatus').textContent=!ok?(state.coursesStatus==='error'||state.entriesStatus==='error'?'講習や授業の読み込みに失敗しました':'講習・授業データの読込中です'):courseEditor.selectedId?'授業を選択中：日付を変更してから移動先をタップできます':changes.length?`未反映の変更：${changes.length}件（講師にはまだ公開されていません）`:'変更なし・講師に公開中の時間割';
  const otherEdits=changes.some(e=>{const current=state.entries.find(x=>x.id===e.id);return !current||courseEditorKey(current)!==courseEditorKey(courseEditor.originals.get(e.id));});
  const changedCourse=course&&courseEditorSettings(course)!==courseEditor.courseSignature;
  $('editorWarning').hidden=!(otherEdits||changedCourse||courseEditor.warning);
  $('editorWarning').textContent=changedCourse?'講習期間またはコマ設定が変わりました。変更を破棄して読み直してください。':otherEdits?'別の管理者が同じ授業を変更しました。古い内容は上書きせず、保存時に停止します。':courseEditor.warning;
  if(!ok){host.append(make('p','empty',state.courses.length?'時間割と講習・休校情報を読み込んでいます…':'講習期間がありません。「講習期間管理」で登録してください。'));return;}
  const teachers=state.people.filter(p=>['admin','employee'].includes(p.role)).sort((a,b)=>collator.compare(a.name||'',b.name||''));
  if(courseEditor.mode==='day'&&!teachers.length){host.append(make('p','empty','講師が登録されていません。'));return;}
  const isDay=courseEditor.mode==='day';
  const columns=isDay?teachers:[...Array(7)].map((_,i)=>datePlus(startOfWeek(courseEditor.date),i));
  const table=make('table','editor-grid');
  const thead=make('thead'),headRow=make('tr');headRow.append(make('th','editor-period-heading',isDay?prettyDate(courseEditor.date):'授業時間'));
  for(const column of columns){
    const text=isDay?column.name||column.id:prettyDate(column);
    headRow.append(make('th','',text));
  }
  thead.append(headRow);table.append(thead);
  const tbody=make('tbody');
  course.periods.forEach((p,i)=>{
    const tr=make('tr');tr.append(make('th','editor-period-heading',`${i+1}限\n${p.start}〜${p.end}`));
    for(const column of columns)tr.append(isDay?courseEditorCell(courseEditor.date,i,column.id):courseEditorCell(column,i));
    tbody.append(tr);
  });
  table.append(tbody);host.append(table);
}
$('editorCourse').addEventListener('change',e=>{if(!openCourseEditor(e.target.value))e.target.value=courseEditor.courseId;renderCourseEditor();});
$('editorDayMode').addEventListener('click',()=>{courseEditor.mode='day';renderCourseEditor();});
$('editorWeekMode').addEventListener('click',()=>{courseEditor.mode='week';renderCourseEditor();});
$('editorDate').addEventListener('change',e=>{if(e.target.value)courseEditor.date=e.target.value;renderCourseEditor();});
$('editorPrevious').addEventListener('click',()=>{courseEditor.date=datePlus(courseEditor.date,courseEditor.mode==='day'?-1:-7);renderCourseEditor();});
$('editorNext').addEventListener('click',()=>{courseEditor.date=datePlus(courseEditor.date,courseEditor.mode==='day'?1:7);renderCourseEditor();});
$('editorCancelSelection').addEventListener('click',()=>{courseEditor.selectedId='';renderCourseEditor();});
$('editorUndo').addEventListener('click',()=>{
  const last=courseEditor.history.pop();if(!last)return;
  courseEditor.draft.set(last.id,last.previous);courseEditor.selectedId='';renderCourseEditor();
});
$('editorReset').addEventListener('click',()=>{
  if(!courseEditorChanges().length)return;
  if(!confirm('未反映の変更をすべて破棄し、現在の時間割を読み直しますか？'))return;
  const id=courseEditor.courseId,date=courseEditor.date,mode=courseEditor.mode;
  courseEditor.draft=new Map();courseEditor.originals=new Map();courseEditor.history=[];
  openCourseEditor(id);courseEditor.date=date;courseEditor.mode=mode;renderCourseEditor();
});
async function publishCourseEditor(){
  if(!isAdmin()||courseEditor.busy)return;
  const changes=courseEditorChanges(),course=state.courses.find(c=>c.id===courseEditor.courseId);
  if(!changes.length||!course)return;
  if(changes.length>150){showMessage('一度に反映できる変更は150件までです。複数回に分けて確定してください。');return;}
  if(courseEditorSettings(course)!==courseEditor.courseSignature){showMessage('講習設定が変更されました。再読み込みしてください。');return;}
  for(const changed of changes){const error=courseEditorValidate(changed.id,changed);if(error){showMessage(error);return;}}
  if(!confirm(`${changes.length}件の講習授業の変更を確定し、講師の時間割に反映しますか？`))return;
  courseEditor.busy=true;renderCourseEditor();
  try{
    const dates=[...new Set(changes.flatMap(e=>[e.date,courseEditor.originals.get(e.id).date]))];
    // Fetch all known timetable documents on touched dates before the transaction.
    const snapshots=await Promise.all(dates.map(date=>getDocs(query(collection(db,'timetableEntries'),where('date','==',date)))));
    const peers=new Map(snapshots.flatMap(snap=>snap.docs).map(snap=>[snap.id,snap]));
    for(const change of changes){if(!peers.has(change.id))throw Error('元の授業を確認できません。画面を再読み込みしてください。');}
    const peerDocs=[...peers.values()];
    if(peerDocs.length>350)throw Error('対象日の授業が多すぎます。変更を分けて反映してください。');
    const courseRef=doc(db,'specialCourses',course.id);
    const closureRefs=dates.map(date=>doc(db,'schoolClosures',date));
    const affected=[...new Set(changes.flatMap(e=>[e.teacherUid,courseEditor.originals.get(e.id)?.teacherUid]).filter(Boolean))];
    await runTransaction(db,async tx=>{
      // Every read happens before the first write, including closure records.
      const courseSnap=await tx.get(courseRef);
      const closureSnaps=await Promise.all(closureRefs.map(r=>tx.get(r)));
      const fresh=await Promise.all(peerDocs.map(s=>tx.get(s.ref)));
      if(!courseSnap.exists()||courseEditorSettings(courseSnap.data())!==courseEditor.courseSignature)throw Error('講習期間・時間設定が変更されました。画面を再読み込みしてください。');
      if(closureSnaps.some(s=>s.exists()))throw Error('対象日に休校日が登録されました。再確認してください。');
      const current=new Map();
      for(let i=0;i<peerDocs.length;i++){
        const snap=peerDocs[i],now=fresh[i];
        if(!now.exists()||courseEditorKey(now.data())!==courseEditorKey(snap.data()))throw Error('他の管理者が授業予定を変更しました。再読み込みしてからやり直してください。');
        current.set(snap.id,{id:snap.id,...now.data()});
      }
      for(const change of changes){
        if(courseEditorKey(current.get(change.id))!==courseEditorKey(courseEditor.originals.get(change.id)))throw Error('移動対象の授業が変更されました。最新の時間割を確認してください。');
        current.set(change.id,{...current.get(change.id),...change});
      }
      // Validate every touched day against *all* currently known peer documents.
      for(const date of dates){
        const rows=[...current.values()].filter(e=>e.courseId===course.id&&e.date===date&&e.status!=='cancelled');
        for(let i=0;i<rows.length;i++){
          const e=rows[i];
          if(!course.periods.some(p=>p.start===e.start&&p.end===e.end))throw Error('登録されたコマと授業時間が一致しません。');
          for(let j=0;j<i;j++){
            const f=rows[j];if(e.start>=f.end||e.end<=f.start)continue;
            if(e.studentId===f.studentId)throw Error('同じ生徒の授業が重複しています。');
          }
          const count=rows.filter(x=>x.teacherUid===e.teacherUid&&x.start<e.end&&x.end>e.start).length;
          if(count>2)throw Error('担当講師が同時に3人以上の生徒を担当しています。');
        }
      }
      for(const change of changes){
        const teacher=state.people.find(p=>p.id===change.teacherUid);
        tx.update(doc(db,'timetableEntries',change.id),{date:change.date,start:change.start,end:change.end,teacherUid:change.teacherUid,teacherName:teacher?.name||change.teacherName});
      }
      for(const uid of affected){
        const ref=doc(collection(db,'notifications',uid,'items'));
        tx.set(ref,{message:'講習の担当授業が変更されました。時間割を確認してください。',date:changes[0].date,read:false,createdAt:serverTimestamp()});
      }
    });
    // Update local snapshot immediately; Firestore's real-time listener follows.
    for(const change of changes){const live=state.entries.find(e=>e.id===change.id);if(live)Object.assign(live,{date:change.date,start:change.start,end:change.end,teacherUid:change.teacherUid,teacherName:change.teacherName});}
    const id=courseEditor.courseId,date=courseEditor.date,mode=courseEditor.mode;
    courseEditor.draft=new Map();courseEditor.originals=new Map();courseEditor.history=[];
    openCourseEditor(id);courseEditor.date=date;courseEditor.mode=mode;
    showMessage(`${changes.length}件の講習授業を確定して反映しました。`);
    renderAll();
  }catch(error){console.error(error);courseEditor.warning=error.message||'反映できませんでした。';showMessage('反映できませんでした：'+courseEditor.warning);}
  finally{courseEditor.busy=false;renderCourseEditor();}
}
$('editorSave').addEventListener('click',publishCourseEditor);

function loggedOut(){
  resetSubscriptions();state.user=null;state.profile=null;state.entries=[];state.entriesStatus='loading';state.students=[];state.people=[];state.closures={};state.closuresStatus='loading';state.courses=[];state.coursesStatus='loading';state.notices=[];resetCourseEditor();
  $('loginPanel').hidden=false;$('appPanel').hidden=true;$('logout').hidden=true;$('notificationButton').hidden=true;$('identity').textContent='';$('password').value='';
  for(const d of document.querySelectorAll('dialog'))if(d.open)d.close();
}
async function loggedIn(user){
  resetSubscriptions();state.user=user;state.entries=[];state.entriesStatus='loading';state.closures={};state.closuresStatus='loading';state.courses=[];state.coursesStatus='loading';
  const profileSnap=await getDoc(doc(db,'users',user.uid));
  if(!profileSnap.exists()||!['admin','employee'].includes(profileSnap.data().role)){showMessage('利用者登録がありません。管理者に連絡してください。');await signOut(auth);return;}
  if(auth.currentUser?.uid!==user.uid)return;
  state.profile=profileSnap.data();
  const name=state.profile.name?.trim()||user.email||'ユーザー';
  $('welcomeName').textContent=`ようこそ、${name}さん`;
  $('identity').textContent=`${name}（${isAdmin()?'管理者':'教師'}）`;
  $('welcomeSub').textContent=isAdmin()?'生徒情報と授業の状況をまとめて管理できます。':'今日の授業・全教師の時間割・生徒情報を確認できます。';
  $('loginPanel').hidden=true;$('appPanel').hidden=false;$('logout').hidden=false;
  $('navCount').hidden=!isAdmin();$('navAdminLessons').hidden=!isAdmin();$('navClosures').hidden=!isAdmin();$('navCourses').hidden=!isAdmin();$('navCourseEditor').hidden=!isAdmin();$('navTeacherLessons').hidden=isAdmin();$('navTeacherStudents').hidden=isAdmin();$('addLesson').hidden=!isAdmin();$('notificationButton').hidden=isAdmin();$('teacherFilterWrap').hidden=isAdmin();
  resetCourseEditor();$('teacherFilter').value='mine';state.date=todayKey();state.scheduleView='day';document.querySelectorAll('[data-schedule-view]').forEach(button=>{const active=button.dataset.scheduleView==='day';button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  state.unsub.push(onSnapshot(collection(db,'schoolStudents'),snap=>{state.students=snap.docs.map(d=>({id:d.id,...d.data()}));renderAll();},err=>trapError(err,'生徒情報を取得できません')));
  state.unsub.push(onSnapshot(collection(db,'users'),snap=>{state.people=snap.docs.map(d=>({id:d.id,...d.data()}));renderAll();},err=>trapError(err,'教師情報を取得できません')));
  state.unsub.push(onSnapshot(collection(db,'timetableEntries'),snap=>{state.entries=snap.docs.map(d=>({id:d.id,...d.data()}));state.entriesStatus='ready';renderAll();},err=>{state.entriesStatus='error';trapError(err,'時間割を取得できません');}));
  state.unsub.push(onSnapshot(collection(db,'specialCourses'),snap=>{
    state.courses=snap.docs.map(d=>({id:d.id,...d.data()})).filter(c=>Array.isArray(c.periods) && c.startDate && c.endDate).sort((a,b)=>a.startDate.localeCompare(b.startDate));
    state.coursesStatus='ready';renderAll();
    if($('lessonFormDialog').open)syncLessonCoursePeriod(lessonById($('lessonId').value));
    if($('detailDialog').open && state.activeLesson){const lesson=lessonById(state.activeLesson);if(lesson)renderUpcomingForLesson(lesson);}
  },err=>{state.coursesStatus='error';trapError(err,'講習情報を取得できません');renderAll();}));
  state.unsub.push(onSnapshot(collection(db,'schoolClosures'),snap=>{
    state.closures=Object.fromEntries(snap.docs.map(d=>[d.id,{...d.data(),date:d.id}]));
    state.closuresStatus='ready';renderAll();
    if($('detailDialog').open && state.activeLesson){
      const active=lessonById(state.activeLesson);
      if(active)renderUpcomingForLesson(active);
    }
  },err=>{state.closuresStatus='error';trapError(err,'休校日情報を取得できません');renderAll();}));
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
