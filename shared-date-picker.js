// Shared date-only calendar; no new persistence or Firebase access.
export function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
  const [y,m,d]=value.split('-').map(Number);
  if(y<100||y>9999)return false;
  const date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
}
export function monthDays(year,month){
  const count=new Date(Date.UTC(year,month,0)).getUTCDate();
  const leading=(new Date(Date.UTC(year,month-1,1)).getUTCDay()+6)%7;
  return {leading,dates:Array.from({length:count},(_,i)=>String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(i+1).padStart(2,'0'))};
}
export function dateAllowed(value,min,max){
  return validDate(value)&&(!validDate(min)||value>=min)&&(!validDate(max)||value<=max);
}
export function installSharedDatePicker({ids,today,allowed,gate}){
  const make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const btn=(text,cls,fn)=>{const b=make('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;};
  const dialog=make('dialog','modal shared-calendar-dialog');
  dialog.id='sharedDateDialog';dialog.setAttribute('aria-labelledby','sharedDateTitle');
  const content=make('div','modal-content');
  const header=make('div','modal-head');
  const title=make('h2','','日付を選択');title.id='sharedDateTitle';
  const close=btn('×','close-modal',()=>dialog.close());close.setAttribute('aria-label','閉じる');
  header.append(title,close);
  const nav=make('div','schedule-picker-nav');
  const monthLabel=make('strong','');monthLabel.setAttribute('aria-live','polite');
  const previous=btn('‹','ghost',()=>move(-1));previous.setAttribute('aria-label','前月');
  const next=btn('›','ghost',()=>move(1));next.setAttribute('aria-label','翌月');
  nav.append(previous,monthLabel,next);
  const grid=make('div','schedule-picker-grid');
  const footer=make('div','schedule-picker-bottom');
  const todayButton=btn('今日','ghost',()=>choose(today()));
  footer.append(todayButton,btn('閉じる','ghost',()=>dialog.close()));
  content.append(header,nav,grid,footer);dialog.append(content);document.body.append(dialog);
  let target=null,trigger=null,parentDialog=null,year=0,month=0;
  function usable(input){return input?.isConnected&&!input.disabled&&!input.readOnly&&allowed()&&(!parentDialog||parentDialog.open);}
  function move(delta){
    const v=new Date(Date.UTC(year,month-1+delta,1));
    if(v.getUTCFullYear()<100||v.getUTCFullYear()>9999)return;
    year=v.getUTCFullYear();month=v.getUTCMonth()+1;paint();
  }
  function paint(){
    if(!usable(target)){dialog.close();return;}
    monthLabel.textContent=year+'年'+month+'月';
    grid.replaceChildren();
    for(const d of ['月','火','水','木','金','土','日'])grid.append(make('span','schedule-picker-weekday',d));
    const {leading,dates}=monthDays(year,month);
    for(let n=0;n<leading;n++)grid.append(make('span','schedule-picker-empty'));
    for(const date of dates){
      const selected=date===target.value,now=date===today();
      const b=btn(String(Number(date.slice(-2))),'schedule-picker-day'+(selected?' is-selected':'')+(now?' is-today':''),()=>choose(date));
      b.disabled=!dateAllowed(date,target.min,target.max);
      b.setAttribute('aria-label',date);b.setAttribute('aria-pressed',String(selected));
      if(now)b.setAttribute('aria-current','date');
      grid.append(b);
    }
    todayButton.disabled=!dateAllowed(today(),target.min,target.max);
  }
  function choose(date){
    if(!usable(target)||!dateAllowed(date,target.min,target.max))return;
    const input=target;
    // Close first: application handlers can rerender the underlying workspace.
    dialog.close();
    if(input.value!==date){
      input.value=date;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  for(const id of ids){
    const input=document.getElementById(id);
    if(!input||input.type!=='date'||input.readOnly||input.dataset.sharedCalendar)continue;
    input.dataset.sharedCalendar='true';
    const wrapper=make('span','shared-date-field');
    input.before(wrapper);wrapper.append(input);
    const button=btn('▦','shared-date-open',event=>{
      event.preventDefault();event.stopPropagation();
      parentDialog=input.closest('dialog');
      if(!usable(input)||dialog.open)return;
      target=input;trigger=button;
      const start=validDate(input.value)?input.value:today();
      [year,month]=start.split('-').map(Number);
      dialog.showModal();paint();
    });
    button.setAttribute('aria-label','カレンダーから日付を選択');button.title='カレンダーから日付を選択';
    wrapper.append(button);
    const sync=()=>{button.disabled=input.disabled||input.readOnly;if(dialog.open&&target===input&&!usable(input))dialog.close();};
    new MutationObserver(sync).observe(input,{attributes:true,attributeFilter:['disabled','readonly']});
    sync();
  }
  if(gate)new MutationObserver(()=>{if(dialog.open&&!usable(target))dialog.close();}).observe(gate,{attributes:true,attributeFilter:['hidden']});
  dialog.addEventListener('close',()=>{if(dialog.open)return;const previousTrigger=trigger;target=trigger=parentDialog=null;if(previousTrigger?.isConnected&&!previousTrigger.disabled&&allowed())previousTrigger.focus({preventScroll:true});});
  return dialog;
}
