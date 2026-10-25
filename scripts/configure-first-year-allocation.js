import {pool,tx} from '../src/db.js';
import {balancedQuotas} from '../src/team-allocation.js';

const [slug,teamsArg,totalArg,apply]=process.argv.slice(2),teams=Number(teamsArg),total=Number(totalArg);
try{
 if(!slug||!Number.isSafeInteger(teams)||teams<1||!Number.isSafeInteger(total)||total<0)throw Error('Usage: node scripts/configure-first-year-allocation.js event-slug teams first-years [--apply]');
 const result=await tx(async c=>{
  await c.query("SET LOCAL lock_timeout='10s'");
  await c.query('LOCK TABLE club.teams,club.team_members IN SHARE ROW EXCLUSIVE MODE');
  const event=(await c.query('SELECT id,team_size FROM club.events WHERE slug=$1 FOR UPDATE',[slug])).rows[0];if(!event)throw Error('Event not found');
  const count=(await c.query("SELECT count(*)::int n FROM club.registrations r JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE r.event_id=$1 AND r.status='CONFIRMED' AND p.academic_year=1",[event.id])).rows[0].n;
  if(count!==total)throw Error(`Expected ${total} confirmed first-years, found ${count}`);
  const existing=(await c.query('SELECT id FROM club.teams WHERE event_id=$1 ORDER BY created_at,id FOR UPDATE',[event.id])).rows;
  const slots=(await c.query('SELECT slot,first_year_quota,team_id FROM club.team_allocation_slots WHERE event_id=$1 ORDER BY slot',[event.id])).rows;
  if(slots.length){if(slots.length!==teams||slots.reduce((n,s)=>n+s.first_year_quota,0)!==total)throw Error('An allocation plan already exists with different totals');return {event:slug,already_configured:true,slots};}
  if(existing.length>teams)throw Error('More teams exist than planned');
  const allocated=(await c.query('SELECT count(*)::int n FROM club.team_members WHERE event_id=$1',[event.id])).rows[0].n;
  if(allocated)throw Error('Members already allocated; review existing teams before configuring quotas');
  const firstYearLeaders=(await c.query('SELECT count(*)::int n FROM club.event_leaders l JOIN club.participant_profiles p ON p.user_id=l.user_id WHERE l.event_id=$1 AND p.academic_year=1',[event.id])).rows[0].n;
  if(firstYearLeaders)throw Error('Review first-year leaders before configuring the plan');
  const quotas=balancedQuotas(total,teams);if(Math.max(...quotas)>event.team_size-1)throw Error('First-year quota exceeds team capacity');
  if(apply==='--apply'){
   for(let i=0;i<teams;i++)await c.query('INSERT INTO club.team_allocation_slots(event_id,slot,first_year_quota,team_id) VALUES($1,$2,$3,$4)',[event.id,i+1,quotas[i],existing[i]?.id||null]);
   await c.query("INSERT INTO club.audit_logs(action,target_id,details) VALUES('OPERATOR_CONFIGURED_FIRST_YEAR_ALLOCATION',$1,$2::jsonb)",[event.id,JSON.stringify({teams,first_years:total,quotas})]);
  }
  return {event:slug,applied:apply==='--apply',teams,first_years:total,quotas,existing_teams:existing.length};
 });console.log(JSON.stringify(result));
}catch(e){console.error(e.message);process.exitCode=1}finally{await pool.end()}
