import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,collection,getDocs,doc,getDoc,addDoc,updateDoc,deleteDoc,setDoc} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './config.js';
const app=getApps().length?getApp():initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id),pad=n=>String(n).padStart(2,'0');
const dateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseDate=s=>new Date(Number(s.slice(0,4)),Number(s.slice(5,7))-1,Number(s.slice(8,10)));
const today=()=>dateKey(new Date());
let day=today(),current=null,lessons=[],notes={},users=[],me=null,role=null;
const status=s=>{$('message').textContent=s};
const safeErr=e=>status('操作に失敗しました: '+(e.code||'通信または権限エラー'));
const make=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e};
const teacherName=uid=>users.find(x=>x.uid===uid)?.name||'担当者';
function resetForm(){ $('lessonForm').reset();$('lessonEditId').value='';$('lessonDate').value=day;$('lessonDelete').hidden=true; }
function selectLesson(l){current=l; $('lessonDetail').hidden=false;$('lessonDetailTitle').textContent=l.student+'さんの授業';
 const body=$('lessonDetailBody');body.replaceChildren();const grid=make('div','','lesson-detail-grid');
 const future=lessons.filter(x=>x.student===l.student && (x.date>l.date || (x.date===l.date&&x.start>l.start)) && x.id!==l.id).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start))[0];
 for(const [k,v] of [['授業日時',`${l.date} ${l.start}〜${l.end}`],['担当講師',teacherName(l.teacherUid)],['教科・教室',`${l.subject} / ${l.room||'未設定'}`],['次回の授業',future?`${future.date} ${future.start}〜${future.end}`:'未登録']]){const box=make('div','');box.append(make('small',k),make('strong',v));grid.append(box)}body.append(grid);
 const editable=role==='admin'||l.teacherUid===me.uid;$('lessonNote').value=notes[l.id]?.text||'';$('lessonNote').readOnly=!editable;$('lessonNoteForm').querySelector('button').hidden=!editable;$('lessonNoteHint').hidden=editable;
 $('lessonDetail').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function render(){const d=parseDate(day);$('lessonDateTitle').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(d);$('lessonDate').value=day;
 const box=$('lessonCards');box.replaceChildren();const list=lessons.filter(l=>l.date===day).sort((a,b)=>a.start.localeCompare(b.start));
 if(!list.length)box.append(make('div','この日に登録された授業はありません。','empty'));
 for(const l of list){const card=make('div','','lesson-card');const head=make('div','','lesson-card-head');head.append(make('strong',l.start+'〜'+l.end),make('span',l.subject,'lesson-chip'));card.append(head,make('strong',l.student+' さん'),make('div',teacherName(l.teacherUid)+' ・ '+(l.room||'教室未設定'),'lesson-meta'));
 const actions=make('div','','form-actions');const open=make('button','詳細・次回予定・メモを見る','lesson-edit-btn');open.type='button';open.addEventListener('click',()=>selectLesson(l));actions.append(open);
 if(role==='admin'){const edit=make('button','編集','ghost');edit.type='button';edit.addEventListener('click',()=>{ $('lessonEditId').value=l.id;for(const [k,v] of Object.entries({lessonDate:l.date,lessonStart:l.start,lessonEnd:l.end,lessonTeacher:l.teacherUid,lessonStudent:l.student,lessonSubject:l.subject,lessonRoom:l.room||''}))$(k).value=v;$('lessonDelete').hidden=false;$('lessonAdmin').scrollIntoView({behavior:'smooth'}); });actions.append(edit)}card.append(actions);box.append(card)}
 if(current){const latest=lessons.find(x=>x.id===current.id);if(latest)selectLesson(latest);else{$('lessonDetail').hidden=true;current=null}}
}
async function load(){const ls=await getDocs(collection(db,'lessons'));lessons=ls.docs.map(x=>({id:x.id,...x.data()}));notes={};await Promise.all(lessons.filter(l=>role==='admin'||l.teacherUid===me.uid).map(async l=>{const n=await getDoc(doc(db,'lessonNotes',l.id));if(n.exists())notes[l.id]=n.data()}));render()}
async function move(n){const d=parseDate(day);d.setDate(d.getDate()+n);day=dateKey(d);current=null;$('lessonDetail').hidden=true;render()}
$('lessonPrev').addEventListener('click',()=>move(-1));$('lessonNext').addEventListener('click',()=>move(1));$('lessonToday').addEventListener('click',()=>{day=today();current=null;$('lessonDetail').hidden=true;render()});$('lessonClose').addEventListener('click',()=>{$('lessonDetail').hidden=true;current=null});$('lessonReset').addEventListener('click',resetForm);
$('lessonForm').addEventListener('submit',async e=>{e.preventDefault();if(role!=='admin')return;const data={date:$('lessonDate').value,start:$('lessonStart').value,end:$('lessonEnd').value,teacherUid:$('lessonTeacher').value,student:$('lessonStudent').value.trim(),subject:$('lessonSubject').value.trim(),room:$('lessonRoom').value.trim()};if(!data.date||!data.teacherUid||!data.student||!data.subject||data.start>=data.end){status('日付・時刻・必須項目を確認してください');return}try{const id=$('lessonEditId').value;if(id)await updateDoc(doc(db,'lessons',id),data);else await addDoc(collection(db,'lessons'),data);day=data.date;resetForm();await load();status('授業を保存しました')}catch(err){safeErr(err)}});
$('lessonDelete').addEventListener('click',async()=>{if(role!=='admin'||!$('lessonEditId').value||!confirm('この授業を削除しますか？'))return;try{await deleteDoc(doc(db,'lessons',$('lessonEditId').value));resetForm();await load();status('授業を削除しました')}catch(err){safeErr(err)}});
$('lessonNoteForm').addEventListener('submit',async e=>{e.preventDefault();if(!current||!(role==='admin'||current.teacherUid===me?.uid))return;try{await setDoc(doc(db,'lessonNotes',current.id),{text:$('lessonNote').value,updatedBy:me.uid,updatedAt:new Date().toISOString()});await load();status('授業メモを保存しました')}catch(err){safeErr(err)}});
onAuthStateChanged(auth,async u=>{me=u;current=null;$('lessonDetail').hidden=true;if(!u){role=null;return}try{const profile=await getDoc(doc(db,'users',u.uid));role=profile.data()?.role;if(!['admin','employee'].includes(role))return;const us=await getDocs(collection(db,'users'));users=us.docs.map(x=>({uid:x.id,...x.data()}));$('lessonAdmin').hidden=role!=='admin';const sel=$('lessonTeacher');sel.replaceChildren();for(const u of users){const opt=document.createElement('option');opt.value=u.uid;opt.textContent=u.name;sel.append(opt)}resetForm();await load()}catch(e){safeErr(e)}});
