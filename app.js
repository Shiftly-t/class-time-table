import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, query, where, setDoc, deleteDoc, updateDoc, onSnapshot, serverTimestamp, writeBatch, runTransaction, increment, arrayUnion, Timestamp, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';
import { bookingAppCheckSiteKey } from './booking-config.js';
import { installNormalEditor } from './normal-editor.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js';

// A staging build must never contact the production Firebase project.
const IS_TEST_BUILD = document.documentElement.dataset.shiftlyEnvironment === 'test';
if(IS_TEST_BUILD && (!firebaseConfig.projectId || JSON.stringify(firebaseConfig).includes('shiftly-d02f6') || firebaseConfig.projectId.startsWith('REPLACE_'))){
  document.body.innerHTML='<main class="test-configuration-error"><h1>Shiftly-T TEST：設定が必要です</h1><p>テスト専用のFirebaseプロジェクトを作成し、config.jsをテスト用の値に差し替えてください。本番用プロジェクトへの接続は禁止されています。</p></main>';
  throw new Error('テスト用のFirebase設定が未完了、または本番のprojectIdを指定しています。');
}
const fbApp = initializeApp(firebaseConfig);
if (bookingAppCheckSiteKey && !bookingAppCheckSiteKey.startsWith('REPLACE_')) {
  initializeAppCheck(fbApp,{provider:new ReCaptchaEnterpriseProvider(bookingAppCheckSiteKey),isTokenAutoRefreshEnabled:true});
}
const bookingEditorCall=httpsCallable(getFunctions(fbApp,'asia-northeast1'),'bookingAdminApi');
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const $ = id => document.getElementById(id);
// 既存HTMLのrequired属性を解除（教科は文字列として空欄保存する）。
for (const id of ['lessonSubject','editorNewSubject']) { const el=$(id); if(el){el.required=false;el.placeholder='未入力でも保存できます';const label=el.closest('label');if(label?.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.textContent='教科（任意）';} }
const todayKey = () => dateKey(new Date());
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const datePlus = (value, increment) => { const [y,m,d] = value.split('-').map(Number); return dateKey(new Date(y,m-1,d+increment)); };
const prettyDate = value => { if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')) return value||''; const [y,m,d] = value.split('-').map(Number); return `${m}月${d}日（${'日月火水木金土'[new Date(y,m-1,d).getDay()]}）`; };
const isOwner = () => state.profile?.role === 'owner';
const isManagementRole = role => role === 'owner' || role === 'admin';
// 管理権限とは別に、担当講師として割り当て可能なロールを限定する。
const isAssignableTeacher = role => role === 'employee' || role === 'admin';
const isAdmin = () => isManagementRole(state.profile?.role);
const maintenanceState={loaded:false,enabled:false,message:'',version:'',updatedAt:null,startedAt:null,unsub:null,dataStarted:false,history:[],busy:false};
const state = { user:null, profile:null, date:todayKey(), scheduleView:'day', page:'', students:[], people:[], entries:[], entriesStatus:'loading', closures:{}, closuresStatus:'loading', openDays:{}, openDaysStatus:'loading', examEvents:{}, examStatus:'loading', courses:[], coursesStatus:'loading', notices:[], officialAnnouncements:[], officialSeenIds:new Set(), officialSeenReady:false, activeLesson:null, availability:new Map(), availabilityStatus:{}, availabilityUnsub:[], teacherAbsences:{}, teacherAbsencesStatus:'loading', unsub:[] };
let regularEditor=null;
const WEEKDAYS = ['日','月','火','水','木','金','土'];
const closureCalendarView={month:todayKey().slice(0,7),selected:todayKey()};
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
// Academic-year rollover is based on JST, not the device's local timezone.
// Legacy students created before this feature are assumed to have a 2026 school-year grade.
const LEGACY_GRADE_YEAR = 2026;
const GRADE_STAGES = ['小1','小2','小3','小4','小5','小6','中1','中2','中3','高1','高2','高3','卒業'];
const japanDateKey = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function academicYearForDate(date){
  const [year,month]=String(date||japanDateKey()).split('-').map(Number);
  return year-(month<4?1:0);
}
const academicYearJST = () => academicYearForDate(japanDateKey());
function gradeRecordYear(student){
  const v=Number(student?.gradeYear);
  return Number.isInteger(v) && v>=2000 && v<=2100 ? v : LEGACY_GRADE_YEAR;
}
function shiftGrade(value,years){
  const original=String(value||'').trim();
  if(!years)return original;
  const info=gradeInfo(original);
  let index=original==='卒業'?12:
    info.level==='elementary'?info.year-1:
    info.level==='middle'?5+info.year:
    info.level==='high'?8+info.year:-1;
  if(!Number.isInteger(years)||index<0||index>=GRADE_STAGES.length)return original;
  return GRADE_STAGES[Math.min(GRADE_STAGES.length-1,Math.max(0,index+years))];
}
function displayStudentGrade(student,date){
  return shiftGrade(student.grade,academicYearForDate(date)-gradeRecordYear(student));
}
function displayLessonGrade(lesson){
  const student=state.students.find(s=>s.id===lesson.studentId);
  return student?displayStudentGrade(student,lesson.date):lesson.grade||'';
}

function sortedStudents(students, search, level, sort){
  const term=(search||'').trim().toLocaleLowerCase('ja');
  const list=students.filter(s=>{
    if(level!=='all' && gradeInfo(displayStudentGrade(s)).level!==level)return false;
    return [s.name,displayStudentGrade(s),s.grade,s.school,s.textbook,s.remarks, s.regular].some(v=>String(v||'').toLocaleLowerCase('ja').includes(term));
  });
  const name=(a,b)=>collator.compare(a.name||'',b.name||'');
  list.sort((a,b)=>{
    const ag=gradeInfo(displayStudentGrade(a)),bg=gradeInfo(displayStudentGrade(b));
    if(sort==='nameAsc')return name(a,b);
    if(sort==='nameDesc')return name(b,a);
    if(sort==='schoolAsc')return collator.compare(a.school||'',b.school||'')||name(a,b);
    if(sort==='lessonCountDesc')return everySlot(b).length-everySlot(a).length||name(a,b);
    const gradeOrder=ag.rank-bg.rank||ag.year-bg.year||collator.compare(displayStudentGrade(a),displayStudentGrade(b))||name(a,b);
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
// Existing courses may retain the former winter label in Firestore. Display only.
function courseDisplayName(course){
  const year=/^\d{4}/.exec(String(course?.startDate||''))?.[0];
  const name=String(course?.name||'講習').replace(/冬季講習/g,'冬期講習').replace(/期間$/,'');
  return year?`${year}年度 ${name}`:name;
}
function isTeacherAbsentForLesson(entry){
  if(entry?.courseId||entry?.status==='cancelled'||!entry?.date||!entry?.teacherUid)return false;
  const record=state.teacherAbsences?.[`${entry.date}_${entry.teacherUid}`];
  return Array.isArray(record?.absentPeriods)&&CLASS_PERIODS.some(p=>entry.start<p.end&&entry.end>p.start&&record.absentPeriods.includes(p.number));
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

// Japanese national holidays: statutory calculations for 2000–2099.
// Future equinox dates and exceptional statutory changes must be checked against
// the Cabinet Office's published calendar at each annual rollout.
const holidayCache=new Map();
function japaneseHolidays(year){
  if(holidayCache.has(year))return holidayCache.get(year);
  const h=new Map();
  const put=(m,d,name)=>h.set(`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,name);
  const nthMonday=(m,n)=>{const first=new Date(year,m-1,1).getDay();return 1+(8-first)%7+(n-1)*7;};
  put(1,1,'元日');put(1,nthMonday(1,2),'成人の日');put(2,11,'建国記念の日');
  if(year>=2020)put(2,23,'天皇誕生日');
  const spring=Math.floor(20.8431+0.242194*(year-1980)-Math.floor((year-1980)/4));
  const autumn=Math.floor(23.2488+0.242194*(year-1980)-Math.floor((year-1980)/4));
  put(3,spring,'春分の日');put(4,29,'昭和の日');put(5,3,'憲法記念日');put(5,4,'みどりの日');put(5,5,'こどもの日');
  put(7,nthMonday(7,3),'海の日');put(8,11,'山の日');put(9,nthMonday(9,3),'敬老の日');put(9,autumn,'秋分の日');
  put(10,nthMonday(10,2),'スポーツの日');put(11,3,'文化の日');put(11,23,'勤労感謝の日');
  // The Olympic-year exceptions are not ordinary calendar rules.
  if(year===2020){h.delete(`${year}-07-20`);h.delete(`${year}-10-12`);h.delete(`${year}-08-11`);put(7,23,'海の日');put(7,24,'スポーツの日');put(8,10,'山の日');}
  if(year===2021){h.delete(`${year}-07-19`);h.delete(`${year}-10-11`);h.delete(`${year}-08-11`);put(7,22,'海の日');put(7,23,'スポーツの日');put(8,8,'山の日');}
  const originals=[...h.keys()].sort();
  // Citizen's holidays lie between two national holidays (e.g., 2026-09-22).
  for(let day=1;day<=365+(new Date(year,1,29).getMonth()===1?1:0);day++){
    const d=dateKey(new Date(year,0,day));
    if(d.slice(0,4)!==String(year)||h.has(d)||new Date(...d.split('-').map((v,i)=>i===1?Number(v)-1:Number(v))).getDay()===0)continue;
    if(h.has(datePlus(d,-1))&&h.has(datePlus(d,1)))h.set(d,'国民の休日');
  }
  // Substitute holiday: for each Sunday national holiday, first subsequent
  // non-holiday weekday (including a chain of Golden Week holidays).
  for(const d of originals){
    const [y,m,day]=d.split('-').map(Number);
    if(new Date(y,m-1,day).getDay()!==0)continue;
    let after=datePlus(d,1);
    while(h.has(after))after=datePlus(after,1);
    h.set(after,'振替休日');
  }
  holidayCache.set(year,h);return h;
}
function automaticClosure(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return null;
  const [year,month,day]=date.split('-').map(Number);
  if(year<2000||year>2099)return null;
  const weekday=new Date(year,month-1,day).getDay();
  const holiday=japaneseHolidays(year).get(date);
  if(!holiday&&weekday!==0)return null;
  return {date,note:holiday?`${holiday}のため休校`:'日曜日のため休校',automatic:true,holidayName:holiday||''};
}

// School opening exceptions and mock exams take priority over automatic/manual closures.
// Neither action deletes the underlying closure. Removing the exception restores it.
function closureFor(date){return (openDayFor(date)||examFor(date)) ? null : (state.closures[date] || automaticClosure(date));}
function explicitClosureFor(date){return state.closures[date]||null;}
function openDayFor(date){return state.openDays[date]||null;}
function examFor(date){return state.examEvents[date]||null;}
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
  const save = form?.querySelector('button[type="submit"]');
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
['studentForm', 'lessonForm', 'memoForm', 'closureForm', 'openDayForm', 'courseForm', 'courseDeadlineForm'].forEach(enableOneTapSave);


// ────────────────────────────────────────────────────────────────────────────
// Owner audit and safe recovery. Every event stores the previous and new record
// so accidental deletes can be reversed. Records are written atomically with
// application changes wherever possible; Firebase Console edits are NOT traced.
// ────────────────────────────────────────────────────────────────────────────
const OWNER_ROOT_COLLECTIONS=['schoolStudents','timetableEntries','monthlyTargets','specialCourses','schoolClosures','schoolOpenDays','schoolEvents'];
const auditState={logs:[],archives:[],busy:false,loaded:false};
function archivedValue(value){
  if(value===null||value===undefined)return null;
  if(value instanceof Date)return {__shiftlyType:'timestamp',value:value.toISOString()};
  if(typeof value?.toDate==='function')return {__shiftlyType:'timestamp',value:value.toDate().toISOString()};
  if(value?._methodName==='serverTimestamp')return {__shiftlyType:'serverNow'};
  if(Array.isArray(value))return value.map(archivedValue);
  if(typeof value==='object'){
    const obj={};for(const [key,val] of Object.entries(value))if(val!==undefined)obj[key]=archivedValue(val);return obj;
  }
  return value;
}
function unarchiveValue(value){
  if(value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(unarchiveValue);
  if(value.__shiftlyType==='timestamp')return Timestamp.fromDate(new Date(value.value));
  if(value.__shiftlyType==='serverNow')return serverTimestamp();
  return Object.fromEntries(Object.entries(value).map(([key,val])=>[key,unarchiveValue(val)]));
}
const auditJson=value=>JSON.stringify(value==null?null:archivedValue(value));
function cleanRecord(data){
  if(data==null)return null;
  const clone={...data};for(const k of ['id','virtual','displayPeriod','splitTotal','splitIndex'])delete clone[k];
  return clone;
}
function validOwnerDocPath(path){
  const seg=String(path||'').split('/');
  if(seg.length===2)return OWNER_ROOT_COLLECTIONS.includes(seg[0])&&Boolean(seg[1])&&!seg[1].includes('..');
  return seg.length===4 && seg[0]==='specialCourses' && seg[1] && (seg[2]==='teacherAvailability'||seg[2]==='scheduleMeta')&&seg[3]&&!seg.some(x=>x==='..');
}
function auditChange(writer,path,before,after,action,summary,groupId=''){
  if(!state.user||!validOwnerDocPath(path))throw Error('変更履歴の対象が不正です');
  const beforeJson=auditJson(cleanRecord(before)),afterJson=auditJson(cleanRecord(after));
  if(beforeJson.length>300000||afterJson.length>300000)throw Error('変更履歴が大きすぎるため、保存できません。運営に確認してください。');
  writer.set(doc(collection(db,'auditLogs')),{path,action,summary:String(summary||path).slice(0,150),actorUid:state.user.uid,
    actorName:(state.profile?.name||'担当者').slice(0,90),beforeJson,afterJson,groupId:String(groupId||'').slice(0,100),courseId:path.includes('/teacherAvailability/')?path.split('/')[1]:'',createdAt:serverTimestamp()});
}
function stampedRestoreData(path,data){
  const restored=unarchiveValue(data);
  if(restored==null)return null;
  if(/^(specialCourses\/[^/]+|schoolClosures\/[^/]+|schoolOpenDays\/[^/]+|schoolEvents\/[^/]+|specialCourses\/[^/]+\/teacherAvailability\/[^/]+|specialCourses\/[^/]+\/scheduleMeta\/[^/]+)$/.test(path)){
    restored.updatedAt=serverTimestamp();restored.updatedBy=state.user.uid;
  }
  return restored;
}
function ownerOperationBusy(busy,text=''){
  auditState.busy=busy;
  for(const id of ['ownerCreateBackup','ownerRefresh','ownerDownloadBackup','ownerRestoreBackup'])if($(id))$(id).disabled=busy;
  if(text)$('ownerAuditMessage').textContent=text;
}
function doubleConfirmRecovery(message){
  if(!confirm(`【復元確認 1/2】\n${message}\n\n現在のデータが上書き・削除される可能性があります。続行しますか？`))return false;
  return prompt(`【復元確認 2/2】\n${message}\n\n実行する場合は「復元する」と入力してください。`)==='復元する';
}
function formatAuditDate(value){return value?.toDate?.()?.toLocaleString('ja-JP')||'日時不明';}
async function gatherOwnerRecords(){
  if(!isOwner())throw Error('運営アカウント専用です');
  const records=[];
  for(const name of OWNER_ROOT_COLLECTIONS){
    const docs=await getDocs(collection(db,name));
    for(const item of docs.docs)records.push({path:item.ref.path,data:archivedValue(item.data())});
    if(records.length>10000)throw Error('バックアップ対象が多すぎます。分割バックアップが必要です。');
    if(name==='specialCourses'){
      for(const course of docs.docs){
        for(const nested of ['teacherAvailability','scheduleMeta']){
          const children=await getDocs(collection(db,'specialCourses',course.id,nested));
          for(const child of children.docs)records.push({path:child.ref.path,data:archivedValue(child.data())});
        }
      }
    }
  }
  return records;
}
function splitOwnerArchive(records){
  const chunks=[];let chunk=[],size=2;
  for(const record of records){
    const estimated=JSON.stringify(record).length+4;
    if(estimated>70000)throw Error('1件のデータが大きすぎてバックアップできません。');
    if(chunk.length&&(chunk.length>=45||size+estimated>75000)){
      chunks.push(chunk);chunk=[];size=2;
    }
    chunk.push(record);size+=estimated;
  }
  if(chunk.length)chunks.push(chunk);
  return chunks;
}
async function createOwnerArchive(label='手動バックアップ'){
  if(!isOwner())throw Error('運営アカウント専用です');
  const records=await gatherOwnerRecords();
  const parts=splitOwnerArchive(records);
  const archiveRef=doc(collection(db,'backupArchives'));
  if(parts.length>500)throw Error('バックアップの分割数が上限を超えています。');
  // Write all parts first, and publish the metadata ONLY when all succeed.
  for(let i=0;i<parts.length;i+=20){
    const batch=writeBatch(db);
    for(let j=i;j<Math.min(parts.length,i+20);j++)batch.set(doc(db,'backupArchives',archiveRef.id,'parts',String(j).padStart(5,'0')),{json:JSON.stringify(parts[j])});
    await batch.commit();
  }
  await setDoc(archiveRef,{label:String(label).slice(0,100),createdBy:state.user.uid,createdAt:serverTimestamp(),partCount:parts.length,recordCount:records.length,formatVersion:1});
  return {id:archiveRef.id,recordCount:records.length,partCount:parts.length};
}
async function readOwnerArchive(id){
  if(!isOwner())throw Error('運営アカウント専用です');
  const meta=await getDoc(doc(db,'backupArchives',id));
  if(!meta.exists()||meta.data().formatVersion!==1)throw Error('復元可能なバックアップではありません。');
  const parts=[];
  for(let i=0;i<meta.data().partCount;i++){
    const part=await getDoc(doc(db,'backupArchives',id,'parts',String(i).padStart(5,'0')));
    if(!part.exists())throw Error('バックアップの一部がありません。復元は中止しました。');
    const data=JSON.parse(part.data().json);if(!Array.isArray(data))throw Error('バックアップ形式が不正です');
    parts.push(...data);
  }
  if(parts.length!==meta.data().recordCount||parts.some(item=>!validOwnerDocPath(item.path)))throw Error('バックアップの整合性が確認できません');
  return {meta:meta.data(),records:parts};
}
function downloadOwnerJson(name,object){
  const blob=new Blob([JSON.stringify(object,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function reloadOwnerTools(){
  if(!isOwner())return;
  const [logs,archives]=await Promise.all([
    getDocs(query(collection(db,'auditLogs'),orderBy('createdAt','desc'),limit(150))),
    getDocs(query(collection(db,'backupArchives'),orderBy('createdAt','desc'),limit(80)))
  ]);
  auditState.logs=logs.docs.map(d=>({id:d.id,...d.data()}));
  auditState.archives=archives.docs.map(d=>({id:d.id,...d.data()}));
  auditState.loaded=true;renderOwnerTools();
}
async function loadOwnerTools(){
  if(!isOwner())return;
  $('ownerAuditMessage').textContent='変更履歴とバックアップを確認しています…';
  try{await reloadOwnerTools();$('ownerAuditMessage').textContent='最近の変更履歴を最大150件表示しています。';}
  catch(error){trapError(error,'変更履歴を取得できませんでした');$('ownerAuditMessage').textContent='読み込みに失敗しました。Firebaseルールを確認してください。';}
}
function renderOwnerTools(){
  const logHost=$('ownerAuditList'),archiveHost=$('ownerArchiveList');
  logHost.replaceChildren();archiveHost.replaceChildren();
  if(!auditState.logs.length)logHost.append(make('p','empty','まだ記録された変更履歴がありません。新版の適用後の操作から記録されます。'));
  for(const log of auditState.logs){
    const card=make('article','owner-audit-card'),head=make('div','owner-audit-head');
    head.append(make('strong','',log.summary||'データの変更'),make('span','owner-audit-time',formatAuditDate(log.createdAt)));
    card.append(head,make('p','owner-audit-meta',`${log.actorName||'不明'} ・ ${log.action||'変更'} ・ ${log.path||''}`));
    const controls=make('div','owner-audit-controls');
    for(const [label,key] of [['変更前に戻す','beforeJson'],['変更後に戻す','afterJson']]){
      const btn=make('button','ghost',label);btn.type='button';btn.disabled=auditState.busy||log.action==='全体復元';
      btn.addEventListener('click',()=>restoreOwnerHistory(log,key));controls.append(btn);
    }
    card.append(controls);logHost.append(card);
  }
  if(!auditState.archives.length)archiveHost.append(make('p','empty','クラウドバックアップはまだありません。'));
  for(const archive of auditState.archives){
    const row=make('div','owner-archive-row');
    const info=make('div','owner-archive-info');
    info.append(make('strong','',archive.label||'バックアップ'),make('small','',`${formatAuditDate(archive.createdAt)} ・ ${archive.recordCount}件`));row.append(info);
    const dl=make('button','ghost','JSON保存');dl.type='button';dl.addEventListener('click',()=>downloadOwnerArchive(archive.id));
    const rollback=make('button','danger-soft','全体復元');rollback.type='button';rollback.addEventListener('click',()=>restoreOwnerArchive(archive));
    row.append(dl,rollback);archiveHost.append(row);
  }
}
async function downloadOwnerArchive(id){
  if(!isOwner()||auditState.busy)return;
  ownerOperationBusy(true,'JSONファイルを作成中…');
  try{const data=await readOwnerArchive(id);downloadOwnerJson(`Shiftly-T-backup-${id}.json`,{format:'Shiftly-T-operational-backup-v1',exportedAt:new Date().toISOString(),...data});}
  catch(error){trapError(error,'バックアップのダウンロードに失敗しました');}
  finally{ownerOperationBusy(false,'JSONの作成が完了しました。');renderOwnerTools();}
}
async function restoreOwnerHistory(log,key){
  if(!isOwner()||auditState.busy||log.action==='全体復元')return;
  if(!validOwnerDocPath(log.path)){showMessage('復元対象のパスが不正です。');return;}
  if(!doubleConfirmRecovery(`${log.summary||log.path}\n${key==='beforeJson'?'変更前':'変更後'}の状態に復元します。`))return;
  ownerOperationBusy(true,'安全バックアップを作成してから、選択した履歴を復元しています…');
  try{
    const archived=JSON.parse(log[key]);
    await createOwnerArchive(`[自動] 履歴復元前 ${log.summary||''}`);
    const target=doc(db,log.path),historyRef=doc(collection(db,'auditLogs'));
    await runTransaction(db,async tx=>{
      const current=await tx.get(target);
      const old=current.exists()?current.data():null;
      const desired=archived===null?null:stampedRestoreData(log.path,archived);
      if(desired===null)tx.delete(target);else tx.set(target,desired);
      auditChange({set:(ref,data)=>tx.set(ref,data)},log.path,old,desired,'復元',`履歴から復元：${log.summary||log.path}`);
    });
    await reloadOwnerTools();showMessage('選択した履歴の内容に復元しました。復元操作も履歴に記録しました。');
  }catch(error){trapError(error,'履歴の復元に失敗しました。安全バックアップを確認してください');}
  finally{ownerOperationBusy(false,'復元処理が終了しました。');renderOwnerTools();}
}
async function restoreOwnerArchive(archive){
  if(!isOwner()||auditState.busy)return;
  if(!doubleConfirmRecovery(`「${archive.label}」（${archive.recordCount}件）に業務データ全体を戻します。\n現在の登録内容のうちバックアップにないものは削除されます。`))return;
  ownerOperationBusy(true,'復元データを検証しています…');
  try{
    const {records}=await readOwnerArchive(archive.id);
    // Safety copy of the current live data is committed BEFORE the first restore write.
    const safety=await createOwnerArchive(`[自動] 全体復元前 ${archive.label}`);
    $('ownerAuditMessage').textContent=`復元前の安全バックアップ（${safety.id}）を保存しました。データを順番に復元しています…`;
    const existing=await gatherOwnerRecords(),wanted=new Map(records.map(r=>[r.path,r]));
    const obsolete=existing.filter(item=>!wanted.has(item.path));
    const groups=[
      records.filter(r=>r.path.startsWith('schoolStudents/')||r.path.startsWith('specialCourses/')&&r.path.split('/').length===2),
      records.filter(r=>['schoolClosures','schoolEvents','monthlyTargets'].includes(r.path.split('/')[0])),
      records.filter(r=>r.path.split('/').length===4),
      records.filter(r=>r.path.startsWith('timetableEntries/'))
    ];
    // All writes are chunked because the Firestore SDK has a batch write limit.
    // A failed phase leaves the PRE-RESTORE backup available for recovery.
    let processed=0;
    for(const group of groups){
      for(let offset=0;offset<group.length;offset+=180){
        const batch=writeBatch(db);
        for(const record of group.slice(offset,offset+180))batch.set(doc(db,record.path),stampedRestoreData(record.path,record.data));
        await batch.commit();processed+=Math.min(180,group.length-offset);
        $('ownerAuditMessage').textContent=`復元中 ${processed}/${records.length}件…`;
      }
    }
    const deletedOrder=obsolete.sort((a,b)=>{
      const priority=p=>p.startsWith('timetableEntries/')?0:p.split('/').length===4?1:p.startsWith('schoolStudents/')?3:p.startsWith('specialCourses/')?4:2;
      return priority(a.path)-priority(b.path);
    });
    for(let offset=0;offset<deletedOrder.length;offset+=180){
      const batch=writeBatch(db);for(const record of deletedOrder.slice(offset,offset+180))batch.delete(doc(db,record.path));await batch.commit();
    }
    const batch=writeBatch(db);
    auditChange(batch,`schoolStudents/${archive.id}`,null,null,'全体復元',`全体バックアップを復元：${archive.label}`);
    await batch.commit();
    await reloadOwnerTools();
    showMessage('全体復元が完了しました。復元前の安全バックアップも保存してあります。');
  }catch(error){trapError(error,'全体復元が中断しました。復元前の自動バックアップから復旧できるよう保全しています');}
  finally{ownerOperationBusy(false,'処理が終了しました。必要に応じて画面を再読み込みしてください。');renderOwnerTools();}
}
$('ownerCreateBackup').addEventListener('click',async()=>{
  if(!isOwner()||auditState.busy)return;
  const label=($('ownerBackupLabel').value||'手動バックアップ').trim().slice(0,100);
  ownerOperationBusy(true,'Firebase上にバックアップを作成しています…');
  try{const archive=await createOwnerArchive(label);await reloadOwnerTools();showMessage(`${archive.recordCount}件のバックアップをFirebaseに保存しました。`);}
  catch(error){trapError(error,'バックアップを作成できませんでした');}
  finally{ownerOperationBusy(false,'バックアップ処理が終了しました。');renderOwnerTools();}
});
$('ownerRefresh').addEventListener('click',loadOwnerTools);

function resetSubscriptions(){state.unsub.forEach(fn=>fn());state.unsub=[];maintenanceState.dataStarted=false;}

// Readable by registered users even when ordinary data access is blocked.
const MAINTENANCE_REF = doc(db,'systemConfig','maintenance');
function applyMaintenanceState(){
  const blocked=maintenanceState.enabled && !isOwner();
  $('maintenancePanel').hidden=!blocked;
  $('appPanel').hidden=blocked || !maintenanceState.loaded;
  $('notificationButton').hidden=blocked || !maintenanceState.loaded;
  $('maintenanceMessage').textContent=maintenanceState.message||'現在、機能の更新と動作確認を行っています。';
  $('maintenanceVersion').textContent=maintenanceState.version?`対象バージョン：${maintenanceState.version}`:'';
  $('maintenanceStatus').textContent=maintenanceState.loaded?'ただいまメンテナンス中です':'利用状況を確認しています…';
  if(!blocked && maintenanceState.loaded && state.user){ $('notificationButton').hidden=false; }
  if(isOwner())renderMaintenanceOwner();
}
function renderMaintenanceOwner(){
  if(!isOwner()||!$('maintenanceOwnerPage'))return;
  $('maintenanceModeLabel').textContent=maintenanceState.enabled?'メンテナンス中':'通常運用中';
  $('maintenanceModeLabel').className='maintenance-badge'+(maintenanceState.enabled?' is-active':'');
  $('maintenanceOwnerCurrent').textContent=maintenanceState.enabled?'現在、管理者・講師の業務データアクセスを停止しています。運営のみ操作できます。':'管理者・講師が通常利用できる状態です。';
  $('maintenanceStart').hidden=maintenanceState.enabled;
  $('maintenanceEnd').hidden=!maintenanceState.enabled;
  $('maintenanceStart').disabled=maintenanceState.busy;
  $('maintenanceEnd').disabled=maintenanceState.busy;
  $('maintenanceRecord').disabled=maintenanceState.busy;
  const host=$('maintenanceHistoryList');host.replaceChildren();
  if(!maintenanceState.history.length){host.append(make('p','empty','メンテナンス履歴はまだありません。'));return;}
  for(const item of maintenanceState.history){
    const row=make('article','maintenance-history-item');
    const kind=item.type==='start'?'メンテナンス開始':item.type==='end'?'メンテナンス終了':'更新内容の記録';
    row.append(make('strong','',kind),make('small','',formatAuditDate(item.createdAt)));
    row.append(make('p','',item.message||'記録なし'));
    row.append(make('small','',`記録者：${item.actorName||'運営'}${item.version?' ／ '+item.version:''}${item.backupId?' ／ 開始前バックアップあり':''}`));
    host.append(row);
  }
}
async function loadMaintenanceHistory(){
  if(!isOwner())return;
  try{
    const rows=await getDocs(query(collection(db,'maintenanceEvents'),orderBy('createdAt','desc'),limit(50)));
    maintenanceState.history=rows.docs.map(row=>({id:row.id,...row.data()}));
    renderMaintenanceOwner();
  }catch(error){trapError(error,'メンテナンス履歴を取得できませんでした');}
}
async function changeMaintenance(type){
  if(!isOwner()||maintenanceState.busy||!maintenanceState.loaded)return;
  const enabled=type==='start'?true:type==='end'?false:maintenanceState.enabled;
  if(type==='start'&&maintenanceState.enabled||type==='end'&&!maintenanceState.enabled)return;
  const message=$('maintenanceNoticeInput').value.trim().slice(0,300);
  const version=$('maintenanceVersionInput').value.trim().slice(0,50);
  if(type==='start'&&!confirm('メンテナンスモードを開始します。管理者・講師はサイト内の業務データへアクセスできなくなります。開始しますか？'))return;
  if(type==='end'&&!confirm('動作確認は完了しましたか？メンテナンスモードを終了して管理者・講師の利用を再開しますか？'))return;
  if(type==='update'&&!message){showMessage('更新内容を入力してください。');return;}
  maintenanceState.busy=true;renderMaintenanceOwner();
  try{
    let backupId='';
    if(type==='start'){
      $('maintenanceProgress').textContent='停止前のバックアップを作成しています…';
      const backup=await createOwnerArchive('メンテナンス開始前 '+new Date().toLocaleString('ja-JP'));
      backupId=backup.id;
    }
    const eventRef=doc(collection(db,'maintenanceEvents'));
    const record={type,toEnabled:enabled,message,version,actorUid:state.user.uid,
      actorName:(state.profile?.name||'運営').slice(0,90),backupId,createdAt:serverTimestamp()};
    const config={enabled,message,version,updatedBy:state.user.uid,updatedAt:serverTimestamp(),
      lastEventId:eventRef.id,startedAt:enabled?(maintenanceState.enabled?maintenanceState.startedAt||serverTimestamp():serverTimestamp()):null};
    const batch=writeBatch(db);
    batch.set(eventRef,record);
    batch.set(MAINTENANCE_REF,config);
    await batch.commit();
    $('maintenanceProgress').textContent=type==='start'?'メンテナンスを開始しました。':type==='end'?'メンテナンスを終了しました。':'更新内容を履歴に記録しました。';
    await loadMaintenanceHistory();
  }catch(error){trapError(error,'メンテナンス設定を保存できませんでした');$('maintenanceProgress').textContent='設定を変更できませんでした。停止状態を確認してください。';}
  finally{maintenanceState.busy=false;renderMaintenanceOwner();}
}
$('maintenanceStart').addEventListener('click',()=>changeMaintenance('start'));
$('maintenanceEnd').addEventListener('click',()=>changeMaintenance('end'));
$('maintenanceRecord').addEventListener('click',()=>changeMaintenance('update'));
$('maintenanceHistoryRefresh').addEventListener('click',loadMaintenanceHistory);

function nav(page) {
  if(state.page==='adminLessons'&&page!=='adminLessons'&&regularEditor?.hasChanges()){
    if(!confirm('未確定の講師欠席・担当振替があります。破棄して画面を移動しますか？'))return;
    regularEditor.reset();
  }
  state.page=page;
  $('adminCountPage').hidden=page!=='count';
  $('teacherStudentsPage').hidden=page!=='students';
  $('closuresPage').hidden=page!=='closures';
  $('closurePageTitle').textContent=isAdmin()?'休校日管理':'休校日カレンダー';
  $('closurePageDescription').textContent=isAdmin()?'日曜・祝日の休校を日付ごとに解除できます。通常授業・講習の両方に適用されます。':'休校日・特別開校日・模試の予定を閲覧できます（編集は管理者のみ）。';
  $('coursesPage').hidden=page!=='courses';
  $('normalEditorPage').hidden=page!=='adminLessons';
  $('courseEditorPage').hidden=page!=='courseEditor';
  $('availabilityPage').hidden=page!=='availability';
  $('ownerHistoryPage').hidden=page!=='ownerHistory';
  $('maintenanceOwnerPage').hidden=page!=='maintenanceOwner';
  $('lessonsPage').hidden=page==='count'||page==='students'||page==='closures'||page==='courses'||page==='courseEditor'||page==='availability'||page==='ownerHistory'||page==='maintenanceOwner'||page==='adminLessons';
  for(const [id,p] of [['navCount','count'],['navAdminLessons','adminLessons'],['navClosures','closures'],['navCourses','courses'],['navAvailability','availability'],['navTeacherLessons','teacherLessons'],['navTeacherStudents','students'],['navOwnerHistory','ownerHistory'],['navMaintenanceOwner','maintenanceOwner']]) $(''+id).classList.toggle('active',page===p || (id==='navCourses'&&isAdmin()&&(page==='availability'||page==='courseEditor'))||(id==='navAdminLessons'&&page==='adminSchedule'));
  if(page==='count')renderCount();
  else if(page==='students')renderTeacherStudents();
  else if(page==='closures')renderClosures();
  else if(page==='courses')renderCourses();
  else if(page==='adminLessons')regularEditor?.open(state.date);
  else if(page==='courseEditor')renderCourseEditor();
  else if(page==='availability')renderAvailabilityPage();
  else if(page==='ownerHistory')loadOwnerTools();
  else if(page==='maintenanceOwner'){renderMaintenanceOwner();loadMaintenanceHistory();}
  else {
    $('scheduleHeading').textContent=isAdmin()?'授業管理':'今日の時間割';
    $('scheduleDescription').textContent=isAdmin()?'全教師の授業を確認・変更できます。':'全教師の時間割と伝達事項を閲覧できます。';
    renderLessons();
  }
  renderAvailabilityHome();
}
$('navCount').addEventListener('click',()=>nav('count'));
$('navAdminLessons').addEventListener('click',()=>nav('adminLessons'));
$('navClosures').addEventListener('click',()=>nav('closures'));
$('navCourses').addEventListener('click',()=>{if(isAdmin())nav('courses');});
$('navAvailability').addEventListener('click',()=>nav('availability'));
function preferredCourse(){
  const visible=state.courses.filter(course=>course.archived!==true);return visible.find(course=>course.endDate>=todayKey())||visible.at(-1)||null;
}
$('coursesOpenAvailability').addEventListener('click',()=>{
  if(!isAdmin())return;
  const course=preferredCourse();
  if(course)openAvailabilityFromHome(course.id);
  else nav('availability');
});
$('coursesOpenEditor').addEventListener('click',()=>{
  if(!isAdmin())return;
  const course=preferredCourse();
  if(!course){showMessage('先に講習期間を登録してください。');return;}
  if(openCourseEditor(course.id))nav('courseEditor');
});
$('editorBackToCourses').addEventListener('click',()=>{if(isAdmin())nav('courses');});
$('availabilityBackToCourses').addEventListener('click',()=>{if(isAdmin())nav('courses');});
$('navTeacherLessons').addEventListener('click',()=>nav('teacherLessons'));
$('navTeacherStudents').addEventListener('click',()=>nav('students'));
$('navOwnerHistory').addEventListener('click',()=>{if(isOwner())nav('ownerHistory');});
$('navMaintenanceOwner').addEventListener('click',()=>{if(isOwner())nav('maintenanceOwner');});
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
// Repeated manager tabs are safe: each transaction rereads the current gradeYear.
let gradePromotionRunning=false;
async function persistAnnualGradePromotion(){
  if(!state.user||!isAdmin()||gradePromotionRunning)return;
  const year=academicYearJST();
  const pending=state.students.filter(student=>{
    const from=gradeRecordYear(student);
    return from<year && shiftGrade(student.grade,year-from)!==student.grade;
  });
  if(!pending.length)return;
  gradePromotionRunning=true;
  const userUid=state.user.uid;
  try{
    for(const student of pending){
      if(state.user?.uid!==userUid||!isAdmin())break;
      await runTransaction(db,async tx=>{
        const ref=doc(db,'schoolStudents',student.id);
        const snap=await tx.get(ref);
        if(!snap.exists())return;
        const data=snap.data();
        const from=gradeRecordYear(data);
        const next=shiftGrade(data.grade,year-from);
        if(from>=year||next===data.grade)return;
        tx.update(ref,{grade:next,gradeYear:year});
        auditChange({set:(r,d)=>tx.set(r,d)},ref.path,data,{...data,grade:next,gradeYear:year},'自動進級',`${data.name||student.name}さんの学年進級`);
      });
    }
  }catch(error){
    console.error('学年自動更新に失敗しました',error);
    showMessage('学年の自動更新を保存できませんでした。通信状態を確認して再読み込みしてください。');
  }finally{gradePromotionRunning=false;}
}
let renderedAcademicYear=academicYearJST();
function refreshAcademicYear(){
  const nowYear=academicYearJST();
  if(nowYear===renderedAcademicYear)return;
  renderedAcademicYear=nowYear;
  if(!state.user)return;
  renderAll();
  persistAnnualGradePromotion();
}
// Schedule the rollover close to 00:00 JST on April 1, even if the app stays open.
function scheduleAcademicYearRefresh(){
  const [year,month]=japanDateKey().split('-').map(Number);
  const nextApril=month<4?year:year+1;
  const boundary=Date.UTC(nextApril,2,31,15,0,0); // Japan midnight
  const delay=Math.min(12*60*60*1000,Math.max(1000,boundary-Date.now()+250));
  setTimeout(()=>{refreshAcademicYear();scheduleAcademicYearRefresh();},delay);
}
scheduleAcademicYearRefresh();

function renderAll() { if(!state.user) return; renderLessons(); if(isAdmin()){renderCount();renderCourses();if(state.page==='courseEditor')renderCourseEditor();}else renderTeacherStudents();renderClosures(); if(state.page==='availability')renderAvailabilityPage(); renderAvailabilityHome(); renderNoticeButton();if($('notificationDialog').open)renderNotifications();regularEditor?.onData(); }
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
    .map(e=>({...e,teacherAbsent:isTeacherAbsentForLesson(e)}))
    .flatMap(splitLessonForDisplay)
    .sort((a,b)=>a.start.localeCompare(b.start)||a.teacherName.localeCompare(b.teacherName)||a.studentName.localeCompare(b.studentName));
}
function openScheduleDay(date){state.date=date;selectScheduleView('day');}
function fullLessonCard(item){
  const time=`${item.displayPeriod?item.displayPeriod+'限　':''}${item.start} – ${item.end}`;
  const card=make('button',(item.status==='cancelled'?'lesson-card is-absent':'lesson-card')+(item.teacherAbsent?' is-teacher-absent':''));card.type='button';
  const headline=make('div','lesson-topline');headline.append(make('span','lesson-time',time));
  if(item.splitTotal>1)headline.append(make('span','split-tag',`連続${item.splitTotal}コマ · ${item.splitIndex}/${item.splitTotal}`));
  const st=item.status==='done'?'実施済':item.status==='cancelled'?'欠席':'予定';
  headline.append(make('span',item.status==='cancelled'?'state-tag absent-tag':'state-tag',st));
  if(item.teacherAbsent)headline.append(make('span','normal-teacher-alert','⚠ 担当調整中・要振替'));
  headline.append(make('span','origin-tag',item.courseId?'講習授業':item.regularId?'通常授業':'個別登録'));card.append(headline);
  card.append(make('div','lesson-student',`${displayLessonGrade(item)} ${item.studentName||'生徒名未登録'}`));
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
  const exam=examFor(date);if(exam)card.append(examCard(exam));
  return card;
}
function examCard(exam){
  const card=make('div','exam-event-card');
  card.append(make('strong','exam-event-title',`📝 ${exam.title||'模試・テスト'}`));
  const time=exam.start&&exam.end?`${exam.start}〜${exam.end}`:'時間未設定';
  card.append(make('span','exam-event-time',time));
  if(exam.note)card.append(make('span','exam-event-note',exam.note));
  return card;
}
function courseBanner(date, compact=false){
  const course=courseFor(date);
  if(!course)return null;
  const banner=make('div',compact?'course-banner compact':'course-banner');
  banner.append(make('strong','',`${courseDisplayName(course)}期間`));
  if(!compact)banner.append(make('span','',`${prettyDate(course.startDate)}〜${prettyDate(course.endDate)}　通常授業は表示せず、講習専用の授業だけを表示しています。`));
  if(hasCourseConflict(date))banner.append(make('span','course-overlap-warning','講習期間が重複しています。管理者に確認してください。'));
  return banner;
}
function renderDaySchedule(parent){
  parent.className='lesson-list';
  const banner=courseBanner(state.date);if(banner)parent.append(banner);
  if(closureFor(state.date)){parent.append(closureCard(state.date));return;}
  const exam=examFor(state.date);if(exam)parent.append(examCard(exam));
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
    if(examFor(date))section.append(examCard(examFor(date)));
    if(!rows.length){section.append(make('p','week-day-empty','授業なし'));parent.append(section);continue;}
    for(const item of rows){
      const lesson=make('button',item.status==='cancelled'?'week-lesson is-absent':'week-lesson');lesson.type='button';
      const topline=make('div','week-lesson-top');
      topline.append(make('span','week-lesson-time',`${item.displayPeriod?item.displayPeriod+'限　':''}${item.start}–${item.end}`));
      if(item.status==='cancelled')topline.append(make('strong','week-absence','欠席'));
      if(item.teacherAbsent)topline.append(make('strong','week-absence','⚠ 要振替'));
      else if(item.status==='done')topline.append(make('span','week-done','実施済'));
      lesson.append(topline);
      lesson.append(make('strong','week-student',`${displayLessonGrade(item)} ${item.studentName||'生徒名未登録'}`));
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
  const monthStart=dateKey(new Date(year,month,1)),monthEnd=dateKey(new Date(year,month+1,0));
  const relevantCourses=state.courses.filter(c=>c.startDate<=monthEnd&&c.endDate>=monthStart);
  if(relevantCourses.length){
    const summary=make('div','month-course-summary');
    summary.append(make('strong','', '講習期間'));
    for(const c of relevantCourses)summary.append(make('span','',`${courseDisplayName(c)}：${c.startDate.slice(0,4)}年${prettyDate(c.startDate)} 〜 ${c.endDate.slice(0,4)}年${prettyDate(c.endDate)}`));
    parent.append(summary);
  }
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
    if(course){cell.classList.add('is-course-period');header.append(make('span','month-course-label',date===course.startDate?'講習開始':date===course.endDate?'講習終了':`${courseDisplayName(course)}期間`));}
    if(closure)header.append(make('span','month-closed-label','休校'));
    if(openDayFor(date))header.append(make('span','month-open-label','開校'));
    else if(rows.length)header.append(make('span','month-day-count',`${rows.length}コマ`));
    header.addEventListener('click',()=>openScheduleDay(date));
    cell.append(header);
    if(closure){
      cell.append(make('div','month-closed-note',closure.note||'塾はお休みです'));
      if(examFor(date))cell.append(make('div','month-exam-tag',`📝 ${examFor(date).title}`));
      calendar.append(cell);continue;
    }
    if(examFor(date))cell.append(make('div','month-exam-tag',`📝 ${examFor(date).title}`));
    for(const item of rows.slice(0,3)){
      const mini=make('button',item.status==='cancelled'?'month-event is-absent':'month-event');mini.type='button';
      mini.textContent=`${item.displayPeriod?item.displayPeriod+'限 ':''}${item.start} ${item.studentName||'生徒名未登録'}${item.status==='cancelled'?'（欠席）':''}${item.teacherAbsent?' ⚠要振替':''}${item.memo?.trim()?' 📝':''}`;
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
  if(state.closuresStatus!=='ready'||state.openDaysStatus!=='ready'||state.coursesStatus!=='ready'){
    parent.className='lesson-list';
    parent.append(make('div','closure-load-warning',state.closuresStatus==='error'||state.openDaysStatus==='error'||state.coursesStatus==='error'?'休校日または講習期間を読み込めません。Firebaseのルールを確認してください。':'休校日・講習期間情報を読み込んでいます…'));
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
    const group=gradeInfo(displayStudentGrade(student)).level;
    if(['gradeAsc','gradeDesc'].includes(sort)&&group!==lastGroup){
      const groupRow=make('tr','group-row');const td=cell(groupRow,labels[group]);td.colSpan=columns;
      tbody.append(groupRow);lastGroup=group;
    }
    const tr=make('tr');
    cell(tr,student.name||'―','student-name-cell');
    cell(tr,displayStudentGrade(student)||'―');
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
// Date-specific exception for classes held on Sundays / public holidays.
// The old schoolClosures document is retained, so reverting is safe.
const openDayAction=document.createElement('button');
openDayAction.type='button';openDayAction.id='closureSelectedOpenAction';
openDayAction.className='primary closure-selected-action';openDayAction.hidden=true;
$('closureSelectedAction').after(openDayAction);
const openDayDialog=document.createElement('dialog');
openDayDialog.id='openDayDialog';openDayDialog.className='modal';
openDayDialog.innerHTML=`<form id="openDayForm" class="modal-content">
<div class="modal-head"><h2>特別開校日の登録</h2><button id="closeOpenDayDialog" class="close-modal" type="button" aria-label="閉じる">×</button></div>
<input id="openDayDate" type="hidden">
<p class="muted" id="openDaySummary"></p>
<label class="full">開校日の備考（任意・講師にも表示）<textarea id="openDayNote" rows="3" maxlength="500" placeholder="例：祝日ですが通常通り授業を実施"></textarea></label>
<p class="muted">講習期間中は、保存後に「講習予約管理」で予約枠を同期し、勤務希望も確認してください。既存の休校設定は削除されません。</p>
<div class="modal-actions"><button id="cancelOpenDay" class="ghost" type="button">キャンセル</button><button class="primary" type="submit">この日を開校にする</button></div>
</form>`;
document.body.append(openDayDialog);
enableOneTapSave('openDayForm');
$('closeOpenDayDialog').addEventListener('click',()=>closeDialog('openDayDialog'));
$('cancelOpenDay').addEventListener('click',()=>closeDialog('openDayDialog'));
const openDayStyle=document.createElement('style');
openDayStyle.textContent='.closure-calendar-day.is-open-override{background:#effaf3;border-color:#a1d7b4;color:#17633b}.closure-calendar-open{font-size:10px;line-height:1.3;font-weight:850;border-radius:5px;padding:3px 5px;background:#d9f4e3;color:#17633b}.closure-open-day-note{font-size:12px;color:#17633b}.month-open-label{font-size:10px;font-weight:800;border-radius:5px;padding:3px 5px;background:#d9f4e3;color:#17633b}';
document.head.append(openDayStyle);
function openDayWarning(date){return courseFor(date)?'講習期間のため、開校指定の変更後は「講習予約管理」で「予約枠を同期」し、講師の勤務希望を確認してください。':'通常授業の時間割にも即時反映されます。';}
openDayAction.addEventListener('click',async()=>{
  if(!isAdmin()||state.openDaysStatus!=='ready'||state.closuresStatus!=='ready')return;
  const date=closureCalendarView.selected,existing=openDayFor(date);
  if(!existing){
    if(!closureFor(date)){showMessage('この日はすでに開校日です。');return;}
    $('openDayDate').value=date;
    $('openDayNote').value='';
    $('openDaySummary').textContent=`${prettyDate(date)}の休校を解除し、この日を開校にします。${openDayWarning(date)}`;
    showDialog('openDayDialog');return;
  }
  if(!confirm(`${prettyDate(date)}の特別開校指定を解除しますか？日曜・祝日または手動休校の設定が再び適用されます。${openDayWarning(date)}`))return;
  openDayAction.disabled=true;
  try{
    const batch=writeBatch(db);
    batch.delete(doc(db,'schoolOpenDays',date));
    auditChange(batch,`schoolOpenDays/${date}`,existing,null,'削除',`${prettyDate(date)}の特別開校解除`);
    await batch.commit();
    showMessage(`${prettyDate(date)}の開校指定を解除しました。${openDayWarning(date)}`);
  }catch(e){trapError(e,'開校指定の解除に失敗しました');}
  finally{openDayAction.disabled=false;}
});
$('openDayForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin()||state.openDaysStatus!=='ready')return;
  const date=$('openDayDate').value,note=$('openDayNote').value.trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||note.length>500||openDayFor(date)||!closureFor(date)){
    showMessage('日付と開校指定の状態を確認してください。');return;
  }
  const button=event.submitter||$('openDayForm').querySelector('button[type=submit]');button.disabled=true;
  try{
    const after={date,note,updatedBy:state.user.uid,updatedAt:serverTimestamp()};
    const batch=writeBatch(db);
    batch.set(doc(db,'schoolOpenDays',date),after);
    auditChange(batch,`schoolOpenDays/${date}`,null,after,'追加',`${prettyDate(date)}の特別開校`);
    await batch.commit();
    closeDialog('openDayDialog');
    showMessage(`${prettyDate(date)}を開校日に変更しました。${openDayWarning(date)}`);
  }catch(e){trapError(e,'特別開校日の保存に失敗しました');}
  finally{button.disabled=false;}
});
// Full-school closure management: only administrators may mutate this collection.
// Stored lesson data remains untouched and becomes visible again if closure is removed.
function renderClosures(){
  if(!state.user)return;
  const host=$('closureList'),grid=$('closureCalendarGrid');
  host.replaceChildren();grid.replaceChildren();
  const admin=isAdmin();
  $('addClosure').hidden=!admin;
  openDayAction.hidden=!admin;
  $('closureSelectedAction').hidden=!admin;
  $('closureSelectedExamAction').hidden=!admin;
  $('closureSelectedHint').textContent=admin?'日曜・祝日は原則休校ですが、該当日だけ開校指定にできます。講習は予約枠の同期も必要です。':'閲覧専用です。休校・開校指定や模試の変更は管理者が行います。';
  const [year,month]=closureCalendarView.month.split('-').map(Number);
  $('closureMonthTitle').textContent=`${year}年${month}月`;
  if(state.closuresStatus!=='ready'||state.openDaysStatus!=='ready'||state.examStatus!=='ready'){
    const err=state.closuresStatus==='error'||state.openDaysStatus==='error'||state.examStatus==='error';
    const text=err?'休校日または模試予定を読み込めません。Firebaseルールを確認してください。':'休校日・模試予定を読み込んでいます…';
    grid.append(make('p','closure-calendar-loading',text));
    host.append(make('div','empty',text));
    $('closureMonthCount').textContent='';
    $('closureSelectedTitle').textContent=prettyDate(closureCalendarView.selected);
    $('closureSelectedStatus').textContent='読み込み中';
    $('closureSelectedStatus').className='closure-selected-status';
    $('closureSelectedCourse').hidden=true;
    $('closureSelectedNote').textContent=text;
    $('closureSelectedExamInfo').textContent='';
    $('closureSelectedAction').disabled=true;
    openDayAction.hidden=true;
    $('closureSelectedExamAction').disabled=true;
    return;
  }
  $('closureSelectedAction').disabled=false;
  $('closureSelectedExamAction').disabled=false;
  const start=`${year}-${String(month).padStart(2,'0')}-01`;
  const countDays=new Date(year,month,0).getDate();
  let closedCount=0;
  for(let day=1;day<=countDays;day++)if(closureFor(datePlus(start,day-1)))closedCount++;
  $('closureMonthCount').textContent=`この月の休校日 ${closedCount}日 / 模試 ${Object.values(state.examEvents).filter(e=>e.date.startsWith(closureCalendarView.month)).length}件`;
  const firstWeekday=jsDate(start).getDay();
  const fragment=document.createDocumentFragment();
  for(const weekday of WEEKDAYS)fragment.append(make('span','closure-weekday',weekday));
  for(let i=0;i<42;i++){
    const date=datePlus(start,i-firstWeekday),record=closureFor(date),exam=examFor(date),opened=openDayFor(date);
    const outside=!date.startsWith(closureCalendarView.month),selected=date===closureCalendarView.selected;
    const course=state.coursesStatus==='ready'?courseFor(date):null;
    const cell=make('button',`closure-calendar-day${outside?' is-outside':''}${record?' is-closed':''}${record?.automatic?' is-automatic':''}${opened?' is-open-override':''}${exam?' has-exam':''}${course?' is-course-period':''}${date===todayKey()?' is-today':''}${selected?' is-selected':''}`);
    cell.type='button';cell.setAttribute('aria-pressed',String(selected));
    cell.setAttribute('aria-label',`${prettyDate(date)}${record?'、休校':''}${opened?'、特別開校日':''}${record?.note?'、'+record.note:''}${exam?'、'+exam.title+'実施':''}${course?'、'+courseDisplayName(course)+'期間':''}`);
    cell.append(make('span','closure-calendar-number',String(Number(date.slice(-2)))));
    if(record)cell.append(make('span','closure-calendar-closed','休校'));
    if(opened)cell.append(make('span','closure-calendar-open','開校'));
    if(course){
      const flag=date===course.startDate?'開始':date===course.endDate?'終了':'';
      const pill=make('span','closure-calendar-course',flag?`講習${flag}`:'講習');pill.title=`${courseDisplayName(course)}：${prettyDate(course.startDate)} 〜 ${prettyDate(course.endDate)}`;cell.append(pill);
    }
    if(exam)cell.append(make('span','closure-calendar-exam','模試'));
    if(record?.note)cell.append(make('span','closure-calendar-day-note',record.note));
    cell.addEventListener('click',()=>{closureCalendarView.selected=date;closureCalendarView.month=date.slice(0,7);renderClosures();});
    fragment.append(cell);
  }
  grid.append(fragment);
  const selected=closureCalendarView.selected,record=closureFor(selected),explicit=explicitClosureFor(selected),exam=examFor(selected),opened=openDayFor(selected);
  openDayAction.hidden=!admin||(!opened&&!record);
  openDayAction.textContent=opened?'特別開校指定を解除':'この日を開校にする';
  $('addClosure').hidden=!admin||!!opened;
  $('closureSelectedAction').hidden=!admin||!!opened;
  $('closureSelectedTitle').textContent=prettyDate(selected);
  $('closureSelectedStatus').textContent=opened?'特別開校日':exam?'模試実施日':record?'休校':'通常営業日';
  $('closureSelectedStatus').className='closure-selected-status'+(record?' is-closed':'');
  const selectedCourse=state.coursesStatus==='ready'?courseFor(selected):null;
  $('closureSelectedCourse').hidden=!selectedCourse;
  $('closureSelectedCourse').textContent=selectedCourse?`${courseDisplayName(selectedCourse)}：${selectedCourse.startDate.slice(0,4)}年${prettyDate(selectedCourse.startDate)} 〜 ${selectedCourse.endDate.slice(0,4)}年${prettyDate(selectedCourse.endDate)}${selected===selectedCourse.startDate?'（講習開始日）':selected===selectedCourse.endDate?'（講習最終日）':''}`:'';
  $('closureSelectedNote').textContent=opened?('休校指定を解除して開校しています。'+(opened.note?' '+opened.note:'')):exam?'模試・テストを実施するため、休校扱いを解除しています。':record?(record.note||'備考の登録はありません。'):'この日は休校登録されていません。';
  $('closureSelectedExamInfo').textContent=exam?`📝 ${exam.title}｜${exam.start}〜${exam.end}${exam.note?'｜'+exam.note:''}`:'模試・テストの予定はありません。';
  $('closureSelectedAction').textContent=explicit?'休校内容を編集・登録解除':record?.automatic?'休校日の備考を追加':'この日を休校にする';
  $('closureSelectedExamAction').textContent=exam?'模試・テストを編集／削除':'＋ 模試・テストを登録';
  const records=Object.values(state.closures).sort((a,b)=>a.date.localeCompare(b.date));
  for(const record of records){
    const item=make('div','closure-list-item'),info=make('div','closure-list-info');
    info.append(make('strong','',prettyDate(record.date)));
    info.append(make('span','closure-list-note',record.note||'備考なし'));
    const edit=make('button','mini-button','カレンダーで見る');edit.type='button';
    edit.addEventListener('click',()=>{closureCalendarView.selected=record.date;closureCalendarView.month=record.date.slice(0,7);renderClosures();$('closureCalendarGrid').scrollIntoView({block:'nearest',behavior:'smooth'});});
    item.append(info,edit);host.append(item);
  }
  for(const opened of Object.values(state.openDays).sort((a,b)=>a.date.localeCompare(b.date))){
    const item=make('div','closure-list-item'),info=make('div','closure-list-info');
    info.append(make('strong','closure-open-day-note',`${prettyDate(opened.date)}　特別開校日`));
    info.append(make('span','closure-list-note',opened.note||'日曜・祝日などの休校を解除'));
    const view=make('button','mini-button','カレンダーで見る');view.type='button';
    view.addEventListener('click',()=>{closureCalendarView.selected=opened.date;closureCalendarView.month=opened.date.slice(0,7);renderClosures();$('closureCalendarGrid').scrollIntoView({block:'nearest',behavior:'smooth'});});
    item.append(info,view);host.append(item);
  }
  if(!records.length&&!Object.keys(state.openDays).length)host.append(make('div','empty','手動の休校・特別開校は登録されていません（日曜・祝日は原則休校です）。'));
}
function openClosureForm(date=''){
  if(!isAdmin())return;
  $('closureForm').reset();
  const closure=explicitClosureFor(date);
  $('closureEditingDate').value=closure?.date||'';
  $('closureDate').value=closure?.date||date||state.date;
  $('closureDate').disabled=Boolean(closure);
  $('closureNote').value=closure?.note||'';
  $('closureDialogTitle').textContent=closure?'休校日を編集':automaticClosure(date)?'休校日の備考を追加':'休校日を登録';
  $('deleteClosure').hidden=!closure;
  showDialog('closureDialog');
}
$('closurePrevMonth').addEventListener('click',()=>{closureCalendarView.month=shiftMonth(closureCalendarView.month+'-01',-1).slice(0,7);closureCalendarView.selected=closureCalendarView.month+'-01';renderClosures();});
$('closureNextMonth').addEventListener('click',()=>{closureCalendarView.month=shiftMonth(closureCalendarView.month+'-01',1).slice(0,7);closureCalendarView.selected=closureCalendarView.month+'-01';renderClosures();});
$('closureThisMonth').addEventListener('click',()=>{closureCalendarView.selected=todayKey();closureCalendarView.month=closureCalendarView.selected.slice(0,7);renderClosures();});
$('closureSelectedAction').addEventListener('click',()=>openClosureForm(closureCalendarView.selected));
$('addClosure').addEventListener('click',()=>openClosureForm(closureCalendarView.selected));
$('closureForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin())return;
  if(state.closuresStatus!=='ready'){showMessage('休校日情報の読み込み完了後に操作してください。');return;}
  const date=$('closureDate').value,note=$('closureNote').value.trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||note.length>500){showMessage('日付と備考を確認してください。');return;}
  if(explicitClosureFor(date)&&!$('closureEditingDate').value){showMessage('この日はすでに休校登録されています。「編集」から変更してください。');return;}
  const button=event.submitter;button.disabled=true;
  try{
    const before=explicitClosureFor(date);const after={date,note,updatedAt:serverTimestamp(),updatedBy:state.user.uid};
    const batch=writeBatch(db);batch.set(doc(db,'schoolClosures',date),after);auditChange(batch,`schoolClosures/${date}`,before,after,before?'変更':'追加',`${prettyDate(date)}の休校日`);await batch.commit();
    closureCalendarView.selected=date;closureCalendarView.month=date.slice(0,7);
    closeDialog('closureDialog');renderClosures();showMessage(`${prettyDate(date)}の休校設定を保存しました。授業データは削除されません。`);
  }catch(e){trapError(e,'休校日の保存に失敗しました');}
  finally{button.disabled=false;}
});
$('deleteClosure').addEventListener('click',async()=>{
  if(!isAdmin())return;
  const date=$('closureEditingDate').value;
  if(!date||!explicitClosureFor(date))return;
  const automatic=Boolean(automaticClosure(date));
  if(!confirm(`${prettyDate(date)}の手動休校設定を解除しますか？${automatic?'日曜・祝日の休校は引き続き有効です。':'元の時間割が再び表示されます。'}`))return;
  const button=$('deleteClosure');button.disabled=true;
  try{const batch=writeBatch(db);batch.delete(doc(db,'schoolClosures',date));auditChange(batch,`schoolClosures/${date}`,explicitClosureFor(date),null,'削除',`${prettyDate(date)}の休校日`);await batch.commit();closeDialog('closureDialog');renderClosures();showMessage(automatic?'備考を解除しました。日曜・祝日の休校は継続します。':'休校日を解除しました。元の授業予定が再表示されます。');}
  catch(e){trapError(e,'休校日の解除に失敗しました');}finally{button.disabled=false;}
});
function openExamForm(date){
  if(!isAdmin())return;
  const exam=examFor(date);
  $('examForm').reset();
  $('examDate').value=date;
  $('examTitle').value=exam?.title||'模試';
  $('examStart').value=exam?.start||'09:00';
  $('examEnd').value=exam?.end||'12:00';
  $('examNote').value=exam?.note||'';
  $('deleteExam').hidden=!exam;
  showDialog('examDialog');
}
$('closureSelectedExamAction').addEventListener('click',()=>openExamForm(closureCalendarView.selected));
$('examForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin())return;
  const date=$('examDate').value,title=$('examTitle').value.trim(),start=$('examStart').value,end=$('examEnd').value,note=$('examNote').value.trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!title||title.length>80||!start||!end||start>=end||note.length>500){showMessage('模試の日時・名称・備考を確認してください。');return;}
  const button=event.submitter;button.disabled=true;
  try{const previous=examFor(date),after={date,type:'exam',title,start,end,note,updatedBy:state.user.uid,updatedAt:serverTimestamp()};
    const batch=writeBatch(db);batch.set(doc(db,'schoolEvents',date),after);auditChange(batch,`schoolEvents/${date}`,previous,after,previous?'変更':'追加',`${prettyDate(date)}の模試・テスト`);await batch.commit();
    closeDialog('examDialog');showMessage(`${prettyDate(date)}の模試・テストを登録しました。この日の休校扱いを解除しました。`);}
  catch(error){trapError(error,'模試の登録に失敗しました');}finally{button.disabled=false;}
});
$('deleteExam').addEventListener('click',async()=>{
  if(!isAdmin())return;
  const date=$('examDate').value;if(!examFor(date))return;
  if(!confirm(`${prettyDate(date)}の模試・テスト予定を削除しますか？`))return;
  const button=$('deleteExam');button.disabled=true;
  try{const batch=writeBatch(db);batch.delete(doc(db,'schoolEvents',date));auditChange(batch,`schoolEvents/${date}`,examFor(date),null,'削除',`${prettyDate(date)}の模試・テスト`);await batch.commit();closeDialog('examDialog');showMessage('模試・テスト予定を削除しました。日曜・祝日・手動休校の設定が再び適用されます。');}
  catch(error){trapError(error,'模試を削除できませんでした');}finally{button.disabled=false;}
});

// Seasonal courses are separate from normal recurring lessons.
// Never delete normal timetable entries when the course becomes active.
const COURSE_NAMES={spring:'春期講習',summer:'夏期講習',winter:'冬期講習'};
function courseLessons(courseId){return state.entries.filter(e=>e.courseId===courseId);}
let courseArchiveView='active';
async function setCourseArchived(course, archived){
  if(!isAdmin()||state.coursesStatus!=='ready')return;
  if(archived && course.endDate>=todayKey()){showMessage('講習期間が終了してから非表示にできます。');return;}
  const action=archived?'非表示':'再表示';
  if(!confirm(`${courseDisplayName(course)}を${action}にしますか？講習授業・勤務希望・予約データは削除されません。`))return;
  try{
    const before=state.courses.find(c=>c.id===course.id);
    const change={archived,updatedAt:serverTimestamp(),updatedBy:state.user.uid};
    const batch=writeBatch(db);
    batch.update(doc(db,'specialCourses',course.id),change);
    auditChange(batch,`specialCourses/${course.id}`,before,{...before,...change},'変更',`${courseDisplayName(course)}の${action}`);
    await batch.commit();
    showMessage(`${courseDisplayName(course)}を${action}にしました。`);
  }catch(error){trapError(error,'講習の表示状態を変更できませんでした。Firestoreルールも確認してください。');}
}
function renderCourses(){
  if(!isAdmin())return;
  const host=$('courseList');host.replaceChildren();
  if(state.coursesStatus!=='ready'){
    host.append(make('div','empty',state.coursesStatus==='error'?'講習データを読み込めません。Firestoreルールを確認してください。':'講習期間を読み込んでいます…'));
    return;
  }
  const active=state.courses.filter(c=>c.archived!==true);
  const archived=state.courses.filter(c=>c.archived===true);
  const switcher=make('div','course-archive-switch');
  for(const [key,label,count] of [['active','表示中の講習',active.length],['archived','非表示一覧',archived.length]]){
    const button=make('button','course-archive-tab'+(courseArchiveView===key?' active':''),`${label}（${count}）`);
    button.type='button';button.setAttribute('aria-pressed',String(courseArchiveView===key));
    button.addEventListener('click',()=>{courseArchiveView=key;renderCourses();});
    switcher.append(button);
  }
  host.append(switcher);
  const courses=[...(courseArchiveView==='archived'?archived:active)].sort((x,y)=>y.startDate.localeCompare(x.startDate));
  if(!courses.length){
    host.append(make('div','empty',courseArchiveView==='archived'?'非表示にした講習はありません。':'表示中の講習はありません。「＋ 講習期間を登録」から追加できます。'));
    return;
  }
  for(const course of courses){
    const record=make('div','course-list-item');
    const info=make('div','course-list-info');
    info.append(make('strong','',courseDisplayName(course)));
    info.append(make('span','',`${course.startDate.slice(0,4)}年${prettyDate(course.startDate)} 〜 ${course.endDate.slice(0,4)}年${prettyDate(course.endDate)}`));
    info.append(make('span','',`${course.periods.length}コマ構成 / 講習授業 ${state.entriesStatus==='ready'?courseLessons(course.id).length+'件':'読込中'}`));
    info.append(make('span','',course.periods.map((r,i)=>`${i+1}限 ${r.start}〜${r.end}`).join(' · ')));
    info.append(make('span','',`講師希望締切：${formatDeadline(course)}`));
    const actions=make('div','course-list-actions');
    if(course.archived===true){
      const restore=make('button','mini-button course-archive-action','↩ 再表示する');restore.type='button';
      restore.addEventListener('click',()=>setCourseArchived(course,false));actions.append(restore);
      record.classList.add('is-archived');
    }else{
      const edit=make('button','mini-button','編集');edit.type='button';edit.addEventListener('click',()=>openCourseForm(course.id));
      const jump=make('button','mini-button','開始日の時間割');jump.type='button';jump.addEventListener('click',()=>{state.date=course.startDate;nav('adminSchedule');});
      const grid=make('button','mini-button','表で配置');grid.type='button';grid.addEventListener('click',()=>{if(openCourseEditor(course.id))nav('courseEditor');});
      const avail=make('button','mini-button','勤務希望・提出状況');avail.type='button';avail.addEventListener('click',()=>openAvailabilityFromHome(course.id));
      const hide=make('button','mini-button course-archive-action','非表示にする');hide.type='button';
      hide.disabled=course.endDate>=todayKey();hide.title=hide.disabled?'講習期間が終了してから操作できます':'講習を一覧から非表示にします';
      hide.addEventListener('click',()=>setCourseArchived(course,true));
      actions.append(edit,avail,jump,grid,hide);
    }
    record.append(info,actions);host.append(record);
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
  $('courseDeadline').value=course?.availabilityDeadline?.toDate?localDateTimeInput(course.availabilityDeadline.toDate()):'';
  $('coursePeriodRows').replaceChildren();
  (course?.periods||[{start:'09:00',end:'09:55'},{start:'10:00',end:'10:55'},{start:'11:00',end:'11:55'}]).forEach(addCoursePeriodRow);
  $('deleteCourse').hidden=!course;
  $('courseDeleteNotice').hidden=true;
  $('courseDeleteNoticeMessage').textContent='';
  showDialog('courseDialog');
}
function openCourseDeadlineEditor(courseId){
  if(!isAdmin())return;
  const course=state.courses.find(c=>c.id===courseId);
  if(!course){showMessage('講習期間が見つかりません。');return;}
  $('courseDeadlineForm').reset();
  $('deadlineEditCourseId').value=course.id;
  $('deadlineEditCourseLabel').textContent=`${courseDisplayName(course)}：${prettyDate(course.startDate)}〜${prettyDate(course.endDate)}`;
  $('deadlineEditValue').value=availabilityDeadlineDate(course)?localDateTimeInput(availabilityDeadlineDate(course)):'';
  showDialog('courseDeadlineDialog');
}
$('courseDeadlineForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin())return;
  if(state.coursesStatus!=='ready'){showMessage('講習データの読み込み完了後に変更してください。');return;}
  const id=$('deadlineEditCourseId').value;
  if(!state.courses.some(course=>course.id===id)){showMessage('講習期間が見つかりません。画面を再読み込みしてください。');return;}
  const value=$('deadlineEditValue').value,date=value?new Date(value):null;
  if(!date||Number.isNaN(date.getTime())){showMessage('提出締切の日時を入力してください。');return;}
  const button=event.submitter||$('courseDeadlineForm').querySelector('[type="submit"]');button.disabled=true;
  try{
    const before=state.courses.find(c=>c.id===id),change={availabilityDeadline:date,updatedBy:state.user.uid,updatedAt:serverTimestamp()};
    const batch=writeBatch(db);batch.update(doc(db,'specialCourses',id),change);auditChange(batch,`specialCourses/${id}`,before,{...before,...change},'変更',`${before?.name||'講習'}の勤務希望提出締切`);await batch.commit();
    closeDialog('courseDeadlineDialog');showMessage('勤務希望の提出締切を変更しました。');
  }catch(e){trapError(e,'提出締切の変更に失敗しました');}
  finally{button.disabled=false;}
});
$('addCourse').addEventListener('click',()=>openCourseForm());
$('addCoursePeriod').addEventListener('click',()=>addCoursePeriodRow());
$('courseForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin())return;
  if(state.coursesStatus!=='ready'||state.entriesStatus!=='ready'){showMessage('講習・時間割データの読込完了後に操作してください。');return;}
  const id=$('courseId').value||doc(collection(db,'specialCourses')).id;
  const type=$('courseType').value,name=COURSE_NAMES[type],startDate=$('courseStart').value,endDate=$('courseEnd').value;
  const deadlineText=$('courseDeadline').value;const deadline=deadlineText?new Date(deadlineText):null;
  if(deadlineText&&(!deadline||Number.isNaN(deadline.getTime()))){showMessage('勤務希望の提出締切を正しく入力してください。');return;}
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
    const before=state.courses.find(c=>c.id===id),after={type,name,startDate,endDate,periods,availabilityDeadline:deadline,archived:before?.archived===true,updatedBy:state.user.uid,updatedAt:serverTimestamp()};
    const batch=writeBatch(db);batch.set(doc(db,'specialCourses',id),after);auditChange(batch,`specialCourses/${id}`,before,after,before?'変更':'追加',`${name}期間・コマ設定`);await batch.commit();
    closeDialog('courseDialog');showMessage(`${name}期間を保存しました。期間内は講習授業だけが表示されます。`);
  }catch(e){trapError(e,'講習期間の保存に失敗しました');}finally{button.disabled=false;}
});
$('deleteCourse').addEventListener('click',async()=>{
  if(!isAdmin())return;
  if(state.entriesStatus!=='ready'){showMessage('時間割データの読込完了後に操作してください。');return;}
  const id=$('courseId').value,course=state.courses.find(c=>c.id===id);if(!course)return;
  if(courseLessons(id).length){showMessage('講習授業が登録されています。削除前に講習授業をすべて削除してください。');return;}
  if(!confirm(`${courseDisplayName(course)}（${prettyDate(course.startDate)}〜${prettyDate(course.endDate)}）を削除しますか？期間内の通常授業が再表示されます。`))return;
  const button=$('deleteCourse');button.disabled=true;
  $('courseDeleteNotice').hidden=true;
  try{
    const availabilityDocs=await getDocs(collection(db,'specialCourses',id,'teacherAvailability'));
    if(availabilityDocs.size>170)throw Error('勤務希望が多数あるため一度に削除できません。運営に相談してください。');
    const batch=writeBatch(db);
    const group=doc(collection(db,'auditLogs')).id;
    for(const snapshot of availabilityDocs.docs){batch.delete(snapshot.ref);auditChange(batch,snapshot.ref.path,snapshot.data(),null,'削除',`${course.name}の講師勤務希望`,group);}
    const metaRef=doc(db,'specialCourses',id,'scheduleMeta','state');const meta=await getDoc(metaRef);
    if(meta.exists()){batch.delete(metaRef);auditChange(batch,metaRef.path,meta.data(),null,'削除',`${course.name}の配置管理情報`,group);}
    batch.delete(doc(db,'specialCourses',id));auditChange(batch,`specialCourses/${id}`,course,null,'削除',`${course.name}講習期間`,group);
    await batch.commit();
    closeDialog('courseDialog');showMessage('講習期間と勤務希望を解除しました。通常授業が再表示されます。');
  }
  catch(e){
    console.error('講習期間削除エラー',e);
    const permission=String(e?.code||'').includes('permission-denied');
    const note=$('courseDeleteNotice');
    $('courseDeleteNoticeTitle').textContent=permission?'予約設定またはアクセス権限により削除できません':'講習期間の解除に失敗しました';
    $('courseDeleteNoticeMessage').textContent=permission
      ?'この講習に「講習予約の受付設定（bookingSettings）」が存在すると、講習授業が0件でもFirestoreの保護ルールで削除が拒否されます。予約・QR・受付枠などの関連データはサーバー側で安全に整理する必要があります。設定がない場合は管理者権限とFirestoreルールを確認してください。'
      :String(e?.message||'Firebaseとの通信または関連データの確認に失敗しました。').slice(0,300);
    note.hidden=false;
    note.scrollIntoView({block:'nearest',behavior:'smooth'});
    showMessage(permission?'予約設定が残っている可能性があります。下の説明を確認してください。':'講習期間を解除できませんでした。下の説明を確認してください。');
  }finally{button.disabled=false;}
});

function renderTeacherStudents(){
  if(isAdmin()||!state.user)return;
  renderStudentTable({searchId:'teacherStudentSearch',levelId:'teacherStudentLevel',sortId:'teacherStudentSort',resultsId:'teacherStudentResults',rowsId:'teacherStudentRows',canEdit:false});
}
function renderCount(){
  if(!isAdmin())return;
  renderStudentTable({searchId:'studentSearch',levelId:'studentLevel',sortId:'studentSort',resultsId:'studentResults',rowsId:'countRows',canEdit:true});
}
// Notification inbox: every signed-in member can read, mark as read,
// and delete only their OWN items. A teacher's availability announcement is
// generated as a restricted typed event; free-form notices require admin role.
const notificationNewestFirst=(a,b)=>{
  const millis=n=>n.createdAt?.toMillis?.() ?? (n.createdAt?.seconds||0)*1000;
  return millis(b)-millis(a)||b.id.localeCompare(a.id);
};
function visibleNotifications(){return [...state.notices].sort(notificationNewestFirst).slice(0,10);}
// Official announcements are shared, time-limited Firestore documents.
// They are never part of the deletable personal notification inbox.
const announcementMillis=value=>value?.toMillis?.() ?? (value?.seconds!=null?value.seconds*1000:NaN);
const announcedDateTime=value=>{
  const millis=announcementMillis(value);
  return Number.isFinite(millis)?new Date(millis).toLocaleString('ja-JP',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'日時未設定';
};
function visibleOfficialAnnouncements(){
  const now=Date.now();
  return state.officialAnnouncements.filter(a=>{
    const start=announcementMillis(a.startAt),end=announcementMillis(a.endAt);
    return Number.isFinite(start)&&Number.isFinite(end)&&start<=now&&now<end;
  }).sort((a,b)=>announcementMillis(b.createdAt)-announcementMillis(a.createdAt)||b.id.localeCompare(a.id));
}
function renderOfficialAnnouncements(){
  const notices=visibleOfficialAnnouncements(),section=$('officialNoticesSection'),parent=$('officialNoticeList');
  section.hidden=notices.length===0;parent.replaceChildren();
  for(const n of notices){
    const seen=state.officialSeenReady&&state.officialSeenIds.has(n.id);
    const card=make('div','notification official-notice'+(seen?'':' unread'));
    card.append(make('strong','official-notice-title','📌 運営からのお知らせ'));
    card.append(make('p','official-notice-message',n.message||''));
    card.append(make('small','official-notice-period',`掲載期間：${announcedDateTime(n.startAt)} ～ ${announcedDateTime(n.endAt)}`));
    card.append(make('small','official-notice-lock','掲載期間中は削除できません。閲覧すると未読バッジのみ消えます。'));
    parent.append(card);
  }
}
function renderOwnerAnnouncementManagement(){
  const wrap=$('ownerAnnouncementManagement'),list=$('ownerAnnouncementList');
  wrap.hidden=!isOwner();list.replaceChildren();
  if(!isOwner())return;
  const sorted=[...state.officialAnnouncements].sort((a,b)=>announcementMillis(b.createdAt)-announcementMillis(a.createdAt));
  if(!sorted.length){list.append(make('p','muted','掲載したお知らせはまだありません。'));return;}
  for(const n of sorted.slice(0,12)){
    const now=Date.now(),start=announcementMillis(n.startAt),end=announcementMillis(n.endAt);
    const status=now<start?'掲載予約中':now>=end?'掲載終了':'掲載中';
    const node=make('div','owner-announcement-row');
    const text=make('div','owner-announcement-text');
    text.append(make('strong','',`${status}｜${(n.message||'').slice(0,90)}`));
    text.append(make('small','',`${announcedDateTime(n.startAt)} ～ ${announcedDateTime(n.endAt)}`));
    const button=make('button','notification-delete','掲載を取り消す');button.type='button';
    button.addEventListener('click',async()=>{
      if(!confirm('この運営のお知らせの掲載を取り消しますか？管理者・講師の画面からも消えます。'))return;
      button.disabled=true;
      try{await deleteDoc(doc(db,'officialAnnouncements',n.id));showMessage('お知らせの掲載を取り消しました。');}
      catch(error){button.disabled=false;trapError(error,'掲載を取り消せませんでした');}
    });
    node.append(text,button);list.append(node);
  }
}
async function markVisibleOfficialRead(){
  if(!state.user||!state.officialSeenReady)return;
  const ids=visibleOfficialAnnouncements().map(n=>n.id).filter(id=>!state.officialSeenIds.has(id));
  if(!ids.length)return;
  try{
    await setDoc(doc(db,'announcementReadStates',state.user.uid),
      {seenIds:arrayUnion(...ids),updatedAt:serverTimestamp()},{merge:true});
  }catch(error){trapError(error,'運営のお知らせを既読にできませんでした');}
}
function notificationText(n){
  if(n.kind==='broadcast'){
    const sender=state.people.find(p=>p.id===n.senderUid);
    const title=sender?.role==='owner'?'運営からのお知らせ'
      :sender?.role==='admin'?`管理者${sender.name?'（'+sender.name+'）':''}からのお知らせ`
      :'スタッフからのお知らせ';
    return `【${title}】\n${n.message||''}`;
  }
  if(n.kind==='availability'){
    const teacher=state.people.find(p=>p.id===n.senderUid);
    const course=state.courses.find(c=>c.id===n.courseId);
    const name=teacher?.name?.trim()||'講師';
    return `${name}から${course?.name ? course.name+'の' : ''}勤務希望が提出されました。`;
  }
  return n.message||'授業が変更されました。';
}
let noticeCleanupBusy=false;
async function pruneOldNotices(){
  if(noticeCleanupBusy||!state.user||state.notices.length<=10)return;
  // Server snapshot only; a pending local notification must not be pruned.
  noticeCleanupBusy=true;
  const uid=state.user.uid;
  try{
    const extras=[...state.notices].sort(notificationNewestFirst).slice(10);
    for(let start=0;start<extras.length;start+=400){
      const batch=writeBatch(db);
      for(const n of extras.slice(start,start+400))batch.delete(doc(db,'notifications',uid,'items',n.id));
      await batch.commit();
    }
  }catch(error){console.warn('古い通知の整理に失敗しました',error);}
  finally{noticeCleanupBusy=false;}
}
function renderNoticeButton(){
  const unread=visibleNotifications().filter(n=>n.read!==true).length
    +(state.officialSeenReady?visibleOfficialAnnouncements().filter(n=>!state.officialSeenIds.has(n.id)).length:0);
  $('noticeCount').hidden=unread===0;
  $('noticeCount').textContent=String(unread);
  $('notificationButton').setAttribute('aria-label',unread?`通知・未読${unread}件`:'通知を表示');
}
function renderNotifications(){
  renderOfficialAnnouncements();renderOwnerAnnouncementManagement();
  const parent=$('notificationList');parent.replaceChildren();
  const notices=visibleNotifications();
  $('noticeRetention').textContent=`通常通知は直近${notices.length}件（最大10件）。本人が削除できます。運営のお知らせは別枠で期間中表示されます。`;
  $('deleteAllNotices').disabled=notices.length===0;
  if(!notices.length){parent.append(make('div','empty','その他の通知はありません。'));return;}
  for(const n of notices){
    const node=make('div','notification'+(n.read===true?'':' unread'));
    const header=make('div','notification-row');
    const label=make('button','notification-open',notificationText(n));
    label.type='button';
    if(n.kind==='availability'&&isAdmin() || n.kind==='student'&&n.studentId || n.date&&/^\d{4}-\d{2}-\d{2}$/.test(n.date)){
      label.title=n.kind==='availability'?'タップして勤務希望を表示':n.kind==='student'?'タップして生徒情報を表示':n.kind==='lesson'?'タップして授業の詳細へ移動':'タップして対象日の時間割へ移動';
      label.addEventListener('click',()=>openNotificationTarget(n));
    }else label.disabled=true;
    header.append(label);
    const del=make('button','notification-delete','削除');
    del.type='button';del.setAttribute('aria-label','この通知を削除');
    del.addEventListener('click',async()=>{
      del.disabled=true;
      try{await deleteDoc(doc(db,'notifications',state.user.uid,'items',n.id));}
      catch(error){del.disabled=false;trapError(error,'通知を削除できませんでした');}
    });
    header.append(del);node.append(header);
    const time=n.createdAt?.toDate?.();
    node.append(make('small','',time?time.toLocaleString('ja-JP'):'日時情報なし'));
    if(!label.disabled)node.append(make('small','notification-jump-hint',n.kind==='availability'?'タップすると講師の勤務希望に移動します':n.kind==='student'?'タップすると生徒情報に移動します':'タップすると該当の時間割に移動します'));
    parent.append(node);
  }
}
async function markVisibleNoticesRead(){
  const unread=visibleNotifications().filter(n=>n.read!==true);
  if(!unread.length||!state.user)return;
  try{
    const batch=writeBatch(db),uid=state.user.uid;
    for(const n of unread)batch.update(doc(db,'notifications',uid,'items',n.id),{read:true});
    await batch.commit();
  }catch(error){trapError(error,'通知を既読にできませんでした');}
}
$('notificationButton').addEventListener('click',()=>{
  renderNotifications();showDialog('notificationDialog');
  // The unread badge clears when its notifications have been viewed.
  markVisibleNoticesRead();
  markVisibleOfficialRead();
});
$('deleteAllNotices').addEventListener('click',async()=>{
  const notices=visibleNotifications();if(!notices.length||!state.user)return;
  if(!confirm(`表示中の通知${notices.length}件を削除しますか？`))return;
  const button=$('deleteAllNotices');button.disabled=true;
  try{
    const batch=writeBatch(db);
    for(const n of notices)batch.delete(doc(db,'notifications',state.user.uid,'items',n.id));
    await batch.commit();
  }catch(error){trapError(error,'通知を削除できませんでした');}
  finally{button.disabled=false;}
});
$('broadcastForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isOwner())return;
  const content=$('broadcastMessage').value.trim();
  const start=new Date($('broadcastStart').value),end=new Date($('broadcastEnd').value);
  if(!content||content.length>450){showMessage('運営のお知らせは1〜450文字で入力してください。');return;}
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||end.getTime()<=Date.now()){
    showMessage('掲載開始・掲載終了の日時を確認してください。終了は開始より後、かつ未来にしてください。');return;
  }
  if(!confirm(`次の期間、管理者・講師に運営のお知らせを掲載しますか？\n${start.toLocaleString('ja-JP')} ～ ${end.toLocaleString('ja-JP')}\n※掲載期間中、受信者は削除できません。`))return;
  const button=$('broadcastSend');button.disabled=true;
  try{
    await setDoc(doc(collection(db,'officialAnnouncements')),{message:content,startAt:start,endAt:end,createdBy:state.user.uid,createdAt:serverTimestamp()});
    $('broadcastMessage').value='';showMessage('運営のお知らせを登録しました。指定した期間に全スタッフへ表示されます。');
  }catch(error){trapError(error,'運営のお知らせを登録できませんでした');}
  finally{button.disabled=false;}
});
function addRegularRow(slot={}){
  const row=make('div','regular-row');row.dataset.slotId=slot.id||doc(collection(db,'schoolStudents')).id;
  const fields=[
    ['weekday','曜日','select'],['start','開始','time'],['end','終了','time'],
    ['teacherUid','担当教師','select'],['subject','教科（任意）','text'],['activeFrom','適用開始','date']
  ];
  for(const [key,label,type] of fields){
    const wrap=make('label','',label);
    const el=make(type==='select'?'select':'input');el.dataset.field=key;
    if(type!=='select')el.type=type;
    if(key==='weekday')WEEKDAYS.forEach((w,i)=>{const opt=make('option','',w+'曜日');opt.value=String(i);el.append(opt);});
    if(key==='teacherUid')state.people.filter(p=>isAssignableTeacher(p.role)).forEach(p=>{const opt=make('option','',p.name||'教師名未登録');opt.value=p.id;el.append(opt);});
    const defaultValue={weekday:'3',start:'17:30',end:'18:25',teacherUid:state.people.find(p=>isAssignableTeacher(p.role))?.id||'',subject:'',activeFrom:todayKey()};
    el.value=String(slot[key]??defaultValue[key]);
    if(key==='subject')el.placeholder='例：数学';
    el.required=key!=='subject';wrap.append(el);row.append(wrap);
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
    if(!info.teacherUid||!info.activeFrom||!info.start||!info.end||info.start>=info.end||!state.people.some(p=>p.id===info.teacherUid&&isAssignableTeacher(p.role))){throw Error('通常授業の曜日・時間・担当講師・適用開始日を確認してください。');}
    slots[info.id]=info;
  }
  return slots;
}

function openStudent(id){
  if(!isAdmin())return;
  const student=state.students.find(s=>s.id===id);
  $('studentForm').reset();$('studentId').value=id||'';$('studentDialogTitle').textContent=student?'生徒情報を編集':'生徒を登録';$('deleteStudent').hidden=!student;
  for(const [field,key] of [['studentName','name'],['studentGrade','grade'],['studentSchool','school'],['studentTextbook','textbook'],['studentRemarks','remarks']])$(field).value=field==='studentGrade'&&student?displayStudentGrade(student):(student?.[key]||'');
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
  const group=doc(collection(db,'auditLogs')).id;
  for(const snapshot of docs.docs){
    const change={studentName:studentData.name,grade:studentData.grade,school:studentData.school};
    batch.update(snapshot.ref,change);auditChange(batch,snapshot.ref.path,snapshot.data(),{...snapshot.data(),...change},'変更',`${studentData.name}さんの授業表示情報`,group);count++;
    if(count===175){await batch.commit();batch=writeBatch(db);count=0;}
  }
  if(count)await batch.commit();
  const recipients=[...new Set(docs.docs.filter(d=>d.data().date>=todayKey()).map(d=>d.data().teacherUid).filter(Boolean))];
  await sendStudentNotifications(recipients,studentId,studentData.name,'生徒情報（氏名・学年・学校など）が更新されました。');
}
$('studentForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin())return;
  const id=$('studentId').value||doc(collection(db,'schoolStudents')).id;
  const before=state.students.find(s=>s.id===id);
  let slots;try{slots=collectRegularSlots();}catch(error){showMessage(error.message);return;}
  const regular=Object.keys(slots).length?formatRegular(slots):(Object.keys(before?.regularSlots||{}).length?'':before?.regular||'');
  const data={name:$('studentName').value.trim(),grade:$('studentGrade').value.trim(),gradeYear:academicYearJST(),school:$('studentSchool').value.trim(),regular,regularSlots:slots,textbook:$('studentTextbook').value.trim(),remarks:$('studentRemarks').value.trim()};
  if(!data.name||!data.grade){showMessage('生徒名と学年を入力してください。');return;}
  const button=event.submitter;button.disabled=true;
  try{
    const batch=writeBatch(db);batch.set(doc(db,'schoolStudents',id),data);auditChange(batch,`schoolStudents/${id}`,before,data,before?'変更':'追加',`${data.name}さんの生徒情報・通常授業`);await batch.commit();
    if($('studentId').value)await updateStudentEntryLabels(id,data);
    if(JSON.stringify(before?.regularSlots||{})!==JSON.stringify(data.regularSlots)){
      const affected=[...everySlot(before||{}),...everySlot(data)].map(s=>s.teacherUid);
      const oldSlots=everySlot(before||{}),newSlots=everySlot(data);
      const oldSummary=oldSlots.map(s=>`${WEEKDAYS[s.weekday]}曜 ${s.start}〜${s.end} ${s.subject||''}`).join(' / ')||'登録なし';
      const nextSummary=newSlots.map(s=>`${WEEKDAYS[s.weekday]}曜 ${s.start}〜${s.end} ${s.subject||''}`).join(' / ')||'登録なし';
      await sendStudentNotifications(affected,id,data.name,`通常授業が変更されました（変更前：${oldSummary} → 変更後：${nextSummary}）。`);
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
      '過去の授業・欠席・伝達事項も削除されます。運営の変更履歴から復元できる場合がありますが、削除前のバックアップを推奨します。';
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
    const linked=[...request.lessons,...request.targets],group=doc(collection(db,'auditLogs')).id;
    for(let offset=0;offset<linked.length;offset+=175){
      const batch=writeBatch(db);
      for(const snapshot of linked.slice(offset,offset+175)){batch.delete(snapshot.ref);auditChange(batch,snapshot.ref.path,snapshot.data(),null,'削除',`${request.studentName}さんの関連授業・記録`,group);}
      await batch.commit();
    }
    const before=state.students.find(s=>s.id===request.studentId);
    const batch=writeBatch(db);batch.delete(doc(db,'schoolStudents',request.studentId));
    auditChange(batch,`schoolStudents/${request.studentId}`,before,null,'削除',`${request.studentName}さんの生徒情報`,group);await batch.commit();
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
  selectOptions($('lessonStudent'),state.students,s=>`${displayStudentGrade(s)} ${s.name}`);
  selectOptions($('lessonTeacher'),state.people.filter(p=>isAssignableTeacher(p.role)),p=>`${p.name||p.id}${p.role==='owner'?'（運営）':p.role==='admin'?'（管理者）':''}`);
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
    $('lessonCourseHint').textContent=`${courseDisplayName(course)}期間：この日は講習専用の授業を登録します。通常授業は保存済みのまま非表示です。`;
    course.periods.forEach((p,i)=>{const option=make('option','',`${i+1}限　${p.start}〜${p.end}`);option.value=String(i);$('lessonCoursePeriod').append(option);});
    const current=course.periods.findIndex(p=>p.start===(lesson?.start||$('lessonStart').value) && p.end===(lesson?.end||$('lessonEnd').value));
    $('lessonCoursePeriod').value=String(Math.max(0,current));
    $('lessonCoursePeriod').required=true;
  }else $('lessonCoursePeriod').required=false;
}
$('lessonDate').addEventListener('change',()=>syncLessonCoursePeriod());
$('addLesson').addEventListener('click',()=>openLessonForm());

function lessonNoticeText(before,after,mode='save'){
  const lesson=after||before;
  if(!lesson)return '授業予定が変更されました。';
  const when=`${prettyDate(lesson.date)} ${lesson.start}〜${lesson.end}`;
  const who=`${lesson.studentName||'生徒'}の`;
  if(mode==='delete')return `${when} ${who}授業が削除されました。`;
  if(!before)return `${when} ${who}授業が登録されました（${lesson.subject||'教科未設定'}）。`;
  if(before.status!==after.status){
    if(after.status==='cancelled')return `${when} ${who}授業が欠席になりました。`;
    if(before.status==='cancelled')return `${when} ${who}授業の欠席が取り消されました。`;
    if(after.status==='done')return `${when} ${who}授業が実施済みに変更されました。`;
  }
  if(before.date!==after.date||before.start!==after.start||before.end!==after.end){
    return `${when} ${who}授業日時が変更されました（変更前：${prettyDate(before.date)} ${before.start}〜${before.end}）。`;
  }
  if(before.teacherUid!==after.teacherUid)return `${when} ${who}担当講師が${before.teacherName||'未設定'}から${after.teacherName||'未設定'}に変更されました。`;
  if(before.subject!==after.subject)return `${when} ${who}授業科目が${before.subject||'未設定'}から${after.subject||'未設定'}に変更されました。`;
  if(mode==='memo'||before.memo!==after.memo)return `${when} ${who}授業の伝達事項が変更されました。`;
  return `${when} ${who}授業内容が変更されました。`;
}
function lessonNoticePayload(before,after,mode='save'){
  const lesson=after||before;
  return {kind:'lesson',lessonId:lesson.id,date:lesson.date,message:lessonNoticeText(before,after,mode).slice(0,390),read:false,createdAt:serverTimestamp()};
}
async function sendLessonNotifications(uids,before,after,mode='save',batch=null){
  const unique=[...new Set(uids.filter(Boolean))];if(!unique.length)return;
  const writer=batch||writeBatch(db),payload=lessonNoticePayload(before,after,mode);
  for(const uid of unique)writer.set(doc(collection(db,'notifications',uid,'items')),payload);
  if(!batch)await writer.commit();
}
function openNotificationTarget(n){
  if(n.kind==='availability' && isAdmin()){
    if(!syncAvailabilityDraft(n.courseId,n.senderUid))return;
    closeDialog('notificationDialog');nav('availability');return;
  }
  if(n.kind==='student'&&n.studentId){
    const student=state.students.find(s=>s.id===n.studentId);
    closeDialog('notificationDialog');
    nav(isAdmin()?'count':'students');
    const search=$(isAdmin()?'studentSearch':'teacherStudentSearch');
    search.value=student?.name||'';
    if(isAdmin())renderCount();else renderTeacherStudents();
    search.scrollIntoView({behavior:'smooth',block:'center'});
    if(!student)showMessage('対象の生徒情報はすでに削除されています。');
    return;
  }
  const date=n.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return;
  closeDialog('notificationDialog');
  state.date=date;
  if(n.kind==='lesson'&&n.lessonId){
    // A reassigned lesson may no longer belong to the current teacher.
    if(!isAdmin())$('teacherFilter').value='all';
  }
  nav(isAdmin()?'adminLessons':'teacherLessons');
  selectScheduleView('day');
  if(n.kind==='lesson'&&n.lessonId){
    if(lessonById(n.lessonId))openLessonDetail(n.lessonId);
    else showMessage(`${prettyDate(date)}の時間割を開きました。対象の授業は削除または移動されています。`);
  }
}

async function sendStudentNotifications(uids,studentId,name,change){
  const unique=[...new Set(uids.filter(Boolean))];if(!unique.length)return;
  const writer=writeBatch(db);
  const message=`${name||'担当生徒'}さんの${change}`.slice(0,390);
  for(const uid of unique)writer.set(doc(collection(db,'notifications',uid,'items')),
    {kind:'student',studentId,message,date:todayKey(),read:false,createdAt:serverTimestamp()});
  await writer.commit();
}
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
  const data={studentId:student.id,studentName:student.name,grade:displayStudentGrade(student,date),school:student.school,teacherUid:teacher.id,teacherName:teacher.name,date,start,end,subject:$('lessonSubject').value.trim(),status:$('lessonStatus').value,memo:old?.memo||'',memoUpdatedAt:old?.memoUpdatedAt||null,nextDates:old?.nextDates||[]};
  if(old?.regularId)data.regularId=old.regularId;
  if(course)data.courseId=course.id;
  if(!isAssignableTeacher(teacher.role)){showMessage('運営アカウントは担当講師に設定できません。');return;}
  if(!course&&data.status!=='cancelled'&&isTeacherAbsentForLesson(data)){showMessage('指定された講師はこの日の該当コマが欠席設定です。別の担当講師を選んでください。');return;}
  // Single-lesson editing must honor the same server-stored teacher limit as
  // the course editor (0–4 per slot, default 2). Never silently assume 2.
  if(course && data.status!=='cancelled'){
    const periodIndex=course.periods.findIndex(p=>p.start===start&&p.end===end);
    if(periodIndex<0||!availabilityAllows(course.id,teacher.id,date,periodIndex)){showMessage('この講師は指定された日時の勤務希望を提出していません。講師勤務希望画面で先に登録してください。');return;}
    let teacherLimit=2;
    try{
      const response=(await bookingEditorCall({action:'teachers',courseId:course.id})).data;
      const settings=(response.teachers||[]).find(x=>x.id===teacher.id);
      if(!settings){showMessage('担当講師の予約上限を確認できません。');return;}
      const slotKey=`${course.id}__${date}__${periodIndex}`;
      const n=settings.perSlot?.[slotKey]??settings.defaultCapacity??2;
      teacherLimit=Number.isInteger(n)?Math.max(0,Math.min(4,n)):2;
    }catch(error){showMessage('担当講師の予約上限を取得できません：'+String(error?.message||'エラー'));return;}
    const peers=lessonsOnDate(date).filter(e=>e.id!==id && e.status!=='cancelled' && e.start===start && e.end===end);
    if(peers.some(e=>e.studentId===student.id)){showMessage('同じ生徒が同じ講習コマで重複しています。');return;}
    if(peers.filter(e=>e.teacherUid===teacher.id).length>=teacherLimit){showMessage(`このコマの担当講師の設定上限（${teacherLimit}人）を超えています。`);return;}
  }
  const btn=event.submitter;btn.disabled=true;
  try{
    const batch=writeBatch(db);batch.set(doc(db,'timetableEntries',id),data);
    auditChange(batch,`timetableEntries/${id}`,old?.virtual?null:old,data,old?'変更':'追加',`${prettyDate(date)} ${start}〜${end} ${student.name}さんの授業`);
    if(course)batch.set(doc(db,'specialCourses',course.id,'scheduleMeta','state'),{version:increment(1),updatedBy:state.user.uid,updatedAt:serverTimestamp()},{merge:true});
    const affected=[teacher.id];if(old?.teacherUid&&old.teacherUid!==teacher.id)affected.push(old.teacherUid);
    await sendLessonNotifications(affected,old,{...data,id},'save',batch);
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
    auditChange(batch,`timetableEntries/${old.id}`,old,null,'削除',`${prettyDate(old.date)} ${old.start}〜${old.end} ${old.studentName||'生徒'}さんの授業`);
    if(old.courseId)batch.set(doc(db,'specialCourses',old.courseId,'scheduleMeta','state'),{version:increment(1),updatedBy:state.user.uid,updatedAt:serverTimestamp()},{merge:true});
    await sendLessonNotifications([old.teacherUid],old,null,'delete',batch);
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
  $('detailGrade').textContent=[displayLessonGrade(lesson),lesson.school].filter(Boolean).join(' / ');
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
    auditChange(batch,`timetableEntries/${lesson.id}`,lesson.virtual?null:lesson,{...lesson,memo:content,memoUpdatedAt:serverTimestamp()},'変更',`${prettyDate(lesson.date)} ${lesson.studentName||'生徒'}さんの伝達事項`);
    await sendLessonNotifications([lesson.teacherUid],lesson,{...lesson,memo:content},'memo',batch);
    await batch.commit();
    closeDialog('detailDialog');showMessage('伝達事項を保存しました。時間割にも反映されます。');
  }
  catch(e){trapError(e,'伝達事項の保存に失敗しました');}finally{button.disabled=false;}
});
// Course-period availability is kept separately from lesson assignments.
// Only the employee's own document may be edited by the employee; all timetable
// mutations remain administrator-only and are also validated in Security Rules.
const availabilitySlotKey=(date,periodIndex)=>`${date}_${periodIndex}`;
const availabilityDocKey=(courseId,uid)=>`${courseId}/${uid}`;
const availabilityRecord=(courseId,uid)=>state.availability.get(availabilityDocKey(courseId,uid))||null;
function availabilityAllows(courseId,uid,date,periodIndex){
  if(periodIndex<0||!courseId||!uid||!date)return false;
  const course=state.courses.find(c=>c.id===courseId);
  if(!course||date<course.startDate||date>course.endDate||closureFor(date))return false;
  return Array.isArray(availabilityRecord(courseId,uid)?.slots)
    && availabilityRecord(courseId,uid).slots.includes(availabilitySlotKey(date,periodIndex));
}
function courseEditorHasDayAvailability(courseId,uid,date){
  const course=state.courses.find(c=>c.id===courseId);
  return Boolean(course?.periods.some((_,i)=>availabilityAllows(courseId,uid,date,i)));
}
function courseEditorSortedTeachers(date){
  return state.people.filter(p=>isAssignableTeacher(p.role)).sort((a,b)=>{
    const group=p=>isManagementRole(p.role)?2:courseEditorHasDayAvailability(courseEditor.courseId,p.id,date)?0:1;
    return group(a)-group(b)||collator.compare(a.name||'',b.name||'');
  });
}
function availabilityDeadlineDate(course){
  return course?.availabilityDeadline?.toDate?.()||null;
}
function formatDeadline(course){
  const date=availabilityDeadlineDate(course);
  return date?date.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未設定（講師の提出不可）';
}
// Home status for teachers, and the count of submitted teachers for management.
// A submission is a SAVED Firestore document, never just a locally selected slot.
function countdownUntil(deadline,now=Date.now()){
  if(!(deadline instanceof Date)||Number.isNaN(deadline.getTime()))return '締切未設定';
  const ms=deadline.getTime()-now;
  if(ms<=0)return '締切終了';
  const minutes=Math.ceil(ms/60000);
  const days=Math.floor(minutes/1440),hours=Math.floor((minutes%1440)/60),mins=minutes%60;
  if(days>0)return `残り ${days}日 ${hours}時間`;
  if(hours>0)return `残り ${hours}時間 ${mins}分`;
  return `残り ${mins}分`;
}
function openAvailabilityFromHome(courseId){
  const course=state.courses.find(c=>c.id===courseId);
  if(!course||course.archived===true){showMessage('非表示の講習は勤務希望画面に表示されません。');return;}
  const uid=isAdmin()
    ?(availabilityEditor.uid||state.people.find(p=>p.role==='employee')?.id||state.user.uid)
    :state.user.uid;
  if(!syncAvailabilityDraft(course.id,uid))return;
  nav('availability');
}
// The deadline/submission overview is now integrated in the selected course itself.
// Remove the duplicated upper dashboard card; do not delete any submission records.
function renderAvailabilityHome(){
  const panel=$('availabilityHomePanel');
  if(panel)panel.hidden=true;
}
// Update the countdown without requiring a page reload or a Firestore write.
setInterval(()=>{
  if(!state.user)return;
  refreshAcademicYear();
  renderAvailabilityHome();
  renderNoticeButton();
  if($('notificationDialog').open)renderNotifications();
  if(state.page==='availability')renderAvailabilityPage();
},60000);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden||!state.user)return;
  refreshAcademicYear();
  renderAvailabilityHome();renderNoticeButton();if($('notificationDialog').open)renderNotifications();
  if(state.page==='availability')renderAvailabilityPage();
});
function localDateTimeInput(date){
  const pad=n=>String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function clearAvailabilitySubscriptions(){
  for(const unsub of state.availabilityUnsub||[])try{unsub();}catch(error){console.warn(error);}
  state.availabilityUnsub=[];
}
function subscribeAvailabilityCourses(){
  clearAvailabilitySubscriptions();
  state.availability=new Map();state.availabilityStatus={};
  for(const course of state.courses.filter(c=>c.archived!==true)){
    const courseId=course.id;
    state.availabilityStatus[courseId]='loading';
    if(isAdmin()){
      const ref=collection(db,'specialCourses',courseId,'teacherAvailability');
      const unsub=onSnapshot(ref,snapshot=>{
        for(const key of [...state.availability.keys()])if(key.startsWith(courseId+'/'))state.availability.delete(key);
        for(const d of snapshot.docs)state.availability.set(availabilityDocKey(courseId,d.id),{...d.data(),uid:d.id});
        state.availabilityStatus[courseId]='ready';renderAll();
      },error=>{state.availabilityStatus[courseId]='error';trapError(error,'講師の勤務希望を取得できません');renderAll();});
      state.availabilityUnsub.push(unsub);
    }else{
      const ref=doc(db,'specialCourses',courseId,'teacherAvailability',state.user.uid);
      const unsub=onSnapshot(ref,snapshot=>{
        const key=availabilityDocKey(courseId,state.user.uid);
        if(snapshot.exists())state.availability.set(key,{...snapshot.data(),uid:snapshot.id});
        else state.availability.delete(key);
        state.availabilityStatus[courseId]='ready';renderAll();
      },error=>{state.availabilityStatus[courseId]='error';trapError(error,'勤務希望を取得できません');renderAll();});
      state.availabilityUnsub.push(unsub);
    }
  }
}
let availabilityEditor;
function resetAvailabilityEditor(){
  availabilityEditor={courseId:'',uid:'',draft:new Set(),sourceKey:'[]',busy:false,renderedKey:''};
}
resetAvailabilityEditor();
const availabilitySetKey=slots=>JSON.stringify([...slots].sort());
function syncAvailabilityDraft(courseId,uid,force=false){
  if(!courseId||!uid)return;
  const key=availabilitySetKey(availabilityRecord(courseId,uid)?.slots||[]);
  const dirty=availabilityEditor.sourceKey!==availabilitySetKey(availabilityEditor.draft);
  if(!force && dirty && (courseId!==availabilityEditor.courseId||uid!==availabilityEditor.uid)){
    if(!confirm('提出前の勤務希望の変更を破棄しますか？'))return false;
  }
  if(force||courseId!==availabilityEditor.courseId||uid!==availabilityEditor.uid){
    availabilityEditor.courseId=courseId;availabilityEditor.uid=uid;
    availabilityEditor.renderedKey='';
    availabilityEditor.draft=new Set(availabilityRecord(courseId,uid)?.slots||[]);
    availabilityEditor.sourceKey=key;
  }else if(!dirty && availabilityEditor.sourceKey!==key){
    availabilityEditor.draft=new Set(availabilityRecord(courseId,uid)?.slots||[]);
    availabilityEditor.sourceKey=key;
  }
  return true;
}
function availabilityCanEdit(course){
  return Boolean(state.user && course && course.archived!==true && state.availabilityStatus[course.id]==='ready'
    && (isAdmin() || (availabilityDeadlineDate(course)?.getTime()||0)>=Date.now()));
}
function renderAvailabilityPage(){
  if(!state.user||state.page!=='availability')return;
  const courseSelect=$('availabilityCourse'),oldCourse=availabilityEditor.courseId;
  courseSelect.replaceChildren();
  const activeCourses=state.courses.filter(c=>c.archived!==true);
  for(const c of activeCourses){const opt=make('option','',`${courseDisplayName(c)}　${prettyDate(c.startDate)}〜${prettyDate(c.endDate)}`);opt.value=c.id;courseSelect.append(opt);}
  if(!activeCourses.length){$('availabilityGrid').replaceChildren(make('p','empty','表示中の講習はありません。管理者は講習期間管理の非表示一覧から復元できます。'));$('availabilitySubmit').disabled=true;return;}
  const course=activeCourses.find(c=>c.id===oldCourse)||activeCourses.find(c=>c.endDate>=todayKey())||activeCourses.at(-1);
  const people=state.people.filter(p=>isAssignableTeacher(p.role)).sort((a,b)=>a.role===b.role?collator.compare(a.name||'',b.name||''):a.role==='employee'?-1:1);
  const personSelect=$('availabilityPerson');personSelect.replaceChildren();
  for(const p of people){const opt=make('option','',`${p.name||p.id}${p.role==='owner'?'（運営）':p.role==='admin'?'（管理者）':''}`);opt.value=p.id;personSelect.append(opt);}
  $('availabilityPersonWrap').hidden=!isAdmin();
  const uid=isAdmin()&&people.some(p=>p.id===availabilityEditor.uid)?availabilityEditor.uid:isAdmin()?people[0]?.id:state.user.uid;
  if(!uid){$('availabilityGrid').replaceChildren(make('p','empty','講師アカウントがありません。'));return;}
  if(state.availabilityStatus[course.id]==='ready')syncAvailabilityDraft(course.id,uid);
  else if(course.id!==availabilityEditor.courseId||uid!==availabilityEditor.uid){
    availabilityEditor.courseId=course.id;availabilityEditor.uid=uid;availabilityEditor.renderedKey='';
    availabilityEditor.draft=new Set();availabilityEditor.sourceKey='';
  }
  courseSelect.value=course.id;personSelect.value=uid;
  // Build every course day, including dates across months and year boundaries.
  const dates=[];
  for(let day=course.startDate;day<=course.endDate;day=datePlus(day,1))dates.push(day);
  $('availabilityWeekLabel').textContent=`${course.startDate.slice(0,4)}年${prettyDate(course.startDate)} 〜 ${course.endDate.slice(0,4)}年${prettyDate(course.endDate)}`;
  const closedDays=new Set(dates.filter(date=>Boolean(closureFor(date))));
  const deadline=availabilityDeadlineDate(course);
  const canEdit=availabilityCanEdit(course)&&!availabilityEditor.busy;
  $('availabilityDeadlineInfo').textContent=`勤務希望提出締切：${formatDeadline(course)}　｜　${countdownUntil(deadline)}　｜　${!deadline?'未設定':deadline.getTime()<=Date.now()?'受付終了':canEdit?'受付中・編集可能':'読込中'}`;
  $('availabilitySubmit').textContent=availabilityEditor.busy?'保存中…':isAdmin()?'この講師の勤務希望を保存':'勤務希望を提出・更新';
  function updateDraftDisplay(){
    const submitted=Boolean(availabilityRecord(course.id,uid));
    const changed=availabilityEditor.sourceKey!==availabilitySetKey(availabilityEditor.draft);
    const currentSource=availabilitySetKey(availabilityRecord(course.id,uid)?.slots||[]);
    const conflict=changed&&currentSource!==availabilityEditor.sourceKey;
    $('availabilityEditingState').textContent=conflict?'⚠ 別の端末で希望が変更されています。破棄して読み直してください。':changed?'保存前の変更あり':submitted?'提出済み':'未提出';
    $('availabilitySubmit').disabled=!canEdit||(!changed&&submitted)||conflict;
    $('availabilityReset').disabled=!changed||availabilityEditor.busy;
    const summary=$('availabilityPeriodOverview');summary.replaceChildren();
    const headline=make('div','availability-overview-main');
    headline.append(make('strong','availability-overview-course',courseDisplayName(course)));
    headline.append(make('span','availability-overview-dates',`${course.startDate.slice(0,4)}年${prettyDate(course.startDate)} 〜 ${course.endDate.slice(0,4)}年${prettyDate(course.endDate)}`));
    const availableCount=[...availabilityEditor.draft].filter(key=>{
      const day=key.slice(0,10);return day>=course.startDate&&day<=course.endDate&&!closedDays.has(day);
    }).length;
    headline.append(make('span','availability-overview-count',`全${dates.length}日・休校${closedDays.size}日 ｜ 出勤可能 ${availableCount}コマ`));
    const cutoff=availabilityDeadlineDate(course);
    const waiting=state.availabilityStatus[course.id]!=='ready';
    const status=make('div','availability-overview-emphasis');
    status.append(
      make('strong','',`勤務希望提出締切：${formatDeadline(course)}`),
      make('span','',waiting?'提出状況を確認中':!cutoff?'提出受付前':cutoff.getTime()<=Date.now()?'締切終了':'受付中'),
      make('span','',submitted?'✓ 提出済み':'未提出')
    );
    summary.append(headline,status);
  }
  updateDraftDisplay();
  const host=$('availabilityGrid');
  const newGridKey=`${course.id}:${uid}`;
  const oldScrollLeft=availabilityEditor.renderedKey===newGridKey?host.scrollLeft:0;
  const oldScrollTop=availabilityEditor.renderedKey===newGridKey?host.scrollTop:0;
  host.replaceChildren();
  if(state.availabilityStatus[course.id]!=='ready'){
    host.append(make('div','empty','勤務希望のデータを読み込んでいます…'));
    availabilityEditor.renderedKey='';return;
  }
  const table=make('table','availability-table');
  const thead=make('thead'),monthHead=make('tr','availability-month-head'),dateHead=make('tr','availability-date-head');
  const corner=make('th','availability-corner','コマ / 時間');corner.rowSpan=2;corner.scope='col';monthHead.append(corner);
  // Month labels make the full-width timeline easy to navigate on iPad.
  for(let i=0;i<dates.length;){
    const month=dates[i].slice(0,7);let end=i+1;
    while(end<dates.length&&dates[end].startsWith(month))end++;
    const monthTitle=make('th','availability-month-label',`${month.slice(0,4)}年${Number(month.slice(5))}月`);
    monthTitle.colSpan=end-i;monthTitle.scope='colgroup';monthHead.append(monthTitle);i=end;
  }
  for(const date of dates){
    const isStart=date===course.startDate,isEnd=date===course.endDate;
    const header=make('th','availability-date-header'+(isStart?' is-course-start':'')+(isEnd?' is-course-end':'')+(closedDays.has(date)?' is-closed-date':'')+(jsDate(date).getDay()===0?' is-sunday':''));
    header.scope='col';
    header.append(make('span','availability-date-main',prettyDate(date)));
    if(isStart||isEnd)header.append(make('span','availability-boundary-label',isStart&&isEnd?'初日・最終日':isStart?'講習初日':'講習最終日'));
    else if(closedDays.has(date))header.append(make('span','availability-closed-label','休校'));
    dateHead.append(header);
  }
  thead.append(monthHead,dateHead);table.append(thead);
  const body=make('tbody');
  course.periods.forEach((period,i)=>{
    const row=make('tr');const periodHead=make('th','availability-period-head',`${i+1}限　${period.start}〜${period.end}`);periodHead.scope='row';row.append(periodHead);
    for(const date of dates){
      const closed=closedDays.has(date);
      const td=make('td','availability-day-cell'+(closed?' is-closed':'')+(date===course.startDate?' is-course-start':'')+(date===course.endDate?' is-course-end':''));
      if(!closed){
        const key=availabilitySlotKey(date,i),checked=availabilityEditor.draft.has(key);
        const btn=make('button','availability-slot'+(checked?' is-available':''),checked?'✓':'');
        btn.type='button';btn.disabled=!canEdit||($('availabilityEditingState').textContent.startsWith('⚠'));
        btn.setAttribute('aria-pressed',String(checked));
        btn.setAttribute('aria-label',`${prettyDate(date)} ${i+1}限 ${checked?'出勤可能':'出勤不可'}`);
        btn.addEventListener('click',()=>{
          if(availabilityEditor.draft.has(key))availabilityEditor.draft.delete(key);
          else availabilityEditor.draft.add(key);
          const selected=availabilityEditor.draft.has(key);
          btn.classList.toggle('is-available',selected);
          btn.textContent=selected?'✓':'';
          btn.setAttribute('aria-pressed',String(selected));
          btn.setAttribute('aria-label',`${prettyDate(date)} ${i+1}限 ${selected?'出勤可能':'出勤不可'}`);
          updateDraftDisplay(); // Keep focus and horizontal scroll position while editing.
        });
        td.append(btn);
      }else td.append(make('span','availability-outside','休校'));
      row.append(td);
    }
    body.append(row);
  });
  table.append(body);host.append(table);
  host.scrollLeft=oldScrollLeft;host.scrollTop=oldScrollTop;
  availabilityEditor.renderedKey=newGridKey;
}
$('availabilityCourse').addEventListener('change',event=>{
  const uid=isAdmin()?($('availabilityPerson').value||state.user.uid):state.user.uid;
  if(!syncAvailabilityDraft(event.target.value,uid)){event.target.value=availabilityEditor.courseId;return;}
  renderAvailabilityPage();
});
$('availabilityPerson').addEventListener('change',event=>{
  if(!syncAvailabilityDraft($('availabilityCourse').value,event.target.value)){event.target.value=availabilityEditor.uid;return;}
  renderAvailabilityPage();
});
$('availabilityReset').addEventListener('click',()=>{
  if(!confirm('未提出の勤務希望の変更を破棄しますか？'))return;
  syncAvailabilityDraft(availabilityEditor.courseId,availabilityEditor.uid,true);renderAvailabilityPage();
});
$('availabilitySubmit').addEventListener('click',async()=>{
  const {courseId,uid}=availabilityEditor,course=state.courses.find(c=>c.id===courseId);
  if(!availabilityCanEdit(course)||availabilityEditor.busy)return;
  const slots=[...availabilityEditor.draft].sort();
  if(slots.length>1200){showMessage('勤務希望の登録数が上限を超えています。');return;}
  if(slots.some(key=>{const [date,n]=key.split('_');return !/^\d{4}-\d{2}-\d{2}$/.test(date)||date<course.startDate||date>course.endDate||!Number.isInteger(+n)||+n<0||+n>=course.periods.length||closureFor(date);})){
    showMessage('期間外・休校日・存在しないコマが含まれています。');return;
  }
  if(availabilityEditor.sourceKey!==availabilitySetKey(availabilityRecord(courseId,uid)?.slots||[])){
    showMessage('別の画面で提出内容が更新されています。いったん変更を破棄してください。');return;
  }
  availabilityEditor.busy=true;renderAvailabilityPage();
  try{
    const availabilityRef=doc(db,'specialCourses',courseId,'teacherAvailability',uid);
    // For employee submissions, notify all administrators in the SAME commit.
    // The Rules require a corresponding availability write via getAfter().
    const adminIds=!isAdmin()?(await getDocs(collection(db,'users'))).docs.filter(d=>isManagementRole(d.data().role)).map(d=>d.id):[];
    if(adminIds.length>50)throw Error('管理者アカウント数を確認してください。');
    const notificationRefs=adminIds.map(adminUid=>doc(collection(db,'notifications',adminUid,'items')));
    await runTransaction(db,async tx=>{
      const snapshot=await tx.get(availabilityRef);
      const previous=snapshot.exists()&&Array.isArray(snapshot.data().slots)?snapshot.data().slots:[];
      if(availabilitySetKey(previous)!==availabilityEditor.sourceKey)throw Error('他の端末で勤務希望が更新されました。変更を破棄して読み直してください。');
      const submitted={slots,updatedBy:state.user.uid,updatedAt:serverTimestamp()};
      tx.set(availabilityRef,submitted);
      auditChange({set:(r,d)=>tx.set(r,d)},availabilityRef.path,snapshot.exists()?snapshot.data():null,submitted,'勤務希望',`${course?.name||'講習'}の勤務希望（${slots.length}コマ）`);
      for(const ref of notificationRefs){
        tx.set(ref,{kind:'availability',senderUid:state.user.uid,courseId,
          read:false,createdAt:serverTimestamp()});
      }
    });
    availabilityEditor.sourceKey=availabilitySetKey(slots);
    showMessage('勤務希望を保存しました。時間割への授業配置は管理者が行います。');
  }catch(error){trapError(error,'勤務希望の提出に失敗しました');}
  finally{availabilityEditor.busy=false;renderAvailabilityPage();}
});

// Create course lessons in the spreadsheet editor as local drafts, then publish
// them together with moved lessons. No draft writes to Firestore.
function openEditorNewLesson({date,periodIndex,teacherUid}={}){
  if(!isAdmin()||courseEditor.busy)return;
  const course=state.courses.find(c=>c.id===courseEditor.courseId);
  if(!course||state.availabilityStatus[course.id]!=='ready'||!courseEditorCapacity.ready)return;
  if(!state.students.length){showMessage('先に生徒を登録してください。');return;}
  const chosenDate=date||courseEditor.date;
  if(chosenDate<course.startDate||chosenDate>course.endDate||closureFor(chosenDate)){showMessage('講習期間内の休校日以外を選択してください。');return;}
  $('editorNewForm').reset();
  selectOptions($('editorNewStudent'),[...state.students].sort((a,b)=>collator.compare(a.name||'',b.name||'')),s=>`${displayStudentGrade(s)} ${s.name||''}`);
  $('editorNewDate').min=course.startDate;$('editorNewDate').max=course.endDate;
  $('editorNewDate').value=chosenDate;
  const periods=$('editorNewPeriod');periods.replaceChildren();
  course.periods.forEach((p,i)=>{const opt=make('option','',`${i+1}限　${p.start}〜${p.end}`);opt.value=String(i);periods.append(opt);});
  periods.value=String(Number.isInteger(periodIndex)?periodIndex:0);
  updateEditorNewTeachers(teacherUid);
  showDialog('editorNewDialog');
}
function updateEditorNewTeachers(preferred=''){
  const course=state.courses.find(c=>c.id===courseEditor.courseId);
  if(!course)return;
  const date=$('editorNewDate').value,i=Number($('editorNewPeriod').value);
  const teacherSelect=$('editorNewTeacher'),old=preferred||teacherSelect.value;
  teacherSelect.replaceChildren();
  const matching=courseEditorSortedTeachers(date).filter(p=>availabilityAllows(course.id,p.id,date,i));
  for(const teacher of matching){
    const active=courseEditorEntries().filter(e=>e.date===date&&e.teacherUid===teacher.id&&e.status!=='cancelled'&&e.start===course.periods[i]?.start&&e.end===course.periods[i]?.end).length;
    const teacherLimit=courseTeacherLimit(course,teacher.id,date,i);
    if(active>=teacherLimit)continue;
    const opt=make('option','',`${teacher.name||teacher.id}${teacher.role==='owner'?'（運営）':teacher.role==='admin'?'（管理者）':''}　${active}/${teacherLimit}人`);opt.value=teacher.id;teacherSelect.append(opt);
  }
  if([...teacherSelect.options].some(o=>o.value===old))teacherSelect.value=old;
  $('editorNewHelp').textContent=teacherSelect.options.length?'講師の出勤希望があるコマだけ登録できます。登録後は「確定して反映」で保存してください。':'この時間帯に出勤可能で空きがある講師がいません。勤務希望または日時を確認してください。';
  $('editorNewForm').querySelector('button[type=submit]').disabled=!teacherSelect.options.length;
}
$('editorNew').addEventListener('click',()=>openEditorNewLesson());
$('editorNewDate').addEventListener('change',()=>updateEditorNewTeachers());
$('editorNewPeriod').addEventListener('change',()=>updateEditorNewTeachers());
$('editorNewForm').addEventListener('submit',event=>{
  event.preventDefault();if(!isAdmin()||courseEditor.busy)return;
  const course=state.courses.find(c=>c.id===courseEditor.courseId);
  const student=state.students.find(s=>s.id===$('editorNewStudent').value);
  const teacher=state.people.find(p=>p.id===$('editorNewTeacher').value);
  const date=$('editorNewDate').value,periodIndex=Number($('editorNewPeriod').value);
  const period=course?.periods[periodIndex],subject=$('editorNewSubject').value.trim();
  if(!course||!student||!teacher||!isAssignableTeacher(teacher.role)||!period){showMessage('生徒・担当講師・日時を確認してください。');return;}
  const id=doc(collection(db,'timetableEntries')).id;
  const entry={id,courseId:course.id,studentId:student.id,studentName:student.name,grade:displayStudentGrade(student,date),school:student.school||'',teacherUid:teacher.id,teacherName:teacher.name||'',date,start:period.start,end:period.end,subject,status:'scheduled',memo:'',memoUpdatedAt:null,nextDates:[]};
  courseEditor.draft.set(id,entry);
  const error=courseEditorValidate(id,entry);
  if(error){courseEditor.draft.delete(id);showMessage(error);return;}
  courseEditor.history.push({id,previous:null});
  courseEditor.selectedId='';courseEditor.date=date;courseEditor.warning='';
  closeDialog('editorNewDialog');renderCourseEditor();showMessage('講習授業を仮登録しました。「確定して反映」で保存されます。');
});
$('editorRemoveDraft').addEventListener('click',()=>{
  const id=courseEditor.selectedId;
  if(!id||!courseEditor.draft.has(id))return;
  const item=courseEditor.draft.get(id);
  if(item.status!=='scheduled'){showMessage('実施済み・欠席の授業はエディターから削除できません。');return;}
  if(!confirm(`${item.studentName||'この生徒'}の講習授業を削除しますか？\n「確定して反映」を押すまでFirebaseからは削除されません。`))return;
  courseEditor.history.push({id,previous:{...item},wasDeleted:courseEditor.deleted.has(id)});
  courseEditor.draft.delete(id);
  if(courseEditor.originals.has(id))courseEditor.deleted.add(id);
  courseEditor.selectedId='';renderCourseEditor();
});

// Spreadsheet-style seasonal course editor. All drag/tap edits are local drafts
// until an administrator explicitly publishes the changed entries.
let courseEditor;
function resetCourseEditor(){
  courseEditor={courseId:'',date:todayKey(),mode:'day',originals:new Map(),draft:new Map(),history:[],deleted:new Set(),selectedId:'',drag:null,suppressClick:false,busy:false,courseSignature:'',warning:''};
}
resetCourseEditor();
const courseEditorKey=e=>JSON.stringify([e?.courseId||'',e?.studentId||'',e?.date||'',e?.start||'',e?.end||'',e?.teacherUid||'',e?.status||'']);
// Only scheduling-critical fields belong to the optimistic concurrency guard.
// Normalize Firestore arrays/objects before comparison; deadline and display name
// can change without invalidating a draft's lesson dates and period times.
const courseEditorSettings=c=>JSON.stringify([
  String(c?.type||''),String(c?.startDate||''),String(c?.endDate||''),
  (Array.isArray(c?.periods)?c.periods:[]).map(p=>[String(p?.start||''),String(p?.end||'')])
]);
function courseEditorChanges(){
  return [...courseEditor.deleted].map(id=>({...courseEditor.originals.get(id),id,_delete:true})).concat([...courseEditor.draft.values()].filter(e=>!courseEditor.originals.has(e.id)||courseEditorKey(e)!==courseEditorKey(courseEditor.originals.get(e.id))));
}
function openCourseEditor(id){
  if(!isAdmin())return false;
  const course=state.courses.find(c=>c.id===id);
  if(!course||course.archived===true||courseEditor.busy)return false;
  if(courseEditorChanges().length&&!confirm('講習配置の未反映の変更があります。破棄して別の講習を開きますか？'))return false;
  courseEditor.courseId=id;
  loadCourseEditorCapacity(id);
  courseEditor.date=course.startDate;
  courseEditor.originals=new Map(courseLessons(id).map(e=>[e.id,{...e}]));
  courseEditor.draft=new Map(courseLessons(id).map(e=>[e.id,{...e}]));
  courseEditor.history=[];courseEditor.deleted=new Set();courseEditor.selectedId='';courseEditor.warning='';courseEditor.courseSignature=courseEditorSettings(course);
  return true;
}
function courseEditorEntries(){return [...courseEditor.draft.values()];}
function courseEditorPeriod(course,entry){return course.periods.findIndex(p=>p.start===entry.start&&p.end===entry.end);}
// Limits are stored server-side; the public app reads only the admin callable's safe summary.
const courseEditorCapacity={courseId:'',teachers:new Map(),ready:false,busy:false,error:'',version:0};
function courseTeacherLimit(course,uid,date,index){
  if(!course||!Number.isInteger(index)||index<0)return 2;
  const item=courseEditorCapacity.courseId===course.id?courseEditorCapacity.teachers.get(uid):null;
  const key=`${course.id}__${date}__${index}`;
  const n=item?.perSlot?.[key]??item?.defaultCapacity??2;
  return Number.isInteger(n)?Math.max(0,Math.min(4,n)):2;
}
async function loadCourseEditorCapacity(id){
  const seq=++courseEditorCapacity.version;
  courseEditorCapacity.courseId=id;courseEditorCapacity.teachers=new Map();
  courseEditorCapacity.ready=false;courseEditorCapacity.error='';
  try{
    const response=(await bookingEditorCall({action:'teachers',courseId:id})).data;
    if(seq!==courseEditorCapacity.version||id!==courseEditor.courseId)return;
    courseEditorCapacity.teachers=new Map((response.teachers||[]).map(item=>[item.id,item]));
    courseEditorCapacity.ready=true;
  }catch(error){
    if(seq!==courseEditorCapacity.version||id!==courseEditor.courseId)return;
    courseEditorCapacity.error=String(error?.message||'担当上限を取得できませんでした');
    console.error('講師の担当上限を取得できません',error);
  }
  if(state.page==='courseEditor')renderCourseEditor();
}
async function saveCourseEditorLimit(course,uid,date,index,value){
  if(!isAdmin()||courseEditorCapacity.busy||!courseEditorCapacity.ready)return;
  if(!Number.isInteger(value)||value<0||value>4){showMessage('担当上限は0〜4人です。');return;}
  const chosen=courseEditorEntries().filter(e=>e.teacherUid===uid&&e.date===date&&e.status!=='cancelled'&&e.start===course.periods[index].start&&e.end===course.periods[index].end).length;
  if(value<chosen){showMessage(`仮配置の授業が${chosen}人分あります。先に授業を調整してください。`);renderCourseEditor();return;}
  courseEditorCapacity.busy=true;
  const key=`${course.id}__${date}__${index}`;
  try{
    await bookingEditorCall({action:'setTeacherLimit',courseId:course.id,teacherUid:uid,slotId:key,capacity:value});
    const item=courseEditorCapacity.teachers.get(uid);
    if(item)item.perSlot={...(item.perSlot||{}),[key]:value};
    showMessage(`${prettyDate(date)}の${state.people.find(p=>p.id===uid)?.name||'講師'}の上限を${value}人に変更しました。予約枠にも自動反映されます。`);
  }catch(error){
    console.error(error);showMessage('担当上限を変更できません：'+String(error?.message||'エラー'));
  }finally{courseEditorCapacity.busy=false;renderCourseEditor();}
}
function courseEditorValidate(id,target){
  const item=courseEditor.draft.get(id),course=state.courses.find(c=>c.id===courseEditor.courseId);
  if(!item||!course)return '講習または授業が見つかりません。';
  if(!courseEditorCapacity.ready||courseEditorCapacity.courseId!==course.id)return '講師の担当上限を取得中です。しばらくしてから再操作してください。';
  if(item.status!=='scheduled')return '実施済み・欠席の授業はこの画面から移動できません。';
  if(courseEditorSettings(course)!==courseEditor.courseSignature)return '講習期間・コマ設定が変更されています。変更を破棄して読み直してください。';
  if(target.date<course.startDate||target.date>course.endDate||courseFor(target.date)?.id!==course.id||hasCourseConflict(target.date))return '指定日は、この講習期間に含まれていません。';
  if(closureFor(target.date))return `${prettyDate(target.date)}は休校日です。`;
  if(!course.periods.some(p=>p.start===target.start&&p.end===target.end))return '講習で設定したコマを選択してください。';
  if(!state.people.some(p=>p.id===target.teacherUid&&isAssignableTeacher(p.role)))return '担当講師には講師・管理者アカウントを指定してください。';
  const periodIndex=courseEditorPeriod(course,target);
  if(!availabilityAllows(course.id,target.teacherUid,target.date,periodIndex))return 'この講師は指定されたコマの勤務希望を提出していません。';
  const peer=courseEditorEntries().filter(e=>e.id!==id&&e.status!=='cancelled'&&e.date===target.date&&e.start<target.end&&e.end>target.start);
  if(peer.some(e=>e.studentId===item.studentId))return 'この時間帯は、同じ生徒の授業がすでに登録されています。';
  if(peer.filter(e=>e.teacherUid===target.teacherUid).length>=courseTeacherLimit(course,target.teacherUid,target.date,periodIndex))return '担当講師の設定上限を超えています（初期値2人・最大4人）。';
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
  card.append(make('strong','',`${displayLessonGrade(item)} ${item.studentName||'生徒名未設定'}`));
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
  const selected=courseEditor.draft.get(courseEditor.selectedId);
  const unavailable=teacherUid?!availabilityAllows(course.id,teacherUid,date,periodIndex):selected?!availabilityAllows(course.id,selected.teacherUid,date,periodIndex):!state.people.some(p=>isAssignableTeacher(p.role)&&availabilityAllows(course.id,p.id,date,periodIndex));
  if(closed||outside||unavailable)cell.classList.add('is-blocked');
  if(unavailable)cell.classList.add('is-unavailable');
  if(closed)cell.classList.add('is-closed');
  cell.tabIndex=0;cell.setAttribute('role','button');
  cell.title=closed?'休校日':outside?'講習期間外':unavailable?'勤務希望なし（登録・移動不可）':`${prettyDate(date)} ${periodIndex+1}限：タップで授業登録、または移動先`; 
  const contained=courseEditorEntries().filter(e=>e.date===date&&e.start===period.start&&e.end===period.end&&(!teacherUid||e.teacherUid===teacherUid));
  const localLimit=teacherUid?courseTeacherLimit(course,teacherUid,date,periodIndex):null;
  if(teacherUid && contained.filter(e=>e.status!=='cancelled').length>=localLimit)cell.classList.add('is-full');
  const title=make('div','editor-slot-note',closed?'休校':outside?'期間外':unavailable?(contained.length?'⚠ 勤務希望外':''):teacherUid?`${contained.filter(e=>e.status!=='cancelled').length}/${localLimit}人`:contained.length?`${contained.length}件`:'');
  cell.append(title);
  // One per teacher/slot in the DAY view. Event propagation must not create a lesson.
  if(teacherUid && !closed && !outside && !unavailable && courseEditorCapacity.ready){
    const control=make('label','editor-limit-control');control.append(make('span','','担当上限'));
    const select=make('select','editor-limit-select');select.setAttribute('aria-label',`${prettyDate(date)} ${state.people.find(p=>p.id===teacherUid)?.name||'講師'}の担当上限`);
    for(let n=0;n<=4;n++){const opt=make('option','',`${n}人`);opt.value=String(n);select.append(opt);}
    select.value=String(localLimit);select.disabled=courseEditorCapacity.busy;
    select.addEventListener('click',e=>e.stopPropagation());
    select.addEventListener('pointerdown',e=>e.stopPropagation());
    select.addEventListener('keydown',e=>e.stopPropagation());
    select.addEventListener('change',e=>{e.stopPropagation();saveCourseEditorLimit(course,teacherUid,date,periodIndex,Number(select.value));});
    control.addEventListener('click',e=>e.stopPropagation());
    control.addEventListener('pointerdown',e=>e.stopPropagation());
    control.addEventListener('keydown',e=>e.stopPropagation());
    control.append(select);cell.append(control);
  }
  const bag=make('div','editor-slot-bag');contained.forEach(item=>bag.append(courseEditorCard(item)));cell.append(bag);
  if(!contained.length&&!unavailable)cell.append(make('div','editor-slot-empty',closed?'休校':outside?'—':'+ 授業を登録 / 移動')); 
  cell.addEventListener('click',()=>{if(!closed&&!outside&&!unavailable){if(courseEditor.selectedId)courseEditorFromCell(cell);else openEditorNewLesson({date,periodIndex,teacherUid});}});
  cell.addEventListener('keydown',e=>{if(e.target!==cell)return;if((e.key==='Enter'||e.key===' ')&&!closed&&!outside&&!unavailable){e.preventDefault();if(courseEditor.selectedId)courseEditorFromCell(cell);else openEditorNewLesson({date,periodIndex,teacherUid});}});
  return cell;
}
function renderCourseEditor(){
  if(!isAdmin()||state.page!=='courseEditor')return;
  const chooser=$('editorCourse'),keep=courseEditor.courseId;
  chooser.replaceChildren();
  const visibleCourses=state.courses.filter(c=>c.archived!==true);
  for(const c of visibleCourses){const opt=make('option','',`${courseDisplayName(c)}　${prettyDate(c.startDate)}〜${prettyDate(c.endDate)}`);opt.value=c.id;chooser.append(opt);}
  if(!courseEditor.courseId && visibleCourses.length && state.entriesStatus==='ready' && state.coursesStatus==='ready')openCourseEditor(visibleCourses.find(c=>c.endDate>=todayKey())?.id||visibleCourses.at(-1).id);
  if(courseEditor.courseId && !visibleCourses.some(c=>c.id===courseEditor.courseId))resetCourseEditor();
  chooser.value=courseEditor.courseId||'';
  const course=state.courses.find(c=>c.id===courseEditor.courseId);
  const host=$('editorGrid');host.replaceChildren();
  const ok=Boolean(course&&state.entriesStatus==='ready'&&state.coursesStatus==='ready'&&state.closuresStatus==='ready'&&state.openDaysStatus==='ready'&&state.availabilityStatus[course.id]==='ready'&&courseEditorCapacity.ready&&courseEditorCapacity.courseId===course.id);
  $('editorDayMode').classList.toggle('active',courseEditor.mode==='day');$('editorWeekMode').classList.toggle('active',courseEditor.mode==='week');
  $('editorDayMode').setAttribute('aria-pressed',String(courseEditor.mode==='day'));
  $('editorWeekMode').setAttribute('aria-pressed',String(courseEditor.mode==='week'));
  $('editorDate').value=courseEditor.date;
  $('editorDate').disabled=!course;
  $('editorPrevious').disabled=!course;$('editorNext').disabled=!course;
  $('editorCancelSelection').hidden=!courseEditor.selectedId;
  $('editorUndo').disabled=!courseEditor.history.length||courseEditor.busy;
  $('editorNew').disabled=!ok||courseEditor.busy;
  if(courseEditor.selectedId&&!courseEditor.draft.has(courseEditor.selectedId))courseEditor.selectedId='';
  $('editorRemoveDraft').hidden=!courseEditor.selectedId;
  $('editorRemoveDraft').textContent=courseEditor.selectedId&&courseEditor.originals.has(courseEditor.selectedId)?'授業を削除':'仮登録を削除';
  const changes=courseEditorChanges();
  $('editorReset').disabled=!changes.length||courseEditor.busy;
  $('editorSave').disabled=!changes.length||!ok||courseEditor.busy;
  $('editorSave').textContent=courseEditor.busy?'反映中…':`確定して反映${changes.length?'（'+changes.length+'件）':''}`;
  $('editorStatus').textContent=!ok?(state.coursesStatus==='error'||state.entriesStatus==='error'||state.availabilityStatus[course?.id]==='error'?'講習・授業・勤務希望の読み込みに失敗しました':courseEditorCapacity.error?'担当上限を読み込めません：'+courseEditorCapacity.error:'講習・授業・勤務希望・担当上限の読込中です'):courseEditor.selectedId?'授業を選択中：日付を変更してから移動先をタップできます':changes.length?`未反映の変更：${changes.length}件（講師にはまだ公開されていません）`:'変更なし・講師に公開中の時間割';
  const otherEdits=changes.some(e=>{if(!courseEditor.originals.has(e.id))return false;const current=state.entries.find(x=>x.id===e.id);return !current||courseEditorKey(current)!==courseEditorKey(courseEditor.originals.get(e.id));});
  const changedCourse=course&&courseEditorSettings(course)!==courseEditor.courseSignature;
  const mismatched=course?courseEditorEntries().filter(e=>e.status!=='cancelled'&&courseEditorPeriod(course,e)>=0&&!availabilityAllows(course.id,e.teacherUid,e.date,courseEditorPeriod(course,e))):[];
  $('editorWarning').hidden=!(otherEdits||changedCourse||courseEditor.warning||mismatched.length);
  $('editorWarning').textContent=changedCourse?'講習期間またはコマ設定が変わりました。変更を破棄して読み直してください。':otherEdits?'別の管理者が同じ授業を変更しました。古い内容は上書きせず、保存時に停止します。':courseEditor.warning|| (mismatched.length?`${mismatched.length}件の授業が最新の勤務希望から外れています。該当する授業を勤務可能なコマへ移動するか、管理者が勤務希望を修正してください。`:'');
  if(!ok){host.append(make('p','empty',courseEditorCapacity.error?'講師の担当上限が取得できません。Firebase Functionsの更新・App Check設定を確認してください。':state.courses.length?'時間割と講習・休校・担当上限情報を読み込んでいます…':'講習期間がありません。「講習期間管理」で登録してください。'));return;}
  const teachers=courseEditorSortedTeachers(courseEditor.date);
  if(courseEditor.mode==='day'&&!teachers.length){host.append(make('p','empty','講師が登録されていません。'));return;}
  const isDay=courseEditor.mode==='day';
  const columns=isDay?teachers:[...Array(7)].map((_,i)=>datePlus(startOfWeek(courseEditor.date),i));
  const table=make('table','editor-grid');
  const thead=make('thead'),headRow=make('tr');headRow.append(make('th','editor-period-heading',isDay?prettyDate(courseEditor.date):'授業時間'));
  for(const column of columns){
    const text=isDay?`${column.name||column.id}${column.role==='owner'?'（運営）':column.role==='admin'?'（管理者）':''}${courseEditorHasDayAvailability(course.id,column.id,courseEditor.date)?' ●':''}`:prettyDate(column);
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
  if(last.previous)courseEditor.draft.set(last.id,last.previous);else courseEditor.draft.delete(last.id);if(last.wasDeleted)courseEditor.deleted.add(last.id);else courseEditor.deleted.delete(last.id);courseEditor.selectedId='';renderCourseEditor();
});
$('editorReset').addEventListener('click',()=>{
  if(!courseEditorChanges().length)return;
  if(!confirm('未反映の変更をすべて破棄し、現在の時間割を読み直しますか？'))return;
  const id=courseEditor.courseId,date=courseEditor.date,mode=courseEditor.mode;
  courseEditor.draft=new Map();courseEditor.originals=new Map();courseEditor.history=[];courseEditor.deleted=new Set();
  openCourseEditor(id);courseEditor.date=date;courseEditor.mode=mode;renderCourseEditor();
});
async function publishCourseEditor(){
  if(!isAdmin()||courseEditor.busy)return;
  const changes=courseEditorChanges(),course=state.courses.find(c=>c.id===courseEditor.courseId);
  if(!changes.length||!course)return;
  if(changes.length>90){showMessage('履歴記録を含め、一度に反映できる変更は90件までです。複数回に分けて確定してください。');return;}
  if(courseEditorSettings(course)!==courseEditor.courseSignature){showMessage('講習設定が変更されました。再読み込みしてください。');return;}
  for(const changed of changes.filter(e=>!e._delete)){const error=courseEditorValidate(changed.id,changed);if(error){showMessage(error);return;}}
  if(!confirm(`${changes.length}件の講習授業の変更を確定し、講師の時間割に反映しますか？`))return;
  courseEditor.busy=true;renderCourseEditor();
  try{
    const dates=[...new Set(changes.flatMap(e=>[e.date,courseEditor.originals.get(e.id)?.date].filter(Boolean)))];
    // A revision guard catches concurrent creations, which a preflight date query alone cannot detect.
    const metaRef=doc(db,'specialCourses',course.id,'scheduleMeta','state');
    const metaBefore=await getDoc(metaRef);
    const expectedVersion=metaBefore.exists()?Number(metaBefore.data().version)||0:0;
    // Fetch all known timetable documents on touched dates before the transaction.
    const snapshots=await Promise.all(dates.map(date=>getDocs(query(collection(db,'timetableEntries'),where('date','==',date)))));
    const peers=new Map(snapshots.flatMap(snap=>snap.docs).map(snap=>[snap.id,snap]));
    for(const change of changes){if(courseEditor.originals.has(change.id)&&!peers.has(change.id))throw Error('元の授業を確認できません。画面を再読み込みしてください。');}
    const peerDocs=[...peers.values()];
    if(peerDocs.length>350)throw Error('対象日の授業が多すぎます。変更を分けて反映してください。');
    const courseRef=doc(db,'specialCourses',course.id);
    const closureRefs=dates.map(date=>doc(db,'schoolClosures',date));
    const openRefs=dates.map(date=>doc(db,'schoolOpenDays',date));
    const examRefs=dates.map(date=>doc(db,'schoolEvents',date));
    const affected=[...new Set(changes.flatMap(e=>[e.teacherUid,courseEditor.originals.get(e.id)?.teacherUid]).filter(Boolean))];
    const availRefs=affected.map(uid=>doc(db,'specialCourses',course.id,'teacherAvailability',uid));
    await runTransaction(db,async tx=>{
      // Every read happens before the first write, including closure records.
      const courseSnap=await tx.get(courseRef);
      const metaNow=await tx.get(metaRef);
      const closureSnaps=await Promise.all(closureRefs.map(r=>tx.get(r)));
      const openSnaps=await Promise.all(openRefs.map(r=>tx.get(r)));
      const examSnaps=await Promise.all(examRefs.map(r=>tx.get(r)));
      const fresh=await Promise.all(peerDocs.map(s=>tx.get(s.ref)));
      const availabilitySnaps=await Promise.all(availRefs.map(ref=>tx.get(ref)));
      if(!courseSnap.exists()||courseEditorSettings(courseSnap.data())!==courseEditor.courseSignature)throw Error('講習期間・時間設定が変更されました。画面を再読み込みしてください。');
      if((metaNow.exists()?Number(metaNow.data().version)||0:0)!==expectedVersion)throw Error('他の管理者が講習授業を更新しました。最新の時間割を読み直してください。');
      if(dates.some((date,i)=>!openSnaps[i].exists()&&!(examSnaps[i].exists()&&examSnaps[i].data().type==='exam')&&(closureSnaps[i].exists()||!!automaticClosure(date))))throw Error('対象日に休校日が設定されました。再確認してください。');
      const current=new Map();
      for(let i=0;i<peerDocs.length;i++){
        const snap=peerDocs[i],now=fresh[i];
        if(!now.exists()||courseEditorKey(now.data())!==courseEditorKey(snap.data()))throw Error('他の管理者が授業予定を変更しました。再読み込みしてからやり直してください。');
        current.set(snap.id,{id:snap.id,...now.data()});
      }
      const availableByUid=new Map(availabilitySnaps.map((snap,i)=>[affected[i],new Set(snap.exists()&&Array.isArray(snap.data().slots)?snap.data().slots:[])]));
      for(const change of changes){
        if(courseEditor.originals.has(change.id) && courseEditorKey(current.get(change.id))!==courseEditorKey(courseEditor.originals.get(change.id)))throw Error('移動対象の授業が変更されました。最新の時間割を確認してください。');
        if(change._delete){current.delete(change.id);continue;}
        const periodIndex=courseEditorPeriod(course,change);
        if(periodIndex<0||!availableByUid.get(change.teacherUid)?.has(availabilitySlotKey(change.date,periodIndex)))throw Error('講師の勤務希望が変更されたか、未提出です。最新の希望を確認してください。');
        current.set(change.id,{...current.get(change.id),...change});
      }
      // Validate every touched day against *all* currently known peer documents.
      for(const date of dates){
        const rows=[...current.values()].filter(e=>e.courseId===course.id&&e.date===date&&e.status!=='cancelled');
        for(let i=0;i<rows.length;i++){
          const e=rows[i];
          if(!course.periods.some(p=>p.start===e.start&&p.end===e.end))throw Error('登録されたコマと授業時間が一致しません。');
          if(!availableByUid.has(e.teacherUid)){
            // Availability of unaffected teachers cannot be assumed from this transaction: their existing lesson is unchanged.
          }else if(!availableByUid.get(e.teacherUid).has(availabilitySlotKey(e.date,courseEditorPeriod(course,e)))){
            throw Error('同じ日の担当授業で、勤務希望のないコマが見つかりました。管理者が確認してください。');
          }
          for(let j=0;j<i;j++){
            const f=rows[j];if(e.start>=f.end||e.end<=f.start)continue;
            if(e.studentId===f.studentId)throw Error('同じ生徒の授業が重複しています。');
          }
          const count=rows.filter(x=>x.teacherUid===e.teacherUid&&x.start<e.end&&x.end>e.start).length;
          const limit=courseTeacherLimit(course,e.teacherUid,e.date,courseEditorPeriod(course,e));
          if(count>limit)throw Error(`担当講師が設定上限（${limit}人）を超えています。`);
        }
      }
      const auditGroup=doc(collection(db,'auditLogs')).id;
      for(const change of changes){
        const original=courseEditor.originals.get(change.id)||null;
        if(change._delete){tx.delete(doc(db,'timetableEntries',change.id));
          auditChange({set:(r,d)=>tx.set(r,d)},`timetableEntries/${change.id}`,original,null,'削除',`${prettyDate(change.date)} ${change.studentName||'生徒'}さんの講習授業`,auditGroup);continue;}
        const teacher=state.people.find(p=>p.id===change.teacherUid);
        if(!courseEditor.originals.has(change.id)){
          const {id,...entry}=change;tx.set(doc(db,'timetableEntries',change.id),{...entry,teacherName:teacher?.name||change.teacherName});
        }else{tx.update(doc(db,'timetableEntries',change.id),{date:change.date,start:change.start,end:change.end,teacherUid:change.teacherUid,teacherName:teacher?.name||change.teacherName});}
        auditChange({set:(r,d)=>tx.set(r,d)},`timetableEntries/${change.id}`,original,{...original,...change,teacherName:teacher?.name||change.teacherName},original?'変更':'追加',`${prettyDate(change.date)} ${change.start}〜${change.end} ${change.studentName||'生徒'}さんの講習授業`,auditGroup);
      }
      tx.set(metaRef,{version:expectedVersion+1,updatedBy:state.user.uid,updatedAt:serverTimestamp()});
      for(const change of changes){
        const before=courseEditor.originals.get(change.id)||null;
        const after=change._delete?null:{...change,teacherName:state.people.find(p=>p.id===change.teacherUid)?.name||change.teacherName};
        const recipients=[...new Set([before?.teacherUid,after?.teacherUid].filter(Boolean))];
        const payload=lessonNoticePayload(before,after,change._delete?'delete':'save');
        for(const uid of recipients)tx.set(doc(collection(db,'notifications',uid,'items')),payload);
      }
    });
    // Update local snapshot immediately; Firestore's real-time listener follows.
    for(const change of changes){if(change._delete){state.entries=state.entries.filter(e=>e.id!==change.id);continue;}const live=state.entries.find(e=>e.id===change.id);if(live)Object.assign(live,{date:change.date,start:change.start,end:change.end,teacherUid:change.teacherUid,teacherName:change.teacherName});else state.entries.push({...change});}
    const id=courseEditor.courseId,date=courseEditor.date,mode=courseEditor.mode;
    courseEditor.draft=new Map();courseEditor.originals=new Map();courseEditor.history=[];courseEditor.deleted=new Set();
    openCourseEditor(id);courseEditor.date=date;courseEditor.mode=mode;
    showMessage(`${changes.length}件の講習授業を確定して反映しました。`);
    renderAll();
  }catch(error){console.error(error);courseEditor.warning=error.message||'反映できませんでした。';showMessage('反映できませんでした：'+courseEditor.warning);}
  finally{courseEditor.busy=false;renderCourseEditor();}
}
$('editorSave').addEventListener('click',publishCourseEditor);

function syncBookingManagementShortcut(){
  let link=$('navBookingManagement');
  if(!isAdmin()){link?.remove();return;}
  if(link)return;
  link=document.createElement('a');
  link.id='navBookingManagement';
  link.href='./course-booking-admin.html';
  link.className='nav-tab';
  link.textContent='講習予約管理';
  link.style.cssText='display:inline-flex;align-items:center;text-decoration:none;min-height:44px';
  $('navCourses').after(link);
}
function loggedOut(){
  if(maintenanceState.unsub){maintenanceState.unsub();maintenanceState.unsub=null;}
  maintenanceState.loaded=false;maintenanceState.dataStarted=false;maintenanceState.enabled=false;maintenanceState.history=[];
  $('maintenancePanel').hidden=true;
  auditState.logs=[];auditState.archives=[];auditState.loaded=false;auditState.busy=false;
  $('ownerAuditList').replaceChildren();$('ownerArchiveList').replaceChildren();$('ownerAuditMessage').textContent='';
  resetSubscriptions();state.user=null;state.profile=null;courseEditorCapacity.version++;courseEditorCapacity.ready=false;courseEditorCapacity.teachers.clear();syncBookingManagementShortcut();state.entries=[];state.entriesStatus='loading';state.students=[];state.people=[];state.closures={};state.closuresStatus='loading';state.openDays={};state.openDaysStatus='loading';state.examEvents={};state.examStatus='loading';state.courses=[];state.coursesStatus='loading';state.notices=[];state.officialAnnouncements=[];state.officialSeenIds=new Set();state.officialSeenReady=false;clearAvailabilitySubscriptions();state.availability=new Map();state.availabilityStatus={};state.teacherAbsences={};state.teacherAbsencesStatus='loading';regularEditor?.reset();resetCourseEditor();resetAvailabilityEditor();
  $('availabilityHomePanel').hidden=true;$('availabilityHomeCards').replaceChildren();
  $('loginPanel').hidden=false;$('appPanel').hidden=true;$('logout').hidden=true;$('notificationButton').hidden=true;$('identity').textContent='';$('password').value='';$('noticeCount').hidden=true;
  for(const d of document.querySelectorAll('dialog'))if(d.open)d.close();
}
async function loggedIn(user){
  if(maintenanceState.unsub){maintenanceState.unsub();maintenanceState.unsub=null;}
  resetSubscriptions();clearAvailabilitySubscriptions();state.availability=new Map();state.availabilityStatus={};state.user=user;state.notices=[];state.officialAnnouncements=[];state.officialSeenIds=new Set();state.officialSeenReady=false;state.entries=[];state.entriesStatus='loading';state.closures={};state.closuresStatus='loading';state.openDays={};state.openDaysStatus='loading';state.examEvents={};state.examStatus='loading';state.courses=[];state.coursesStatus='loading';state.teacherAbsences={};state.teacherAbsencesStatus='loading';regularEditor?.reset();
  const profileSnap=await getDoc(doc(db,'users',user.uid));
  if(!profileSnap.exists()||!['owner','admin','employee'].includes(profileSnap.data().role)){showMessage('利用者登録がありません。管理者に連絡してください。');await signOut(auth);return;}
  if(auth.currentUser?.uid!==user.uid)return;
  state.profile=profileSnap.data();
  const name=state.profile.name?.trim()||user.email||'ユーザー';
  $('welcomeName').textContent=`ようこそ、${name}さん`;
  $('identity').textContent=`${name}（${isOwner()?'運営':isAdmin()?'管理者':'教師'}）`;
  $('welcomeSub').textContent=isAdmin()?'生徒情報と授業の状況をまとめて管理できます。':'今日の授業・全教師の時間割・生徒情報を確認できます。';
  $('availabilityPageTitle').textContent=isAdmin()?'勤務希望登録・提出状況':'勤務希望登録';
  $('navOwnerHistory').hidden=!isOwner();
  $('navMaintenanceOwner').hidden=!isOwner();
  $('availabilityPageDescription').textContent=isAdmin()?'各講師の勤務希望と提出状況を確認・修正できます。':'出勤できる日・コマを選択して、締切までに提出してください。';
  $('loginPanel').hidden=true;$('appPanel').hidden=false;$('logout').hidden=false;
  // Teacher navigation: timetable, student list, school calendar, availability.
  if(isAdmin())$('navAdminLessons').after($('navClosures'));else $('navTeacherStudents').after($('navClosures'));
  $('navOwnerHistory').hidden=!isOwner();
  $('navMaintenanceOwner').hidden=!isOwner();
  $('navCount').hidden=!isAdmin();$('navAdminLessons').hidden=!isAdmin();$('navClosures').hidden=false;$('navCourses').hidden=!isAdmin();syncBookingManagementShortcut();$('navAvailability').hidden=isAdmin();$('availabilityBackToCourses').hidden=!isAdmin();$('editorBackToCourses').hidden=!isAdmin();$('navTeacherLessons').hidden=isAdmin();$('navTeacherStudents').hidden=isAdmin();$('addLesson').hidden=!isAdmin();$('notificationButton').hidden=false;$('broadcastForm').hidden=!isOwner();$('ownerAnnouncementManagement').hidden=!isOwner();
  renderedAcademicYear=academicYearJST();
  const now=new Date();$('broadcastStart').value=localDateTimeInput(now);$('broadcastEnd').value=localDateTimeInput(new Date(now.getTime()+7*86400000));$('teacherFilterWrap').hidden=isAdmin();
  resetCourseEditor();resetAvailabilityEditor();$('teacherFilter').value='mine';state.date=todayKey();state.scheduleView='day';document.querySelectorAll('[data-schedule-view]').forEach(button=>{const active=button.dataset.scheduleView==='day';button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  // Workspaces remain hidden until the server-side maintenance state is known.
  $('appPanel').hidden=true;
  maintenanceState.loaded=false;
  maintenanceState.dataStarted=false;
  if(maintenanceState.unsub){maintenanceState.unsub();maintenanceState.unsub=null;}
  maintenanceState.unsub=onSnapshot(MAINTENANCE_REF,snapshot=>{
    if(state.user?.uid!==user.uid)return;
    const data=snapshot.exists()?snapshot.data():{};
    maintenanceState.loaded=true;
    maintenanceState.enabled=data.enabled===true;
    maintenanceState.message=String(data.message||'');
    maintenanceState.version=String(data.version||'');
    maintenanceState.startedAt=data.startedAt||null;
    maintenanceState.updatedAt=data.updatedAt||null;
    $('maintenanceNoticeInput').value=maintenanceState.message;
    if(maintenanceState.version)$('maintenanceVersionInput').value=maintenanceState.version;
    if(maintenanceState.enabled&&!isOwner()){
      if(maintenanceState.dataStarted){resetSubscriptions();clearAvailabilitySubscriptions();maintenanceState.dataStarted=false;}
      for(const dialog of document.querySelectorAll('dialog'))if(dialog.open)dialog.close();
      state.students=[];state.entries=[];state.entriesStatus='loading';state.people=[];state.courses=[];state.coursesStatus='loading';state.notices=[];state.closures={};state.closuresStatus='loading';state.openDays={};state.openDaysStatus='loading';state.examEvents={};state.examStatus='loading';
      applyMaintenanceState();
    }else{
      applyMaintenanceState();
      if(!maintenanceState.dataStarted)startBusinessSubscriptions(user);
    }
  },error=>{
    console.error('メンテナンス状態を確認できません',error);
    maintenanceState.loaded=false;$('appPanel').hidden=true;
    $('maintenancePanel').hidden=false;
    $('maintenanceStatus').textContent='利用状況を確認できません';
    $('maintenanceMessage').textContent='Firebaseルールの公開状況を運営に確認してください。';
    $('maintenanceVersion').textContent='';
    $('notificationButton').hidden=true;
  });
  if(isOwner())loadMaintenanceHistory();
}
function startBusinessSubscriptions(user){
  if(maintenanceState.dataStarted||!state.user||state.user.uid!==user.uid)return;
  maintenanceState.dataStarted=true;
  state.unsub.push(onSnapshot(collection(db,'schoolStudents'),snap=>{state.students=snap.docs.map(d=>({id:d.id,...d.data()}));renderAll();persistAnnualGradePromotion();},err=>trapError(err,'生徒情報を取得できません')));
  state.unsub.push(onSnapshot(collection(db,'users'),snap=>{state.people=snap.docs.map(d=>({id:d.id,...d.data()}));renderAll();},err=>trapError(err,'教師情報を取得できません')));
  state.unsub.push(onSnapshot(collection(db,'timetableEntries'),snap=>{state.entries=snap.docs.map(d=>({id:d.id,...d.data()}));state.entriesStatus='ready';renderAll();},err=>{state.entriesStatus='error';trapError(err,'時間割を取得できません');}));
  state.unsub.push(onSnapshot(collection(db,'teacherDayAbsences'),snap=>{
    state.teacherAbsences=Object.fromEntries(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
    state.teacherAbsencesStatus='ready';
    renderAll();
  },err=>{
    state.teacherAbsencesStatus='error';
    console.error('講師欠席情報を取得できません',err);
    if(isAdmin())showMessage('コマ別欠席の読込権限がありません。Firestoreルールを設定してください。');
    renderAll();
  }));
  state.unsub.push(onSnapshot(collection(db,'specialCourses'),snap=>{
    state.courses=snap.docs.map(d=>({id:d.id,...d.data()})).filter(c=>Array.isArray(c.periods) && c.startDate && c.endDate).sort((a,b)=>a.startDate.localeCompare(b.startDate));
    state.coursesStatus='ready';subscribeAvailabilityCourses();renderAll();
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
  state.unsub.push(onSnapshot(collection(db,'schoolOpenDays'),snap=>{
    if(state.user?.uid!==user.uid)return;
    state.openDays=Object.fromEntries(snap.docs.map(d=>[d.id,{...d.data(),date:d.id}]));
    state.openDaysStatus='ready';renderAll();
    if($('detailDialog').open&&state.activeLesson){const active=lessonById(state.activeLesson);if(active)renderUpcomingForLesson(active);}
  },err=>{state.openDaysStatus='error';trapError(err,'特別開校日情報を取得できません');renderAll();}));
  state.unsub.push(onSnapshot(collection(db,'schoolEvents'),snap=>{
    if(state.user?.uid!==user.uid)return;
    state.examEvents=Object.fromEntries(snap.docs.map(d=>[d.id,{...d.data(),date:d.id}]));
    state.examStatus='ready';renderAll();
  },err=>{state.examStatus='error';trapError(err,'模試・テスト予定を取得できません');renderAll();}));
  // Admins and teachers both have their own private notification inbox.
  state.unsub.push(onSnapshot(collection(db,'notifications',user.uid,'items'),snap=>{
    if(state.user?.uid!==user.uid)return;
    state.notices=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderNoticeButton();if($('notificationDialog').open)renderNotifications();
    if(!snap.metadata.hasPendingWrites)pruneOldNotices();
  },err=>trapError(err,'通知を取得できません')));
  // Official announcements are global. Users may view them, but only the owner
  // may publish or withdraw them. Read markers are private per account.
  state.unsub.push(onSnapshot(collection(db,'officialAnnouncements'),snap=>{
    if(state.user?.uid!==user.uid)return;
    state.officialAnnouncements=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderNoticeButton();
    if($('notificationDialog').open){renderNotifications();markVisibleOfficialRead();}
  },err=>trapError(err,'運営のお知らせを取得できません')));
  state.unsub.push(onSnapshot(doc(db,'announcementReadStates',user.uid),snap=>{
    if(state.user?.uid!==user.uid)return;
    const seen=snap.exists()?snap.data().seenIds:[];
    state.officialSeenIds=new Set(Array.isArray(seen)?seen:[]);
    state.officialSeenReady=true;
    renderNoticeButton();
    if($('notificationDialog').open){renderNotifications();markVisibleOfficialRead();}
  },err=>trapError(err,'運営のお知らせの既読情報を取得できません')));
  nav(isAdmin()?'count':'teacherLessons');
}
$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;
  try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);}
  catch(e){showMessage('ログインできません。メールアドレスとパスワードを確認してください。');}finally{button.disabled=false;}
});
$('logout').addEventListener('click',async()=>{try{await signOut(auth);}catch(e){trapError(e,'ログアウトに失敗しました');}});
regularEditor=installNormalEditor({
  state,$,make,db,collection,doc,getDocs,query,where,writeBatch,serverTimestamp,
  auditChange,lessonNoticePayload,isAdmin,isAssignableTeacher,lessonsOnDate,
  courseFor,closureFor,CLASS_PERIODS,todayKey,datePlus,prettyDate,
  showMessage,trapError,openLessonForm,openCourseEditor,nav,renderAll
});
onAuthStateChanged(auth,user=>{if(!user)loggedOut();else loggedIn(user).catch(e=>{trapError(e,'ログイン後の読み込みに失敗しました');});});
