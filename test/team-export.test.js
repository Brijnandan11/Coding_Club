import test from 'node:test';import assert from 'node:assert/strict';
import {teamRosterCsv,exportTeamRoster} from '../src/team-export.js';
test('roster CSV escapes commas, quotes, newlines, formulas and includes missing details',()=>{
 const text=teamRosterCsv([{team_name:'Code, "Gun"',role:'Captain',full_name:'Student\nName',phone:'+919876543210',academic_year:2,email:'=bad()',roll_number:'R1',branch:'IT',department:'IT',college:'College',registration_code:'CC-1',registration_date:new Date('2026-10-25T00:00:00Z')},{role:'Vice-captain',full_name:'Second',email:'second@example.invalid'},{role:'Member',full_name:'Third'}]);
 assert.ok(text.startsWith('\uFEFF"Event"'));assert.ok(text.includes('"Code, ""Gun"""'));assert.ok(text.includes('"Student\nName"'));assert.ok(text.includes('"\'+919876543210"'));assert.ok(text.includes('"\'=bad()"'));assert.ok(text.includes('"2026-10-25T00:00:00.000Z"'));assert.ok(text.includes('"Academic Year, Mobile Number, Roll Number, Branch, Department, College, Registration Code"'));assert.ok(text.includes('"Vice-captain"'));assert.ok(text.includes('"Member"'));
});
test('team export returns headers for an empty roster and never serializes credentials',async()=>{
 const csv=await exportTeamRoster({query:async()=>({rows:[{role:'Captain',full_name:'Student',password_hash:'SECRET',credential_hash:'SECRET',token_hash:'SECRET'}]})});assert.ok(!csv.includes('SECRET'));assert.ok(teamRosterCsv([]).includes('"Missing Details"'));
});
