/* QR print editor: layout preferences only; QR and student data remain in memory. */
const STORAGE_KEY='shiftly:qr-print-layout:v1';
const DEFAULTS=Object.freeze({title:'',intro:'下記のQRコードを読み取り、講習の希望日時をご登録ください。',footer:'スマートフォンで読み取り、生徒氏名を入力してください。\nQRコードは他人に渡さないでください。',size:40,layout:1,showName:true,showDeadline:true});
const LIMITS={1:85,2:65,4:45};
function normalize(value={}){
  const v=value&&typeof value==='object'?value:{};
  const layout=[1,2,4].includes(Number(v.layout))?Number(v.layout):1;
  const size=Number(v.size);
  return {title:typeof v.title==='string'?v.title.slice(0,100):DEFAULTS.title,
    intro:typeof v.intro==='string'?v.intro.slice(0,200):DEFAULTS.intro,
    footer:typeof v.footer==='string'?v.footer.slice(0,160):DEFAULTS.footer,
    size:Math.max(25,Math.min(LIMITS[layout],Number.isFinite(size)?Math.round(size):40)),
    layout,showName:v.showName!==false,showDeadline:v.showDeadline!==false};
}
function readPrefs(){try{return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'));}catch{return normalize(DEFAULTS);}}
const CSS=`
@page{size:A4 portrait;margin:8mm}
*{box-sizing:border-box}
html,body{margin:0;color:#18243c;background:#f6f8fc;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif}
.editor-bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 14px;background:white;border-bottom:1px solid #dfe5f0}
.editor-bar strong{flex:1 1 145px;font-size:15px}
button{min-height:44px;border:1px solid #dfe5f0;border-radius:9px;background:#fff;color:#40526f;font:inherit;font-size:13px;font-weight:750;padding:9px 13px;cursor:pointer}
button.primary{background:#4f63e9;color:white;border-color:#4f63e9}
button:disabled{opacity:.5;cursor:not-allowed}
.editor-panel{max-width:900px;margin:14px auto;padding:16px;border:1px solid #dfe5f0;border-radius:13px;background:white}
.editor-panel h2{font-size:17px;margin:0 0 12px}
.editor-panel label{display:grid;gap:6px;font-size:13px;font-weight:700;color:#40526f;min-width:0}
.editor-fields{display:grid;gap:12px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.editor-fields .wide{grid-column:1/-1}
input:not([type=checkbox]),textarea,select{font:inherit;font-size:16px;max-width:100%;width:100%;min-width:0;padding:9px;border:1px solid #d7dfec;border-radius:8px;background:white;color:#18243c}
input[type=range]{padding:0;accent-color:#4f63e9}
textarea{resize:vertical;min-height:70px}
.checks,.editor-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.checks label{display:flex;align-items:center;gap:7px}
.checks input{width:18px;height:18px;accent-color:#4f63e9}
.hint{font-size:12px;line-height:1.65;color:#586a86;margin:8px 0}
.warning{font-size:13px;color:#a33325;line-height:1.6;margin:8px 0;white-space:pre-line}
#previewHost{padding:0 10px 24px;overflow-x:auto}
#previewTitle{max-width:900px;margin:12px auto;font-size:13px;color:#40526f}
#pages{width:194mm;margin:0 auto}
.qr-paper{width:194mm;height:277mm;background:#fff;display:grid;gap:4mm;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);color:#18243c;margin:0 0 6mm}
.qr-paper[data-layout="2"],.qr-paper[data-layout="4"]{grid-template-rows:repeat(2,minmax(0,1fr))}
.qr-paper[data-layout="4"]{grid-template-columns:repeat(2,minmax(0,1fr))}
.qr-card{min-width:0;min-height:0;border:1px solid #cdd5e2;border-radius:3mm;padding:4mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2mm;text-align:center;overflow-wrap:anywhere}
.qr-card>*{flex-shrink:0;max-width:100%;margin:0}
.qr-card .qr-heading{font-size:16pt;line-height:1.25;font-weight:750;white-space:pre-wrap}
.qr-card .qr-name{font-size:13pt;font-weight:750;line-height:1.25}
.qr-card .qr-copy{font-size:10.5pt;line-height:1.4;white-space:pre-wrap}
.qr-card .qr-deadline{font-size:10pt;font-weight:750;line-height:1.4}
.qr-card .qr-art{width:var(--qr-size);height:var(--qr-size);flex:0 0 auto;max-width:none;background:white;display:grid;place-items:center}
.qr-art svg{display:block;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important}
.qr-paper[data-layout="4"] .qr-card{padding:3mm;gap:1.5mm}
.qr-paper[data-layout="4"] .qr-heading{font-size:12pt}
.qr-paper[data-layout="4"] .qr-name{font-size:11pt}
.qr-paper[data-layout="4"] .qr-copy,.qr-paper[data-layout="4"] .qr-deadline{font-size:9pt;line-height:1.35}
@media screen{.qr-paper{box-shadow:0 2px 14px #18243c20}}
@media(max-width:650px){.editor-panel{margin:10px;padding:12px}.editor-fields{grid-template-columns:minmax(0,1fr)}}
@media print{
  html,body{background:white!important;margin:0!important;padding:0!important}
  .editor-bar,.editor-panel,#previewTitle{display:none!important}
  #previewHost{padding:0!important;margin:0!important;overflow:visible!important}
  #pages{zoom:1!important;width:194mm!important;margin:0!important}
  .qr-paper{margin:0!important;box-shadow:none!important;break-inside:avoid;page-break-inside:avoid;break-after:page;page-break-after:always}
  .qr-paper:last-child{break-after:auto;page-break-after:auto}
  .qr-card{break-inside:avoid;page-break-inside:avoid}
  body.print-blocked #pages{display:none!important}
}
`;
export function mountQrPrintEditor(popup,{items,courseStart,courseTitle,formatDeadline,canPrint,onClose}){
  const d=popup.document;
  const data=items.map(x=>({name:String(x.studentName||''),deadline:formatDeadline(x.closingAt),svg:String(x.svg||'')}));
  if(!data.length||data.some(x=>!x.svg))return false;
  let prefs=readPrefs();
  // Parse the server's QR SVG once; never place editor text into markup.
  const arts=data.map(item=>{
    const svg=new DOMParser().parseFromString(item.svg,'image/svg+xml').documentElement;
    if(svg.localName!=='svg'||svg.namespaceURI!=='http://www.w3.org/2000/svg')throw Error('Invalid QR image');
    // The QR generator emits only basic SVG geometry; do not import executable content.
    const allowed=new Set(['svg','path','rect','g','title','desc']);
    const attrs=new Set(['xmlns','width','height','viewBox','fill','stroke','stroke-width','d','x','y','rx','ry','shape-rendering','transform','version','preserveAspectRatio','fill-rule','clip-rule','opacity']);
    for(const el of [svg,...svg.querySelectorAll('*')]){
      if(!allowed.has(el.localName))throw Error('Invalid QR element');
      for(const a of [...el.attributes]){
        if(!attrs.has(a.name)||/url\s*\(|javascript:|data:/i.test(a.value))throw Error('Invalid QR attribute');
      }
    }
    return svg;
  });
  d.documentElement.lang='ja';d.head.replaceChildren();d.body.replaceChildren();
  function el(tag,cls,text){const n=d.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  const meta=el('meta');meta.name='viewport';meta.content='width=device-width,initial-scale=1';
  const referrer=el('meta');referrer.name='referrer';referrer.content='no-referrer';
  const title=el('title','','Shiftly-T | QRエディタ');
  const style=el('style','',CSS);d.head.append(meta,referrer,title,style);
  const bar=el('header','editor-bar'),brand=el('strong','','Shiftly-T｜QRエディタ');
  const print=el('button','primary','印刷・PDF保存'),close=el('button','','閉じる');
  print.type=close.type='button';bar.append(brand,print,close);
  const panel=el('section','editor-panel'),heading=el('h2','','配布用紙のデザイン');
  const fields=el('div','editor-fields');
  function field(label,control,wide=false){const l=el('label',wide?'wide':'',label);l.append(control);fields.append(l);return l;}
  const input=el('input');input.type='text';input.maxLength=100;input.placeholder='自動：'+courseTitle;field('タイトル（空欄で講習名）',input,true);
  const intro=el('textarea');intro.maxLength=200;intro.rows=3;field('案内文',intro,true);
  const footer=el('textarea');footer.maxLength=160;footer.rows=3;field('注意事項',footer,true);
  const layout=el('select');for(const n of [1,2,4]){const o=el('option','',n+'名／A4 1枚');o.value=String(n);layout.append(o);}field('印刷レイアウト',layout);
  const range=el('input');range.type='range';range.min='25';range.step='1';
  const sizeLabel=field('QRコードの大きさ',range);
  const checks=el('div','checks wide');
  const name=el('input');name.type='checkbox';const deadline=el('input');deadline.type='checkbox';
  for(const [control,text] of [[name,'生徒氏名を表示'],[deadline,'受付締切を表示']]){const l=el('label');l.append(control,d.createTextNode(text));checks.append(l);}
  fields.append(checks);
  const actions=el('div','editor-actions');const save=el('button','','設定を保存'),reset=el('button','','初期設定に戻す');
  save.type=reset.type='button';actions.append(save,reset);
  const info=el('p','hint','設定保存はこの端末のみ。氏名などの個人情報を編集欄に入力して保存しないでください。QRや生徒情報は保存しません。');
  const feedback=el('p','hint');feedback.setAttribute('role','status');
  const warning=el('p','warning');warning.setAttribute('role','status');
  panel.append(heading,fields,info,actions,feedback,warning);
  const host=el('div');host.id='previewHost';
  const caption=el('p');caption.id='previewTitle';const pages=el('div');pages.id='pages';host.append(caption,pages);
  d.body.append(bar,panel,host);
  function sync(){
    input.value=prefs.title;intro.value=prefs.intro;footer.value=prefs.footer;
    layout.value=String(prefs.layout);range.max=String(LIMITS[prefs.layout]);range.value=String(prefs.size);
    name.checked=prefs.showName;deadline.checked=prefs.showDeadline;
    sizeLabel.firstChild.nodeValue='QRコードの大きさ：'+prefs.size+' mm';
  }
  function scale(){
    pages.style.zoom='1';
    const width=pages.getBoundingClientRect().width;
    const available=Math.max(1,host.clientWidth-20);
    if(width>0)pages.style.zoom=String(Math.min(1,available/width));
  }
  let fits=false;
  function checkFit(){
    const cards=[...pages.querySelectorAll('.qr-card')];
    fits=cards.length===data.length&&cards.every(c=>{
      const bounds=c.getBoundingClientRect(),children=[...c.children];
      return c.scrollHeight<=c.clientHeight+2&&c.scrollWidth<=c.clientWidth+2&&children.every(n=>{
        const r=n.getBoundingClientRect();return r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1&&r.left>=bounds.left-1&&r.right<=bounds.right+1;
      });
    });
    print.disabled=!fits||!canPrint();
    d.body.classList.toggle('print-blocked',print.disabled);
    warning.textContent=!fits?'内容が用紙の枠を超えています。文章を短くするか、QRを小さくしてください。':prefs.size<35?'QRが小さめです。配布前に実際に印刷して読み取りを確認してください。':'';
    return fits;
  }
  function render(){
    pages.replaceChildren();
    pages.style.setProperty('--qr-size',prefs.size+'mm');
    for(let offset=0;offset<data.length;offset+=prefs.layout){
      const page=el('section','qr-paper');page.dataset.layout=String(prefs.layout);
      for(let i=offset;i<Math.min(offset+prefs.layout,data.length);i++){
        const x=data[i],card=el('article','qr-card');
        card.append(el('h2','qr-heading',prefs.title.trim()||courseTitle));
        if(prefs.showName)card.append(el('p','qr-name',x.name+' さん'));
        if(prefs.intro.trim())card.append(el('p','qr-copy',prefs.intro));
        const art=el('div','qr-art');art.append(d.importNode(arts[i],true));card.append(art);
        if(prefs.showDeadline)card.append(el('p','qr-deadline','受付締切：'+x.deadline+'（日本時間）'));
        if(prefs.footer.trim())card.append(el('p','qr-copy',prefs.footer));
        page.append(card);
      }
      pages.append(page);
    }
    caption.textContent=data.length+'名分 ／ A4 '+Math.ceil(data.length/prefs.layout)+'枚（実寸QR '+prefs.size+' mm）';
    scale();checkFit();
  }
  function changed(){
    prefs=normalize({title:input.value,intro:intro.value,footer:footer.value,layout:Number(layout.value),size:Number(range.value),showName:name.checked,showDeadline:deadline.checked});
    range.max=String(LIMITS[prefs.layout]);range.value=String(prefs.size);
    sizeLabel.firstChild.nodeValue='QRコードの大きさ：'+prefs.size+' mm';
    feedback.textContent='';render();
  }
  for(const control of [input,intro,footer,range])control.addEventListener('input',changed);
  for(const control of [layout,name,deadline])control.addEventListener('change',changed);
  save.addEventListener('click',()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(prefs));feedback.textContent='デザイン設定をこの端末に保存しました。';}catch{feedback.textContent='端末への保存ができません。現在の印刷には利用できます。';}});
  reset.addEventListener('click',()=>{prefs=normalize(DEFAULTS);sync();render();try{localStorage.removeItem(STORAGE_KEY);}catch{}feedback.textContent='初期設定に戻しました。';});
  close.addEventListener('click',onClose);
  print.addEventListener('click',()=>{if(canPrint()&&checkFit())popup.print();});
  popup.addEventListener('resize',()=>{scale();checkFit();});
  popup.addEventListener('beforeprint',()=>{d.body.classList.toggle('print-blocked',!fits||!canPrint());});
  sync();render();
  d.fonts?.ready.then(()=>{if(!popup.closed){scale();checkFit();}}).catch(()=>{});
  return true;
}
