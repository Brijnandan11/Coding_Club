import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const settings=JSON.parse(fs.readFileSync(new URL('../.sandbox/environment.json',import.meta.url),'utf8'));
const url=new URL(settings.databaseUrl);if(!url.hostname.endsWith('.neon.tech')||url.pathname!=='/codingclub_sandbox')throw Error('Unsafe test database');
Object.assign(process.env,{DOTENV_CONFIG_PATH:'/dev/null',DATABASE_URL:settings.databaseUrl,JWT_SECRET:settings.jwtSecret,NODE_ENV:'development'});
const {pool,tx}=await import('../src/db.js');
if((await pool.query('SELECT id FROM sandbox_control.environment')).rows[0].id!==settings.sandboxId)throw Error('Test identity mismatch');
const {default:app}=await import('../src/app.js');
const {balancedQuotas,configureMixedYearPlan}=await import('../src/team-allocation.js');
const marker='mixed-qa-'+crypto.randomBytes(6).toString('hex'),eventId=crypto.randomUUID(),teams=[],tokens=[];
const years=[...Array(74).fill(1),...Array(56).fill(2),...Array(26).fill(3),...Array(22).fill(4),null,null];
const users=years.map((year,i)=>({id:crypto.randomUUID(),email:marker+'-'+i+'@example.invalid',year,registration_id:crypto.randomUUID(),i}));
let server,base,created=false;
async function req(path,token,body,expected=200){const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data}
try{
 await tx(async c=>{
  await c.query(`INSERT INTO club.events(id,title,slug,event_date,start_time,end_time,venue,team_size,max_participants,registration_start,registration_deadline,status) VALUES($1,$2,$2,'2099-01-01','10:00','12:00','QA test',14,180,'2020-01-01','2098-01-01','OPEN')`,[eventId,marker]);
  await c.query(`INSERT INTO club.users(id,email,password_hash) SELECT id,email,'unused' FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,email text)`,[JSON.stringify(users)]);
  await c.query(`INSERT INTO club.participant_profiles(user_id,full_name,academic_year) SELECT id,'QA student '||i,year FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,year int,i int)`,[JSON.stringify(users)]);
  await c.query(`INSERT INTO club.registrations(id,event_id,user_id,status,registration_code) SELECT registration_id,$2,id,'CONFIRMED',$3||'-'||i FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,registration_id uuid,i int)`,[JSON.stringify(users),eventId,marker]);
  const first=balancedQuotas(74,13),sizes=balancedQuotas(180,13),captains=users.filter(u=>u.year===3).slice(0,13);
  for(let i=0;i<13;i++){
   await c.query('INSERT INTO club.team_allocation_slots(event_id,slot,first_year_quota,team_capacity) VALUES($1,$2,$3,$4)',[eventId,i+1,first[i],sizes[i]]);
  }
  for(let i=0;i<13;i++){
   const leaderId=crypto.randomUUID(),teamId=crypto.randomUUID(),token=crypto.randomBytes(32).toString('base64url');tokens.push(token);teams.push({id:teamId,capacity:sizes[i]});
   await c.query('INSERT INTO club.event_leaders(id,event_id,user_id,leader_code,credential_hash) VALUES($1,$2,$3,$4,$5)',[leaderId,eventId,captains[i].id,marker+'-L'+i,'unused']);
   await c.query("INSERT INTO club.leader_sessions(leader_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[leaderId,crypto.createHash('sha256').update(token).digest('hex')]);
   await c.query('INSERT INTO club.teams(id,event_id,leader_id,name) VALUES($1,$2,$3,$4)',[teamId,eventId,leaderId,marker+' team '+i]);
  }
  await configureMixedYearPlan(c,eventId);
 });created=true;
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
 const viceCaptains=users.filter(u=>u.year===2).slice(0,13);
 await Promise.all(tokens.map((token,i)=>req('/leader/team/vice-captain',token,{registration_id:viceCaptains[i].registration_id})));
 for(let round=0;round<12;round++)await Promise.all(tokens.map((token,i)=>round<teams[i].capacity-2?req('/leader/team/spin',token,{}):undefined));
 const results=await Promise.all(tokens.map(token=>req('/leader/team',token)));
 assert.equal(results.reduce((n,t)=>n+t.total_members,0),180);
 assert.equal(results.filter(t=>t.total_members===14).length,11);assert.equal(results.filter(t=>t.total_members===13).length,2);
 const all=new Set();for(const team of results){assert.equal(team.remaining_slots,0);assert.equal(team.members.filter(m=>m.is_vice_captain).length,1);for(const year of [1,2,3,4])assert.ok(team.year_counts[year]>=1);for(const [year,n] of Object.entries(team.year_quotas))assert.equal(team.year_counts[year]||0,n);for(const member of team.members){assert.ok(!all.has(member.registration_id));all.add(member.registration_id)}}
 assert.equal(all.size,167);
 assert.equal(results.filter(t=>t.year_counts[1]===6).length,9);assert.equal(results.filter(t=>t.year_counts[1]===5).length,4);
 await req('/leader/team/spin',tokens[0],{},409);
 const vice=(await req('/leader/team',tokens[0])).members.find(m=>m.is_vice_captain);await req('/leader/team/vice-captain',tokens[0],{registration_id:vice.registration_id});
 // Even direct writes cannot use a reserved Year 4 seat for a Year 2 student.
 const target=results[0],removed=target.members.find(m=>m.academic_year===4),other=results[1].members.find(m=>m.academic_year===2);
 await pool.query('DELETE FROM club.team_members WHERE registration_id=ANY($1::uuid[])',[[removed.registration_id,other.registration_id]]);
 await assert.rejects(()=>pool.query('INSERT INTO club.team_members(team_id,event_id,registration_id) VALUES($1,$2,$3)',[target.id,eventId,other.registration_id]),/academic-year allocation is full/);
 console.log(JSON.stringify({verified:true,players:180,captains:13,vice_captains:13,allocated_non_captains:167,teams_of_14:11,teams_of_13:2,all_four_years_in_every_team:true,first_year_split:'9 x 6 and 4 x 5',duplicate_players:0,manual_bypass_blocked:true}));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 if(created)await tx(async c=>{
  await c.query('DELETE FROM club.audit_logs WHERE actor_id=ANY($1::uuid[]) OR target_id=ANY($2::uuid[])',[users.map(u=>u.id),teams.map(t=>t.id)]);
  for(const table of ['team_members','team_allocation_slots','teams','event_leaders','registrations'])await c.query('DELETE FROM club.'+table+' WHERE event_id=$1',[eventId]);
  await c.query('DELETE FROM club.events WHERE id=$1',[eventId]);await c.query('DELETE FROM club.users WHERE id=ANY($1::uuid[])',[users.map(u=>u.id)]);
 });
 await pool.end();console.log('Temporary QA event removed; existing test teams and allocations were not reset.');
}
