// QA ranking read-only integration. No fixture data or direct Firestore access.
const metrics=[['slots','担当授業コマ数（延べ）','コマ'],['regular','通常授業コマ数（延べ）','コマ'],['seasonal','講習授業コマ数（延べ）','コマ'],['days','授業担当日数','日'],['students','担当生徒数（実人数）','人']];
const el=(tag,cls='',text='')=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
function button(label,action,cls='ghost'){const b=el('button',cls,label);b.type='button';b.addEventListener('click',action);return b;}
function avatar(){const a=el('span','ranking-avatar');a.innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>';return a;}
const method='集計方法：担当した生徒の人数分をカウントします（1コマで2人担当した場合は2コマ分として集計）。';
export function installRankingLive({trigger,dialog,host,call,getSession,getRole,getAvailable,today}){
 let kind='month',key='',metric='slots',expanded=false,view='rank',selected=null,result=null,error='',loading=false,serial=0,session=null;
 const allowed=()=>!!getSession()&&getAvailable()&&['employee','admin','owner'].includes(getRole());
 function clear(){serial++;result=null;selected=null;error='';loading=false;host.replaceChildren();}
 function sync(){const next=getSession();if(next!==session||!allowed()){clear();if(dialog.open)dialog.close();session=next;}trigger.hidden=!allowed();}
 function resetKey(){const d=today();key=kind==='month'?d.slice(0,7):String(Number(d.slice(0,4))-(Number(d.slice(5,7))<4?1:0));}
 function go(v){view=v;selected=null;render();}
 async function load(){if(!allowed()||!dialog.open)return;const seq=++serial,uid=getSession();loading=true;error='';result=null;expanded=false;render();
  try{const reply=await call({kind,key,metric});if(seq!==serial||uid!==getSession()||!allowed()||!dialog.open)return;
   const d=reply.data;if(!d||!Array.isArray(d.rows)||!d.coverage||typeof d.period!=='string'||d.rows.some(r=>typeof r.name!=='string'||typeof r.teacherUid!=='string'||!Number.isSafeInteger(r.rank)||r.rank<1||metrics.some(m=>!Number.isSafeInteger(r[m[0]])||r[m[0]]<0)))throw Error('INVALID_RESPONSE');
   result=d;
  }catch(e){if(seq!==serial||uid!==getSession()||!allowed()||!dialog.open)return;
   const code=e?.code;
   error=code==='functions/failed-precondition'?'ランキングはまだ公開されていません。':code==='functions/unauthenticated'||code==='functions/permission-denied'?'認証またはアプリの確認に失敗しました。':code==='functions/unavailable'?'現在ランキングを利用できません。':'ランキングを取得できませんでした。';
  }finally{if(seq===serial&&uid===getSession()&&allowed()&&dialog.open){loading=false;render();}}
 }
 function render(){
  if(!allowed()||!dialog.open)return;host.replaceChildren();
  const head=el('div','ranking-head'),heading=el('div','ranking-heading');heading.append(el('p','eyebrow','SHIFTLY-T · RANKING'),el('h2','','講師ランキング'));const close=button('×',()=>dialog.close(),'close-modal');close.setAttribute('aria-label','閉じる');head.append(heading,close);host.append(head,el('p','ranking-demo','QA検証版 · 確定済み実績のみ。自動集計・バッジ機能は準備中です。'));
  const tabs=el('div','ranking-tabs');for(const [id,label] of [['rank','ランキング'],['profile','プロフィール'],['badges','獲得バッジ'],['history','表彰履歴'],...(getRole()==='owner'?[['owner','バッジ管理']]:[])]){const b=button(label,()=>go(id),'ranking-tab'+(view===id?' active':''));b.setAttribute('aria-pressed',String(view===id));tabs.append(b);}host.append(tabs);
  if(view==='profile'){
   const p=selected||result?.rows.find(x=>x.teacherUid===getSession());
   if(!p){host.append(el('p','empty','プロフィール実績は未取得です。'));return;}
   const card=el('section','ranking-profile'),who=el('div','ranking-profile-head');who.append(avatar(),el('h2','',p.name));card.append(who,el('p','',result?.period||'選択期間'));
   const summary=el('div','ranking-summary');for(const [k,label] of [['slots','担当コマ数'],['days','担当日数'],['students','担当生徒数']]){const cell=el('div','ranking-stat');cell.append(el('span','',label),el('strong','',String(p[k])),el('small','',metrics.find(m=>m[0]===k)[2]));summary.append(cell);}card.append(summary,el('p','ranking-note','この期間の実績のみ。累計・月別推移・バッジは準備中です。'));host.append(card,button('← ランキングに戻る',()=>go('rank')));return;
  }
  if(view!=='rank'){host.append(el('p','empty','この機能は準備中です。'));return;}
  const switcher=el('div','ranking-period-switch');for(const [id,label] of [['month','月間'],['year','年間']]){const b=button(label,()=>{kind=id;resetKey();load();},'ranking-tab'+(kind===id?' active':''));b.setAttribute('aria-pressed',String(kind===id));switcher.append(b);}host.append(switcher);
  const filters=el('div','ranking-filters'),periodLabel=el('label','','対象期間'),period=el('input');period.type=kind==='month'?'month':'number';period.value=key;if(kind==='year'){period.min='2000';period.max=String(Number(today().slice(0,4)));}
  period.addEventListener('change',()=>{if(period.value){key=period.value;load();}});periodLabel.append(period);
  const metricLabel=el('label','','ランキング部門'),select=el('select');for(const [k,label] of metrics){const option=el('option','',label);option.value=k;select.append(option);}select.value=metric;select.addEventListener('change',()=>{metric=select.value;load();});metricLabel.append(select);filters.append(periodLabel,metricLabel);host.append(filters);
  const unit=metrics.find(m=>m[0]===metric)[2];
  if(loading)host.append(el('p','empty','ランキングを取得しています…'));
  else if(error){const msg=el('p','ranking-demo',error);msg.setAttribute('role','status');host.append(msg,button('再取得',load));}
  else if(result){
   host.append(el('h3','ranking-period-title',result.period+' · '+metrics.find(m=>m[0]===metric)[1]));
   if(!result.coverage.complete)host.append(el('p','ranking-demo','未確定の日付があるため順位を表示できません。確定済み '+result.coverage.recorded+' / '+result.coverage.expected+' 日'));
   else if(!result.rows.length)host.append(el('p','empty','集計対象の確定実績はありません。'));
   else {
    const top=result.rows.filter(r=>r.rank<=3),rest=result.rows.filter(r=>r.rank>3),podium=el('div','ranking-podium');
    const ordered=top.length===3&&top.map(r=>r.rank).join(',')==='1,2,3'?[top[1],top[0],top[2]]:top;
    const profile=p=>{selected=p;view='profile';render();};
    for(const p of ordered){const b=button('',()=>profile(p),'ranking-podium-person rank-'+p.rank);b.append(el('span','ranking-medal',({1:'🥇',2:'🥈',3:'🥉'})[p.rank]),avatar(),el('strong','ranking-name',p.name),el('span','ranking-count',p[metric]+' '+unit),el('span','ranking-podium-base',String(p.rank)));podium.append(b);}host.append(podium);
    if(expanded&&rest.length){const list=el('div','ranking-list');for(const p of rest){const b=button('',()=>profile(p),'ranking-person-row');b.append(el('strong','ranking-position',String(p.rank)),avatar(),el('strong','ranking-name',p.name),el('span','ranking-count',p[metric]+' '+unit));list.append(b);}host.append(list);}
    if(rest.length){const b=button(expanded?'↑ 閉じる':'↓ 全員を表示（'+result.rows.length+'名）',()=>{expanded=!expanded;render();},'ghost ranking-expand');b.setAttribute('aria-expanded',String(expanded));host.append(b);}
   }
  }
  host.append(el('p','ranking-method',method),el('p','ranking-note','勤務量の参考情報です。指導力や人事評価を示すものではありません。'));
 }
 trigger.addEventListener('click',()=>{if(!allowed()||dialog.open)return;clear();kind='month';metric='slots';view='rank';resetKey();dialog.showModal();load();});
 dialog.addEventListener('close',()=>{if(!dialog.open)clear();});
 sync();return {sync};
}
