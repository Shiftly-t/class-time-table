'use strict';
// Independent in-memory optimistic transaction model. NOT a Firestore emulator.
const clone=value=>value==null?value:structuredClone(value);
function createStore(seed={}){
  const docs=new Map(Object.entries(clone(seed))),versions=new Map();let commits=0,retries=0;let barrier=null;
  const ref=path=>({path,id:path.split('/').at(-1)});
  const snapshot=path=>({id:path.split('/').at(-1),exists:docs.has(path),data:()=>clone(docs.get(path))});
  const collection=path=>({path,filter:null,max:Infinity,where(...filter){return {...this,filter}},limit(max){return {...this,max}}});
  const db={doc:ref,collection,async runTransaction(fn){for(let attempt=0;attempt<12;attempt++){
    const reads=new Map(),ops=[];let writing=false,queryRead=false;
    const tx={async get(r){if(writing)throw Error('read after write');if('max'in r){queryRead=true;return {docs:[...docs.keys()].filter(p=>p.startsWith(r.path+'/')&&p.split('/').length===r.path.split('/').length+1&&(!r.filter||docs.get(p)[r.filter[0]]===r.filter[2])).sort().slice(0,r.max).map(p=>{reads.set(p,versions.get(p)||0);return snapshot(p)})}}reads.set(r.path,versions.get(r.path)||0);return snapshot(r.path)},set(r,data){writing=true;ops.push(['set',r.path,clone(data)])},delete(r){writing=true;ops.push(['delete',r.path])}};
    const startCommits=commits;const result=await fn(tx);
    if(barrier){const b=barrier;await b();}
    if([...reads].some(([p,v])=>(versions.get(p)||0)!==v)||(queryRead&&commits!==startCommits)){retries++;continue;}
    for(const [op,p,d]of ops){if(op==='delete')docs.delete(p);else docs.set(p,d);versions.set(p,(versions.get(p)||0)+1)}commits++;return result;
  }throw Error('mock contention exhausted')}};
  return {db,docs,get retries(){return retries},get commits(){return commits},raceNextTwo(){let n=0,release;const ready=new Promise(r=>release=r);barrier=async()=>{if(++n===2){barrier=null;release()}await ready};}};
}
module.exports={createStore};
