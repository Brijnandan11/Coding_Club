import fs from 'node:fs';
import {config} from '../src/config.js';
import {pool} from '../src/db.js';
import {captureSnapshot} from '../src/database-snapshot.js';
import {randomInt} from 'node:crypto';
const url=new URL(config.databaseUrl);
if(!(url.hostname==='db.wfmzhrjdjbkuezsmewjk.supabase.co'||url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username)==='postgres.wfmzhrjdjbkuezsmewjk'))throw Error('Unexpected production database');
const apply=process.argv.includes('--apply'),c=await pool.connect();
try{
 await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='15s'");
 await c.query('LOCK TABLE club.events,club.registrations,club.teams,club.team_members,club.team_allocation_slots IN SHARE ROW EXCLUSIVE MODE');
 const event=(await c.query("SELECT id FROM club.events WHERE slug='code-sastra-2026'")).rows[0];if(!event)throw Error('Production event missing');
 const years=(await c.query("SELECT COALESCE(p.academic_year,0) AS year,count(*)::int players,count(*) FILTER(WHERE u.is_active)::int active FROM club.registrations r JOIN club.users u ON u.id=r.user_id JOIN club.participant_profiles p ON p.user_id=u.id WHERE r.event_id=$1 AND r.status='CONFIRMED' GROUP BY COALESCE(p.academic_year,0)",[event.id])).rows;
 const total=years.reduce((n,r)=>n+r.players,0),first=years.find(r=>r.year===1)?.players||0;
 if(total!==182||years.some(r=>r.active!==r.players))throw Error('Expected 182 active confirmed players; current count '+total);
 const slots=(await c.query('SELECT * FROM club.team_allocation_slots WHERE event_id=$1 ORDER BY slot',[event.id])).rows;if(slots.length!==13)throw Error('Expected 13 planned team slots');
 const existing=(await c.query('SELECT count(*)::int members FROM club.team_members WHERE event_id=$1',[event.id])).rows[0].members;
 if(existing)throw Error('Existing production members require a reviewed plan; refusing to overwrite quotas');
 if(!apply){await c.query('ROLLBACK');console.log(JSON.stringify({dry_run:true,confirmed:total,first_years:first,team_slots:13,capacity_each:14,existing_members:existing,years}));}
 else{
  fs.mkdirSync('.production-backups',{recursive:true,mode:0o700});
  const backup='.production-backups/before-182-plan-'+Date.now()+'.json';fs.writeFileSync(backup,JSON.stringify(await captureSnapshot(c)),{mode:0o600});
  await c.query(fs.readFileSync(new URL('../sql/005_mixed_year_team_allocation.sql',import.meta.url),'utf8'));
  const low=Math.floor(first/13),extra=first%13;
  // Keep the old six-player first-year slots before extending one old five-player slot.
  const order=slots.map((s,i)=>({i,old:s.first_year_quota,tie:randomInt(1_000_000)})).sort((a,b)=>b.old-a.old||a.tie-b.tie);
  const bigger=new Set(order.slice(0,extra).map(s=>s.i));
  await c.query('UPDATE club.events SET team_size=14 WHERE id=$1',[event.id]);
  for(let i=0;i<slots.length;i++)await c.query('UPDATE club.team_allocation_slots SET team_capacity=14,first_year_quota=$1,year_quotas=NULL WHERE event_id=$2 AND slot=$3',[low+(bigger.has(i)?1:0),event.id,slots[i].slot]);
  await c.query("INSERT INTO club.audit_logs(action,target_id,details) VALUES('OPERATOR_PUBLISHED_182_PLAYER_ALLOCATION',$1,$2::jsonb)",[event.id,JSON.stringify({players:total,teams:13,size:14,first_years:first,captains_selected_by_admin:true,backup})]);
  const verify=(await c.query('SELECT count(*)::int slots,sum(team_capacity)::int capacity,sum(first_year_quota)::int first_years FROM club.team_allocation_slots WHERE event_id=$1',[event.id])).rows[0];if(verify.slots!==13||verify.capacity!==182||verify.first_years!==first)throw Error('Verification failed');
  await c.query('COMMIT');console.log(JSON.stringify({applied:true,players:182,teams:13,team_size:14,first_years:first,first_year_teams_of_6:extra,first_year_teams_of_5:13-extra,captains_and_registrations_preserved:true,backup}));
 }
}catch(e){await c.query('ROLLBACK');console.error(e.message);process.exitCode=1}finally{c.release();await pool.end()}
