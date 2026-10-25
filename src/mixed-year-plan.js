import {randomInt} from 'node:crypto';
const shuffled=values=>{const out=[...values];for(let i=out.length-1;i>0;i--){const j=randomInt(i+1);[out[i],out[j]]=[out[j],out[i]]}return out};

// Find a randomized integer matrix: team totals and year totals must both match.
// Existing students (including captains) are lower bounds, never extra seats.
export function mixedYearPlan(totals,slots){
 const years=Object.keys(totals),n=slots.length,total=Object.values(totals).reduce((a,b)=>a+b,0);
 if(!n||slots.reduce((a,s)=>a+s.team_capacity,0)!==total)throw Error('Team capacities must equal the confirmed player count');
 if(slots.reduce((a,s)=>a+s.first_year_quota,0)!==(totals[1]||0))throw Error('Saved first-year quotas do not match registrations');
 const minimum=(s,y)=>{
  if(y==='0')return 0;
  const captains=slots.filter(t=>Number(t.leader_year)===Number(y)).length;
  // Reserve an actual teammate of each known year as well as the captain,
  // whenever the registered pool can supply one to every team.
  if(totals[y]-captains>=n)return 1+(Number(s.leader_year)===Number(y)?1:0);
  return totals[y]>=n?1:0;
 };
 for(let relaxation=0;relaxation<=Math.max(...slots.map(s=>s.team_capacity));relaxation++){
  const lower=slots.map(s=>Object.fromEntries(years.map(y=>[y,y==='1'?s.first_year_quota:Math.max(s.counts?.[y]||0,minimum(s,y),Math.floor(totals[y]/n)-relaxation)])));
  if(slots.some((s,i)=>(s.counts?.[1]||0)>lower[i][1]||Object.values(lower[i]).reduce((a,b)=>a+b,0)>s.team_capacity))continue;
  const remaining=Object.fromEntries(years.map(y=>[y,totals[y]-lower.reduce((sum,row)=>sum+row[y],0)]));if(Object.values(remaining).some(v=>v<0))continue;
  const source=0,sink=years.length+n+1,graph=Array.from({length:sink+1},()=>[]),edges=[];
  const add=(a,b,capacity)=>{const edge={to:b,capacity,reverse:graph[b].length};graph[a].push(edge);graph[b].push({to:a,capacity:0,reverse:graph[a].length-1});return edge};
  for(const j of shuffled(years.map((_,i)=>i))){const year=years[j];add(source,1+j,remaining[year]);for(const i of shuffled(slots.map((_,i)=>i))){const max=year==='1'?lower[i][year]:Math.max(slots[i].counts?.[year]||0,Math.ceil(totals[year]/n)+relaxation);const capacity=Math.max(0,max-lower[i][year]);edges.push({i,year,capacity,edge:add(1+j,1+years.length+i,capacity)})}}
  for(let i=0;i<n;i++)add(1+years.length+i,sink,slots[i].team_capacity-Object.values(lower[i]).reduce((a,b)=>a+b,0));
  let flow=0;
  for(;;){const previous=Array(sink+1).fill(null),queue=[source];previous[source]=true;for(let q=0;q<queue.length&&!previous[sink];q++){const from=queue[q];for(let k=0;k<graph[from].length;k++){const edge=graph[from][k];if(edge.capacity>0&&!previous[edge.to]){previous[edge.to]={from,k};queue.push(edge.to)}}}if(!previous[sink])break;let amount=Infinity;for(let v=sink;v!==source;v=previous[v].from){const {from,k}=previous[v];amount=Math.min(amount,graph[from][k].capacity)}for(let v=sink;v!==source;v=previous[v].from){const {from,k}=previous[v],edge=graph[from][k];edge.capacity-=amount;graph[v][edge.reverse].capacity+=amount}flow+=amount}
  if(flow!==Object.values(remaining).reduce((a,b)=>a+b,0))continue;
  for(const {i,year,capacity,edge} of edges)lower[i][year]+=capacity-edge.capacity;
  return slots.map((s,i)=>({...s,year_quotas:lower[i]}));
 }
 throw Error('Existing allocations cannot fit the mixed-year plan. Reset the test copy before preparing teams again.');
}

export function chooseDrawYear(quotas,counts){
 const remaining=Object.keys(quotas).filter(y=>quotas[y]>(counts[y]||0));
 const unseen=remaining.filter(y=>y!=='0'&&!(counts[y]||0));
 const choices=unseen.length?unseen:remaining;
 if(!choices.length)return null;
 const total=choices.reduce((n,y)=>n+quotas[y]-(counts[y]||0),0);let draw=randomInt(total);
 for(const year of choices){draw-=quotas[year]-(counts[year]||0);if(draw<0)return Number(year)}
}
