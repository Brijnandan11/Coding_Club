import fs from 'node:fs';
import pg from 'pg';
const settings=JSON.parse(fs.readFileSync(new URL('../.sandbox/environment.json',import.meta.url),'utf8'));
const url=new URL(settings.databaseUrl);if(!url.hostname.endsWith('.neon.tech')||url.pathname!=='/codingclub_sandbox')throw Error('Unsafe target');
const pool=new pg.Pool({connectionString:settings.databaseUrl,connectionTimeoutMillis:15000});
try{
 if((await pool.query('SELECT id FROM sandbox_control.environment')).rows[0].id!==settings.sandboxId)throw Error('Identity mismatch');
 console.log(JSON.stringify((await pool.query(`SELECT p.academic_year,count(*)::int n,count(*) FILTER(WHERE u.is_active)::int active FROM club.registrations r JOIN club.events e ON e.id=r.event_id JOIN club.participant_profiles p ON p.user_id=r.user_id JOIN club.users u ON u.id=r.user_id WHERE e.slug='code-sastra-2026' AND r.status='CONFIRMED' GROUP BY p.academic_year ORDER BY p.academic_year`)).rows));
 console.log(JSON.stringify((await pool.query(`SELECT t.id,t.name,count(m.registration_id)::int members,jsonb_agg(p.academic_year) FILTER(WHERE m.registration_id IS NOT NULL) years,lp.academic_year leader_year FROM club.teams t JOIN club.events e ON e.id=t.event_id JOIN club.event_leaders l ON l.id=t.leader_id JOIN club.participant_profiles lp ON lp.user_id=l.user_id LEFT JOIN club.team_members m ON m.team_id=t.id LEFT JOIN club.registrations r ON r.id=m.registration_id LEFT JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE e.slug='code-sastra-2026' GROUP BY t.id,lp.academic_year ORDER BY t.name`)).rows));
}finally{await pool.end()}
