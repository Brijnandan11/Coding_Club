import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createLeaderLoginLimit} from '../src/leader-login-limit.js';

test('leader sign-ins on shared IPs have separate failed-attempt limits and do not count successes',async()=>{
 const app=express();app.use(express.json());app.post('/login',createLeaderLoginLimit(),(req,res)=>res.status(req.body.password==='correct'?200:401).json({ok:req.body.password==='correct'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const login=(code,password)=>fetch('http://127.0.0.1:'+server.address().port+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({leader_id:code,password})});
 try{
  for(let i=0;i<15;i++)assert.equal((await login('LEADER-A','correct')).status,200);
  for(let i=0;i<10;i++)assert.equal((await login('LEADER-A','wrong')).status,401);
  const blocked=await login('leader-a','wrong');assert.equal(blocked.status,429);assert.match((await blocked.json()).error,/failed sign-in attempts/);assert.ok(Number(blocked.headers.get('Retry-After'))>0);
  for(let i=0;i<15;i++)assert.equal((await login('LEADER-B','correct')).status,200);
  assert.equal((await login('LEADER-B','wrong')).status,401);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
