import fs from 'node:fs';
import assert from 'node:assert/strict';
const settings=JSON.parse(fs.readFileSync(new URL('../.sandbox/environment.json',import.meta.url),'utf8'));
const base=process.argv[2]||'http://127.0.0.1:5191';let cookie;
async function request(path,{body,token,status=200,locked=false}={}){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie&&!locked?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}
 assert.equal(response.status,status,typeof data==='object'?JSON.stringify(data):String(data).slice(0,200));
 return {data,response};
}
await request('/api/events',{status:401,locked:true});
const unlock=await request('/_sandbox/unlock',{body:{code:settings.accessCode}});cookie=unlock.response.headers.get('set-cookie').split(';')[0];
let before=(await request('/_sandbox/state')).data;
const event=before.events.find(e=>e.slug==='code-sastra-2026');assert.ok(event);
let changed=false;
try{
 const prepared=(await request('/_sandbox/prepare-teams',{body:{event_id:event.id}})).data;changed=true;assert.equal(prepared.total,13);
 const state=(await request('/_sandbox/state')).data;assert.equal(state.teams.filter(t=>t.event_id===event.id).length,13);
 const leaders=state.leaders.filter(l=>l.event_id===event.id&&l.is_active);assert.equal(leaders.length,13);
 const token=(await request('/_sandbox/login',{body:{kind:'leader',leader_id:leaders[0].id}})).data.token;
 const candidates=(await request('/api/leader/team/vice-captain/candidates',{token})).data;
 const candidate=candidates.find(c=>c.academic_year===1&&!c.already_in_team);assert.ok(candidate);
 await request('/api/leader/team/vice-captain',{body:{registration_id:candidate.registration_id},token});
 const second=(await request('/_sandbox/login',{body:{kind:'leader',leader_id:leaders[1].id}})).data.token;
 await request('/api/leader/team/vice-captain',{body:{registration_id:candidate.registration_id},token:second,status:409});
 const initialTeam=(await request('/api/leader/team',{token})).data;
 for(let i=0;i<initialTeam.remaining_slots;i++)await request('/api/leader/team/spin',{body:{},token});
 const team=(await request('/api/leader/team',{token})).data;assert.equal(team.total_members,team.team_size);assert.equal(team.first_year_count,team.first_year_quota);assert.equal(team.members.filter(m=>m.is_vice_captain).length,1);
 await request('/api/leader/team/vice-captain',{body:{registration_id:null},token});
 const admin=(await request('/_sandbox/login',{body:{kind:'admin'}})).data.token;
 const payments=(await request('/api/admin/payments/upi?limit=1',{token:admin})).data;
 const qr=(await request('/api/payments/config')).data;assert.equal(qr.enabled,false);assert.equal(qr.upi_id,'');
 assert.ok((await request('/')).data.includes('TEST COPY'));
 console.log(JSON.stringify({gate_verified:true,test_users:before.counts.users,registrations:before.counts.registrations,copied_files:before.counts.files,prepared_teams:13,vice_captain_verified:true,quota_verified:team.first_year_quota,real_payments_disabled:true,payment_records_accessible:!!payments}));
}finally{
 if(changed){await request('/_sandbox/reset',{body:{}});const restored=(await request('/_sandbox/state')).data;assert.deepEqual(restored.counts,before.counts);assert.equal(restored.teams.length,before.teams.length);assert.equal(restored.leaders.length,before.leaders.length);console.log('Reset verified: original test snapshot restored.');}
}
