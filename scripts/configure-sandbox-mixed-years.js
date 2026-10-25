import fs from 'node:fs';
import pg from 'pg';
import {captureSnapshot} from '../src/sandbox-data.js';
const settings=JSON.parse(fs.readFileSync(new URL('../.sandbox/environment.json',import.meta.url),'utf8'));
const url=new URL(settings.databaseUrl);if(!url.hostname.endsWith('.neon.tech')||url.pathname!=='/codingclub_sandbox')throw Error('Unsafe target');
process.env.DOTENV_CONFIG_PATH='/dev/null';process.env.DATABASE_URL=settings.databaseUrl;
const {balancedQuotas,configureMixedYearPlan}=await import('../src/team-allocation.js');
const pool=new pg.Pool({connectionString:settings.databaseUrl,connectionTimeoutMillis:15000});
const c=await pool.connect();let stage="metadata";
try{
 await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='15s'");
 const environment=(await c.query('SELECT id,baseline FROM sandbox_control.environment FOR UPDATE')).rows[0];if(environment.id!==settings.sandboxId)throw Error('Test identity mismatch');
 await c.query('LOCK TABLE club.events,club.teams,club.team_members,club.team_allocation_slots IN SHARE ROW EXCLUSIVE MODE');
 await c.query('CREATE TABLE IF NOT EXISTS sandbox_control.allocation_upgrade_backups(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,created_at timestamptz DEFAULT now(),snapshot jsonb NOT NULL)');
 await c.query('INSERT INTO sandbox_control.allocation_upgrade_backups(snapshot) VALUES($1::jsonb)',[JSON.stringify(await captureSnapshot(c))]);
 stage='schema';await c.query(fs.readFileSync(new URL('../sql/005_mixed_year_team_allocation.sql',import.meta.url),'utf8'));
 const event=(await c.query("SELECT id FROM club.events WHERE slug='code-sastra-2026'")).rows[0];
 const count=Number((await c.query("SELECT count(*)::int n FROM club.registrations WHERE event_id=$1 AND status='CONFIRMED'",[event.id])).rows[0].n);if(count!==180)throw Error('Expected 180 confirmed players, found '+count);
 const slots=(await c.query('SELECT * FROM club.team_allocation_slots WHERE event_id=$1 ORDER BY slot',[event.id])).rows;if(slots.length!==13)throw Error('Expected 13 planned teams');
 const capacities=slots.every(s=>s.team_capacity)&&slots.reduce((n,s)=>n+s.team_capacity,0)===180?slots.map(s=>s.team_capacity):balancedQuotas(180,13);
 await c.query('UPDATE club.events SET team_size=14 WHERE id=$1',[event.id]);
 for(let i=0;i<slots.length;i++)await c.query('UPDATE club.team_allocation_slots SET team_capacity=$1 WHERE event_id=$2 AND slot=$3',[capacities[i],event.id,slots[i].slot]);
 stage='year-plan';let plan=[];if(slots.every(s=>s.team_id))plan=await configureMixedYearPlan(c,event.id);
 const baseline=environment.baseline,table=baseline.tables.find(t=>t.name==='team_allocation_slots');
 table.columns=(await c.query("SELECT attname::text FROM pg_attribute WHERE attrelid='club.team_allocation_slots'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")).rows.map(r=>r.attname);
 for(const row of table.rows){row.team_capacity=row.event_id===event.id?capacities[slots.findIndex(s=>s.slot===row.slot)]:null;row.year_quotas=null;}
 baseline.tables.find(t=>t.name==='events').rows.find(e=>e.id===event.id).team_size=14;
 await c.query('UPDATE sandbox_control.environment SET baseline=$1::jsonb WHERE id=$2',[JSON.stringify(baseline),settings.sandboxId]);
 await c.query('COMMIT');
 console.log(JSON.stringify({test_only:true,total_players:180,teams_of_14:capacities.filter(n=>n===14).length,teams_of_13:capacities.filter(n=>n===13).length,existing_allocations_preserved:true,year_mix_ready:plan.length===13,plan:plan.map(s=>({slot:s.slot,capacity:s.team_capacity,years:s.year_quotas}))}));
}catch(e){await c.query('ROLLBACK');console.error(JSON.stringify({stage,message:e.message,position:e.position,where:e.where}));process.exitCode=1}finally{c.release();await pool.end()}
