import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,doc,getDoc} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import {createBookingTransport} from './booking-transport.js';
import * as config from './config.js';
import {firebaseTargetForPage} from './firebase-target.js';
import {bookingAppCheckSiteKey} from './booking-config.js';
import {initializeAppCheck,ReCaptchaEnterpriseProvider} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js';
const {firebaseConfig}=config;
const {databaseId,functionsRegion}=firebaseTargetForPage(config,bookingAppCheckSiteKey);
const app=initializeApp(firebaseConfig);
if(bookingAppCheckSiteKey && !bookingAppCheckSiteKey.startsWith('REPLACE_'))initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(bookingAppCheckSiteKey),isTokenAutoRefreshEnabled:true});
const auth=getAuth(app),db=databaseId?getFirestore(app,databaseId):getFirestore(app);
const call=httpsCallable(getFunctions(app,functionsRegion),'bookingAdminApi');
const $=s=>document.getElementById(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let courses=[],courseId='',settings=null,course=null,roster=[],demand=[],teachers=[],detail=null,studentId='',search='',filter='all',tab='students',busy=false,draft=[],printItems=[];
let authEpoch=0,authorized=false,cancelConfirmation=null;
const transport=createBookingTransport({call,getSession:()=>authorized?'staff:'+authEpoch:null});
function clearPrintPreparation(){printItems=[];$('printRoot').replaceChildren();$('printReadyWrap').hidden=true;}

function clearPrivateState(){
  cancelConfirmation?.();
  clearBookingNotice();
  transport.reset();busy=false;document.getElementById('bookingResultCheck')?.remove();
  authorized=false;courses=[];courseId='';settings=null;course=null;roster=[];demand=[];teachers=[];detail=null;studentId='';search='';filter='all';tab='students';draft=[];printItems=[];editorMode='';editorKey='';
  $('printRoot').replaceChildren();$('printReadyWrap').hidden=true;$('feedback').textContent='';
}
const statusLabels={unanswered:'未回答',declined:'不参加',submitted:'提出済み'};
function status(row){if(row.status==='declined')return '不参加';if(row.status==='unanswered')return '未回答';if(row.confirmed>=row.wishes&&row.wishes>0)return '確定済み';if(row.confirmed>0)return '一部確定';return '提出済み';}
const slotMap=()=>new Map(demand.map(s=>[s.id,s]));

function datedCourseName(name,startDate){
  const n=String(name||'').trim();
  const [y,m]=String(startDate||'').split('-').map(Number);
  if(!y||!m)return n;
  const year=m<4?y-1:y;
  const base=n
    .replace(/^[0-9]{4}(?:年度|年)?[ 　]*/, '')
    .replace(/[ 　]*[（(]?[0-9]{4}(?:年度|年)?[）)]?$/, '')
    .trim();
  return year+'年度'+base;
}
function dateText(d){const [y,m,day]=String(d).split('-').map(Number),weekday=new Date(y,m-1,day).getDay();return `${y}年${m}月${day}日（${'日月火水木金土'[weekday]}）`;}
function slotLabel(id){const s=slotMap().get(id)||detail?.slots?.find(x=>x.id===id);return s?`${dateText(s.date)} ${s.start}〜${s.end}`:id;}
function fmtTime(iso){if(!iso)return '';const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));return parts.replace(' ','T');}
function isoJst(value){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('日時を指定してください');return new Date(value+':00+09:00').toISOString();}
function getBookingNotice(){
  let d=document.getElementById('bookingNotice');
  if(d)return d;
  d=document.createElement('dialog');
  d.id='bookingNotice';
  d.setAttribute('aria-labelledby','bookingNoticeTitle');
  d.style.cssText='width:min(480px,calc(100% - 32px));max-height:85dvh;overflow:auto;box-sizing:border-box;border:0;border-radius:20px;padding:26px;text-align:center;box-shadow:0 20px 70px #0005';
  d.innerHTML=`
    <div style="font-size:42px;color:#dc2626">⚠</div>
    <h2 id="bookingNoticeTitle" style="font-size:23px;margin:12px 0">操作をご確認ください</h2>
    <p id="bookingNoticeText" style="font-size:17px;line-height:1.8;overflow-wrap:anywhere" aria-live="assertive"></p>
    <div id="bookingNoticeActions" style="display:grid;gap:12px;margin:20px 0 12px"></div>
    <button id="bookingNoticeClose" type="button" class="secondary" style="width:100%;min-height:48px">閉じる</button>`;
  const style=document.createElement('style');
  style.textContent='#bookingNotice::backdrop{background:rgba(15,23,42,.65)}';
  document.head.append(style);
  document.body.append(d);
  d.querySelector('#bookingNoticeClose').addEventListener('click',()=>{
    if(!busy)d.close();
  });
  d.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  return d;
}

function clearBookingNotice(){
  const d=document.getElementById('bookingNotice');
  if(d?.open)d.close();
  document.getElementById('bookingResultCheck')?.remove();
  document.getElementById('bookingNoticeReopen')?.remove();
}

function note(msg,isError=false,showSuccess=false){
  $('feedback').textContent=msg;
  $('feedback').className='status'+(isError?' error':'');
  clearBookingNotice();
  const pending=transport.hasPending()&&authorized;
  if(!isError&&!pending&&!showSuccess)return;

  const d=getBookingNotice();
  const success=showSuccess&&!isError&&!pending;
  d.firstElementChild.textContent=success?'✓':'⚠';
  d.firstElementChild.style.color=success?'#16a34a':'#dc2626';
  d.querySelector('#bookingNoticeTitle').textContent=success?'保存が完了しました':'操作をご確認ください';
  d.querySelector('#bookingNoticeClose').textContent=success?'OK':'閉じる';
  d.querySelector('#bookingNoticeText').textContent=msg;
  const actions=d.querySelector('#bookingNoticeActions');
  actions.replaceChildren();

  if(pending){
    const b=document.createElement('button');
    b.id='bookingResultCheck';
    b.type='button';
    b.className='primary';
    b.textContent='送信結果を確認';
    b.style.cssText='min-height:48px;font-size:16px';
    b.disabled=busy;
    b.addEventListener('click',()=>guarded(
      '送信結果の確認',async()=>{
        clearPrintPreparation();
        await transport.confirmPending();
        await reloadCourse();
      }
    ));
    actions.append(b);
  }

  const reopen=document.createElement('button');
  reopen.id='bookingNoticeReopen';
  reopen.type='button';
  reopen.className='secondary';
  reopen.textContent='お知らせを確認';
  reopen.addEventListener('click',()=>{
    if(!d.open)d.showModal();
  });
  if(!success)$('feedback').after(reopen);

  if(!d.open)d.showModal();
}

const readActionLabels={
  courses:'講習一覧の取得',getSettings:'受付設定の取得',roster:'生徒一覧の取得',
  slotDemand:'日時別の予約枠の取得',teachers:'講師情報の取得',detail:'生徒詳細の取得',getQr:'QRコードの取得'
};

function diagnosticCode(error){return String(error?.code||'').replace(/^functions\//,'');}

function diagnosticReason(error){
  const code=diagnosticCode(error);
  const message=String(error?.message||'').trim();
  if(code==='failed-precondition'&&message==='Coordinated deployment has not been activated'){
    return '本番の連携機能が有効化されていません。運営に確認してください。';
  }
  if(['failed-precondition','unauthenticated'].includes(code)&&message==='Verified App Check required'){
    return 'アプリの認証（App Check）を確認できません。ページを開き直してください。';
  }
  if(code.startsWith('auth/'))return 'ログイン状態を確認できません。再ログインしてください。';
  switch(code){
    case 'unauthenticated': return '認証を確認できません。ページを開き直し、必要に応じて再ログインしてください。';
    case 'permission-denied': return 'この操作に必要な権限を確認できません。運営に確認してください。';
    case 'failed-precondition': return '操作に必要な条件を満たしていません。運営に確認してください。';
    case 'invalid-argument':
    case 'out-of-range': return '対象と入力内容を確認してください。';
    case 'not-found': return '対象が見つかりません。最新の内容を確認してください。';
    case 'already-exists': return '対象はすでに登録されています。最新の内容を確認してください。';
    case 'aborted': return '他の操作との競合が発生しました。最新の内容を確認してください。';
    case 'resource-exhausted': return '処理可能な上限に達しました。運営に確認してください。';
    case 'unavailable':
    case 'deadline-exceeded': return '通信状態を確認してください。更新操作の結果が不明な場合は、再送せず送信結果を確認してください。';
    case 'booking/result-unconfirmed': return '送信結果を確認できません。再送せず「送信結果を確認」を使ってください。';
    case 'booking/unsupported-operation': return 'この操作は現在利用できません。';
    default: return '処理に失敗しました。運営に確認してください。';
  }
}

class BookingDiagnostic extends Error {
  constructor(action,message,code=''){
    super(message);
    this.action=action;
    this.code=code;
  }
}

function errorMessage(error){
  if(!(error instanceof BookingDiagnostic))return diagnosticReason(error);
  const label=Object.hasOwn(readActionLabels,error.action)?readActionLabels[error.action]:'';
  return label?`${label}：${error.message}`:error.message;
}

function isRecord(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}

function validReadResponse(action,data,fields){
  switch(action){
    case 'courses': return Array.isArray(data?.courses)&&data.courses.every(row=>typeof row?.id==='string'&&row.id.length>0);
    case 'getSettings': return isRecord(data?.course)&&Array.isArray(data.course.periods)&&Object.hasOwn(data,'settings')&&(data.course.id==null||data.course.id===fields.courseId);
    case 'roster': return Array.isArray(data?.rows)&&data.rows.every(row=>typeof row?.id==='string'&&typeof row?.name==='string');
    case 'slotDemand': return Array.isArray(data?.slots);
    case 'teachers': return Array.isArray(data?.teachers);
    case 'detail': return isRecord(data?.student)&&(data.student.id==null||data.student.id===fields.studentId);
    default: return true;
  }
}

async function api(action,fields={}){
  const epoch=authEpoch;
  if(!authorized)throw new BookingDiagnostic(action,'管理者のログインが必要です。','unauthenticated');
  const payload={action,courseId,...fields};
  if(transport.isMutation(action))clearPrintPreparation();
  let result;
  try{result=await transport.call(payload);}
  catch(error){throw new BookingDiagnostic(action,diagnosticReason(error),diagnosticCode(error));}
  if(epoch!==authEpoch||!authorized)throw new BookingDiagnostic(action,'ログイン状態が変更されました。再読み込みしてください。');
  if(!validReadResponse(action,result?.data,payload)){
    throw new BookingDiagnostic(action,'予約APIの応答形式を確認できません。運営に確認してください。');
  }
  return result?.data;
}
function canInteract(){return authorized&&!busy&&!cancelConfirmation;}
async function guarded(label,fn){
  if(!canInteract())return null;
  const epoch=authEpoch,before=transport.commits();
  busy=true;
  document.querySelectorAll('#app button,#app input,#app select,#app textarea').forEach(x=>x.disabled=true);
  note(label+'…');
  try{
    const result=await fn();
    if(epoch!==authEpoch||!authorized)return null;
    note(label+'が完了しました',false,transport.commits()>before);
    return result;
  }catch(e){
    if(epoch===authEpoch){
      const reason=errorMessage(e);
      const prefix=transport.commits()>before?'一部または全部の保存は完了しています。再実行せず最新の内容を確認してください。\n':'';
      note(prefix+reason,true);
    }
    return null;
  }finally{
    if(epoch===authEpoch){
      busy=false;
      const check=$('bookingResultCheck');
      if(check)check.disabled=false;
      if(authorized)render();
    }
  }
}
function b(action,label,cls='secondary',props=''){return `<button type="button" class="${cls}" data-act="${esc(action)}" ${props}>${esc(label)}</button>`;}
function badge(text){return `<span class="badge ${text==='不参加'?'gray':text==='確定済み'?'ok':text==='一部確定'?'warn':text==='未回答'?'bad':''}">${esc(text)}</span>`;}
async function reloadCourse(nextCourseId=courseId,nextStudentId=studentId){
  if(!nextCourseId)return;
  const epoch=authEpoch;
  const target={courseId:nextCourseId};
  const [nextSettings,nextRoster,nextDemand,nextTeachers]=await Promise.all([
    api('getSettings',target),api('roster',target),api('slotDemand',target),api('teachers',target)
  ]);
  if(epoch!==authEpoch||!authorized)return;
  const nextCourse=nextSettings.course;
  const nextRows=nextRoster.rows;
  const nextSlots=nextDemand.slots;
  const nextTeacherRows=nextTeachers.teachers.filter(t=>t.role!=='owner');
  const selectedStudentId=nextRows.some(row=>row.id===nextStudentId)?nextStudentId:'';
  const nextDetail=selectedStudentId?await loadStudentDetail(nextCourseId,selectedStudentId):null;
  if(epoch!==authEpoch||!authorized)return;
  // Keep the displayed data and mutation target together until every read succeeds.
  if(nextCourseId!==courseId||selectedStudentId!==studentId){
    clearPrintPreparation();
    editorMode='';editorKey='';draft=[];
  }
  courseId=nextCourseId;course=nextCourse;settings=nextSettings.settings;
  roster=nextRows;demand=nextSlots;teachers=nextTeacherRows;
  studentId=selectedStudentId;detail=nextDetail;
}
async function load(){
  const epoch=authEpoch;
  const result=await api('courses');
  if(epoch!==authEpoch||!authorized)return;
  courses=result.courses;
  await reloadCourse(courses[0]?.id||'','');
  if(epoch===authEpoch&&authorized)render();
}
function setup(){
 if(!course)return '<p class="muted">講習期間管理で講習を登録してください。</p>';
 const starts=settings?.openingAt||'',ends=settings?.closingAt||'';
 const legacyExcluded=settings?.excludedDates?.length||0;
 return `<section class="panel"><h2>予約受付の設定</h2>
  <p class="muted">講習期間・コマは「講習期間管理」、休校日は「休校日管理」、受入人数は講師の勤務希望・担当上限から自動取得します。ここで指定するのは受付期間のみです。</p>
  <div class="noticebox"><strong>${esc(datedCourseName(course.name,course.startDate))}　${esc(course.startDate)}〜${esc(course.endDate)}</strong><br>
   <span class="muted">${course.periods.map((p,i)=>`${i+1}限 ${p.start}〜${p.end}`).map(esc).join(' ／ ')}</span></div>
  <form id="setupForm"><div class="grid2 booking-setup-dates">
   <label class="field">受付開始（日本時間）<input name="openingAt" type="datetime-local" required value="${esc(fmtTime(starts))}"></label>
   <label class="field">受付締切（日本時間）<input name="closingAt" type="datetime-local" required value="${esc(fmtTime(ends))}"></label>
  </div><div class="noticebox" style="margin-top:14px">
   <strong>予約枠は自動計算</strong><p class="muted" style="margin:7px 0 0">そのコマに勤務可能な講師の担当上限の合計で決まります。講師1人あたり最大2人です。個別定員の変更はできません。出勤可能な講師が0人なら予約枠も0です。</p>
   <p class="muted" style="margin:7px 0 0">休校日管理に登録した日、日曜・祝日はQRの希望日時から自動除外されます（特別開校日・模試は優先）。</p>
  </div>
  ${legacyExcluded?`<p class="hint">※以前の設定で手動除外した日が${legacyExcluded}日あります。安全のため既存の除外設定を維持しています。</p>`:''}
  <div class="actions"><button type="submit" class="primary">受付期間を保存して予約枠を同期する</button></div></form>
  <p class="hint">受付開始後は締切の延長のみ可能です。休校日が後から追加された場合も、新規予約は自動停止します。既存の希望・確定授業は削除されません。</p>
 </section>`;
}
function controls(){return `<section class="panel"><div class="row"><div><h2>管理する講習</h2><p class="muted">必要な講習を選択してください。</p></div><span class="badge ${settings?.enabled?'ok':'gray'}">${settings?.enabled?'予約枠同期済み':'準備中'}</span></div><label class="field">講習を選択<select id="courseSelect">${courses.map(c=>`<option value="${esc(c.id)}" ${c.id===courseId?'selected':''}>${esc(datedCourseName(c.name,c.startDate))}　${esc(c.startDate)}〜${esc(c.endDate)}</option>`).join('')}</select></label><div class="actions">${b('tab:students','生徒別希望一覧',tab==='students'?'primary':'secondary')}${b('tab:dates','日時別希望一覧',tab==='dates'?'primary':'secondary')}${b('tab:capacity','定員・空き枠',tab==='capacity'?'primary':'secondary')}${b('tab:teachers','講師の担当上限',tab==='teachers'?'primary':'secondary')}${b('tab:settings','講習設定',tab==='settings'?'primary':'secondary')}</div></section>`;}
function listStudents(){const rows=roster.filter(r=>(filter==='all'||status(r)===filter)&&(!search||r.name.includes(search)));return `<section class="panel"><div class="row"><div><h2>生徒別の提出状況</h2><p class="muted">未回答と不参加は分けて表示。数字は「確定 / 希望」コマ数。</p></div>${b('printAll','全生徒のQRを一括印刷','secondary')}</div><div class="toolbar"><label class="field">氏名検索<input id="search" type="search" placeholder="生徒名で検索" value="${esc(search)}"></label><label class="field">状況で絞り込み<select id="filter">${['all','未回答','提出済み','一部確定','確定済み','不参加'].map(x=>`<option value="${x}" ${filter===x?'selected':''}>${x==='all'?'すべて':x}</option>`).join('')}</select></label></div><div class="tablewrap" style="margin-top:14px"><table><thead><tr><th>生徒</th><th>状況</th><th>希望</th><th>確定</th><th>詳細</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${badge(status(r))}</td><td>${r.status==='declined'?'—':r.wishes}</td><td>${r.status==='declined'?'—':r.confirmed}</td><td>${b('student:'+r.id,'希望日時を見る','secondary')}</td></tr>`).join('')||'<tr><td colspan="5">対象の生徒はいません。</td></tr>'}</tbody></table></div></section>${detail?studentDetail():''}`;}
function listDates(){return `<section class="panel"><h2>日時ごとの希望状況</h2><p class="muted">各コマに希望している生徒名と確定状況を表示します。</p>${datesSummary()}</section>`;}
function datesSummary(){const grp=new Map();for(const x of demand){if(!grp.has(x.date))grp.set(x.date,[]);grp.get(x.date).push(x);}return [...grp].map(([date,rows])=>`<div class="slotday"><div class="daytitle">${esc(dateText(date))}</div><div style="padding:10px"><div class="grid2">${rows.map(x=>`<div class="noticebox" style="margin:0;min-width:0"><strong>${esc(x.start)}〜${esc(x.end)}</strong><br><span class="muted">残り ${x.remaining}枠 ／ 定員 ${x.capacity}（予約・確定 ${x.used}、既存授業 ${x.manualUsed||0}）</span><ul class="entrylist" style="margin-top:7px">${x.requests.map(p=>`<li>${esc(p.studentName)} ${p.published?badge('公開済み'):p.confirmed?badge('確定済み'):badge('希望')}</li>`).join('')||'<li class="muted">希望なし</li>'}</ul></div>`).join('')}</div></div></div>`).join('');}
function capacity(){return `<section class="panel"><h2>日時別の定員・残り枠</h2><p class="muted">定員と残り枠は閲覧専用です。既存の確保枠を変更せず、個別人数の設定は使用できません。</p>${demand.map(x=>`<div class="noticebox"><strong>${esc(dateText(x.date))} ${esc(x.start)}〜${esc(x.end)}</strong><p>残り ${esc(x.remaining)}／${esc(x.capacity)}枠 ${x.overbooked?'（要調整）':''} ${x.disabled?'（休講）':''}</p></div>`).join('')}</section>`;}
function teacherLimits(){return `<section class="panel"><h2>講師の勤務希望と担当上限</h2><p class="muted">講師1人最大2人。人数はここでは変更できません。既存の制限がある場合は管理担当者へ確認してください。</p>${teachers.map(t=>`<div class="noticebox"><strong>${esc(t.name)}</strong><p>勤務希望 ${esc(t.slots.length)}コマ</p></div>`).join('')}</section>`;}

function teacherOptions(slotId,selected=''){const m=/__(\d{4}-\d{2}-\d{2})__(\d+)$/.exec(slotId),need=m?m[1]+'_'+m[2]:'';const possible=teachers.filter(t=>t.slots.includes(need));return `<option value="">講師を選択</option>`+possible.map(t=>`<option value="${esc(t.id)}" ${selected===t.id?'selected':''}>${esc(t.name)}</option>`).join('');}
function studentDetail(){const s=detail?.student,e=detail?.booking||{},r=roster.find(x=>x.id===studentId);if(!s)return '';const wishes=e.wishes||[],confirmed=e.confirmed||[];const cMap=new Map(confirmed.map(x=>[x.slotId,x]));const open=!!settings?.enabled;return `<section class="panel" id="studentDetail"><div class="row"><div><h2>${esc(s.name)} さんの希望詳細</h2><p class="muted">${esc(s.grade)} ${esc(s.school)}　${badge(status(r||{status:'unanswered',wishes:0,confirmed:0}))}</p></div>${b('closeDetail','詳細を閉じる','secondary')}</div><div class="actions">${b('getQr','現在のQRを印刷')}${b('issue','初回QR発行')}${b('reissue','QRを再発行','danger')}</div><div class="divider"></div><h3>提出された希望日時（${wishes.length}コマ）</h3>${wishes.length?`<ul class="entrylist">${wishes.map(k=>{const p=cMap.get(k);return `<li><strong>${esc(slotLabel(k))}</strong> ${p?p.published?badge('公開済み'):badge('確定済み'):badge('未確定')}${p?`<p class="muted" style="margin:5px 0">${esc(p.teacherName)}／${esc(p.subject)}</p>`:''}${!p?`<div class="grid2"><label class="field">担当講師<select data-teacher="${esc(k)}">${teacherOptions(k)}</select></label><label class="field">教科（任意）<input data-subject="${esc(k)}" placeholder="未入力でも確定できます" maxlength="80"></label></div><div class="actions">${b('confirm:'+k,'このコマを確定','primary')}${b('releaseWish:'+k,'この未確定希望枠を解除','danger')}</div>`:p.published?`<div class="actions">${b('editPublished:'+k,'公開授業の日時・担当変更','secondary')}${b('cancelConfirmed:'+k,'授業を取り消す','danger')}</div>`:`<div class="grid2"><label class="field">担当講師<select data-teacher="${esc(k)}">${teacherOptions(k,p.teacherUid)}</select></label><label class="field">教科（任意）<input data-subject="${esc(k)}" value="${esc(p.subject)}" maxlength="80"></label></div><div class="actions">${b('reassign:'+k,'未公開授業の担当を変更')}${b('moveUnpublished:'+k,'未公開授業の日時を変更')}${b('publish:'+k,'この授業を公開','primary')}${b('cancelConfirmed:'+k,'授業を取り消す','danger')}</div>`}</li>`}).join('')}</ul>`:'<p class="muted">希望日時はまだ提出されていません。</p>'}${confirmed.some(x=>!x.published)?`<div class="actions">${b('publishAll','未公開の確定授業をまとめて公開','primary')}</div>`:''}<label class="field">保護者から伝えたいこと<textarea id="adminRemarks" maxlength="1000" rows="2">${esc(e.remarks||'')}</textarea></label><div class="actions">${b('setRemarks','備考を保存')}</div><div class="divider"></div><h3>管理者による対応</h3><p class="muted">提出前・未確定の生徒について、締切後も希望日時を代理入力できます。</p>${b('adminEdit','希望日時を代理入力・修正','secondary',confirmed.length?'disabled':'')}
 <div class="admin-detail-grid"><label class="field">個別受付期限（日本時間）<input type="datetime-local" id="extendDate" value="${esc(fmtTime(e.extensionUntil||''))}"></label><div class="admin-grid-button">${b('extend','個別の締切を延長','secondary')}</div><div class="admin-grid-button">${b('removeUnconfirmed','未確定の希望枠を解除','secondary')}</div><div class="admin-grid-button">${b('adminDecline','不参加に設定','danger',confirmed.length?'disabled':'')}</div></div>${e.publishedChanges?.length?`<div class="divider"></div><h3>公開済み授業の変更・確認状況</h3><ul class="entrylist">${e.publishedChanges.map(x=>`<li>${esc(slotLabel(x.from))} → ${esc(slotLabel(x.to))}<br>${x.ack?badge('保護者確認済み'):badge('未確認')}</li>`).join('')}</ul>`:''}${detail?.history?.length?`<details><summary style="cursor:pointer;padding:10px 0;font-weight:750">予約変更・管理操作の履歴</summary><ul class="entrylist">${detail.history.map(x=>`<li>${esc(x.action)}　${esc(x.actor)}<br><span class="muted">${esc(x.createdAt||'')}</span></li>`).join('')}</ul></details>`:''}</section>`;}
function editPublished(key){const isPublished=editorMode==='published';const c=(detail?.booking?.confirmed||[]).find(x=>x.slotId===key);if(!c)return '';return `<section class="panel"><h2>${isPublished?'公開済み':'未公開'}授業の変更</h2><p class="notice">${isPublished?'日時変更後は保護者のQR画面に変更内容と「確認しました」ボタンが表示されます。':'未公開の授業日時を変更します。保護者には公開後に日時を表示します。'}</p><form id="changePublishedForm" data-from="${esc(key)}"><label class="field">移動先の日時<select name="to">${demand.filter(x=>!x.disabled&&(x.remaining>0||x.id===key)).map(x=>`<option value="${esc(x.id)}" ${x.id===key?'selected':''}>${esc(slotLabel(x.id))}（残り${x.remaining}枠）</option>`).join('')}</select></label><label class="field">担当講師<select name="teacherUid">${teacherOptions(key,c.teacherUid)}</select></label><label class="field">教科（任意）<input name="subject" maxlength="80" value="${esc(c.subject)}"></label><div class="actions">${b('closePublishedEditor','戻る')}<button type="submit" class="primary">変更内容を公開する</button></div></form></section>`;}
function adminEdit(){const current=detail?.booking?.wishes||[];const selected=new Set(draft.length?draft:current);const grouped=new Map();for(const x of demand){if(!grouped.has(x.date))grouped.set(x.date,[]);grouped.get(x.date).push(x);}return `<section class="panel"><h2>希望日時の代理入力</h2><p class="muted">保護者の希望を確認してから入力してください。未確定の枠だけを変更できます。</p><form id="adminEditForm">${[...grouped].map(([date,arr])=>`<div class="slotday"><div class="daytitle">${dateText(date)}</div><div class="slotgrid">${arr.map(x=>`<label class="slot"><input type="checkbox" name="slots" value="${esc(x.id)}" style="width:18px;min-height:18px;flex:none" ${selected.has(x.id)?'checked':''} ${x.disabled||(x.remaining===0&&!selected.has(x.id))?'disabled':''}><strong>${esc(x.start)}〜${esc(x.end)}</strong><small>残り${x.remaining}</small></label>`).join('')}</div></div>`).join('')}<label class="field">保護者から伝えたいこと（任意）<textarea name="remarks" maxlength="1000">${esc(detail?.booking?.remarks||'')}</textarea></label><div class="actions">${b('closeAdminEdit','戻る')}<button class="primary" type="submit">希望日時を保存する</button></div></form></section>`;}
function render(){if(!authorized)return;if(!courses.length){$('app').innerHTML='<h2>講習が登録されていません</h2><p class="muted">先に講習期間管理で講習を登録してください。</p>';return;}$('app').outerHTML='<div id="app">'+controls()+((tab==='students')?listStudents():tab==='dates'?listDates():tab==='capacity'?capacity():tab==='teachers'?teacherLimits():setup())+(tab==='students'&&studentId&&['published','unpublished'].includes(editorMode)?editPublished(editorKey):tab==='students'&&studentId&&editorMode==='admin'?adminEdit():'')+'</div>';wire();}
let editorMode='',editorKey='';
function loadStudentDetail(targetCourseId,targetStudentId){
  return api('detail',{courseId:targetCourseId,studentId:targetStudentId});
}
async function selectStudent(id){
  const epoch=authEpoch,targetCourseId=courseId;
  const nextDetail=await loadStudentDetail(targetCourseId,id);
  if(epoch!==authEpoch||!authorized||targetCourseId!==courseId)return false;
  clearPrintPreparation();
  studentId=id;detail=nextDetail;editorMode='';editorKey='';draft=[];
  return true;
}
function ask(title,text,options){
  const dialog=$('askDialog'),yes=$('askYes'),no=$('askNo');
  const previous={yesLabel:yes.textContent,noLabel:no.textContent,yesClass:yes.className,noClass:no.className};
  $('askTitle').textContent=title;
  $('askText').textContent=text||'';
  yes.textContent=options.yesLabel||'実行する';
  no.textContent=options.noLabel||'キャンセル';
  yes.className=options.yesClass||'danger';
  no.className=options.noClass||'secondary';
  return new Promise(resolve=>{
    function finish(confirmed){
      if(cancelConfirmation!==dismiss)return;
      cancelConfirmation=null;
      yes.removeEventListener('click',accept);
      no.removeEventListener('click',dismiss);
      dialog.removeEventListener('cancel',cancel);
      dialog.removeEventListener('close',closed);
      yes.textContent=previous.yesLabel;no.textContent=previous.noLabel;
      yes.className=previous.yesClass;no.className=previous.noClass;
      if(dialog.open)dialog.close();
      resolve(confirmed);
    }
    function accept(){finish(true);}
    function dismiss(){finish(false);}
    function cancel(event){event.preventDefault();dismiss();}
    function closed(){if(!dialog.open)dismiss();}
    cancelConfirmation=dismiss;
    yes.addEventListener('click',accept);
    no.addEventListener('click',dismiss);
    dialog.addEventListener('cancel',cancel);
    dialog.addEventListener('close',closed);
    try{dialog.showModal();}catch{dismiss();}
  });
}
async function confirmAction(title,text,action,options={}){
  if(!canInteract())return;
  const epoch=authEpoch,targetCourseId=courseId,targetStudentId=studentId;
  if(!await ask(title,text,options))return;
  if(!canInteract()||epoch!==authEpoch||targetCourseId!==courseId||targetStudentId!==studentId)return;
  return action();
}
function printLayoutBuild(items){return items.map(x=>`<div class="printsheet"><div class="printitem"><h2>Shiftly-T｜${esc(datedCourseName(x.courseName,course?.startDate))}</h2><div class="studentname">${esc(x.studentName)} さん</div>${x.svg}<p>講習予約・確認用QRコード<br>受付締切：${esc(x.closingAt?fmtTime(x.closingAt).replace('T',' '):'教室にご確認ください')}（日本時間）</p><p>スマートフォンで読み取り、生徒氏名を入力してください。<br>QRコードは他人に渡さないでください。</p></div></div>`).join('');}
function printAll(items){if(!authorized)return;printItems=items.map(x=>({...x,courseId:x.courseId||courseId}));if(!items.length){note('印刷対象の生徒がいません',true);return;}$('printRoot').innerHTML=printLayoutBuild(items);$('printReadyWrap').hidden=false;note(items.length+'名分のQRコードの印刷準備ができました。『QRコードの印刷プレビューを開く』を押してください。');$('printReadyWrap').scrollIntoView({behavior:'smooth',block:'center'});}
async function qrAction(action){
  const epoch=authEpoch;
  clearPrintPreparation();
  const result=await guarded(action==='issue'?'QR初回発行':action==='reissue'?'QR再発行':'QR取得',()=>api(action,{studentId}));
  if(result&&epoch===authEpoch)printAll([result]);
}
async function bulkPrint(){clearPrintPreparation();await guarded('全生徒のQRを取得',async()=>{const all=[];for(const r of roster){try{all.push(await api('getQr',{studentId:r.id}));}catch(e){if(String(e?.code||'').replace(/^functions\//,'')!=='not-found')throw e;all.push(await api('issue',{studentId:r.id}));}}printAll(all);return {ok:true};});}
async function runAction(a){
 if(!canInteract())return;
 if(a.startsWith('tab:')){tab=a.slice(4);editorMode='';render();return;}
 if(a.startsWith('student:')){
   const selected=await guarded('生徒データを取得',()=>selectStudent(a.slice(8)));
   if(selected)$('studentDetail')?.scrollIntoView({block:'start',behavior:'smooth'});
   return;
 }
 if(a==='closeDetail'){studentId='';detail=null;render();return;}
 if(a==='printAll'){await bulkPrint();return;}
 if(a==='issue'){await qrAction('issue');return;}
 if(a==='getQr'){await qrAction('getQr');return;}
 if(a==='reissue'){
   const name=detail?.student?.name||'';
   return confirmAction('QRコードを再発行しますか？',`${name}さんの古いQRコードは無効になります。予約内容・確保枠・変更履歴は維持されます。`,()=>qrAction('reissue'));
 }
 if(a.startsWith('limit:')||a.startsWith('capacity:')){note('個別定員の変更は廃止しました',true);return;}
 if(a.startsWith('confirm:')||a.startsWith('reassign:')){const [act,key]=a.split(':');const t=document.querySelector(`[data-teacher="${CSS.escape(key)}"]`),s=document.querySelector(`[data-subject="${CSS.escape(key)}"]`);if(!t?.value){note('担当講師を選択してください',true);return;}await guarded('授業確定',async()=>{await api(act,{studentId,slotId:key,teacherUid:t.value,subject:(s?.value||'').trim()});await reloadCourse();});return;}
 if(a.startsWith('publish:')){
   const key=a.slice(8);
   return confirmAction('授業を公開しますか？','確定した授業を教室の時間割に反映し、保護者がQR画面で閲覧できるようにします。',()=>guarded('授業公開',async()=>{
     await api('publish',{studentId,slotId:key});
     await reloadCourse();
   }));
 }
 if(a==='publishAll'){
   const items=(detail?.booking?.confirmed||[]).filter(x=>!x.published);
   return confirmAction('未公開の確定授業を公開しますか？',`${items.length}コマを順に公開します。途中で問題が起きた場合はその時点で停止します。`,()=>guarded('授業の一括公開',async()=>{
     for(const x of items)await api('publish',{studentId,slotId:x.slotId});
     await reloadCourse();
   }));
 }
 if(a.startsWith('releaseWish:')){
   const key=a.slice(12);
   return confirmAction('未確定の希望枠を解除しますか？',`${slotLabel(key)}の仮確保を解除します。`,()=>guarded('希望枠解除',async()=>{
     await api('releaseWish',{studentId,slotId:key});
     await reloadCourse();
   }));
 }
 if(a.startsWith('cancelConfirmed:')){
   const key=a.slice(16);
   return confirmAction('確定授業を取り消しますか？',`${slotLabel(key)}を取消して確保枠を解放します。公開済みなら時間割からも削除されます。`,()=>guarded('授業取消',async()=>{
     await api('cancelConfirmed',{studentId,slotId:key});
     await reloadCourse();
   }));
 }
 if(a.startsWith('editPublished:')){editorMode='published';editorKey=a.slice(14);render();return;}if(a.startsWith('moveUnpublished:')){editorMode='unpublished';editorKey=a.slice(16);render();return;}if(a==='closePublishedEditor'||a==='closeAdminEdit'){editorMode='';render();return;}
 if(a==='adminEdit'){if((detail?.booking?.confirmed||[]).length){note('確定済み授業があるため先に個別調整してください',true);return;}editorMode='admin';draft=(detail?.booking?.wishes||[]).slice();render();return;}
 if(a==='setRemarks'){const remarks=$('adminRemarks')?.value||'';await guarded('備考保存',async()=>{await api('setRemarks',{studentId,remarks});await reloadCourse();});return;}
 if(a==='extend'){const until=$('extendDate')?.value;if(!until){note('延長日時を指定してください',true);return;}await guarded('受付期限延長',async()=>{await api('extend',{studentId,until:isoJst(until)});await reloadCourse();});return;}
 if(a==='adminDecline'){
   return confirmAction('不参加に設定しますか？','提出済みの未確定希望枠はすべて解放されます。確定済み授業がある場合は、先に取り消してください。',()=>guarded('不参加設定',async()=>{
     await api('adminDecline',{studentId});
     await reloadCourse();
   }));
 }
 if(a==='removeUnconfirmed'){
   return confirmAction('未確定希望を解除しますか？','確定済み授業は維持し、未確定の希望枠だけ解放します。',()=>guarded('未確定希望解除',async()=>{
     await api('removeUnconfirmed',{studentId});
     await reloadCourse();
   }));
 }
}
function wire(){
 const cs=$('courseSelect');
 if(cs)cs.addEventListener('change',()=>{
   if(!cs.isConnected)return;
   const nextCourseId=cs.value;
   cs.value=courseId;
   if(canInteract()&&nextCourseId&&nextCourseId!==courseId)void guarded('講習の切替',()=>reloadCourse(nextCourseId,''));
 });
 const f=$('filter');if(f)f.addEventListener('change',()=>{if(canInteract()&&f.isConnected){filter=f.value;render();}});
 const s=$('search');if(s)s.addEventListener('input',()=>{
   if(!canInteract()||!s.isConnected)return;
   search=s.value;render();$('search')?.focus();$('search')?.setSelectionRange(search.length,search.length);
 });
 const setup=$('setupForm');if(setup)setup.addEventListener('submit',async e=>{e.preventDefault();if(!canInteract()||!setup.isConnected)return;const form=new FormData(setup),openingAt=isoJst(form.get('openingAt')),closingAt=isoJst(form.get('closingAt'));const result=await guarded('予約受付設定と枠同期',async()=>{await api('configure',{openingAt,closingAt});const synced=await api('syncSlots');await reloadCourse();return synced;});if(result?.warnings?.length)note(`休校日に予約済みの枠が${result.warnings.length}件あります。既存データは保持しています。日時別希望一覧で調整してください。`,true);});
 const edit=$('adminEditForm');if(edit)edit.addEventListener('submit',async e=>{e.preventDefault();if(!canInteract()||!edit.isConnected)return;const f=new FormData(edit),slots=f.getAll('slots'),remarks=f.get('remarks');if(!slots.length){note('希望日時は1コマ以上選択してください',true);return;}await guarded('希望日時の代理登録',async()=>{await api('adminSubmit',{studentId,slots,remarks});editorMode='';await reloadCourse();});});
 const changed=$('changePublishedForm');if(changed){changed.querySelector('[name=to]')?.addEventListener('change',e=>{const old=changed.querySelector('[name=teacherUid]');if(!old)return;const selected=old.value;old.innerHTML=teacherOptions(e.target.value,selected);if(![...old.options].some(x=>x.value===selected)){old.value='';}});}
 if(changed)changed.addEventListener('submit',e=>{
   e.preventDefault();
   if(!canInteract()||!changed.isConnected)return;
   const form=new FormData(changed),from=changed.dataset.from,to=form.get('to'),teacherUid=form.get('teacherUid'),subject=form.get('subject');
   const published=editorMode==='published';
   void confirmAction('公開済み授業を変更しますか？',published?'保護者画面に変更履歴が表示され、確認ボタンが追加されます。':'未公開の授業日時を変更します。保護者には公開後に日時を表示します。',()=>guarded('公開授業変更',async()=>{
     await api(published?'changePublished':'moveUnpublished',{studentId,from,to,teacherUid,subject});
     editorMode='';await reloadCourse();
   }));
 });
 document.querySelectorAll('[data-act]').forEach(x=>x.addEventListener('click',()=>{if(x.isConnected)void runAction(x.dataset.act);}));
}
$('printReady').addEventListener('click',()=>{
  if(!canInteract())return;
  const epoch=authEpoch,items=printItems;
  void confirmAction('印刷プレビューに移行しますか？','最新のQRと氏名を確認してから印刷します。',async()=>{
    if(printItems!==items)return;
    const refreshed=await guarded('印刷前のQR確認',async()=>{
      clearPrintPreparation();
      const fresh=[];
      for(const item of items){
        if(!item.studentId)throw Error('生徒IDを確認できません');
        fresh.push(await api('getQr',{courseId:item.courseId,studentId:item.studentId}));
      }
      return fresh;
    });
    if(refreshed&&epoch===authEpoch&&authorized){printAll(refreshed);window.print();}
  },{yesLabel:'許可',noLabel:'キャンセル',yesClass:'primary',noClass:'secondary'});
});
$('printDiscard').addEventListener('click',()=>{
  if(!canInteract())return;
  clearPrintPreparation();note('印刷準備を閉じました');
});
onAuthStateChanged(auth,async user=>{const epoch=++authEpoch;clearPrivateState();$('app').textContent='管理者のログイン状態を確認しています…';if(!user){$('app').innerHTML='<h2>ログインが必要です</h2><p class="muted">管理者アカウントでShiftly-Tへログインしてから、このページを開いてください。</p><a href="./index.html">ログイン画面へ</a>';return;}try{const sn=await getDoc(doc(db,'users',user.uid));if(epoch!==authEpoch)return;if(!sn.exists()||!['owner','admin'].includes(sn.data().role)){$('app').innerHTML='<h2>管理者のみ利用できます</h2><p class="muted">アクセス権限がありません。</p>';return;}authorized=true;await load();}catch(e){if(epoch!==authEpoch)return;clearPrivateState();$('app').innerHTML='<h2>読み込みに失敗しました</h2><p class="muted">Firebaseの設定や権限を確認してください。</p>';note(errorMessage(e),true);}});
