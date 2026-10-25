export const teamExportColumns=[
 ['Event','event_title'],['Team Number','team_number'],['Team Name','team_name'],['Role','role'],
 ['Name','full_name'],['Academic Year','academic_year'],['Mobile Number','phone'],['Email','email'],
 ['Roll Number','roll_number'],['Branch','branch'],['Department','department'],['College','college'],
 ['Registration Code','registration_code'],['Registration Status','registration_status'],
 ['Registration Date','registration_date'],['Team Joining Date','allocated_at'],
 ['Bio','bio'],['GitHub','github'],['LinkedIn','linkedin'],['Portfolio','portfolio'],['Missing Details','missing_details'],
];
const requiredDetails=['full_name','academic_year','phone','email','roll_number','branch','department','college','registration_code'];
function csvCell(value){
 let text=value==null?'':value instanceof Date?value.toISOString():String(value);
 if(/^[\s]*[=+@\-]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
export function teamRosterCsv(rows){
 return '\uFEFF'+[teamExportColumns.map(([label])=>csvCell(label)).join(','),...rows.map(row=>{
  const missing=teamExportColumns.filter(([,key])=>requiredDetails.includes(key)&&!String(row[key]??'').trim()).map(([label])=>label).join(', ');
  return teamExportColumns.map(([,key])=>csvCell(key==='missing_details'?missing:row[key])).join(',');
 })].join('\r\n')+'\r\n';
}
export async function exportTeamRoster(c){
 const {rows}=await c.query(`WITH roster AS (
  SELECT t.id team_id,t.name team_name,t.event_id,s.slot team_number,l.user_id,'Captain' role,0 role_order,t.created_at allocated_at
  FROM club.teams t JOIN club.event_leaders l ON l.id=t.leader_id LEFT JOIN club.team_allocation_slots s ON s.team_id=t.id
  UNION ALL
  SELECT t.id,t.name,t.event_id,s.slot,r.user_id,CASE WHEN m.is_vice_captain THEN 'Vice-captain' ELSE 'Member' END,CASE WHEN m.is_vice_captain THEN 1 ELSE 2 END,m.joined_at
  FROM club.team_members m JOIN club.teams t ON t.id=m.team_id JOIN club.registrations r ON r.id=m.registration_id LEFT JOIN club.team_allocation_slots s ON s.team_id=t.id
 ) SELECT e.title event_title,x.*,p.full_name,p.academic_year,p.phone,u.email,p.roll_number,p.branch,p.department,p.college,p.bio,p.github,p.linkedin,p.portfolio,r.registration_code,r.status registration_status,r.created_at registration_date
 FROM roster x JOIN club.events e ON e.id=x.event_id JOIN club.users u ON u.id=x.user_id LEFT JOIN club.participant_profiles p ON p.user_id=x.user_id LEFT JOIN club.registrations r ON r.user_id=x.user_id AND r.event_id=x.event_id
 ORDER BY e.event_date DESC,e.id,x.team_number NULLS LAST,x.team_name,x.role_order,p.full_name,x.user_id`);
 return teamRosterCsv(rows);
}
