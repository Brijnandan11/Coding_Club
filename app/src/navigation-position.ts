export type NavigationPosition={top:number;section?:string;offset?:number};
const positions=new Map<string,NavigationPosition>();
const route=()=>location.hash||'#/';
export function initializeNavigationEntry(previous?:string){
 const state=history.state||{};
 if(state.clubEntry&&state.clubRoute===route())return;
 const inherited=state.clubRoute&&state.clubRoute!==route();
 history.replaceState({...state,clubEntry:crypto.randomUUID(),clubRoute:route(),clubPrevious:previous||null,clubScroll:inherited?null:state.clubScroll},'');
}
export function readNavigationPosition():NavigationPosition|null{
 const value=positions.get(history.state?.clubEntry)||history.state?.clubScroll;
 return value&&Number.isFinite(value.top)&&value.top>=0?value:null;
}
export function rememberNavigationPosition(){
 const top=Math.max(0,window.scrollY);let section:HTMLElement|undefined;
 document.querySelectorAll<HTMLElement>('[data-chapter][id]').forEach(element=>{if(element.getBoundingClientRect().top<=1)section=element});
 const position:NavigationPosition={top,...(section?{section:section.id.replace('section-',''),offset:-section.getBoundingClientRect().top}:{})};
 if(history.state?.clubEntry)positions.set(history.state.clubEntry,position);
 return position;
}
export function saveNavigationPosition(){
 const position=rememberNavigationPosition();
 history.replaceState({...history.state,clubScroll:position},'');
 return position;
}
export function goBack(fallback='/'){
 if(history.state?.clubPrevious)history.back();else location.hash=fallback;
}
