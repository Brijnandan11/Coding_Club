import Recovery from './Recovery';
import {validateFormSubmission} from './form-validation';
import AccountProfile from './AccountProfile';
import EventRoute from './EventRoute';
import UPIPayment from './UPIPayment';
import {AuthProvider,AccountStatus} from './Auth';
import {allPages,get,eventView,profileView} from './api';
import {readPublicContent,savePublicContent,preloadPublicImages,PublicContent} from './public-cache';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {About,Contact,Events,People,Registrations} from './PublicPages';
import {Admin,LeaderPortal} from './Portals';
import {Label} from './ui';
import {initial,navItems,Store} from './model';
import {setupMotion} from './motion';
import './app.css';
import './dark.css';
import './vibe.css';
import './events.css';
import './typography.css';
import './event-contrast.css';
import './events-reference.css';
import './editorial-polish.css';
import './workspace.css';
import './footer-motion.css';
import './buttons.css';
import PageGuide from './PageGuide';
import {CustomCursor,ScrollHome,sectionTarget,scrollToChapter,cancelScrollNavigation,restoreNavigationPosition} from './Journey';
import {readNavigationPosition,saveNavigationPosition,rememberNavigationPosition,initializeNavigationEntry,goBack} from './navigation-position';
function Footer({store}:any){const s=store.settings;return <footer className="site-footer ink"><div className="footer-cta"><Label>GOOD IDEAS START WITH A CONVERSATION</Label><a href="#/contact-form">LET’S BUILD<br/>WHAT’S NEXT <span aria-hidden="true">↗</span></a></div><div className="footer-columns"><div><a className="footer-mark" href="#/"><img className="club-logo-mark" src="/assets/club-symbol.svg" alt="Coding Club" width="133" height="98"/></a><h3>{s.clubName}</h3><p>{s.college}<br/>{s.department}</p></div><div><Label>EXPLORE</Label>{navItems.map(([a,b])=><a key={b} href={'#'+b}>{a}</a>)}</div><div><Label>THE WORKSPACE</Label><a href="#/leader">Leader portal ↗</a><a href="#/registrations">My registrations ↗</a><a href="#/account">My account ↗</a><a href="#/admin">Admin workspace ↗</a>{s.github&&<a href={s.github} target="_blank" rel="noreferrer">GitHub ↗</a>}{s.linkedin&&<a href={s.linkedin} target="_blank" rel="noreferrer">LinkedIn ↗</a>}</div><div><Label>SAY HELLO</Label>{s.email?<a href={'mailto:'+s.email}>{s.email}</a>:<p>Have a question?<br/>Start a conversation.</p>}<a href="#/contact-form">Contact the club ↗</a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} {s.clubName}</span><span>CREATE. CODE. CONQUER.</span><span>CREATE. CODE. CONQUER.</span></div></footer>}
export default function App(){return <AuthProvider><ConnectedApp/></AuthProvider>}
function ConnectedApp(){
 const [cached]=useState(()=>readPublicContent());
 const publicContent=useRef<PublicContent>(cached);
 const [store,setStore]=useState<Store>(()=>({...structuredClone(initial),events:(cached.events||[]).map(eventView),profiles:[...(cached.faculty||[]).map(p=>profileView(p,'faculty')),...(cached.team||[]).map(p=>profileView(p,'student'))],settings:{...initial.settings,...cached.settings},registrations:[],leaders:[],teams:[],messages:[]}));
 const storeRef=useRef(store);
 const [loadError,setLoadError]=useState('');
 async function reload(){
  setLoadError('');
  const results=await Promise.allSettled((['events','faculty','team','settings'] as const).map(async group=>{
   const data=group==='events'?await allPages('/events'):await get('/'+group);
   publicContent.current={...publicContent.current,[group]:data};
   savePublicContent(publicContent.current);
   const next={...storeRef.current};
   if(group==='events')next.events=data.map(eventView);
   else if(group==='settings')next.settings={...initial.settings,...data};
   else next.profiles=[...next.profiles.filter(p=>p.kind!==(group==='faculty'?'faculty':'student')),...data.map((p:any)=>profileView(p,group==='faculty'?'faculty':'student'))];
   storeRef.current=next;setStore(next);
   if(group!=='settings')preloadPublicImages({[group]:data});
  }));
  if(results.every(r=>r.status==='rejected')&&!Object.keys(publicContent.current).length)setLoadError('Club information is temporarily unavailable. Please try again.');
 }
 useEffect(()=>{preloadPublicImages(cached);void reload()},[]);
 const [path,setPath]=useState(()=>{const raw=location.hash.slice(1)||'/';return sectionTarget(raw)?'/':raw});const [notification,setNotification]=useState('');const timer=useRef<any>(null);const appRef=useRef<HTMLDivElement>(null);function toast(message:string){setNotification(message);clearTimeout(timer.current);timer.current=setTimeout(()=>setNotification(''),4500)}function navigate(url:string){const section=sectionTarget(url);if(section&&path==='/'){if(location.hash==='#/section/'+section)scrollToChapter(section);else location.hash='/section/'+section;return}if(location.hash==='#'+url){window.scrollTo({top:0,behavior:'smooth'});return}location.hash=section?'/section/'+section:url}
const pendingRestore=useRef<()=>void>(()=>{}),[navigationVersion,setNavigationVersion]=useState(0);
useLayoutEffect(()=>{pendingRestore.current()},[navigationVersion]);
useEffect(()=>{
 const previousRestoration=history.scrollRestoration;history.scrollRestoration='manual';initializeNavigationEntry();
 let currentHash=location.hash,frame=0;
 const save=()=>{if(currentHash===location.hash)saveNavigationPosition()};
 const onScroll=()=>{if(currentHash!==location.hash)return;rememberNavigationPosition();clearTimeout(frame);frame=window.setTimeout(save,150)};
 const onLink=(event:MouseEvent)=>{const link=(event.target as Element).closest?.('a[href]');if(link?.getAttribute('href')?.startsWith('#/'))save()};
 const onHash=()=>{
  clearTimeout(frame);cancelScrollNavigation();initializeNavigationEntry(currentHash||'#/');const raw=location.hash.slice(1)||'/',section=sectionTarget(raw),position=readNavigationPosition();
  currentHash=location.hash;setPath(section?'/':raw);
  pendingRestore.current=()=>{if(position)restoreNavigationPosition(position);else if(section)scrollToChapter(section);else restoreNavigationPosition({top:0})};setNavigationVersion(v=>v+1);
 };
 window.addEventListener('hashchange',onHash);window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('beforeunload',save);window.addEventListener('pagehide',save);document.addEventListener('click',onLink,true);
 const position=readNavigationPosition(),initialSection=sectionTarget(location.hash.slice(1));
 if(position)restoreNavigationPosition(position);else if(initialSection)scrollToChapter(initialSection);
 (window as any).__clubAppReady=true;requestAnimationFrame(()=>window.dispatchEvent(new Event('club:ready')));
 return()=>{clearTimeout(frame);cancelScrollNavigation();window.removeEventListener('hashchange',onHash);window.removeEventListener('scroll',onScroll);window.removeEventListener('beforeunload',save);window.removeEventListener('pagehide',save);history.scrollRestoration=previousRestoration;document.removeEventListener('click',onLink,true);clearTimeout(timer.current)};
},[]);
useEffect(()=>{let alive=true,dispose:(()=>void)|undefined;const controller=new AbortController();setupMotion(appRef.current!,controller.signal).then(d=>{if(alive)dispose=d;else d()}).catch(()=>{});return()=>{alive=false;controller.abort();dispose?.()}},[path,store.events,store.profiles]);
useEffect(()=>{document.title=({"/":"Coding Club — Create. Code. Conquer.","/about":"Our Aim — Coding Club","/events":"Events — Coding Club","/faculty":"Faculty — Coding Club","/team":"Student Team — Coding Club","/contact":"Credits — Coding Club","/contact-form":"Contact — Coding Club","/leader":"Leader Portal — Coding Club","/admin":"Admin Workspace — Coding Club"} as any)[path.split('?')[0]]||'Coding Club'},[path]);
const [route,arg]=path.slice(1).split('?')[0].split('/');const event=store.events.find(e=>e.id===arg);const props={store,reload,toast};let page:React.ReactNode;
switch(route){case 'about':page=<About store={store}/>;break;case 'events':page=<Events store={store}/>;break;case 'event':page=<EventRoute eventId={arg} event={event} {...props}/>;break;case 'register':page=<EventRoute eventId={arg} event={event} register {...props}/>;break;case 'payment':page=<UPIPayment registrationId={arg}/>;break;case 'registrations':page=<Registrations {...props}/>;break;case 'account':page=<AccountProfile/>;break;case 'forgot-password':page=<Recovery/>;break;case 'reset-password':page=<Recovery reset/>;break;case 'faculty':page=<People store={store} kind="faculty"/>;break;case 'team':page=<People store={store} kind="student"/>;break;case 'contact':case 'contact-form':page=<Contact {...props}/>;break;case 'leader':page=<LeaderPortal {...props}/>;break;case 'admin':page=<Admin {...props}/>;break;default:page=<ScrollHome {...props} navigate={navigate}/>;}
return <div className="club-app" ref={appRef} onSubmitCapture={validateFormSubmission}><CustomCursor/><a className="skip-link" href="#page-content" onClick={e=>{e.preventDefault();const main=document.getElementById("page-content");main?.focus();main?.scrollIntoView()}}>Skip to content</a>{path!=='/'&&<a className="return-to-club" href="#/" onClick={e=>{e.preventDefault();goBack()}}>← Back</a>}{path!=='/'&&<AccountStatus/>}{loadError&&<div className="notice error" role="alert">{loadError} <button onClick={reload}>Retry connection</button></div>}<main id="page-content" tabIndex={-1} className={'page-content'+(['register','registrations','leader','admin','contact-form'].includes(route)?' workspace-route route-'+route:'')} key={path}>{page}</main>{route!=='admin'&&<Footer store={store}/>}<div className={'toast '+(notification?'visible':'')} role="status" aria-live="polite">{notification}<button aria-label="Dismiss message" onClick={()=>setNotification('')}>×</button></div>{path==='/'?<PageGuide onNavigate={navigate}/>:<a href="#/registrations" className="floating-link" aria-label="My registrations">My registrations ↗</a>}</div>}
