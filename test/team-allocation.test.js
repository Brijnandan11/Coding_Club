import test from 'node:test';
import assert from 'node:assert/strict';
import {balancedQuotas,allocationEligibility} from '../src/team-allocation.js';
test('74 first-years have nine quotas of six and four of five across 13 teams',()=>{
 for(let i=0;i<20;i++){
  const quotas=balancedQuotas(74,13);
  assert.equal(quotas.reduce((a,b)=>a+b,0),74);
  assert.equal(quotas.filter(n=>n===6).length,9);
  assert.equal(quotas.filter(n=>n===5).length,4);
 }
});
test('allocation reserves remaining first-year places and caps their number',()=>{
 assert.deepEqual(allocationEligibility({quota:6,firstYears:0,members:3,teamSize:10}),{allowFirstYear:true,allowOther:false});
 assert.deepEqual(allocationEligibility({quota:6,firstYears:6,members:6,teamSize:10}),{allowFirstYear:false,allowOther:true});
 assert.deepEqual(allocationEligibility({quota:6,firstYears:2,members:3,teamSize:10}),{allowFirstYear:true,allowOther:true});
 assert.deepEqual(allocationEligibility({quota:null,firstYears:0,members:0,teamSize:3}),{allowFirstYear:true,allowOther:true});
 assert.throws(()=>allocationEligibility({quota:6,firstYears:2,members:7,teamSize:10}),/first-year quota/);
 assert.throws(()=>allocationEligibility({quota:5,firstYears:5,members:9,teamSize:10}),/Team full/);
});
