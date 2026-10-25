const {test,expect}=require('@playwright/test');
const event={id:'11111111-1111-4111-8111-111111111111',title:'Connected workshop',slug:'connected-workshop',description:'Build useful things together.',event_date:'2099-01-01',start_time:'10:00:00',end_time:'12:00:00',venue:'Campus lab',registration_fee:0,team_size:3,max_participants:20,registration_start:'2020-01-01T00:00:00Z',registration_deadline:'2098-12-31T00:00:00Z',status:'OPEN'};
const user={id:'22222222-2222-4222-8222-222222222222',email:'student@example.invalid',full_name:'Connected Student',role:'PARTICIPANT',department:'IT',academic_year:2};
const registration={id:'33333333-3333-4333-8333-333333333333',registration_code:'CC99-00001',event_id:event.id,user_id:user.id,title:event.title,full_name:user.full_name,email:user.email,status:'CONFIRMED',created_at:'2026-01-01T00:00:00Z'};
const leader={id:'44444444-4444-4444-8444-444444444444',leader_code:'CC99-L001',event_id:event.id,user_id:user.id,full_name:user.full_name,event_title:event.title};
const team={id:'55555555-5555-4555-8555-555555555555',name:'Connected team',event_id:event.id,leader_id:leader.id,leader_code:leader.leader_code,locked:false,team_size:3,members:[],remaining_slots:2};
async function fixture(page,{admin=false,logged=false,fee=0,pending=false,noLeaderTeam=false,allocationReady=true,candidateFailure=false,planPending=false}={}){
 const state={allocationReady,planPending,candidateFailure,teamCreated:!noLeaderTeam,teamName:team.name,calls:[],registrations:pending?[{...registration,status:'PENDING_PAYMENT',registration_fee:900,registration_ref:'UPI-TEST-123456789012'}]:[],events:[{...event,registration_fee:fee}],members:[],unexpected:[],role:admin?'ADMIN':'PARTICIPANT',settings:{clubName:'Connected Club'},profile:{...user},leaders:[{...leader,is_active:true}],adminRegistrations:[{...registration},{...registration,id:'66666666-6666-4666-8666-666666666666',user_id:'77777777-7777-4777-8777-777777777777',full_name:'Second Student',registration_code:'CC99-00002'},{...registration,id:'88888888-8888-4888-8888-888888888888',user_id:'99999999-9999-4999-8999-999999999999',full_name:'Third Student',registration_code:'CC99-00003'}]};
 await page.addInitScript(({logged})=>{if(logged)sessionStorage.setItem('cc-user-token','user-token')},{logged});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4),method=req.method();let body;try{body=req.postDataJSON()}catch{body=req.postData()}
  state.calls.push({path,method,body,authorization:req.headers().authorization,query:url.searchParams.toString()});
  let data,status=200;
  if(path==='/settings')data=state.settings;
  else if(path==='/admin/settings'){if(method==='PATCH')Object.assign(state.settings,body);data={settings:state.settings}}
  else if(path==='/auth/forgot-password')data={ok:true,message:'If an active account exists for this email, a password reset link will be sent.'};
  else if(path==='/auth/reset-password')data={ok:true};
  else if(path==='/events'&&method==='GET')data=state.events;
  else if(path==='/events/'+event.slug||path==='/events/'+event.id)data=state.events[0];
  else if(['/faculty','/team'].includes(path))data=[];
  else if(path==='/auth/login'||path==='/auth/register')data={token:'user-token',user:{...user,role:state.role}}
  else if(path==='/auth/me'){if(method==='PATCH')Object.assign(state.profile,body);data={...state.profile,role:state.role}}
  else if(path==='/auth/logout')data={ok:true};
  else if(path==='/contact')data={ok:true};
  else if(path==='/events/'+event.id+'/register'){data=state.registrations[0]||{...registration,status:fee?'PENDING_PAYMENT':'CONFIRMED',registration_fee:fee};state.registrations=[data];status=201}
  else if(path==='/registrations/me')data=state.registrations;
  else if(path==='/registrations/'+registration.id+'/cancel'){state.registrations[0].status='CANCELLED';data=state.registrations[0]}
  else if(path==='/payments/config')data={enabled:true,upi_id:'codingclub@example',qr_url:'/assets/payment/coding-club-upi-qr.png',instructions:'Pay and submit your receipt.',amount_rupees:9,event_name:'Coding Club'};
  else if(path==='/registrations/'+registration.id+'/payment-status')data={registration:{...registration,registration_code:null,status:'PENDING_PAYMENT',registration_fee:900,registration_ref:'UPI-TEST-123456789012',...state.registrations[0]},submissions:[]};
  else if(path==='/payments/extract-utr')data={confidence:.99,candidates:[{reference:'TEST123456789',confidence:.98}],fields:{amount_rupees:9}};
  else if(path==='/payments/submit'){state.registrations[0]={...state.registrations[0],status:'PENDING_VERIFICATION',registration_code:null};data={id:'proof-1',status:'PENDING'};status=201}
  else if(path==='/admin/payments/upi')data=[];
  else if(path==='/admin/payments/upi/stats')data={total_submissions:0,pending_verification:0,under_review:0,approved:0,rejected:0,confirmed_registrations:0,verified_collection:0};
  else if(path==='/leader/login')data={token:'leader-token',leader_id:leader.leader_code,event_id:event.id};
  else if(path==='/leader/logout')data={ok:true};
  else if(path==='/leader/session')data={leader_id:leader.leader_code,event_id:event.id,user_id:user.id,full_name:user.full_name};
  else if(path==='/leader/event')data=event;
  else if(path==='/leader/team'&&method==='POST'){state.teamCreated=true;state.teamName=body.name;data={...team,name:body.name};status=201}
  else if(path==='/leader/team'){if(!state.teamCreated){status=404;data={error:'Team not found'}}else data={...team,allocation_ready:state.allocationReady,allocation_plan_pending:state.planPending,name:state.teamName,leader_name:user.full_name,members:state.members,remaining_slots:2-state.members.length};}
  else if(path==='/leader/team/vice-captain/candidates'&&state.candidateFailure){status=400;data={error:'Candidate list temporarily unavailable'}}
  else if(path==='/leader/team/vice-captain/candidates')data=[...state.members.map(m=>({...m,already_in_team:true})),...state.adminRegistrations.slice(1).filter(r=>!state.members.some(m=>m.registration_id===r.id)&&state.members.length<2).map(r=>({...r,registration_id:r.id,already_in_team:false}))];
  else if(path==='/leader/team/vice-captain'){const id=body.registration_id;if(id&&!state.members.some(m=>m.registration_id===id)){const candidate=state.adminRegistrations.find(r=>r.id===id);state.members.push({...candidate,registration_id:id})}state.members.forEach(m=>m.is_vice_captain=m.registration_id===id);data={ok:true}}
  else if(path==='/leader/team/spin'){state.members.push({full_name:state.members.length?'Second Allocated Student':'Allocated Student',registration_code:'CC99-0000'+(state.members.length+2)});data={selected:{id:'member-'+state.members.length,...state.members.at(-1)},remaining_slots:2-state.members.length}}
  else if(path==='/health')data={database:'connected',status:'ok'};
  else if(path==='/admin/dashboard/summary')data={total_events:1,total_registrations:1};
  else if(path==='/admin/dashboard')data={registrations:{confirmed:1},paid_payments:0};
  else if(path==='/admin/events'&&method==='GET')data=state.events;
  else if(path==='/admin/events'&&method==='POST'){data={...body,id:event.id};state.events=[data]}
  else if(path==='/admin/events/'+event.id&&method==='PATCH'){Object.assign(state.events[0],body);data=state.events[0]}
  else if(path==='/admin/registrations/export')return route.fulfill({status:200,contentType:'text/csv',body:'registration_code\r\nCC99-00001'});
  else if(path==='/admin/registrations')data=state.adminRegistrations;
  else if(path==='/admin/users')data=state.adminRegistrations;
  else if(path.startsWith('/admin/registrations/')){const reg=state.adminRegistrations.find(r=>r.id===path.split('/').at(-1));Object.assign(reg,body);data=reg}
  else if(path==='/admin/leaders')data=state.leaders;
  else if(path==='/admin/leaders/'+leader.id+'/reset-password')data={...leader,one_time_password:'rotated-leader-secret'};
  else if(path==='/admin/leaders/'+leader.id){Object.assign(state.leaders[0],body);data=state.leaders[0]}
  else if(path==='/admin/teams/export')return route.fulfill({status:200,contentType:'text/csv',body:'\uFEFF"Event","Team Name","Role","Name","Academic Year","Mobile Number"\r\n"Connected workshop","Connected team","Captain","Connected Student","2","9876543210"\r\n'});
  else if(path==='/admin/teams')data=[team];
  else if(path==='/admin/events/'+event.id+'/leaders')data={...leader,one_time_password:'one-time-secret'};
  else if(path==='/admin/events/'+event.id+'/teams')data=team;
  else if(path==='/admin/teams/'+team.id+'/members'&&method==='GET')data=state.members;
  else if(path==='/admin/teams/'+team.id+'/members'&&method==='POST'){const selected=state.adminRegistrations.find(r=>r.id===body.registration_id);state.members=[{...selected,registration_id:selected.id}];data=state.members[0]}
  else if(path.startsWith('/admin/teams/'+team.id+'/'))data={ok:true};
  else if(['/admin/faculty','/admin/team'].includes(path)&&method==='GET')data=[{id:user.id,name:'Connected profile',designation:'Professor',position:'Technical Team',department:'IT',is_active:true}];
  else if(/^\/admin\/(faculty|team)(\/[^/]+)?$/.test(path))data={...body,id:user.id};
  else if(path==='/admin/contact'&&method==='GET')data=[{id:user.id,name:user.full_name,email:user.email,subject:'Workshop question',message:'Please share the details.',status:'UNREAD'}];
  else if(path.startsWith('/admin/contact/'))data={ok:true};
  else if(path==='/admin/notifications')data=[{id:user.id,kind:'registration',recipient:user.email,subject:'Confirmation',status:'FAILED',attempts:1}];
  else if(path.endsWith('/retry'))data={id:user.id};
  else if(path==='/admin/audit')data=[{id:'1',action:'ADMIN_CREATED_EVENT',details:{},created_at:'2026-01-01'}];
  else if(path.startsWith('/admin/images/'))data={url:'https://example.invalid/upload.webp'};
  else {state.unexpected.push(method+' '+path);return route.fulfill({status:500,json:{error:'Unexpected test endpoint'}})}
  await route.fulfill({status,json:data});
 });
 return state;
}
async function go(page,path){await page.goto('/#/'+path);await expect(page.getByText('Loading club information…')).toHaveCount(0)}
function call(state,path,method='POST'){return state.calls.find(c=>c.path===path&&c.method===method)}
test('account creation, authenticated free registration, persisted session and logout',async({page})=>{
 const s=await fixture(page);await go(page,'register/'+event.id);await page.getByRole('button',{name:'New here?'}).click();await page.getByLabel('Email',{exact:false}).fill(user.email);await page.getByLabel('Password').fill('Long-test-password');await page.getByLabel('Full name').fill(user.full_name);await page.getByLabel('Academic year').fill('2');await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByRole('heading',{name:user.full_name})).toBeVisible();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm registration'}).click();await expect(page.getByRole('heading',{name:'Registration confirmed'})).toBeVisible();expect(call(s,'/auth/register').body.academic_year).toBe(2);expect(call(s,'/events/'+event.id+'/register').authorization).toBe('Bearer user-token');await go(page,'registrations');await expect(page.getByRole('heading',{name:event.title,exact:true})).toBeVisible();await page.reload();await go(page,'registrations');await expect(page.getByRole('heading',{name:event.title,exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to your account'})).toBeVisible();expect(call(s,'/auth/logout')).toBeTruthy();expect(s.unexpected).toEqual([]);
});
test('paid registration opens Coding Club UPI payment and keeps proof pending',async({page})=>{
 const s=await fixture(page,{logged:true,fee:900});await go(page,'register/'+event.id);await page.getByRole('checkbox').check();await page.getByRole('button',{name:/Register and pay/}).click();await expect(page.getByRole('heading',{name:'Registration payment'})).toBeVisible();await expect(page.locator('.upi-amount')).toContainText('₹9');expect(call(s,'/payments/order')).toBeFalsy();expect(s.unexpected).toEqual([]);
});
test('reopening an unpaid registration resumes QR payment instead of saying already registered',async({page})=>{
 const s=await fixture(page,{logged:true,fee:900,pending:true});await go(page,'register/'+event.id);await page.getByRole('checkbox').check();await page.getByRole('button',{name:/Register and pay/}).click();await expect(page.getByRole('heading',{name:'Registration payment'})).toBeVisible();await expect(page.getByText('Registration incomplete: upload your payment screenshot and enter the UTR to submit.',{exact:false})).toBeVisible();expect(call(s,'/events/'+event.id+'/register')).toBeTruthy();expect(s.unexpected).toEqual([]);
});
test('payment proof submits with a corrected UTR and no optional payment date',async({page})=>{
 const s=await fixture(page,{logged:true,fee:900,pending:true});await go(page,'payment/'+registration.id);
 await expect(page.getByLabel('Payment date and time (optional)')).toHaveJSProperty('required',false);
 await page.locator('input[type=file]').setInputFiles({name:'test-proof.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=','base64')});
 await expect(page.getByPlaceholder('Enter the reference shown in your UPI app')).toHaveValue('TEST123456789');
 await page.getByPlaceholder('Enter the reference shown in your UPI app').fill('CORRECTED123456');
 await page.getByRole('button',{name:'Submit for verification'}).click();
 await expect(page.getByText('Your payment details have been submitted successfully.',{exact:false})).toBeVisible();
 expect(call(s,'/payments/submit')).toBeTruthy();expect(call(s,'/payments/submit').body).toContain('CORRECTED123456');expect(s.unexpected).toEqual([]);
});
test('pending cancellation and backend validation errors are shown',async({page})=>{
 const s=await fixture(page,{logged:true,pending:true});await go(page,'registrations');await expect(page.getByRole('link',{name:'Pay by UPI QR and upload screenshot'})).toBeVisible();await page.getByRole('button',{name:'Cancel registration'}).click();await expect(page.getByText('CANCELLED',{exact:true})).toBeVisible();expect(call(s,'/registrations/'+registration.id+'/cancel')).toBeTruthy();await go(page,'contact-form');await page.route('**/api/contact',r=>r.fulfill({status:400,json:{error:'Validation failed',details:[{path:'message',message:'Must contain at least 10 characters'}]}}));for(const [label,value] of [['Name','AB'],['Email',user.email],['Subject','Hello'],['Message','short']])await page.getByRole('textbox',{name:new RegExp('^'+label+' \*')}).fill(value);await page.getByRole('button',{name:'Send message'}).click();await expect(page.getByRole('alert')).toContainText('message: Must contain');
});
test('contact submits to backend and non-admin cannot open workspace',async({page})=>{
 const s=await fixture(page,{logged:true});await go(page,'contact-form');for(const [label,value] of [['Name',user.full_name],['Email',user.email],['Subject','Hello workshop'],['Message','Please share workshop details.']])await page.getByRole('textbox',{name:new RegExp('^'+label+' \*')}).fill(value);await page.getByRole('button',{name:'Send message'}).click();await expect(page.getByText('Your message has been received by the club.')).toBeVisible();expect(call(s,'/contact').body.message).toBe('Please share workshop details.');await go(page,'admin');await expect(page.getByRole('alert')).toContainText('does not have administrator access');expect(s.calls.some(c=>c.path.startsWith('/admin/'))).toBe(false);
});
test('leader login, server allocation and logout use a separate token',async({page})=>{
 const s=await fixture(page);await go(page,'leader');await page.getByLabel('Leader code').fill(leader.leader_code);await page.getByLabel('Password').fill('Leader-password');await page.getByRole('button',{name:'Open dashboard'}).click();await expect(page.getByRole('heading',{name:team.name})).toBeVisible();await page.getByRole('button',{name:'Allocate next participant'}).click();await expect(page.getByText('Allocated Student',{exact:true}).first()).toBeVisible();expect(call(s,'/leader/team/spin').authorization).toBe('Bearer leader-token');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Leader sign in'})).toBeVisible();expect(call(s,'/leader/logout')).toBeTruthy();expect(s.unexpected).toEqual([]);
});
test('admin edits event with paise and UTC contracts, profiles, message status and operational tabs',async({page})=>{
 test.setTimeout(60000);
 const s=await fixture(page,{admin:true,logged:true});await go(page,'admin');await expect(page.getByText('Database: connected')).toBeVisible();const nav=page.getByRole('navigation',{name:'Admin workspace'});await nav.getByRole('button',{name:'Events',exact:true}).click();await page.getByRole('button',{name:'Edit event',exact:true}).click();await page.getByLabel('Fee per participant').fill('129.50');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(call(s,'/admin/events/'+event.id,'PATCH').body.registration_fee).toBe(12950);expect(call(s,'/admin/events/'+event.id,'PATCH').body.registration_deadline).toMatch(/Z$/);
 await nav.getByRole('button',{name:'Registrations',exact:true}).click();await page.getByLabel('Department',{exact:false}).fill('IT');await page.getByRole('button',{name:'Apply filters'}).click();await expect.poll(()=>s.calls.filter(c=>c.path==='/admin/registrations').at(-1).query).toContain('department=IT');const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Export event registrations CSV'}).click();await dl;
 await nav.getByRole('button',{name:'Faculty',exact:true}).click();await page.getByRole('button',{name:'Edit profile'}).click();await page.getByLabel('Name',{exact:false}).fill('Updated professor');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(call(s,'/admin/faculty/'+user.id,'PATCH').body.name).toBe('Updated professor');await page.getByRole('button',{name:'Deactivate',exact:true}).click();await expect.poll(()=>!!call(s,'/admin/faculty/'+user.id,'DELETE')).toBe(true);
 await nav.getByRole('button',{name:'Messages',exact:true}).click();await page.getByLabel('Message status').selectOption('READ');await expect.poll(()=>!!call(s,'/admin/contact/'+user.id,'PATCH')).toBe(true);
 await nav.getByRole('button',{name:'Payment Verification',exact:true}).click();await expect(page.getByText('Payment verification',{exact:false}).first()).toBeVisible();
 await nav.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>!!call(s,'/admin/notifications/'+user.id+'/retry')).toBe(true);await nav.getByRole('button',{name:'Audit',exact:true}).click();await expect(page.getByText('ADMIN_CREATED_EVENT',{exact:true})).toBeVisible();expect(s.unexpected).toEqual([]);
});
test('expired user token returns to sign-in instead of showing private data',async({page})=>{
 await fixture(page,{logged:true});await page.route('**/api/auth/me',r=>r.fulfill({status:401,json:{error:'Session invalid'}}));await go(page,'registrations');await expect(page.getByRole('heading',{name:'Sign in to your account'})).toBeVisible();expect(await page.evaluate(()=>sessionStorage.getItem('cc-user-token'))).toBeNull();
});

test('admin creates leaders, manages team membership and uploads images',async({page})=>{
 const s=await fixture(page,{admin:true,logged:true});await go(page,'admin');const nav=page.getByRole('navigation',{name:'Admin workspace'});await nav.getByRole('button',{name:'Leaders',exact:true}).click();await page.getByLabel('Event',{exact:false}).selectOption(event.id);await page.getByLabel('Confirmed participant').selectOption('99999999-9999-4999-8999-999999999999');await page.getByRole('button',{name:'Generate leader credentials'}).click();await expect(page.getByRole('dialog')).toContainText('one-time-secret');expect(call(s,'/admin/events/'+event.id+'/leaders').body.user_id).toBe('99999999-9999-4999-8999-999999999999');await page.getByRole('button',{name:'Close dialog'}).click();await nav.getByRole('button',{name:'Teams',exact:true}).click();await expect(page.getByRole('heading',{name:team.name,exact:true})).toBeVisible();const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:team.name,exact:true})});await card.getByRole('button',{name:'Lock',exact:true}).click();await expect.poll(()=>!!call(s,'/admin/teams/'+team.id+'/lock','PATCH')).toBe(true);await card.getByLabel('Confirmed participant').selectOption('66666666-6666-4666-8666-666666666666');await card.getByRole('button',{name:'Add participant'}).click();expect(call(s,'/admin/teams/'+team.id+'/members').body.registration_id).toBe('66666666-6666-4666-8666-666666666666');await card.getByRole('button',{name:'Remove',exact:true}).click();await expect.poll(()=>!!call(s,'/admin/teams/'+team.id+'/members/66666666-6666-4666-8666-666666666666','DELETE')).toBe(true);await nav.getByRole('button',{name:'Events',exact:true}).click();await page.getByLabel('Upload banner').setInputFiles({name:'poster.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71])});await expect.poll(()=>!!call(s,'/admin/images/events/'+event.id)).toBe(true);expect(s.unexpected).toEqual([]);
});

test('club settings save to the API and appear after a reload',async({page})=>{
 const s=await fixture(page,{admin:true,logged:true});await go(page,'admin');await page.getByRole('navigation',{name:'Admin workspace'}).getByRole('button',{name:'Club settings',exact:true}).click();await page.getByLabel('Club name').fill('Saved Coding Club');await page.getByLabel('Vision',{exact:false}).fill('Every student can build.');await page.getByRole('button',{name:'Save club settings'}).click();await expect.poll(()=>call(s,'/admin/settings','PATCH')?.body.clubName).toBe('Saved Coding Club');await go(page,'contact-form');await expect(page.locator('.contact-facts').locator('..')).toContainText('Saved Coding Club');await page.reload();await expect(page.locator('.site-footer')).toContainText('Saved Coding Club');expect(s.unexpected).toEqual([]);
});
test('event category, schedule, prizes, FAQs and photos survive save and render publicly',async({page})=>{
 const s=await fixture(page,{admin:true,logged:true});await go(page,'admin');await page.getByRole('navigation',{name:'Admin workspace'}).getByRole('button',{name:'Events',exact:true}).click();await page.getByRole('button',{name:'Edit event',exact:true}).click();await page.getByLabel('Category').selectOption('Workshops');await page.getByLabel('Prizes and recognition').fill('Club certificates');await page.getByRole('button',{name:'Add schedule item',exact:true}).click();await page.getByLabel('Time 1',{exact:false}).fill('10:30');await page.getByLabel('Session 1').fill('Hands-on lab');await page.getByRole('button',{name:'Add faqs item',exact:true}).click();await page.getByLabel('Question 1').fill('Are beginners welcome?');await page.getByLabel('Answer 1').fill('Yes, everyone can join.');await page.getByRole('button',{name:'Add photos item',exact:true}).click();await page.getByLabel('Photo URL 1').fill('https://example.invalid/gallery.webp');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);const body=call(s,'/admin/events/'+event.id,'PATCH').body;expect(body.schedule).toEqual([{time:'10:30',title:'Hands-on lab'}]);expect(body.faqs[0].q).toBe('Are beginners welcome?');expect(body.photos).toHaveLength(1);await go(page,'event/'+event.id);await expect(page.getByText('Hands-on lab',{exact:true})).toBeVisible();await expect(page.getByText('Club certificates',{exact:true})).toBeVisible();await page.getByText('Are beginners welcome?',{exact:false}).click();await expect(page.getByText('Yes, everyone can join.',{exact:true})).toBeVisible();await expect(page.getByAltText(event.title+' photo 1')).toHaveAttribute('src',body.photos[0]);expect(s.unexpected).toEqual([]);
});
test('account profile supports additional fields and password recovery forms use backend endpoints',async({page})=>{
 const s=await fixture(page,{logged:true});await go(page,'account');await page.getByLabel('Roll number').fill('REC-2026-42');await page.getByLabel('About you').fill('I like building tools.');await page.getByRole('button',{name:'Save my profile'}).click();await expect(page.getByText('Profile saved.',{exact:true})).toBeVisible();expect(call(s,'/auth/me','PATCH').body.roll_number).toBe('REC-2026-42');await page.reload();await go(page,'account');await expect(page.getByLabel('Roll number')).toHaveValue('REC-2026-42');await go(page,'forgot-password');await page.getByLabel('Account email').fill(user.email);await page.getByRole('button',{name:'Send reset link'}).click();await expect(page.getByText('Check your inbox and spam folder.',{exact:false})).toBeVisible();expect(call(s,'/auth/forgot-password').body.email).toBe(user.email);await go(page,'reset-password?token='+'a'.repeat(64));await page.getByLabel('New password',{exact:false}).first().fill('New-test-password-2026!');await page.getByLabel('Confirm new password').fill('New-test-password-2026!');await page.getByRole('button',{name:'Change password'}).click();await expect(page.getByText('Your password has been changed.',{exact:false})).toBeVisible();expect(call(s,'/auth/reset-password').body.token).toBe('a'.repeat(64));expect(await page.evaluate(()=>location.hash)).not.toContain('token=');expect(await page.evaluate(()=>sessionStorage.getItem('cc-user-token'))).toBeNull();expect(s.unexpected).toEqual([]);
});
test('admin can reset/deactivate leaders and change registration status with a reason',async({page})=>{
 const s=await fixture(page,{admin:true,logged:true});await go(page,'admin');const nav=page.getByRole('navigation',{name:'Admin workspace'});await nav.getByRole('button',{name:'Leaders',exact:true}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Reset leader password'}).click();await expect(page.getByRole('dialog')).toContainText('rotated-leader-secret');await page.getByRole('button',{name:'Close dialog'}).click();await page.getByRole('button',{name:'Deactivate leader',exact:true}).click();await expect(page.getByRole('button',{name:'Activate leader',exact:true})).toBeVisible();expect(call(s,'/admin/leaders/'+leader.id,'PATCH').body.is_active).toBe(false);await nav.getByRole('button',{name:'Registrations',exact:true}).click();await page.getByLabel('Status for '+registration.registration_code).selectOption('CANCELLED');await page.getByLabel('Reason for '+registration.registration_code).fill('Participant withdrew');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Update registration'}).first().click();await expect.poll(()=>call(s,'/admin/registrations/'+registration.id,'PATCH')?.body.status).toBe('CANCELLED');expect(call(s,'/admin/registrations/'+registration.id,'PATCH').body.reason).toBe('Participant withdrew');expect(s.unexpected).toEqual([]);
});

test('Register opens sign-in immediately while live event validation is pending',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});
 await fixture(page);
 await page.route('**/api/events/'+event.slug,async route=>{await new Promise(resolve=>setTimeout(resolve,3000));await route.fulfill({json:event});});
 await page.goto('/');
 await page.locator('#club-preloader').waitFor({state:'hidden'});
 const register=page.locator('a[href="#/register/'+event.id+'"]').first();
 await register.click();
 await expect(page.getByRole('heading',{name:'Sign in to your account'})).toBeVisible({timeout:1200});
 await expect(page.getByRole('heading',{name:'Sign in to your account'})).toBeInViewport();
});

test('registration confirmation waits for availability and agreement',async({page})=>{
 const s=await fixture(page,{logged:true});
 await page.route('**/api/events/'+event.slug,async route=>{await new Promise(resolve=>setTimeout(resolve,3000));await route.fulfill({json:event});});
 await page.goto('/');
 await page.locator('a[href="#/register/'+event.id+'"]').first().click();
 await expect(page.getByRole('heading',{name:user.full_name,exact:true})).toBeVisible({timeout:1200});
 await page.getByRole('checkbox').check();
 await expect(page.getByRole('button',{name:'Checking availability…'})).toBeDisabled();
 expect(call(s,'/events/'+event.id+'/register')).toBeUndefined();
 await expect(page.getByRole('button',{name:'Confirm registration'})).toBeEnabled();
 await page.getByRole('button',{name:'Confirm registration'}).click();
 await expect(page.getByRole('heading',{name:'Registration confirmed'})).toBeVisible();
});

test('direct registration URL resolves the event by ID without a loaded event list',async({page})=>{
 await fixture(page);
 await page.route('**/api/events?*',route=>route.fulfill({json:[]}));
 await page.route('**/api/events/'+event.id,route=>route.fulfill({json:event}));
 await page.goto('/#/register/'+event.id);
 await expect(page.getByRole('heading',{name:'Sign in to your account'})).toBeVisible();
 await page.getByLabel('Email',{exact:false}).fill(user.email);
 await page.getByLabel('Password',{exact:false}).fill('Long-test-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Save your spot.',exact:false})).toBeVisible();
});

test('leader creates their own team and allocates two students with names',async({page})=>{
 const s=await fixture(page,{noLeaderTeam:true});
 await go(page,'leader');
 await page.getByLabel('Leader code',{exact:false}).fill(leader.leader_code);
 await page.getByLabel('Password',{exact:false}).fill('leader-password');
 await page.getByRole('button',{name:'Open dashboard'}).click();
 await expect(page.getByRole('heading',{name:'Create your team',exact:true})).toBeVisible();
 await page.getByLabel('Team name',{exact:false}).fill('Student Builders');
 await page.getByRole('button',{name:'Create my team'}).click();
 await expect(page.getByRole('heading',{name:'Student Builders',exact:true})).toBeVisible();
 expect(call(s,'/leader/team').body).toEqual({name:'Student Builders'});
 await expect(page.getByText('1/3 team members',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Allocate next participant'}).click();
 await expect(page.getByText('2/3 team members',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Allocate next participant'}).click();
 await expect(page.getByText('3/3 team members',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Allocate next participant'})).toBeDisabled();
 await expect(page.locator('.list-item').filter({hasText:'Allocated Student'})).toHaveCount(2);
});

test('portrait event keeps artwork intact and places date and unannounced details underneath',async({page})=>{
 const s=await fixture(page);
 Object.assign(s.events[0],{banner:'/assets/events/bug-bounty-2026.webp',start_time:'00:00:00',end_time:'23:59:00',status:'CLOSED',max_participants:1,presentation:{end_date:'2099-01-03',poster_format:'portrait',organiser:'Coding Club',website:'https://codingclub.live',instagram:'https://www.instagram.com/codingclub_recazm/',email:'codingclub@gecazamgarh.ac.in',schedule_pending:true,registration_pending:true,capacity_pending:true}});
 await go(page,'events');
 const card=page.locator('.gallery-card').filter({has:page.getByRole('heading',{name:event.title,exact:true})});
 await expect(card).toContainText('3 Jan 2099');
 await expect(card.locator('.gallery-event-detail')).toContainText('To be announced');
 await expect(card.locator('a[href^="#/register/"]')).toHaveCount(0);
 expect(await card.locator('.gallery-event-photo').evaluate(el=>getComputedStyle(el).objectFit)).toBe('contain');
 await card.getByRole('link',{name:'Details',exact:false}).click();
 await expect(page.locator('.event-poster-information h1')).toHaveText(event.title);
 await expect(page.locator('.event-poster-facts')).toContainText('1 Jan 2099 – 3 Jan 2099');
 await expect(page.locator('.event-poster-facts')).not.toContainText('00:00');
 await expect(page.locator('.event-poster-facts')).not.toContainText('Free');
 await expect(page.locator('.event-poster-facts').getByText('To be announced',{exact:true})).toHaveCount(3);
 await expect(page.getByRole('link',{name:'codingclub@gecazamgarh.ac.in'})).toBeVisible();
 const positions=await page.evaluate(()=>({poster:document.querySelector('.event-poster-full').getBoundingClientRect().bottom,details:document.querySelector('.event-poster-information').getBoundingClientRect().top}));
 expect(positions.details).toBeGreaterThan(positions.poster);
});

test('published programme shows nine activities and opens nine-rupee registration',async({page})=>{
 const programme=require('../../scripts/data/code-sastra-programme.json');
 const s=await fixture(page,{fee:900});
 Object.assign(s.events[0],{faqs:programme,banner:'/assets/events/hacktober-2026.webp',max_participants:200,presentation:{poster_format:'portrait',registration_pending:false,capacity_pending:false,schedule_pending:true}});
 await go(page,'event/'+event.slug);
 await expect(page.locator('.event-programme article')).toHaveCount(9);
 await expect(page.locator('.event-programme')).toContainText('highest cumulative score');
 await expect(page.locator('.event-programme')).toContainText('Blind Coding');
 await expect(page.locator('.event-poster-facts')).toContainText('₹9');
 await expect(page.locator('.event-poster-facts')).toContainText('200');
 await page.getByRole('link',{name:'Register for this event',exact:true}).click();
 await expect(page.getByRole('heading',{name:/sign in/i})).toBeVisible();
});

test('shared actions stay readable, keyboard accessible and usable on mobile',async({page})=>{
 await fixture(page,{admin:true,logged:true});
 await go(page,'admin');
 await page.getByRole('navigation',{name:'Admin workspace'}).getByRole('button',{name:'Events',exact:true}).click();
 const create=page.getByRole('button',{name:'Create event',exact:true});
 await expect(create).toBeVisible();
 const style=await create.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {color:s.color,bg:s.backgroundColor,radius:s.borderRadius,height:r.height,labelSize:getComputedStyle(el.querySelector('.btn-label')).fontSize}});
 expect(style.radius).toBe('8px');expect(style.height).toBeGreaterThanOrEqual(44);expect(style.labelSize).toBe('13px');
 function luminance(rgb){const c=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722}
 const a=luminance(style.color),b=luminance(style.bg);expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(4.5);
 await create.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(create).toBeFocused();expect(await create.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
 await page.screenshot({path:'/tmp/codingclub-admin-buttons-desktop.png',fullPage:true});
 await create.click();await expect(page.getByRole('dialog')).toBeVisible();
 const close=page.getByRole('button',{name:'Close dialog',exact:true});await expect(close).toBeVisible();await close.click();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await go(page,'leader');await expect(page.getByRole('button',{name:'Open dashboard'})).toBeVisible();
 await page.screenshot({path:'/tmp/codingclub-leader-buttons-mobile.png',fullPage:true});
 await go(page,'contact-form');const send=page.getByRole('button',{name:'Send message'});await expect(send).toBeVisible();
 expect(await send.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:'/tmp/codingclub-contact-buttons-mobile.png',fullPage:true});
});

async function expectSeparatedActions(page,selector){
 const groups=await page.locator(selector).evaluateAll(nodes=>nodes.map(group=>Array.from(group.querySelectorAll(':scope > button,:scope > a')).filter(el=>el.getBoundingClientRect().width>0).map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})));
 expect(groups.length).toBeGreaterThan(0);
 for(const boxes of groups)for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const a=boxes[i],b=boxes[j];expect(a.right+7<=b.left||b.right+7<=a.left||a.bottom+7<=b.top||b.bottom+7<=a.top).toBe(true);
 }
}
test('sign-in and recovery action groups never overlap at phone, tablet or desktop widths',async({page})=>{
 await fixture(page);
 await go(page,'account');
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:900});
  await expectSeparatedActions(page,'.auth-actions');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/codingclub-signin-spacing.png',fullPage:true});
 await page.getByRole('link',{name:'Forgot your password?'}).click();
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:900});
  await expectSeparatedActions(page,'.action-group');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await page.locator('.floating-link').evaluate(el=>getComputedStyle(el).position)).toBe('static');
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/codingclub-recovery-spacing.png',fullPage:true});
 await page.getByRole('link',{name:'Back to sign in'}).click();
 await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
});
test('admin action groups wrap with gaps in cards and table rows',async({page})=>{
 await fixture(page,{admin:true,logged:true});await go(page,'admin');
 for(const tab of ['Events','Leaders']){
  await page.getByRole('navigation',{name:'Admin workspace'}).getByRole('button',{name:tab,exact:true}).click();
  await expect(page.locator('.action-group').first()).toBeVisible();
  for(const width of [390,768,1280]){await page.setViewportSize({width,height:900});await expectSeparatedActions(page,'.action-group')}
 }
});

test('refresh and browser Back retain registration, admin, leader and event destinations',async({page})=>{
 await fixture(page,{admin:true,logged:true});
 for(const route of ['register/'+event.id,'admin','leader','forgot-password']){
  await go(page,route);await page.reload();await expect(page).toHaveURL(new RegExp('#/'+route+'$'));
  await expect(page.locator('.kxr-root')).toHaveCount(0);
 }
 await go(page,'events');await expect.poll(()=>page.locator('#section-events').evaluate(el=>Math.abs(el.getBoundingClientRect().top))).toBeLessThan(5);
 await page.locator('.gallery-card-image').first().scrollIntoViewIfNeeded();const sourceTop=await page.evaluate(()=>scrollY);
 await page.locator('.gallery-card-image').first().click();await expect(page).toHaveURL(new RegExp('#/event/'+event.id+'$'));
 await page.goBack();await expect(page).toHaveURL(/#\/events$/);
 await expect.poll(()=>page.evaluate(top=>Math.abs(scrollY-top),sourceTop)).toBeLessThan(5);
});
test('required fields reject whitespace while blank optional registration fields remain valid',async({page})=>{
 const s=await fixture(page);await go(page,'account');await page.getByRole('button',{name:'New here?'}).click();
 await page.getByLabel('Email',{exact:false}).fill('validation@example.invalid');await page.getByLabel('Password').fill('          ');await page.getByLabel('Full name').fill('   ');
 await page.getByRole('button',{name:'Create account',exact:true}).click();expect(call(s,'/auth/register')).toBeFalsy();
 await page.getByLabel('Password').fill('Valid password 2026');await page.getByRole('button',{name:'Create account',exact:true}).click();expect(call(s,'/auth/register')).toBeFalsy();
 await page.getByLabel('Full name').fill('Valid Student');
 expect(await page.getByLabel('Phone',{exact:false}).evaluate(el=>el.required)).toBe(false);
 await page.getByRole('button',{name:'Create account',exact:true}).click();await expect.poll(()=>Boolean(call(s,'/auth/register'))).toBe(true);
 expect(call(s,'/auth/register').body.phone).toBe('');expect(call(s,'/auth/register').body.department).toBe('');
});
test('required admin and leader fields reject whitespace before API submission',async({page})=>{
 const s=await fixture(page,{admin:true,logged:true});await go(page,'admin');
 await page.getByRole('navigation',{name:'Admin workspace'}).getByRole('button',{name:'Events',exact:true}).click();await page.getByRole('button',{name:'Edit event',exact:true}).click();
 await page.getByLabel('Title',{exact:false}).first().fill('   ');await page.getByRole('button',{name:'Save',exact:true}).click();expect(call(s,'/admin/events/'+event.id,'PATCH')).toBeFalsy();
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await go(page,'leader');
 await page.getByLabel('Leader code').fill('   ');await page.getByLabel('Password').fill('   ');await page.getByRole('button',{name:'Open dashboard'}).click();expect(call(s,'/leader/login')).toBeFalsy();
});

test('Back restores Events opened by scrolling the homepage without a section hash',async({page})=>{
 await fixture(page);await page.goto('/');await page.locator('#club-preloader').waitFor({state:'hidden'});
 await page.evaluate(()=>scrollTo(0,document.querySelector('#section-events').offsetTop));
 const link=page.locator('.gallery-card-image').first();await link.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>scrollY);expect(before).toBeGreaterThan(500);
 await link.click();await expect(page).toHaveURL(new RegExp('#/event/'+event.id+'$'));
 await page.goBack();await expect(page).not.toHaveURL(/#\/event/);
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(500);
 await expect.poll(()=>page.evaluate(before=>Math.abs(scrollY-before),before)).toBeLessThan(5);
 await page.reload();await expect.poll(()=>page.evaluate(before=>Math.abs(scrollY-before),before)).toBeLessThan(5);
});

test.describe('animated navigation history',()=>{
 test.use({reducedMotion:'no-preference'});
 test('closing the main menu cannot pull faculty navigation back to the hero',async({page})=>{
  await fixture(page);await page.goto('/');await page.locator('#club-preloader').waitFor({state:'hidden'});
  await expect.poll(()=>page.evaluate(()=>Boolean(window.__ccLenis))).toBe(true);
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.locator('.stack-menu-link').filter({hasText:'Faculty'}).click();
  await expect.poll(()=>page.locator('#section-faculty').evaluate(el=>Math.abs(el.getBoundingClientRect().top))).toBeLessThan(5);
  await page.waitForTimeout(1200);
  await expect.poll(()=>page.locator('#section-faculty').evaluate(el=>Math.abs(el.getBoundingClientRect().top))).toBeLessThan(5);
 });
});

test('submission capture blocks empty registration, admin and leader forms even when native submit validation is bypassed',async({page})=>{
 const s=await fixture(page);await go(page,'account');await page.getByRole('button',{name:'New here?'}).click();
 await page.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(call(s,'/auth/register')).toBeFalsy();await expect(page.locator('.field-error').first()).toBeVisible();
 await go(page,'leader');await page.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(call(s,'/leader/login')).toBeFalsy();await expect(page.locator('.field-error').first()).toBeVisible();
 await go(page,'admin');await page.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(call(s,'/auth/login')).toBeFalsy();await expect(page.locator('.field-error').first()).toBeVisible();
});

test.describe('late animated layout restoration',()=>{
 test.use({reducedMotion:'no-preference'});
 test('a delayed event response cannot move a faculty refresh back toward the hero',async({page})=>{
  await fixture(page);await page.route('**/api/events',async route=>{await new Promise(resolve=>setTimeout(resolve,6500));await route.fulfill({json:[event]})});
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/events');
  await page.goto('/#/faculty',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'SKIP INTRO'}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean(window.__ccLenis))).toBe(true);
  await response;
  await expect.poll(()=>page.locator('#section-faculty').evaluate(el=>Math.abs(el.getBoundingClientRect().top))).toBeLessThan(5);
 });
});

test('screenshot is mandatory and manual UTR entry works during slow extraction',async({page})=>{
 const s=await fixture(page,{logged:true,fee:900,pending:true});
 let release;const waiting=new Promise(resolve=>{release=resolve});
 await page.route('**/api/payments/extract-utr',async route=>{await waiting;await route.fulfill({json:{confidence:.99,candidates:[{reference:'AUTOMATIC123456'}],fields:{}}})});
 await go(page,'payment/'+registration.id);
 const input=page.getByPlaceholder('Enter the reference shown in your UPI app'),submit=page.getByRole('button',{name:'Submit for verification'});
 await input.fill('MANUAL123456');await expect(submit).toBeDisabled();expect(call(s,'/payments/submit')).toBeFalsy();
 await page.locator('input[type=file]').setInputFiles({name:'proof.png',mimeType:'image/png',buffer:Buffer.from('test image')});
 await expect(page.getByText('Reading the transaction reference…',{exact:false})).toBeVisible();
 await input.fill('MANUAL123456');await expect(submit).toBeEnabled();
 release();await expect(page.getByText('Reading the transaction reference…',{exact:false})).toHaveCount(0);
 await expect(input).toHaveValue('MANUAL123456');await submit.click();
 await expect(page.getByText('Your payment details have been submitted successfully.',{exact:false})).toBeVisible();
 expect(call(s,'/payments/submit').body).toContain('MANUAL123456');
});
test('pending server status resumes payment even when displayed fee is stale',async({page})=>{
 await fixture(page,{logged:true,fee:0,pending:true});await go(page,'register/'+event.id);
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm registration'}).click();
 await expect(page.getByRole('heading',{name:'Registration payment'})).toBeVisible();
 await expect(page.getByText('Registration confirmed.',{exact:true})).toHaveCount(0);
});

test('failed extraction can retry the same screenshot and automatically fills UTR',async({page})=>{
 const s=await fixture(page,{logged:true,fee:900,pending:true});let attempts=0;
 await page.route('**/api/payments/extract-utr',route=>route.fulfill({json:++attempts===1?{confidence:0,candidates:[],fields:{},extraction_error:'timeout'}:{confidence:.96,candidates:[{reference:'612345678901'}],fields:{}}}));
 await go(page,'payment/'+registration.id);
 await page.locator('input[type=file]').setInputFiles({name:'proof.png',mimeType:'image/png',buffer:Buffer.from('test image')});
 await expect(page.getByText('Reference extraction could not finish.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Retry extraction'}).click();
 await expect(page.getByPlaceholder('Enter the reference shown in your UPI app')).toHaveValue('612345678901');
 expect(attempts).toBe(2);expect(call(s,'/payments/submit')).toBeFalsy();
});

for(const tab of ['Users','Registrations'])test('admin filters '+tab+' by year and branch together and clears filters',async({page})=>{
 const s=await fixture(page,{admin:true,logged:true});
 Object.assign(s.adminRegistrations[0],{academic_year:2,branch:' CSE ',department:'Engineering'});
 Object.assign(s.adminRegistrations[1],{academic_year:3,branch:'cse',department:'Engineering'});
 Object.assign(s.adminRegistrations[2],{academic_year:2,branch:'',department:'IT'});
 await go(page,'admin');await page.getByRole('navigation',{name:'Admin workspace'}).getByRole('button',{name:tab,exact:true}).click();
 const rows=page.locator('tbody tr');await expect(rows).toHaveCount(3);
 await page.getByLabel('Year',{exact:true}).selectOption('2');await expect(rows).toHaveCount(2);
 await page.getByLabel('Branch',{exact:true}).selectOption('cse');await expect(rows).toHaveCount(1);await expect(rows).toContainText(user.full_name);
 await page.getByLabel('Year',{exact:true}).selectOption('3');await expect(rows).toHaveCount(1);await expect(rows).toContainText('Second Student');
 await page.getByLabel('Branch',{exact:true}).selectOption('it');await expect(rows).toHaveCount(0);await expect(page.getByText('No users match the selected filters.')).toBeVisible();
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(rows).toHaveCount(3);await expect(page.locator('.admin-main [role=status]')).toContainText('Showing 3 of 3 records');
 expect(s.unexpected).toEqual([]);
});

 test('leader chooses an available vice-captain, sees the role after reload and can clear it',async({page})=>{
 const s=await fixture(page);
 await page.addInitScript(()=>sessionStorage.setItem('cc-leader-token','leader-token'));
 await go(page,'leader');
 await expect(page.getByRole('heading',{name:'Choose your vice-captain'})).toBeVisible();
 await page.getByRole('combobox',{name:/^Vice-captain/}).selectOption('66666666-6666-4666-8666-666666666666');
 await page.getByRole('button',{name:'Save vice-captain',exact:true}).click();
 await expect(page.locator('.list-item .pill').filter({hasText:'Vice-captain'})).toBeVisible();
 expect(call(s,'/leader/team/vice-captain').authorization).toBe('Bearer leader-token');
 await page.reload();
 await expect(page.locator('.list-item .pill').filter({hasText:'Vice-captain'})).toBeVisible();
 await page.getByRole('button',{name:'Clear vice-captain role',exact:true}).click();
 await expect(page.locator('.list-item .pill').filter({hasText:'Vice-captain'})).toHaveCount(0);
 await expect(page.locator('.list-item').filter({hasText:'Second Student'})).toBeVisible();
 expect(s.members.length).toBe(1);expect(s.unexpected).toEqual([]);
});

test('vice-captain is visible before team creation and selectable while allocation is pending',async({page})=>{
 const s=await fixture(page,{noLeaderTeam:true,allocationReady:false});
 await page.addInitScript(()=>sessionStorage.setItem('cc-leader-token','leader-token'));
 await go(page,'leader');
 await expect(page.getByRole('heading',{name:'Choose your vice-captain'})).toBeVisible();
 await expect(page.getByRole('combobox',{name:/^Vice-captain/})).toBeDisabled();
 await page.getByLabel('Team name').fill('Pending team');await page.getByRole('button',{name:'Create my team'}).click();
 await expect(page.getByRole('button',{name:'Allocate next participant'})).toBeDisabled();
 await page.getByRole('combobox',{name:/^Vice-captain/}).selectOption('66666666-6666-4666-8666-666666666666');
 await page.getByRole('button',{name:'Save vice-captain',exact:true}).click();
 await expect(page.locator('.list-item .pill').filter({hasText:'Vice-captain'})).toBeVisible();
 expect(s.members.length).toBe(1);expect(s.unexpected).toEqual([]);
});
test('candidate failure keeps dashboard visible and retry recovers',async({page})=>{
 const s=await fixture(page,{candidateFailure:true});
 await page.addInitScript(()=>sessionStorage.setItem('cc-leader-token','leader-token'));
 await go(page,'leader');
 await expect(page.getByRole('heading',{name:team.name,exact:true})).toBeVisible();
 await expect(page.getByText('Candidate list temporarily unavailable')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Leader sign in'})).toHaveCount(0);
 s.candidateFailure=false;await page.getByRole('button',{name:'Retry candidates'}).click();
 await expect(page.getByRole('combobox',{name:/^Vice-captain/})).toBeEnabled();
 await expect(page.getByRole('option',{name:/Second Student/})).toHaveCount(1);
});

test('allocate next participant works immediately after vice selection while other teams are pending',async({page})=>{
 const s=await fixture(page,{planPending:true});await page.addInitScript(()=>sessionStorage.setItem('cc-leader-token','leader-token'));
 await go(page,'leader');await page.getByRole('combobox',{name:/^Vice-captain/}).selectOption('66666666-6666-4666-8666-666666666666');
 await page.getByRole('button',{name:'Save vice-captain',exact:true}).click();
 await expect(page.locator('.list-item .pill').filter({hasText:'Vice-captain'})).toBeVisible();
 await page.getByRole('button',{name:'Allocate next participant'}).click();
 await expect(page.getByRole('button',{name:'Allocate next participant'})).toBeDisabled();
 expect(s.members.length).toBe(2);expect(call(s,'/leader/team/spin')).toBeTruthy();expect(s.unexpected).toEqual([]);
});

test('leader sign-in shows a useful 429 message without replaying credentials and can recover',async({page})=>{
 await fixture(page);let attempts=0;
 await page.route('**/api/leader/login',route=>{attempts++;return route.fulfill({status:429,headers:{'Retry-After':'5'},contentType:'text/plain',body:'Too many requests, please try again later.'})});
 await go(page,'leader');await page.getByLabel('Leader code').fill(leader.leader_code);await page.getByLabel('Password').fill('Leader-password');await page.getByRole('button',{name:'Open dashboard'}).click();
 await expect(page.getByRole('alert')).toContainText('Please wait 5 seconds');expect(attempts).toBe(1);
 await page.unroute('**/api/leader/login');await page.getByRole('button',{name:'Open dashboard'}).click();
 await expect(page.getByRole('heading',{name:team.name,exact:true})).toBeVisible();
});

test('admin downloads all team details as CSV from Teams tab',async({page})=>{
 const s=await fixture(page,{admin:true,logged:true});await go(page,'admin');await page.getByRole('navigation',{name:'Admin workspace'}).getByRole('button',{name:'Teams',exact:true}).click();
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download teams CSV',exact:true}).click();const file=await pending;
 expect(file.suggestedFilename()).toBe('coding-club-all-teams.csv');const fs=require('node:fs');const csv=fs.readFileSync(await file.path(),'utf8');expect(csv).toContain('Mobile Number');expect(csv).toContain('Connected Student');expect(csv).toContain('Captain');expect(csv.startsWith('\uFEFF')).toBe(true);
 expect(call(s,'/admin/teams/export','GET').authorization).toBe('Bearer user-token');expect(s.unexpected).toEqual([]);
});
