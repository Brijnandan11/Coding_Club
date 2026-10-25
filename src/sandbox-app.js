import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {rateLimit} from 'express-rate-limit';
import {restoreSnapshot} from './sandbox-data.js';

// This is a separate entry point. Production imports src/app.js directly.
if(process.env.SANDBOX_MODE!=='true')throw Error('Sandbox entry point is disabled');
const db=new URL(process.env.DATABASE_URL||'');
if(!db.hostname.endsWith('.neon.tech')||db.pathname!=='/codingclub_sandbox')throw Error('Sandbox requires its independent test database');
if(!process.env.SANDBOX_ID||!process.env.SANDBOX_ACCESS_CODE||process.env.SANDBOX_ACCESS_CODE.length<16)throw Error('Sandbox identity and access code required');
if((process.env.JWT_SECRET||'').length<32)throw Error('Separate sandbox signing secret required');
process.env.DOTENV_CONFIG_PATH='/dev/null';
for(const key of ['RESEND_API_KEY','MAIL_FROM','MAIL_REPLY_TO'])delete process.env[key];
process.env.SUPABASE_URL='https://sandbox-storage.supabase.co';
process.env.SUPABASE_SECRET_KEY='sandbox-only-no-production-access';
process.env.UPI_VPA='';
process.env.APP_URL='https://sandbox.invalid';
const {pool,query,tx}=await import('./db.js');
const {sign,handler,fail}=await import('./utils.js');
const identity=(await query('SELECT id FROM sandbox_control.environment WHERE singleton=true')).rows[0];
if(identity?.id!==process.env.SANDBOX_ID)throw Error('Sandbox database identity mismatch');

// The sandbox has no real email or storage credentials. All storage writes go here.
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
 if(url.hostname!=='sandbox-storage.supabase.co'){
  if(!['GET','HEAD'].includes(init.method||'GET'))throw Error('External writes are disabled in the sandbox');
  return originalFetch(input,init);
 }
 const parts=url.pathname.split('/').filter(Boolean),method=init.method||'GET';
 if(parts.slice(0,3).join('/')!=='storage/v1/object')return Response.json({error:'Unsupported sandbox storage request'},{status:400});
 if(parts[3]==='sign'&&method==='POST')return Response.json({signedURL:'/object/signed/'+parts.slice(4).join('/')});
 const bucket=decodeURIComponent(parts[3]),file=parts.slice(4).map(decodeURIComponent).join('/');
 if(method==='DELETE'){await query('DELETE FROM sandbox_control.files WHERE bucket=$1 AND path=$2',[bucket,file]);return Response.json({ok:true})}
 if(method==='POST'){
  const bytes=Buffer.isBuffer(init.body)?init.body:Buffer.from(await new Response(init.body).arrayBuffer());
  await query('INSERT INTO sandbox_control.files(bucket,path,content_type,bytes) VALUES($1,$2,$3,$4)',[bucket,file,new Headers(init.headers).get('content-type')||'application/octet-stream',bytes]);return Response.json({Key:bucket+'/'+file});
 }
 return Response.json({error:'Unsupported sandbox storage request'},{status:400});
};
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'128kb'}));
const safeEqual=(a,b)=>crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());
const signature=value=>crypto.createHmac('sha256',process.env.JWT_SECRET).update(value).digest('hex');
function hasAccess(req){const cookie=/(?:^|;\s*)cc-sandbox=([^;]+)/.exec(req.headers.cookie||'')?.[1];if(!cookie)return false;const [expires,digest]=cookie.split('.');return Number(expires)>Date.now()&&safeEqual(digest||'',signature(expires))}
app.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Robots-Tag','noindex, nofollow, noarchive');res.set('Referrer-Policy','same-origin');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({error:'Cross-origin test actions blocked'});next()});
app.post('/_sandbox/unlock',rateLimit({windowMs:15*60_000,limit:20,standardHeaders:'draft-7',legacyHeaders:false}), (req,res)=>{
 if(!safeEqual(String(req.body.code||''),process.env.SANDBOX_ACCESS_CODE))return res.status(401).json({error:'Incorrect test access code'});
 const expires=String(Date.now()+12*60*60_000);res.setHeader('Set-Cookie',`cc-sandbox=${expires}.${signature(expires)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${process.env.VERCEL?'; Secure':''}`);res.json({ok:true});
});
app.use((req,res,next)=>{
 if(hasAccess(req))return next();
 if(req.path.startsWith('/api/')||req.path.startsWith('/_sandbox/')&&!['_sandbox',''].includes(req.path.split('/').at(-1)))return res.status(401).json({error:'Unlock the isolated test copy first'});
 res.type('html').send(shell('Open your test copy',`<p>This is an independent copy of Coding Club. Enter your test access code to continue.</p><form id="unlock"><label>Test access code<input id="code" type="password" autocomplete="current-password" required></label><button>Open test copy</button></form><p id="message" role="alert"></p>`,`document.getElementById('unlock').onsubmit=async e=>{e.preventDefault();const r=await fetch('/_sandbox/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value})});if(r.ok)location.href='/_sandbox';else document.getElementById('message').textContent='Incorrect test access code.';};`));
});
app.get('/_sandbox/state',handler(async(_req,res)=>{
 const snapshot=(await query('SELECT snapshot_at FROM sandbox_control.environment')).rows[0];
 const events=(await query('SELECT e.id,e.title,e.slug,(SELECT count(*)::int FROM club.registrations r WHERE r.event_id=e.id) registrations FROM club.events e ORDER BY registrations DESC,e.title')).rows;
 const leaders=(await query('SELECT l.id,l.event_id,l.leader_code,l.is_active,p.full_name,t.name AS team_name FROM club.event_leaders l JOIN club.participant_profiles p ON p.user_id=l.user_id LEFT JOIN club.teams t ON t.leader_id=l.id ORDER BY p.full_name')).rows;
 const teams=(await query(`SELECT t.id,t.name,t.event_id,s.first_year_quota,count(m.registration_id)::int members,count(m.registration_id) FILTER(WHERE p.academic_year=1)::int first_years,max(p.full_name) FILTER(WHERE m.is_vice_captain) vice_captain FROM club.teams t LEFT JOIN club.team_allocation_slots s ON s.team_id=t.id LEFT JOIN club.team_members m ON m.team_id=t.id LEFT JOIN club.registrations r ON r.id=m.registration_id LEFT JOIN club.participant_profiles p ON p.user_id=r.user_id GROUP BY t.id,s.first_year_quota ORDER BY t.name`)).rows;
 res.json({snapshot_at:snapshot.snapshot_at,events,leaders,teams,counts:(await query('SELECT (SELECT count(*)::int FROM club.users) users,(SELECT count(*)::int FROM club.registrations) registrations,(SELECT count(*)::int FROM sandbox_control.files) files')).rows[0]});
}));
app.post('/_sandbox/login',handler(async(req,res)=>{
 if(req.body.kind==='admin'){
  const user=(await query("SELECT id,role,email,token_version FROM club.users WHERE role='ADMIN' AND is_active=true ORDER BY created_at LIMIT 1")).rows[0];if(!user)fail(404,'No copied admin account');return res.json({token:sign(user),kind:'user',destination:'/#/admin'});
 }
 const leader=(await query('SELECT l.id FROM club.event_leaders l JOIN club.users u ON u.id=l.user_id WHERE l.id=$1 AND l.is_active=true AND u.is_active=true',[req.body.leader_id])).rows[0];if(!leader)fail(404,'Leader unavailable');
 const token=crypto.randomBytes(32).toString('base64url');await query("INSERT INTO club.leader_sessions(leader_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[leader.id,crypto.createHash('sha256').update(token).digest('hex')]);res.json({token,kind:'leader',destination:'/#/leader'});
}));
app.post('/_sandbox/prepare-teams',handler(async(req,res)=>{
 const out=await tx(async c=>{
  const event=(await c.query('SELECT id FROM club.events WHERE id=$1 FOR UPDATE',[req.body.event_id])).rows[0];if(!event)fail(404,'Event not found');
  const slots=Number((await c.query('SELECT count(*)::int n FROM club.team_allocation_slots WHERE event_id=$1',[event.id])).rows[0].n);if(!slots)fail(409,'This event has no saved allocation plan');
  const current=Number((await c.query('SELECT count(*)::int n FROM club.teams WHERE event_id=$1',[event.id])).rows[0].n),needed=slots-current;
  const candidates=(await c.query(`SELECT r.user_id FROM club.registrations r JOIN club.participant_profiles p ON p.user_id=r.user_id JOIN club.users u ON u.id=r.user_id WHERE r.event_id=$1 AND r.status='CONFIRMED' AND u.is_active=true AND p.academic_year IS DISTINCT FROM 1 AND NOT EXISTS(SELECT 1 FROM club.event_leaders l WHERE l.event_id=r.event_id AND l.user_id=r.user_id) AND NOT EXISTS(SELECT 1 FROM club.team_members m WHERE m.registration_id=r.id) ORDER BY (p.academic_year=3) DESC,random() LIMIT $2`,[event.id,needed])).rows;
  if(candidates.length<needed)fail(409,'Not enough available confirmed students to create all teams');
  const hash=(await c.query("SELECT password_hash FROM club.users LIMIT 1")).rows[0].password_hash;
  for(let i=0;i<needed;i++){
   const leader=(await c.query('INSERT INTO club.event_leaders(event_id,user_id,leader_code,credential_hash) VALUES($1,$2,$3,$4) RETURNING id',[event.id,candidates[i].user_id,'TEST-'+crypto.randomBytes(5).toString('hex').toUpperCase(),hash])).rows[0];
   await c.query('INSERT INTO club.teams(event_id,leader_id,name) VALUES($1,$2,$3)',[event.id,leader.id,'Test Team '+String(current+i+1).padStart(2,'0')]);
  }
  return {created:needed,total:slots};
 });res.json(out);
}));
app.post('/_sandbox/reset',handler(async(_req,res)=>{
 await tx(async c=>{await c.query("SET LOCAL lock_timeout='15s'");await c.query("SELECT pg_advisory_xact_lock(hashtext('codingclub-sandbox-reset'))");const {baseline}=(await c.query('SELECT baseline FROM sandbox_control.environment WHERE id=$1',[process.env.SANDBOX_ID])).rows[0];await restoreSnapshot(c,baseline);await c.query('TRUNCATE sandbox_control.files');await c.query('INSERT INTO sandbox_control.files SELECT * FROM sandbox_control.baseline_files')});res.json({ok:true});
}));
app.get(/^\/_sandbox\/storage\/v1\/object\/(?:public|signed)\/([^/]+)\/(.+)$/,handler(async(req,res)=>{
 const file=(await query('SELECT content_type,bytes FROM sandbox_control.files WHERE bucket=$1 AND path=$2',[req.params[0],req.params[1]])).rows[0];if(!file)fail(404,'Test file not found');res.type(file.content_type).send(file.bytes);
}));
app.get(['/_sandbox','/_sandbox/'],(_req,res)=>res.type('html').send(dashboard()));
// Rewrite cloned storage references back to this protected, isolated copy.
app.use((req,res,next)=>{
 const json=res.json.bind(res);res.json=value=>json(JSON.parse(JSON.stringify(value).replaceAll('https://sandbox-storage.supabase.co/storage/v1','/_sandbox/storage/v1')));next();
});
const {default:productionApp}=await import('./app.js');
app.use('/api', (req,res,next)=>{req.url='/api'+req.url;productionApp(req,res,next)});
const assets=path.resolve(import.meta.dirname,'../app/dist');
app.get(['/', '/index.html'],(_req,res)=>{
 const banner='<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#d8ee9a;color:#101014;padding:10px 16px;font:600 13px Arial;text-align:center">TEST COPY · Changes stay in the test database · <a style="color:inherit;text-decoration:underline" href="/_sandbox">Test controls / switch leader</a></div><style>body{padding-top:38px!important}</style>';
 res.type('html').send(fs.readFileSync(path.join(assets,'index.html'),'utf8').replace('<body>','<body>'+banner).replace('<title>','<title>TEST COPY · '));
});
app.use(express.static(assets,{index:false}));
app.use((err,_req,res,_next)=>{console.error('Sandbox request failed:',err.message);res.status(err.status||500).json({error:err.status?err.message:'Test copy request failed. Please retry.'})});

function shell(title,content,script=''){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>TEST COPY · Coding Club</title><style>*{box-sizing:border-box}body{margin:0;background:#101014;color:#f4f0e7;font:16px/1.6 system-ui,sans-serif}main{max-width:1050px;margin:50px auto;padding:24px}h1{font-size:clamp(32px,5vw,54px);line-height:1.1}h2{font-size:24px}.tag{color:#d8ee9a;font-weight:700;letter-spacing:.15em;font-size:12px}p{color:#bdb8c8}label{display:block;margin:24px 0}input,select{display:block;width:100%;background:#19191f;color:inherit;border:1px solid #ffffff40;border-radius:6px;padding:14px;font:inherit;margin-top:8px}button,a.button{display:inline-block;background:#d8ee9a;color:#101014;border:0;padding:12px 18px;border-radius:6px;font:600 14px system-ui;cursor:pointer;text-decoration:none;margin:4px 8px 4px 0}button:disabled{opacity:.45;cursor:wait}.secondary{background:#c8b8ef}.danger{background:#ffb4a5}.box{border:1px solid #ffffff25;padding:24px;margin:24px 0;border-radius:10px;overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:12px;border-bottom:1px solid #ffffff20;white-space:nowrap}#message{color:#d8ee9a;min-height:25px}a{color:#d8ee9a}</style></head><body><main><div class="tag">CODING CLUB / ISOLATED TEST COPY</div><h1>${title}</h1>${content}</main><script>${script}</script></body></html>`}
function dashboard(){return shell('Try it. Reset it. Repeat.',`<p>Your copied users, registrations, payments, uploaded files and allocation rules live in a separate database. Real emails and real payment collection are disabled. All account and leader passwords in this copy use your test access code.</p><p id="summary">Loading test copy…</p><div class="box"><h2>Start testing</h2><a class="button" href="/">Open copied website</a><button id="admin" class="secondary">Open test admin</button><label>Event<select id="event"></select></label><button id="prepare">Prepare all 13 teams</button><p>This adds test leaders from copied confirmed students and creates the missing teams. The original copied team is kept.</p><label>Leader<select id="leader"></select></label><button id="login">Open selected leader portal</button><p>Choose a vice-captain, allocate random students, then return here to switch leaders and compare teams.</p></div><p id="message" role="status"></p><div class="box"><h2>Current test teams</h2><table><thead><tr><th>Team</th><th>Allocated members</th><th>First-years / quota</th><th>Vice-captain</th></tr></thead><tbody id="teams"></tbody></table><button id="refresh">Refresh team counts</button></div><div class="box"><h2>Start again</h2><p>Reset restores this test database and its files to the saved copy. It removes test changes and test sessions. It does not connect to production.</p><button id="reset" class="danger">Reset test copy</button></div>`,String.raw`
let state;const el=id=>document.getElementById(id);const text=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n};
async function api(path,body){const r=await fetch('/_sandbox/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d}
function render(){const id=el('event').value;el('leader').replaceChildren();for(const l of state.leaders.filter(l=>l.event_id===id&&l.is_active)){const option=new Option(l.full_name+' · '+(l.team_name||'No team')+' · '+l.leader_code,l.id);el('leader').add(option)}el('teams').replaceChildren();for(const team of state.teams.filter(t=>t.event_id===id)){const tr=document.createElement('tr');for(const value of [team.name,team.members,team.first_years+' / '+(team.first_year_quota??'—'),team.vice_captain||'Not selected'])tr.append(text('td',value));el('teams').append(tr)}el('login').disabled=!el('leader').value}
async function load(){state=await api('state');const selected=el('event').value;el('event').replaceChildren();for(const e of state.events)el('event').add(new Option(e.title+' · '+e.registrations+' registrations',e.id));if([...el('event').options].some(o=>o.value===selected))el('event').value=selected;el('summary').textContent=state.counts.users+' copied users · '+state.counts.registrations+' registrations · '+state.counts.files+' files · Snapshot '+new Date(state.snapshot_at).toLocaleString();render()}
async function action(fn){document.querySelectorAll('button').forEach(b=>b.disabled=true);el('message').textContent='Working on the test copy…';try{await fn()}catch(e){el('message').textContent=e.message}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);if(state)render()}}
async function login(body){const d=await api('login',body);sessionStorage.setItem('cc-'+d.kind+'-token',d.token);location.href=d.destination}
el('event').onchange=render;el('refresh').onclick=()=>action(async()=>{await load();el('message').textContent='Test team counts refreshed.'});el('admin').onclick=()=>action(()=>login({kind:'admin'}));el('login').onclick=()=>action(()=>login({kind:'leader',leader_id:el('leader').value}));el('prepare').onclick=()=>action(async()=>{const d=await api('prepare-teams',{event_id:el('event').value});await load();el('message').textContent=d.created+' missing teams created. '+d.total+' teams are ready to test.'});el('reset').onclick=()=>{if(confirm('Reset only this test copy to its saved snapshot? All test changes will be removed.'))action(async()=>{await api('reset',{});sessionStorage.removeItem('cc-user-token');sessionStorage.removeItem('cc-leader-token');await load();el('message').textContent='Test copy restored. Production was not contacted.'})};load().catch(e=>el('message').textContent=e.message);
`)}
export default app;
export {pool};
