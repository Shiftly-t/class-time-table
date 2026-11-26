// A small, reversible nudge teaches horizontal navigation without changing pages.
export function installMenuScrollHint({menu,enabled,env=window,doc=document}){
  if(!menu)return {reset(){},stop(){}};
  const compact=env.matchMedia('(max-width:899px)');
  const reduced=env.matchMedia('(prefers-reduced-motion: reduce)');
  let timer=0,frame=0,learned=false,count=0;
  const max=()=>Math.max(0,menu.scrollWidth-menu.clientWidth);
  function eligible(){
    return !learned&&compact.matches&&!reduced.matches&&
      !doc.hidden&&enabled()&&max()>12&&
      !doc.querySelector('dialog[open]')&&
      !doc.activeElement?.matches('input,textarea,select,[contenteditable=true]');
  }
  function cancel(){
    env.clearTimeout(timer);env.cancelAnimationFrame(frame);timer=frame=0;
  }
  function schedule(delay=5000){
    cancel();
    if(learned||count>=3||!compact.matches||reduced.matches||doc.hidden)return;
    timer=env.setTimeout(()=>{timer=0;if(eligible())nudge();else schedule(5000);},delay);
  }
  function nudge(){
    const origin=menu.scrollLeft,room=max();
    const direction=room-origin>=24?1:-1;
    const distance=Math.min(38,direction===1?room-origin:origin);
    if(distance<12){schedule(5000);return;}
    count++;
    let start;
    function step(now){
      if(!eligible()){frame=0;schedule(5000);return;}
      if(start===undefined)start=now;
      const t=Math.min(1,(now-start)/2600);
      // Smoothly reveal a little of the next item, then return to the same place.
      menu.scrollLeft=Math.max(0,Math.min(max(),origin+direction*distance*(1-Math.cos(2*Math.PI*t))/2));
      if(t<1)frame=env.requestAnimationFrame(step);
      else{frame=0;schedule(15000);}
    }
    frame=env.requestAnimationFrame(step);
  }
  function interact(){learned=true;cancel();}
  // All manual interaction wins immediately; never fight a swipe or keyboard.
  for(const type of ['pointerdown','touchstart','wheel','keydown','focusin'])menu.addEventListener(type,interact,{passive:true});
  function otherActivity(){if(!learned)schedule();}
  for(const type of ['pointerdown','touchstart','keydown','wheel'])doc.addEventListener(type,otherActivity,{passive:true});
  doc.addEventListener('visibilitychange',()=>schedule());
  env.addEventListener('resize',()=>schedule(),{passive:true});
  for(const media of [compact,reduced])media.addEventListener?.('change',()=>schedule());
  return {
    reset(){learned=false;count=0;schedule();},
    stop(){learned=true;cancel();}
  };
}
