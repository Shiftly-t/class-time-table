import {rankingWindow,splitRankingRows} from '../ranking-view-model.mjs';
function rankingViewTests(){
 const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Assertion failed');};
 eq(rankingWindow('month','2028-02').to,'2028-02-29');eq(rankingWindow('year','2026'),{from:'2026-04-01',to:'2027-03-31',label:'2026年度'});
 const split=splitRankingRows([{rank:1},{rank:2},{rank:3},{rank:3},{rank:5}]);eq(split.top.length,4);eq(split.rest.length,1);
 eq(splitRankingRows([]),{top:[],rest:[]});return 'SUCCESS RANKING VIEW MODEL TESTS';
}
console.log(rankingViewTests());
