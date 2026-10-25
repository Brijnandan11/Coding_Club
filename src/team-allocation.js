import {fail} from './utils.js';
import {memberCapacity} from './team-capacity.js';
import {randomInt} from 'node:crypto';
import {mixedYearPlan} from './mixed-year-plan.js';

export function balancedQuotas(participants,teams){
 if(!Number.isSafeInteger(participants)||participants<0||!Number.isSafeInteger(teams)||teams<1)throw Error('Invalid allocation totals');
 const quotas=Array.from({length:teams},(_,i)=>Math.floor(participants/teams)+(i<participants%teams?1:0));
 for(let i=quotas.length-1;i>0;i--){const j=randomInt(i+1);[quotas[i],quotas[j]]=[quotas[j],quotas[i]]}
 return quotas;
}

// The saved quota includes a first-year leader, when applicable.
export function allocationEligibility({quota,firstYears,members,teamSize}){
 const slots=memberCapacity(teamSize)-members;
 const needed=quota===null?0:quota-firstYears;
 if(slots<=0)fail(409,'Team full');
 if(needed<0||needed>slots)fail(409,'Team does not satisfy its first-year quota. Contact the organizer.');
 return {allowFirstYear:quota===null||needed>0,allowOther:quota===null||slots>needed};
}

export async function allocationState(c,team){
 const {rows}=await c.query(`SELECT count(*)::int members,jsonb_agg(COALESCE(p.academic_year,0)) AS years,
  count(*) FILTER(WHERE p.academic_year=1)::int first_year_members
  FROM club.team_members m JOIN club.registrations r ON r.id=m.registration_id
  JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE m.team_id=$1`,[team.id]);
 const slot=(await c.query(`SELECT s.first_year_quota,s.team_capacity,s.year_quotas,p.academic_year AS leader_year
  FROM club.team_allocation_slots s JOIN club.teams t ON t.id=s.team_id
  JOIN club.event_leaders l ON l.id=t.leader_id
  JOIN club.participant_profiles p ON p.user_id=l.user_id WHERE s.team_id=$1`,[team.id])).rows[0];
 const yearCounts={};for(const year of rows[0].years||[])yearCounts[year]=(yearCounts[year]||0)+1;
 if(slot)yearCounts[slot.leader_year??0]=(yearCounts[slot.leader_year??0]||0)+1;
 return {quota:slot?.first_year_quota??null,firstYears:rows[0].first_year_members+(slot?.leader_year===1?1:0),members:rows[0].members,teamSize:slot?.team_capacity??team.team_size,yearQuotas:slot?.year_quotas??null,yearCounts,allocationReady:!slot?.team_capacity||!!slot.year_quotas};
}

export function mixedEligibility(state){
 if(state.allocationReady===false)fail(409,'Allocation opens after all planned teams have active, confirmed captains');
 const eligibility=allocationEligibility(state);
 if(!state.yearQuotas)return {...eligibility,allowedYears:null};
 const allowedYears=Object.keys(state.yearQuotas).filter(y=>state.yearQuotas[y]>(state.yearCounts[y]||0)).map(Number);
 if(!allowedYears.length)fail(409,'Team full');
 return {...eligibility,allowedYears};
}

export async function configureMixedYearPlan(c,eventId){
 const slots=(await c.query('SELECT s.slot,s.first_year_quota,s.team_capacity,s.team_id,p.academic_year AS leader_year FROM club.team_allocation_slots s LEFT JOIN club.teams t ON t.id=s.team_id LEFT JOIN club.event_leaders l ON l.id=t.leader_id LEFT JOIN club.participant_profiles p ON p.user_id=l.user_id WHERE s.event_id=$1 ORDER BY s.slot FOR UPDATE OF s',[eventId])).rows;
 if(!slots.length||slots.some(s=>!s.team_id||!s.team_capacity))fail(409,'Create all planned teams before configuring mixed-year allocation');
 const totals=Object.fromEntries((await c.query(`SELECT COALESCE(p.academic_year,0) AS year,count(*)::int n FROM club.registrations r JOIN club.participant_profiles p ON p.user_id=r.user_id JOIN club.users u ON u.id=r.user_id WHERE r.event_id=$1 AND r.status='CONFIRMED' AND u.is_active=true GROUP BY COALESCE(p.academic_year,0)`,[eventId])).rows.map(r=>[r.year,r.n]));
 const counts=(await c.query(`SELECT team_id,year,count(*)::int n FROM (
  SELECT m.team_id,COALESCE(p.academic_year,0) AS year FROM club.team_members m JOIN club.registrations r ON r.id=m.registration_id JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE m.event_id=$1
  UNION ALL SELECT t.id,COALESCE(p.academic_year,0) FROM club.teams t JOIN club.event_leaders l ON l.id=t.leader_id JOIN club.participant_profiles p ON p.user_id=l.user_id WHERE t.event_id=$1
 ) players GROUP BY team_id,year`,[eventId])).rows;
 const invalid=(await c.query(`SELECT t.id FROM club.teams t JOIN club.event_leaders l ON l.id=t.leader_id JOIN club.users u ON u.id=l.user_id WHERE t.event_id=$1 AND (NOT l.is_active OR NOT u.is_active OR NOT EXISTS(SELECT 1 FROM club.registrations r WHERE r.event_id=t.event_id AND r.user_id=l.user_id AND r.status='CONFIRMED'))`,[eventId])).rowCount;
 if(invalid)fail(409,'All teams need active captains with confirmed event registrations before allocation');
 let plan;try{plan=mixedYearPlan(totals,slots.map(s=>({...s,counts:Object.fromEntries(counts.filter(r=>r.team_id===s.team_id).map(r=>[r.year,r.n]))})))}catch(e){fail(409,e.message)}
 for(const row of plan)await c.query('UPDATE club.team_allocation_slots SET year_quotas=$1::jsonb WHERE event_id=$2 AND slot=$3',[JSON.stringify(row.year_quotas),eventId,row.slot]);
 return plan;
}

// Finalize once the real captains are selected. Existing completed plans are read-only here.
export async function ensureMixedYearPlan(c,eventId){
 const status=async()=>(await c.query('SELECT count(*)::int planned,count(*) FILTER(WHERE team_id IS NULL)::int missing,count(*) FILTER(WHERE year_quotas IS NULL)::int pending FROM club.team_allocation_slots WHERE event_id=$1 AND team_capacity IS NOT NULL',[eventId])).rows[0];
 let state=await status();if(!state.planned||!state.pending)return true;if(state.missing)return false;
 await c.query('SELECT id FROM club.events WHERE id=$1 FOR UPDATE',[eventId]);
 state=await status();if(!state.pending)return true;if(state.missing)return false;
 const invalid=(await c.query(`SELECT t.id FROM club.teams t JOIN club.event_leaders l ON l.id=t.leader_id JOIN club.users u ON u.id=l.user_id WHERE t.event_id=$1 AND (NOT l.is_active OR NOT u.is_active OR NOT EXISTS(SELECT 1 FROM club.registrations r WHERE r.event_id=t.event_id AND r.user_id=l.user_id AND r.status='CONFIRMED'))`,[eventId])).rowCount;
 if(invalid)return false;await configureMixedYearPlan(c,eventId);return true;
}

export const eligibleParticipantsSql=`FROM club.registrations rg
 JOIN club.participant_profiles p ON p.user_id=rg.user_id
 JOIN club.users u ON u.id=rg.user_id
 WHERE rg.event_id=$1 AND rg.status='CONFIRMED' AND u.is_active=true
 AND NOT EXISTS(SELECT 1 FROM club.teams t JOIN club.event_leaders l ON l.id=t.leader_id WHERE t.event_id=rg.event_id AND l.user_id=rg.user_id)
 AND NOT EXISTS(SELECT 1 FROM club.team_members m WHERE m.event_id=rg.event_id AND m.registration_id=rg.id)
 AND (CASE WHEN p.academic_year=1 THEN $2::boolean ELSE $3::boolean END)
 AND ($4::int[] IS NULL OR COALESCE(p.academic_year,0)=ANY($4::int[]))`;
