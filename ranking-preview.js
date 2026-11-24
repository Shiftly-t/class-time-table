import {aggregateRanking,rankTeachers,RANKING_SLOT_LABEL,RANKING_SLOT_EXPLANATION} from './ranking-core.mjs';
import {rankingWindow,splitRankingRows} from './ranking-view-model.mjs';

// Local QA fixture provider. No Firebase imports, auth tokens, API calls, or persistence.
const people=Array.from({length:15},(_,i)=>({uid:'demo-'+i,name:'練習講師'+String.fromCharCode(65+i),role:i===14?'admin':'employee'}));
const byUid=new Map(people.map(p=>[p.uid,p]));
const metrics=[['slots',RANKING_SLOT_LABEL,'コマ'],['regular','通常授業コマ数（延べ）','コマ'],['seasonal','講習授業コマ数（延べ）','コマ'],['days','授業担当日数','日'],['students','担当生徒数（実人数）','人']];
const periods=Array.from({length:8},(_,i)=>'2026-'+String(11-i).padStart(2,'0'));
const cutoff='2026-11-25T23:59:59+09:00';
const facts=[];
for(const month of periods)for(const [i,p] of people.entries()){
 const count=Math.max(8,86-i*5+(Number(month.slice(5))%4)*3);
 for(let n=0;n<count;n++){
  const day=String(1+Math.floor(n/8)).padStart(2,'0'),period=Math.floor(n%8/2),date=month+'-'+day;
  const end=['18:25','19:25','20:25','21:25'][period];
  facts.push({slotId:[p.uid,date,n].join('_'),teacherUid:p.uid,studentId:'sample-'+i+'-'+(n%23),kind:month==='2026-08'?'seasonal':'regular',status:'done',date,endedAt:date+'T'+end+':00+09:00'});
 }
}
const el=(tag,cls='',text='')=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
const button=(label,fn,cls='ghost')=>{const b=el('button',cls,label);b.type='button';b.addEventListener('click',fn);return b;};
const avatar=()=>{const v=el('span','ranking-avatar');v.innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>';return v;};
const title=(a,b)=>{const d=el('div','ranking-heading');d.append(el('p','eyebrow',a),el('h2','',b));return d;};
function totals(kind,key){const w=rankingWindow(kind,key);return aggregateRanking({facts,teachers:people,from:w.from,to:w.to,cutoff});}
const count=(uid,kind,key)=>totals(kind,key).find(t=>t.teacherUid===uid)?.slots||0;
export function installRankingPreview({button:trigger,dialog,host,getRole,getAvailable,getSelf=()=>null}){
 let view='rank',kind='month',key=periods[0],metric='slots',expanded=false,profile=null;
 const permitted=()=>getAvailable()&&['employee','admin','owner'].includes(getRole());
 function sync(){trigger.hidden=!permitted();if(!permitted()&&dialog.open){dialog.close();host.replaceChildren();}}
 function reset(){view='rank';kind='month';key=periods[0];metric='slots';expanded=false;profile=null;}
 function showProfile(uid){profile=uid;view='profile';render();}
 function go(v){view=v;profile=null;render();}
 function render(){
  if(!permitted()){sync();return;}
  host.replaceChildren();
  const head=el('div','ranking-head');head.append(title('SHIFTLY-T · RANKING','講師ランキング'),button('×',()=>dialog.close(),'close-modal'));host.append(head);
  host.append(el('p','ranking-demo','開発プレビュー · 架空データのみ。本番実績・バッジへの反映はありません。'));
  const tabs=el('div','ranking-tabs');
  for(const [id,label] of [['rank','ランキング'],['profile','プロフィール'],['badges','獲得バッジ'],['history','表彰履歴'],...(getRole()==='owner'?[['owner','バッジ管理']]:[])]){
   const b=button(label,()=>go(id),'ranking-tab'+(view===id?' active':''));b.setAttribute('aria-pressed',String(view===id));tabs.append(b);
  }
  host.append(tabs);
  if(view==='rank')renderRanks();
  else if(view==='profile')renderProfile(profile||getSelf()||people[0].uid);
  else if(view==='badges')renderBadges();
  else if(view==='history')renderHistory();
  else if(view==='owner'&&getRole()==='owner')renderOwner();
 }
 function renderRanks(){
  const switcher=el('div','ranking-period-switch');
  for(const [id,label] of [['month','月間'],['year','年間']]){
   const b=button(label,()=>{kind=id;key=id==='month'?periods[0]:'2026';expanded=false;render();},'ranking-tab'+(kind===id?' active':''));b.setAttribute('aria-pressed',String(kind===id));switcher.append(b);
  }
  host.append(switcher);
  const filters=el('div','ranking-filters');
  const pick=(label,options,value,change)=>{const l=el('label','',label),s=el('select');for(const [v,n] of options){const o=el('option','',n);o.value=v;s.append(o);}s.value=value;s.addEventListener('change',()=>change(s.value));l.append(s);return l;};
  filters.append(pick('対象期間',(kind==='month'?periods:['2026']).map(k=>[k,rankingWindow(kind,k).label]),key,v=>{key=v;expanded=false;render();}),pick('ランキング部門',metrics.map(m=>m.slice(0,2)),metric,v=>{metric=v;expanded=false;render();}));host.append(filters);
  const rows=rankTeachers(totals(kind,key),metric),{top,rest}=splitRankingRows(rows),unit=metrics.find(m=>m[0]===metric)[2];
  host.append(el('h3','ranking-period-title',rankingWindow(kind,key).label+' · '+metrics.find(m=>m[0]===metric)[1]));
  if(!rows.length)host.append(el('p','empty','集計対象の実績はありません。'));
  const podium=el('div','ranking-podium');
  const ordered=top.length===3&&top.map(x=>x.rank).join(',')==='1,2,3'?[top[1],top[0],top[2]]:top;
  for(const t of ordered){
   const b=button('',()=>showProfile(t.teacherUid),'ranking-podium-person rank-'+t.rank);
   b.append(el('span','ranking-medal',({1:'🥇',2:'🥈',3:'🥉'})[t.rank]),avatar(),el('strong','ranking-name',byUid.get(t.teacherUid).name),el('span','ranking-count',t[metric].toLocaleString('ja-JP')+' '+unit),el('span','ranking-podium-base',String(t.rank)));podium.append(b);
  }
  if(top.length)host.append(podium);
  if(expanded&&rest.length){const list=el('div','ranking-list');for(const t of rest){const b=button('',()=>showProfile(t.teacherUid),'ranking-person-row');b.append(el('strong','ranking-position',String(t.rank)),avatar(),el('strong','ranking-name',byUid.get(t.teacherUid).name),el('span','ranking-count',t[metric].toLocaleString('ja-JP')+' '+unit));list.append(b);}host.append(list);}
  if(rest.length){const b=button(expanded?'↑ 閉じる':'↓ 全員を表示（'+rows.length+'名）',()=>{expanded=!expanded;render();},'ghost ranking-expand');b.setAttribute('aria-expanded',String(expanded));host.append(b);}
  host.append(el('p','ranking-method',RANKING_SLOT_EXPLANATION),el('p','ranking-note','勤務量の参考情報です。指導力や人事評価を示すものではありません。'));
 }
 function renderProfile(uid){
  const p=byUid.get(uid)||people[0];const card=el('section','ranking-profile');
  const who=el('div','ranking-profile-head');who.append(avatar(),title('TEACHER PROFILE',p.name));card.append(who);
  const summary=el('div','ranking-summary');
  for(const [label,n] of [['今月',count(p.uid,'month',periods[0])],['今年度',count(p.uid,'year','2026')],['累計（試作期間）',count(p.uid,'year','2026')]]){
   const cell=el('div','ranking-stat');cell.append(el('span','',label),el('strong','',n.toLocaleString('ja-JP')),el('small','','コマ'));summary.append(cell);
  }
  card.append(summary,el('h3','','担当授業の推移'));
  const chart=el('div','ranking-chart');for(const month of [...periods].reverse()){
   const n=count(p.uid,'month',month),row=el('div','ranking-chart-row'),track=el('span','ranking-chart-track'),bar=el('span','ranking-chart-bar');bar.style.width=Math.min(100,n/100*100)+'%';track.append(bar);row.append(el('span','',Number(month.slice(5))+'月'),track,el('strong','',String(n)));chart.append(row);
  }
  card.append(chart,el('p','ranking-method',RANKING_SLOT_EXPLANATION),el('h3','','獲得バッジ'),el('p','empty','付与基準の設定後に表示します。'));host.append(card,button('← ランキングに戻る',()=>go('rank')));
 }
 function renderBadges(){host.append(title('ACHIEVEMENTS','獲得バッジ'),el('p','empty','自動付与・運営付与の基準と保存処理は今後実装します。'));}
 function renderHistory(){host.append(title('HALL OF FAME','表彰履歴'),el('p','empty','月間・年間の確定結果が保存されると表示されます。現在は未接続です。'));}
 function renderOwner(){host.append(title('OWNER · BADGE MANAGEMENT','バッジ管理'),el('p','empty','オリジナルバッジの作成・対象者指定・付与履歴は次の工程で実装します。'));}
 trigger.addEventListener('click',()=>{if(!permitted())return;reset();render();dialog.showModal();});
 sync();
 return {sync};
}
