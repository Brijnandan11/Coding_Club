import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const run=values=>spawnSync(process.execPath,['--input-type=module','-e','await import("./src/sandbox-app.js")'],{encoding:'utf8',env:{PATH:process.env.PATH,...values}});
test('sandbox entry point refuses to start in a production process',()=>{
 const result=run({});assert.notEqual(result.status,0);assert.match(result.stderr,/Sandbox entry point is disabled/);
});
test('sandbox entry point rejects the production database before connecting',()=>{
 const result=run({SANDBOX_MODE:'true',DATABASE_URL:'postgresql://test:unused@db.wfmzhrjdjbkuezsmewjk.supabase.co/postgres'});assert.notEqual(result.status,0);assert.match(result.stderr,/independent test database/);
});
test('sandbox entry point requires a separate identity and access code',()=>{
 const result=run({SANDBOX_MODE:'true',DATABASE_URL:'postgresql://test:unused@ep-test.neon.tech/codingclub_sandbox'});assert.notEqual(result.status,0);assert.match(result.stderr,/identity and access code required/);
});
