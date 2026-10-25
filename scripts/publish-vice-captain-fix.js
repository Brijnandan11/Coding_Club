import fs from 'node:fs';
import {config} from '../src/config.js';
import {pool} from '../src/db.js';
const url=new URL(config.databaseUrl);
if(!(url.hostname==='db.wfmzhrjdjbkuezsmewjk.supabase.co'||url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username)==='postgres.wfmzhrjdjbkuezsmewjk'))throw Error('Unexpected production database');
const c=await pool.connect();
try{
 await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='15s'");
 const previous=(await c.query("SELECT pg_get_functiondef('club.enforce_first_year_quota()'::regprocedure) AS definition")).rows[0].definition;
 fs.mkdirSync('.production-backups',{recursive:true,mode:0o700});fs.writeFileSync('.production-backups/before-vice-fix-'+Date.now()+'.sql',previous,{mode:0o600});
 await c.query(fs.readFileSync(new URL('../sql/006_pending_vice_captains.sql',import.meta.url),'utf8'));
 const saved=(await c.query("SELECT pg_get_functiondef('club.enforce_first_year_quota()'::regprocedure) AS definition")).rows[0].definition;
 if(!saved.includes('AND NOT NEW.is_vice_captain'))throw Error('Vice-captain migration verification failed');
 await c.query('COMMIT');console.log('Vice-captain database fix applied and verified; player records unchanged.');
}catch(e){await c.query('ROLLBACK');throw e}finally{c.release();await pool.end()}
