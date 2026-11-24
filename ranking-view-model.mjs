export function rankingWindow(kind,key){
  if(kind==='month'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(key)){
    const [y,m]=key.split('-').map(Number);return {from:key+'-01',to:key+'-'+new Date(Date.UTC(y,m,0)).getUTCDate(),label:y+'年'+m+'月'};
  }
  if(kind==='year'&&/^\d{4}$/.test(key)){const y=Number(key);return {from:key+'-04-01',to:(y+1)+'-03-31',label:y+'年度'};}
  throw Error('Invalid period');
}

export function splitRankingRows(rows){return {top:rows.filter(x=>x.rank<=3),rest:rows.filter(x=>x.rank>3)};}
