import {Router} from 'express';
import {z} from 'zod';
import {auth,role,handler,validate,fail,audit} from './utils.js';
import {query,tx} from './db.js';
import {deliverNotifications} from './notifications.js';
import {memberCapacity} from './team-capacity.js';
const r=Router(), uuid=z.string().uuid(), admin=[auth,role('ADMIN')];
r.post('/internal/notifications/process',handler(async(req,res)=>{
 const supplied=req.headers['x-worker-secret'];
 if(!process.env.WORKER_SECRET||typeof supplied!=='string'||supplied!==process.env.WORKER_SECRET)fail(401,'Unauthorized');
 res.json(await deliverNotifications(20));
}));
r.get('/admin/notifications',...admin,handler(async(req,res)=>{const data=await query('SELECT id,kind,recipient,subject,status,attempts,created_at,sent_at,last_error FROM club.notification_outbox ORDER BY created_at DESC LIMIT 100');res.json(data.rows);}));
r.post('/admin/notifications/:id/retry',...admin,handler(async(req,res)=>{const q=await query("UPDATE club.notification_outbox SET status='PENDING',next_attempt_at=now() WHERE id=$1 AND status='FAILED' RETURNING id",[req.params.id]);if(!q.rowCount)fail(404,'Failed notification not found');res.json(q.rows[0]);}));
r.post('/admin/teams/:id/move',...admin,validate(z.object({registration_id:uuid,destination_team_id:uuid}).strict()),handler(async(req,res)=>{
 const {registration_id,destination_team_id}=req.body;if(req.params.id===destination_team_id)fail(400,'Same team');
 const result=await tx(async c=>{
  const teams=(await c.query('SELECT t.*,COALESCE(s.team_capacity,e.team_size) AS team_size FROM club.teams t JOIN club.events e ON e.id=t.event_id LEFT JOIN club.team_allocation_slots s ON s.team_id=t.id WHERE t.id=ANY($1::uuid[]) ORDER BY t.id FOR UPDATE OF t',[[req.params.id,destination_team_id]])).rows;
  if(teams.length!==2)fail(404,'Team not found');const origin=teams.find(t=>t.id===req.params.id),dest=teams.find(t=>t.id===destination_team_id);
  if(origin.event_id!==dest.event_id)fail(409,'Teams must belong to same event');if(dest.locked)fail(409,'Destination locked');
  const count=await c.query('SELECT count(*)::int AS n FROM club.team_members WHERE team_id=$1',[dest.id]);if(count.rows[0].n>=memberCapacity(dest.team_size))fail(409,'Destination full');
  const moved=await c.query('UPDATE club.team_members SET team_id=$1 WHERE team_id=$2 AND registration_id=$3 RETURNING *',[dest.id,origin.id,registration_id]);if(!moved.rowCount)fail(404,'Team member not found');
  await audit(c,req.user.id,'ADMIN_MOVED_TEAM_MEMBER',dest.id,{from:origin.id,registration_id});return moved.rows[0];
 });res.json(result);
}));
export default r;
