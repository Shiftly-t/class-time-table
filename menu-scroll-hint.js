// Static guidance only; never changes the menu scroll position.
export function installMenuScrollHint({menu,hint,gate,env=window}){
  if(!menu||!hint)return {reset(){},stop(){}};
  const compact=env.matchMedia('(max-width:899px)');
  function sync(){
    const visible=compact.matches&&!gate?.hidden&&menu.clientWidth>0&&menu.scrollWidth>menu.clientWidth+1;
    hint.hidden=!visible;
    if(visible)menu.setAttribute('aria-describedby',hint.id);
    else menu.removeAttribute('aria-describedby');
  }
  if(typeof ResizeObserver==='function')new ResizeObserver(sync).observe(menu);
  if(typeof MutationObserver==='function'){
    const observer=new MutationObserver(sync);
    observer.observe(menu,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
    if(gate)observer.observe(gate,{attributes:true,attributeFilter:['hidden']});
  }
  env.addEventListener('resize',sync,{passive:true});
  compact.addEventListener?.('change',sync);
  sync();
  return {reset:sync,stop(){hint.hidden=true;menu.removeAttribute('aria-describedby');}};
}
