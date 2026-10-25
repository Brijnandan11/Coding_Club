import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../../src/app.js';
import {pool,query,tx} from '../../src/db.js';
import {sign} from '../../src/utils.js';
import {balancedQuotas} from '../../src/team-allocation.js';

test('vice-captains and 74 random first-years across 13 teams',{timeout:360_000},async t=>{
 const marker='allocation-'+crypto.randomUUID(),users=[];let event,server,base,adminToken;
 const teams=[],tokens=[];
 async function req(path,body,token,expected=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+'/api'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
 }
 try{
  await tx(async c=>{
   event=(await c.query(`INSERT INTO club.events(title,slug,event_date,start_time,end_time,venue,team_size,max_participants,registration_start,registration_deadline,status) VALUES($1,$1,'2099-01-01','10:00','12:00','Test',10,200,'2020-01-01','2098-01-01','OPEN') RETURNING id`,[marker])).rows[0];
   const quotas=balancedQuotas(74,13);
   for(let i=0;i<13;i++)await c.query('INSERT INTO club.team_allocation_slots(event_id,slot,first_year_quota) VALUES($1,$2,$3)',[event.id,i+1,quotas[i]]);
   const created=(await c.query(`INSERT INTO club.users(email,password_hash) SELECT $1||'-'||n||'@example.invalid','unused' FROM generate_series(1,131) n RETURNING id,email,role,token_version`,[marker])).rows;
   users.push(...created.map(u=>u.id));
   await c.query(`INSERT INTO club.participant_profiles(user_id,full_name,academic_year) SELECT id,'Allocation student '||split_part(email,'@',1),CASE WHEN split_part(split_part(email,'@',1),$2,2)::int BETWEEN 14 AND 87 THEN 1 ELSE 3 END FROM club.users WHERE id=ANY($1::uuid[])`,[users,marker+'-']);
   await c.query(`INSERT INTO club.registrations(event_id,user_id,status,registration_code) SELECT $1,id,'CONFIRMED',$2||'-'||row_number() OVER() FROM club.users WHERE id=ANY($3::uuid[])`,[event.id,marker,users.slice(0,130)]);
   const admin=created[130];await c.query("UPDATE club.users SET role='ADMIN' WHERE id=$1",[admin.id]);adminToken=sign({...admin,role:'ADMIN'});
   for(let i=0;i<13;i++){
    const leader=(await c.query('INSERT INTO club.event_leaders(event_id,user_id,leader_code,credential_hash) VALUES($1,$2,$3,$4) RETURNING id',[event.id,users[i],marker+'-L'+i,'unused'])).rows[0];
    const token=crypto.randomBytes(32).toString('base64url');tokens.push(token);
    await c.query("INSERT INTO club.leader_sessions(leader_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[leader.id,crypto.createHash('sha256').update(token).digest('hex')]);
    const team=(await c.query('INSERT INTO club.teams(event_id,leader_id,name) VALUES($1,$2,$3) RETURNING id',[event.id,leader.id,marker+' team '+i])).rows[0];teams.push(team);
   }
  });
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
  let vice;
  await t.test('leader chooses an available confirmed student; other teams cannot claim them',async()=>{
   const candidates=await req('/leader/team/vice-captain/candidates',undefined,tokens[0]);vice=candidates.find(c=>c.academic_year===1);assert.ok(vice);
   await req('/leader/team/vice-captain',{registration_id:vice.registration_id},tokens[0]);
   const team=await req('/leader/team',undefined,tokens[0]);assert.equal(team.members.length,1);assert.equal(team.first_year_count,1);assert.equal(team.members[0].is_vice_captain,true);
   await req('/leader/team/vice-captain',{registration_id:vice.registration_id},tokens[1],409);
   await req('/leader/team/vice-captain',{registration_id:crypto.randomUUID()},tokens[0],409);
   await req('/leader/team/vice-captain',{registration_id:vice.registration_id},'invalid',401);
  });
  await t.test('concurrent random allocation fills every team with its exact saved quota',async()=>{
   for(let round=0;round<9;round++)await Promise.all(tokens.map((token,i)=>i===0&&round===8?undefined:req('/leader/team/spin',{},token)));
   const saved=(await query(`SELECT s.first_year_quota,count(m.registration_id)::int members,count(*) FILTER(WHERE p.academic_year=1)::int first_years FROM club.team_allocation_slots s JOIN club.team_members m ON m.team_id=s.team_id JOIN club.registrations r ON r.id=m.registration_id JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE s.event_id=$1 GROUP BY s.slot,s.first_year_quota`,[event.id])).rows;
   assert.equal(saved.length,13);assert.equal(saved.filter(s=>s.first_years===6).length,9);assert.equal(saved.filter(s=>s.first_years===5).length,4);
   for(const row of saved){assert.equal(row.members,9);assert.equal(row.first_years,row.first_year_quota)}
   assert.equal(saved.reduce((n,s)=>n+s.first_years,0),74);
   await req('/leader/team/spin',{},tokens[0],409);
  });
  await t.test('vice-captain can change on a full or locked team without adding another member',async()=>{
   const team=await req('/leader/team',undefined,tokens[0]),other=team.members.find(m=>!m.is_vice_captain);
   await req('/admin/teams/'+teams[0].id+'/lock',{locked:true},adminToken,200,'PATCH');
   await req('/leader/team/vice-captain',{registration_id:other.registration_id},tokens[0]);
   const changed=await req('/leader/team',undefined,tokens[0]);assert.equal(changed.members.length,9);assert.equal(changed.members.filter(m=>m.is_vice_captain).length,1);assert.equal(changed.members.find(m=>m.is_vice_captain).registration_id,other.registration_id);
   await req('/leader/team/vice-captain',{registration_id:null},tokens[0]);assert.equal((await req('/leader/team',undefined,tokens[0])).members.filter(m=>m.is_vice_captain).length,0);
  });
  await t.test('database guards reserve first-year slots against admin writes and reset transferred vice-captains',async()=>{
   const first=(await query('SELECT m.registration_id FROM club.team_members m JOIN club.registrations r ON r.id=m.registration_id JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE m.team_id=$1 AND p.academic_year=1 LIMIT 1',[teams[0].id])).rows[0];
   await query('DELETE FROM club.team_members WHERE team_id=$1 AND registration_id=$2',[teams[0].id,first.registration_id]);
   const other=(await query('SELECT m.registration_id FROM club.team_members m JOIN club.registrations r ON r.id=m.registration_id JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE m.team_id=$1 AND p.academic_year=3 LIMIT 1',[teams[1].id])).rows[0];
   await query('DELETE FROM club.team_members WHERE team_id=$1 AND registration_id=$2',[teams[1].id,other.registration_id]);
   await assert.rejects(()=>query('INSERT INTO club.team_members(team_id,event_id,registration_id) VALUES($1,$2,$3)',[teams[0].id,event.id,other.registration_id]),/reserved for first-year/);
   await query('INSERT INTO club.team_members(team_id,event_id,registration_id,is_vice_captain) VALUES($1,$2,$3,true)',[teams[0].id,event.id,first.registration_id]);
   // Moving a first-year to a team already at quota must fail, even with a free place.
   await assert.rejects(()=>query('UPDATE club.team_members SET team_id=$1 WHERE registration_id=$2',[teams[1].id,first.registration_id]),/first-year quota/);
   const destinationFirst=(await query('SELECT m.registration_id FROM club.team_members m JOIN club.registrations r ON r.id=m.registration_id JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE m.team_id=$1 AND p.academic_year=1 LIMIT 1',[teams[1].id])).rows[0];
   await query('DELETE FROM club.team_members WHERE team_id=$1 AND registration_id=$2',[teams[1].id,destinationFirst.registration_id]);
   const moved=(await query('UPDATE club.team_members SET team_id=$1 WHERE registration_id=$2 RETURNING is_vice_captain',[teams[1].id,first.registration_id])).rows[0];
   assert.equal(moved.is_vice_captain,false);
   await assert.rejects(()=>query('UPDATE club.participant_profiles SET academic_year=2 WHERE user_id=(SELECT user_id FROM club.registrations WHERE id=$1)',[first.registration_id]),/Academic year is fixed/);
  });
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(event)await tx(async c=>{
   await c.query('DELETE FROM club.team_members WHERE event_id=$1',[event.id]);
   await c.query('DELETE FROM club.team_allocation_slots WHERE event_id=$1',[event.id]);
   await c.query('DELETE FROM club.teams WHERE event_id=$1',[event.id]);
   await c.query('DELETE FROM club.event_leaders WHERE event_id=$1',[event.id]);
   await c.query('DELETE FROM club.registrations WHERE event_id=$1',[event.id]);
   await c.query('DELETE FROM club.events WHERE id=$1',[event.id]);
   await c.query('DELETE FROM club.audit_logs WHERE actor_id=ANY($1::uuid[]) OR target_id=ANY($2::uuid[])',[users,teams.map(t=>t.id)]);
   await c.query('DELETE FROM club.users WHERE id=ANY($1::uuid[])',[users]);
  });
  await pool.end();
 }
});
