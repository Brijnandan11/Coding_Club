import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';
import argon2 from 'argon2';
import {captureSnapshot,restoreSnapshot} from '../src/sandbox-data.js';

const root=path.resolve(import.meta.dirname,'..'),directory=path.join(root,'.sandbox');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const source=dotenv.parse(fs.readFileSync(path.join(root,'.env')));
const connection=execFileSync('neon',['connection-string','sandbox','--project-id','quiet-cake-45017867','--database-name','codingclub_sandbox','--role-name','sandbox_owner','--ssl','verify-full'],{encoding:'utf8'}).trim();
const sourceUrl=new URL(source.DATABASE_URL),targetUrl=new URL(connection);
if(!sourceUrl.hostname.endsWith('.supabase.com')&&!sourceUrl.hostname.endsWith('.supabase.co'))throw Error('Unexpected source');
if(!targetUrl.hostname.endsWith('.neon.tech')||targetUrl.pathname!=='/codingclub_sandbox'||targetUrl.hostname===sourceUrl.hostname)throw Error('Unsafe sandbox target');
const pgEnv=url=>({...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:url.pathname.slice(1),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:'verify-full',PGSSLROOTCERT:url===sourceUrl?path.join(root,'certs/supabase-ca.crt'):'system'});
const sourcePool=new pg.Pool({connectionString:source.DATABASE_URL,ssl:{rejectUnauthorized:true,ca:fs.readFileSync(path.join(root,'certs/supabase-ca.crt'),'utf8')},max:2,connectionTimeoutMillis:15000,query_timeout:30000});
const target=new pg.Pool({connectionString:connection,max:3,connectionTimeoutMillis:15000,query_timeout:30000});
try{
 console.log('Connecting to the independent test database');
 const schemaPresent=(await target.query("SELECT to_regnamespace('club') IS NOT NULL AS present")).rows[0].present;
 const hasControl=(await target.query("SELECT to_regclass('sandbox_control.environment') IS NOT NULL AS present")).rows[0].present;
 const previous=hasControl?(await target.query('SELECT * FROM sandbox_control.environment WHERE singleton=true')).rows[0]:null;
 if(schemaPresent&&!previous&&Number((await target.query('SELECT count(*) n FROM club.users')).rows[0].n)>0)throw Error('Target data is not a recognized test copy');
 if(previous&&process.argv[2]!=='--resume-files')throw Error('Test copy already exists; use --resume-files only to resume its initial file transfer');
 const schemaFile=path.join(directory,'schema.sql');
 if(!schemaPresent){execFileSync('pg_dump',['--schema=club','--schema-only','--no-owner','--no-privileges','--file',schemaFile],{env:pgEnv(sourceUrl),stdio:['ignore','ignore','pipe']});fs.chmodSync(schemaFile,0o600);
 execFileSync('psql',['-X','--set','ON_ERROR_STOP=1','--file',schemaFile],{env:pgEnv(targetUrl),stdio:['ignore','ignore','pipe']});}
 console.log('Reading file inventory from production in read-only mode');
 const reader=await sourcePool.connect();let snapshot,objects;
 try{
  await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  snapshot=previous?previous.baseline:await captureSnapshot(reader);
  objects=(await reader.query("SELECT bucket_id,name,metadata FROM storage.objects WHERE bucket_id IN ('coding-club-media','private-payment-evidence') ORDER BY bucket_id,name")).rows;
  await reader.query('COMMIT');
 }finally{reader.release()}
 console.log('Saving test-only access configuration');
 const saved=fs.existsSync(path.join(directory,'environment.json'))?JSON.parse(fs.readFileSync(path.join(directory,'environment.json'),'utf8')):null;
 const accessCode=saved?.accessCode||crypto.randomBytes(12).toString('base64url'),sandboxId=previous?.id||crypto.randomUUID(),hash=await argon2.hash(accessCode);
 for(const table of snapshot.tables){
  if(['leader_sessions','password_reset_tokens','webhook_events'].includes(table.name)){table.rows=[];continue}
  for(const row of table.rows){
   if(table.name==='users'){row.password_hash=hash;row.token_version=(row.token_version||0)+(previous?0:1)}
   if(table.name==='event_leaders')row.credential_hash=hash;
   if(table.name==='notification_outbox'&&row.kind==='password_reset')row.payload={sandbox_notice:'Original reset link removed'};
  }
 }
 const replaceUrls=value=>typeof value==='string'?value.replaceAll(source.SUPABASE_URL+'/storage/v1','https://sandbox-storage.supabase.co/storage/v1'):Array.isArray(value)?value.map(replaceUrls):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replaceUrls(v)])):value;
 snapshot=replaceUrls(JSON.parse(JSON.stringify(snapshot)));
 await target.query(`CREATE SCHEMA IF NOT EXISTS sandbox_control;
 CREATE TABLE IF NOT EXISTS sandbox_control.environment(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),id uuid NOT NULL,snapshot_at timestamptz NOT NULL,baseline jsonb NOT NULL);
 CREATE TABLE IF NOT EXISTS sandbox_control.files(bucket text NOT NULL,path text NOT NULL,content_type text NOT NULL,bytes bytea NOT NULL,baseline boolean NOT NULL DEFAULT false,PRIMARY KEY(bucket,path));
 CREATE TABLE IF NOT EXISTS sandbox_control.baseline_files(LIKE sandbox_control.files INCLUDING ALL);`);
 const c=await target.connect();try{await c.query('BEGIN');if(!previous)await restoreSnapshot(c,snapshot);else{await c.query('UPDATE club.users SET password_hash=$1',[hash]);await c.query('UPDATE club.event_leaders SET credential_hash=$1',[hash]);}await c.query('INSERT INTO sandbox_control.environment(id,snapshot_at,baseline) VALUES($1,$2,$3::jsonb) ON CONFLICT(singleton) DO UPDATE SET baseline=EXCLUDED.baseline',[sandboxId,snapshot.at,JSON.stringify(snapshot)]);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 const settings={databaseUrl:connection,sandboxId,accessCode,jwtSecret:saved?.jwtSecret||crypto.randomBytes(48).toString('base64url'),projectId:'quiet-cake-45017867',snapshotAt:snapshot.at};
 fs.writeFileSync(path.join(directory,'environment.json'),JSON.stringify(settings,null,2),{mode:0o600});
 const present=new Set((await target.query('SELECT bucket,path FROM sandbox_control.files')).rows.map(r=>r.bucket+'/'+r.path));
 const totalFiles=objects.length;let copied=present.size;objects=objects.filter(o=>!present.has(o.bucket_id+'/'+o.name));console.log('Database ready; '+copied+' files already copied, '+objects.length+' remaining');
 for(let offset=0;offset<objects.length;offset+=5){await Promise.all(objects.slice(offset,offset+5).map(async object=>{
  const url=source.SUPABASE_URL+'/storage/v1/object/'+object.bucket_id+'/'+object.name.split('/').map(encodeURIComponent).join('/');
  for(let attempt=0;;attempt++){
   try{
    const response=await fetch(url,{headers:{apikey:source.SUPABASE_SECRET_KEY,Authorization:'Bearer '+source.SUPABASE_SECRET_KEY},signal:AbortSignal.timeout(90000)});
    if(!response.ok)throw Error('Could not copy file: HTTP '+response.status);
    await target.query('INSERT INTO sandbox_control.files(bucket,path,content_type,bytes,baseline) VALUES($1,$2,$3,$4,true) ON CONFLICT(bucket,path) DO NOTHING',[object.bucket_id,object.name,response.headers.get('content-type')||'application/octet-stream',Buffer.from(await response.arrayBuffer())]);copied++;break;
   }catch(error){if(attempt>=3)throw error;console.log('Retrying a file transfer');}
  }
 }));if(offset%25===0)console.log('Copied '+copied+'/'+totalFiles+' files')}
 await target.query('TRUNCATE sandbox_control.baseline_files');await target.query('INSERT INTO sandbox_control.baseline_files SELECT * FROM sandbox_control.files');
 fs.writeFileSync(path.join(directory,'source-counts.json'),JSON.stringify(snapshot.tables.map(t=>({table:t.name,count:t.rows.length})),null,2),{mode:0o600});
 console.log(JSON.stringify({copied_tables:snapshot.tables.length,copied_files:copied,snapshot_at:snapshot.at,users:snapshot.tables.find(t=>t.name==='users').rows.length,registrations:snapshot.tables.find(t=>t.name==='registrations').rows.length,credentials_saved:'.sandbox/environment.json'}));
}catch(error){console.error('Sandbox copy failed:',error.message||error.code||String(error));process.exitCode=1}finally{await sourcePool.end();await target.end()}
