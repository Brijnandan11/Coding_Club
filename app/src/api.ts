declare const __API_BASE__: string;
import {backendFetch} from './backend-fetch';
export const API_BASE = typeof __API_BASE__ === 'string' ? __API_BASE__.replace(/\/$/, '') : '/api';
export class ApiError extends Error { constructor(public status:number,message:string){super(message)} }
export const session = {
 get(kind='user'){try{return sessionStorage.getItem('cc-'+kind+'-token')||''}catch{return ''}},
 set(token:string,kind='user'){sessionStorage.setItem('cc-'+kind+'-token',token)},
 clear(kind='user'){try{sessionStorage.removeItem('cc-'+kind+'-token')}catch{}},
};
export async function request(path:string,{method='GET',body,kind='user',signal,raw=false}:any={}){
 const token=session.get(kind),headers:Record<string,string>={};
 if(token)headers.Authorization='Bearer '+token;
 if(body!==undefined&&!(body instanceof FormData))headers['Content-Type']='application/json';
 let response:Response;
 try{response=await backendFetch(API_BASE+path,{method,headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal})}catch(e:any){if(e.name==='AbortError')throw e;throw new ApiError(0,'Connection is taking longer than expected. Please retry in a moment.')}
 const text=await response.text();let data:any;try{data=JSON.parse(text)}catch{data=null}
 if(!response.ok){if(response.status===401){session.clear(kind);if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('cc:session-expired',{detail:kind}))}throw new ApiError(response.status,data?.details?.length?data.details.map((d:any)=>`${d.path}: ${d.message}`).join('; '):data?.error||(response.status===429?'Too many requests. Please wait '+(Math.max(1,Math.ceil(Number(response.headers.get('Retry-After'))||60)))+' seconds before trying again.':`Request failed (${response.status}).`))}
 if(raw)return text;
 if(data===null)throw new ApiError(502,'The API returned an invalid response. Check the API URL.');
 return data;
}
export const get=(p:string,options:any={})=>request(p,options);
export const post=(p:string,body?:any,kind='user')=>request(p,{method:'POST',body,kind});
export const patch=(p:string,body:any)=>request(p,{method:'PATCH',body});
export const remove=(p:string)=>request(p,{method:'DELETE'});
export function queryString(values:Record<string,any>){const q=new URLSearchParams();for(const [k,v] of Object.entries(values))if(v!==''&&v!==undefined&&v!==null)q.set(k,String(v));return q.size?'?'+q:''}
export async function allPages(path:string,filters:Record<string,any>={}){const out:any[]=[];for(let offset=0;;offset+=100){const rows=await get(path+queryString({...filters,limit:100,offset}));out.push(...rows);if(rows.length<100)return out}}
export const eventView=(e:any)=>({...e,name:e.title,date:String(e.event_date).slice(0,10),time:e.start_time?.slice(0,5),fee:e.registration_fee/100,teamSize:e.team_size,capacity:e.max_participants,deadline:e.registration_deadline,registrationOpen:!e.presentation?.registration_pending&&e.status==='OPEN'&&Date.now()>=new Date(e.registration_start).getTime(),backendStatus:e.status,status:e.status==='ARCHIVED'?'archived':String(e.presentation?.end_date||e.event_date).slice(0,10)<new Date().toLocaleDateString('en-CA')?'past':'upcoming',category:e.category||'Other',tone:e.tone||'lime',demo:false,objectives:e.objectives||[],rules:e.rules||[],guidelines:e.guidelines||[],schedule:e.schedule||[],faqs:e.faqs||[],photos:e.photos||[],winners:e.winners||[]});
export const profileView=(p:any,kind:string)=>({...p,kind,role:kind==='faculty'?p.role||p.designation:p.position,order:p.hierarchy_level||0,sourceUrl:p.source_url,sourceRetrieved:p.source_retrieved,placeholder:!!p.placeholder});
export const registrationView=(r:any)=>({...r,eventId:r.event_id,name:r.full_name||'',status:r.status.toLowerCase(),created:r.created_at,code:r.registration_code});
export async function uploadImage(kind:string,id:string,file:File,purpose=''){const body=new FormData();body.append('image',file);return post('/admin/images/'+kind+'/'+id+(purpose?'?purpose='+encodeURIComponent(purpose):''),body)}
