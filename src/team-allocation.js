import {fail} from './utils.js';
import {memberCapacity} from './team-capacity.js';
import {randomInt} from 'node:crypto';

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
 const {rows}=await c.query(`SELECT count(*)::int members,
  count(*) FILTER(WHERE p.academic_year=1)::int first_year_members
  FROM club.team_members m JOIN club.registrations r ON r.id=m.registration_id
  JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE m.team_id=$1`,[team.id]);
 const slot=(await c.query(`SELECT s.first_year_quota,p.academic_year AS leader_year
  FROM club.team_allocation_slots s JOIN club.teams t ON t.id=s.team_id
  JOIN club.event_leaders l ON l.id=t.leader_id
  JOIN club.participant_profiles p ON p.user_id=l.user_id WHERE s.team_id=$1`,[team.id])).rows[0];
 return {quota:slot?.first_year_quota??null,firstYears:rows[0].first_year_members+(slot?.leader_year===1?1:0),members:rows[0].members,teamSize:team.team_size};
}

export const eligibleParticipantsSql=`FROM club.registrations rg
 JOIN club.participant_profiles p ON p.user_id=rg.user_id
 JOIN club.users u ON u.id=rg.user_id
 WHERE rg.event_id=$1 AND rg.status='CONFIRMED' AND u.is_active=true
 AND NOT EXISTS(SELECT 1 FROM club.event_leaders l WHERE l.event_id=rg.event_id AND l.user_id=rg.user_id)
 AND NOT EXISTS(SELECT 1 FROM club.team_members m WHERE m.event_id=rg.event_id AND m.registration_id=rg.id)
 AND (CASE WHEN p.academic_year=1 THEN $2::boolean ELSE $3::boolean END)`;
