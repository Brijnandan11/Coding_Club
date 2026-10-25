import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../../src/app.js';
import {pool,tx,query} from '../../src/db.js';

test('pending mixed-year teams can reserve vice-captains without unlocking random draws',{timeout:120000},async()=>{
 const marker='pending-vice-'+crypto.randomUUID(),users=[],leaders=[],tokens=[];let event,server;
 try{
  await tx(async c=>{
   event=(await c.query(`INSERT INTO club.events(title,slug,event_date,start_time,end_time,venue,team_size,max_participants,registration_start,registration_deadline,status) VALUES($1,$1,'2099-01-01','10:00','12:00','QA',14,182,'2020-01-01','2098-01-01','OPEN') RETURNING id`,[marker])).rows[0];
   for(let n=0;n<182;n++){
    const u=(await c.query("INSERT INTO club.users(email,password_hash) VALUES($1,'unused') RETURNING id",[marker+'-'+n+'@example.invalid'])).rows[0];users.push(u.id);
    const year=n<75?1:n<131?2:n<158?3:n<180?4:null;
    await c.query('INSERT INTO club.participant_profiles(user_id,full_name,academic_year) VALUES($1,$2,$3)',[u.id,'QA student '+n,year]);
    await c.query("INSERT INTO club.registrations(event_id,user_id,status,registration_code) VALUES($1,$2,'CONFIRMED',$3)",[event.id,u.id,marker+'-'+n]);
   }
   for(let n=0;n<13;n++){
    await c.query('INSERT INTO club.team_allocation_slots(event_id,slot,first_year_quota,team_capacity) VALUES($1,$2,$3,14)',[event.id,n+1,n<10?6:5]);
    const l=(await c.query("INSERT INTO club.event_leaders(event_id,user_id,leader_code,credential_hash) VALUES($1,$2,$3,'unused') RETURNING id",[event.id,users[75+n],marker+'-L'+n])).rows[0];leaders.push(l.id);
    const token=crypto.randomBytes(32).toString('hex');tokens.push(token);
    await c.query("INSERT INTO club.leader_sessions(leader_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[l.id,crypto.createHash('sha256').update(token).digest('hex')]);
   }
  });
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port+'/api';
  async function req(path,body,idx=0,status=200){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+tokens[idx],'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
  await req('/leader/team',{name:'Pending first'},0,201);await req('/leader/team',{name:'Pending second'},1,201);
  const choices=await req('/leader/team/vice-captain/candidates');assert.ok(choices.length>100);assert.ok(!choices.some(c=>leaders.includes(c.user_id)));assert.equal(choices.length,169);
  const vice=choices.find(c=>c.academic_year===4);assert.ok(vice);
  await req('/leader/team/vice-captain',{registration_id:vice.registration_id});
  let team=await req('/leader/team');assert.equal(team.allocation_ready,false);assert.equal(team.members.length,1);assert.equal(team.members[0].is_vice_captain,true);
  await req('/leader/team/vice-captain',{registration_id:vice.registration_id},1,409);
  await req('/leader/team/spin',{},0,409);
  const ordinary=choices.find(c=>c.academic_year===3);
  await assert.rejects(()=>query('INSERT INTO club.team_members(team_id,event_id,registration_id) VALUES($1,$2,$3)',[team.id,event.id,ordinary.registration_id]),/Allocation opens/);
  await req('/leader/team/vice-captain',{registration_id:ordinary.registration_id});
  team=await req('/leader/team');assert.equal(team.members.length,2);assert.equal(team.members.filter(m=>m.is_vice_captain).length,1);
  await req('/leader/team/vice-captain',{registration_id:null});assert.equal((await req('/leader/team')).members.filter(m=>m.is_vice_captain).length,0);
  for(let n=2;n<13;n++)await req('/leader/team',{name:'QA team '+n},n,201);
  team=await req('/leader/team');assert.equal(team.allocation_ready,true);assert.equal(Object.values(team.year_quotas).reduce((n,v)=>n+v,0),14);assert.ok(team.year_quotas[3]>=1&&team.year_quotas[4]>=1);assert.equal(team.members.length,2);
  await req('/leader/team/spin',{});assert.equal((await req('/leader/team')).members.length,3);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(event)await tx(async c=>{await c.query('DELETE FROM club.team_members WHERE event_id=$1',[event.id]);await c.query('DELETE FROM club.team_allocation_slots WHERE event_id=$1',[event.id]);await c.query('DELETE FROM club.teams WHERE event_id=$1',[event.id]);await c.query('DELETE FROM club.event_leaders WHERE event_id=$1',[event.id]);await c.query('DELETE FROM club.registrations WHERE event_id=$1',[event.id]);await c.query('DELETE FROM club.events WHERE id=$1',[event.id]);await c.query('DELETE FROM club.audit_logs WHERE actor_id=ANY($1::uuid[])',[users]);await c.query('DELETE FROM club.users WHERE id=ANY($1::uuid[])',[users]);});
  await pool.end();
 }
});
