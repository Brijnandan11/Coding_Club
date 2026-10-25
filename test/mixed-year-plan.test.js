import test from 'node:test';
import assert from 'node:assert/strict';
import {mixedYearPlan,chooseDrawYear} from '../src/mixed-year-plan.js';

const totals={1:74,2:56,3:26,4:22,0:2};
test('182 confirmed players form 13 complete teams of 14 with 75 first-years',()=>{
 const updated={1:75,2:56,3:27,4:22,0:2};
 for(let run=0;run<20;run++){
  const plan=mixedYearPlan(updated,Array.from({length:13},(_,i)=>({team_capacity:14,first_year_quota:i<10?6:5,leader_year:3,counts:{3:1}})));
  for(const team of plan){assert.equal(Object.values(team.year_quotas).reduce((a,b)=>a+b,0),14);for(const y of [1,2,3,4])assert.ok(team.year_quotas[y]-(y===3?1:0)>=1)}
  for(const [year,n] of Object.entries(updated))assert.equal(plan.reduce((sum,t)=>sum+t.year_quotas[year],0),n);
 }
});
function check(plan){
 assert.equal(plan.filter(t=>t.team_capacity===14).length,11);assert.equal(plan.filter(t=>t.team_capacity===13).length,2);
 for(const team of plan){assert.equal(Object.values(team.year_quotas).reduce((a,b)=>a+b,0),team.team_capacity);assert.equal(team.year_quotas[1],team.first_year_quota);for(const y of [1,2,3,4])assert.ok(team.year_quotas[y]>=1);for(const [year,n] of Object.entries(team.counts))assert.ok(team.year_quotas[year]>=n)}
 for(const [year,total] of Object.entries(totals))assert.equal(plan.reduce((n,t)=>n+t.year_quotas[year],0),total);
}
test('180 players fit exactly into 11 teams of 14 and two of 13, with all four years',()=>{
 for(let run=0;run<40;run++)check(mixedYearPlan(totals,Array.from({length:13},(_,i)=>({slot:i+1,team_capacity:i<11?14:13,first_year_quota:i<9?6:5,leader_year:3,counts:{3:1}}))));
});
test('existing vice-captains and draws are preserved while completing a year mix',()=>{
 const slots=Array.from({length:13},(_,i)=>({slot:i+1,team_capacity:i===5||i===12?13:14,first_year_quota:i<9?6:5,leader_year:i<2?0:3,counts:i<2?{0:1}:{3:1}}));
 slots[5].counts={1:6,3:4};slots[7].counts={1:6,2:3,3:1};
 for(let run=0;run<20;run++){const plan=mixedYearPlan(totals,slots);check(plan);for(const s of plan)for(const y of [1,2,3,4])assert.ok(s.year_quotas[y]-(s.leader_year===y?1:0)>=1)}
});
test('draws prioritize missing years, then stay within remaining places',()=>{
 const quotas={1:6,2:4,3:2,4:2},counts={3:1};
 for(let i=0;i<3;i++){const year=chooseDrawYear(quotas,counts);assert.ok([1,2,4].includes(year));assert.equal(counts[year]||0,0);counts[year]=1;}
 for(let i=4;i<14;i++){const year=chooseDrawYear(quotas,counts);assert.ok(counts[year]<quotas[year]);counts[year]++;}
 assert.deepEqual(counts,quotas);assert.equal(chooseDrawYear(quotas,counts),null);
});
test('an impossible total or oversubscribed fixed first-year count is rejected',()=>{
 assert.throws(()=>mixedYearPlan(totals,[{team_capacity:14,first_year_quota:6,counts:{3:1}}]),/capacities/);
 const slots=Array.from({length:13},(_,i)=>({team_capacity:i<11?14:13,first_year_quota:i<9?6:5,counts:{3:1}}));slots[0].counts={1:7};assert.throws(()=>mixedYearPlan(totals,slots),/Existing allocations/);
});
