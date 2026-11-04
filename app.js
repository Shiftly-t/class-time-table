import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, query, where, getDocs, setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id);
const state={user:null,profile:null,users:[],requests:[],shifts:[],month:new Date(new Date().getFullYear(),new Date().getMonth(),1)};
const pad=n=>String(n).padStart(2,'0');
const dateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const monthKey=()=>`${state.month.getFullYear()}-${pad(state.month.getMonth()+1)}`;
const msg=s=>{$('message').textContent=s};
const valid=(date,start,end)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&/^\d\d:\d\d$/.test(start)&&/^\d\d:\d\d$/.test(end)&&start<end;
const nameOf=uid=>state.users.find(u=>u.uid===uid)?.name||'不明なユーザー';
const item=(parent,text)=>{const el=document.createElement('div');el.className='item';el.textContent=text;parent.append(el)};
let selectedDate=dateKey(new Date());
function showTab(id){if(id==='adminTab'&&state.profile?.role!=='admin')return;document.querySelectorAll('.tab-page').forEach(el=>el.hidden=el.id!==id);document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===id));}
document.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>showTab(el.dataset.tab)));
$('openRequest').addEventListener('click',()=>{$('requestDate').value=selectedDate;showTab('requestTab')});
function chooseDate(date){selectedDate=date;$('requestDate').value=date;if(state.profile?.role==='admin')$('shiftDate').value=date;render();}
function empty(parent,text){if(!parent.children.length){const el=document.createElement('div');el.className='empty';el.textContent=text;parent.append(el)}}

async function refresh(){
 const m=monthKey();
 const start=m+'-01',end=m+'-31';
 const [shifts,requests]=await Promise.all([
   getDocs(query(collection(db,'shifts'),where('date','>=',start),where('date','<=',end))),
   getDocs(query(collection(db,'requests'),where('uid','==',state.user.uid)))
 ]);
 state.shifts=shifts.docs.map(d=>d.data());
 state.requests=requests.docs.map(d=>d.data()).filter(r=>r.date.startsWith(m));
 if(state.profile.role==='admin'){
   const all=await getDocs(query(collection(db,'requests'),where('date','>=',start),where('date','<=',end)));
   state.requests=all.docs.map(d=>d.data());
 }
 render();
}
function render(){
 const y=state.month.getFullYear(),m=state.month.getMonth();
 $('monthTitle').textContent=`${y}年${m+1}月`;
 $('statShifts').textContent=state.shifts.length;
 $('statMine').textContent=state.shifts.filter(s=>s.uid===state.user.uid).length;
 $('statRequests').textContent=state.requests.filter(r=>r.uid===state.user.uid).length;
 $('selectedTitle').textContent=`${Number(selectedDate.slice(5,7))}月${Number(selectedDate.slice(8,10))}日のシフト`;
 const details=$('dayDetails');details.replaceChildren();
 state.shifts.filter(s=>s.date===selectedDate).sort((a,b)=>a.start.localeCompare(b.start)).forEach(s=>item(details,`${nameOf(s.uid)}　${s.start} 〜 ${s.end}`));
 empty(details,'この日の確定シフトはありません');
 const cal=$('calendar');cal.replaceChildren();
 ['日','月','火','水','木','金','土'].forEach(w=>{const el=document.createElement('div');el.className='weekday';el.textContent=w;cal.append(el)});
 const first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();
 for(let i=0;i<first;i++){const el=document.createElement('div');el.className='day muted';cal.append(el)}
 for(let day=1;day<=days;day++){
  const date=`${y}-${pad(m+1)}-${pad(day)}`;const el=document.createElement('div');el.className='day';
  if(date===selectedDate)el.classList.add('selected');if(date===dateKey(new Date()))el.classList.add('today');
  const num=document.createElement('div');num.className='dateNum';num.textContent=day;if(state.requests.some(r=>r.uid===state.user.uid&&r.date===date)){const dot=document.createElement('i');dot.className='request-dot';num.append(dot)}el.append(num);
  state.shifts.filter(s=>s.date===date).sort((a,b)=>a.start.localeCompare(b.start)).forEach(s=>{const line=document.createElement('div');line.className='shift';line.textContent=`${nameOf(s.uid)} ${s.start}–${s.end}`;el.append(line)});
  el.addEventListener('click',()=>chooseDate(date));el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',date+'のシフト');el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseDate(date)}});cal.append(el)
 }
 $('myRequests').replaceChildren();state.requests.filter(r=>r.uid===state.user.uid).sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>item($('myRequests'),`${r.date} ${r.start}–${r.end} ${r.note||''}`));
 empty($('myRequests'),'この月の希望提出はまだありません');
 if(state.profile.role==='admin'){
  $('requestsList').replaceChildren();state.requests.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>item($('requestsList'),`${r.date} ${nameOf(r.uid)} ${r.start}–${r.end} ${r.note||''}`));empty($('requestsList'),'この月の希望提出はありません');
 }
}
async function initUser(user){
 state.user=user;
 if(!user){state.profile=null;$('loginPanel').hidden=false;$('appPanel').hidden=true;$('identity').textContent='シフト管理ワークスペース';$('logout').hidden=true;$('nav').hidden=true;return}
 const profile=await getDoc(doc(db,'users',user.uid));
 if(!profile.exists()||!['admin','employee'].includes(profile.data().role)){msg('利用者登録がありません。管理者に連絡してください。');await signOut(auth);return}
 state.profile=profile.data();
 $('identity').textContent=`${state.profile.name}（${state.profile.role==='admin'?'管理者':'従業員'}）`; $('logout').hidden=false;$('nav').hidden=false;document.querySelectorAll('.admin-only').forEach(el=>el.hidden=state.profile.role!=='admin');
 $('loginPanel').hidden=true;$('appPanel').hidden=false;
 $('adminPanel').hidden=state.profile.role!=='admin';
 const users=await getDocs(collection(db,'users'));
 state.users=users.docs.map(d=>({uid:d.id,...d.data()}));
 const select=$('shiftUser');select.replaceChildren();state.users.forEach(u=>{const o=document.createElement('option');o.value=u.uid;o.textContent=u.name;select.append(o)});
 const today=dateKey(new Date());$('requestDate').value=today;$('shiftDate').value=today;
 $('todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date());showTab('calendarTab');await refresh();msg('ログインしました');
}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await signInWithEmailAndPassword(auth,$('email').value,$('password').value)}catch(err){msg('ログインできません。メールアドレスとパスワードを確認してください。')}});
$('logout').addEventListener('click',()=>signOut(auth));
$('prevMonth').addEventListener('click',async()=>{state.month=new Date(state.month.getFullYear(),state.month.getMonth()-1,1);try{await refresh()}catch(e){msg('読み込みに失敗しました')}});
$('nextMonth').addEventListener('click',async()=>{state.month=new Date(state.month.getFullYear(),state.month.getMonth()+1,1);try{await refresh()}catch(e){msg('読み込みに失敗しました')}});
$('requestForm').addEventListener('submit',async e=>{e.preventDefault();const date=$('requestDate').value,start=$('requestStart').value,end=$('requestEnd').value,note=$('requestNote').value;if(!valid(date,start,end)){msg('日付・勤務時間を確認してください（終了は開始より後）');return}try{await setDoc(doc(db,'requests',`${state.user.uid}_${date}`),{uid:state.user.uid,date,start,end,note});await refresh();msg('希望を保存しました')}catch(e){msg('保存に失敗しました: '+e.code)}});
$('deleteRequest').addEventListener('click',async()=>{const date=$('requestDate').value;if(!date)return;try{await deleteDoc(doc(db,'requests',`${state.user.uid}_${date}`));await refresh();msg('希望を削除しました')}catch(e){msg('削除に失敗しました: '+e.code)}});
$('shiftForm').addEventListener('submit',async e=>{e.preventDefault();if(state.profile.role!=='admin')return;const uid=$('shiftUser').value,date=$('shiftDate').value,start=$('shiftStart').value,end=$('shiftEnd').value;if(!uid||!valid(date,start,end)){msg('入力を確認してください');return}try{await setDoc(doc(db,'shifts',`${uid}_${date}`),{uid,date,start,end});await refresh();msg('確定シフトを保存しました')}catch(e){msg('保存に失敗しました: '+e.code)}});
$('deleteShift').addEventListener('click',async()=>{if(state.profile.role!=='admin')return;const uid=$('shiftUser').value,date=$('shiftDate').value;if(!uid||!date)return;try{await deleteDoc(doc(db,'shifts',`${uid}_${date}`));await refresh();msg('確定シフトを削除しました')}catch(e){msg('削除に失敗しました: '+e.code)}});
onAuthStateChanged(auth,u=>{initUser(u).catch(e=>msg('読み込みエラー: '+e.code))});
