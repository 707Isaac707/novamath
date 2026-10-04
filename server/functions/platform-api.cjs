const crypto=require('crypto');
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const secret=()=>process.env.MEDIAHUB_AUTH_SECRET||process.env.SOCIAL_AUTH_SECRET||'';
function auth(event){try{const raw=String(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/,'');const [p,sig]=raw.split('.');if(!p||!sig||!secret())return null;const good=crypto.createHmac('sha256',secret()).update(p).digest('base64url');if(sig.length!==good.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(good)))return null;const x=JSON.parse(Buffer.from(p,'base64url').toString());if(x.exp<Date.now()/1000)return null;return x;}catch{return null;}}
const txt=(v,n=500)=>String(v==null?'':v).trim().slice(0,n);
const code=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
const makeCode=()=>{const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<6;i++)s+=chars[crypto.randomInt(chars.length)];return s;};
const pub=u=>u?{id:u.id,username:u.username,displayName:u.displayName||u.username,avatar:u.avatar||'🎮'}:null;
async function postDiscord(url,payload){
  const target=String(url||'').trim();if(!target)return{configured:false,sent:false};
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),7000);
  try{const r=await fetch(target,{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return{configured:true,sent:r.ok,status:r.status};}
  catch(e){console.warn('discord webhook',e?.message||e);return{configured:true,sent:false};}
  finally{clearTimeout(timer);}
}
const reportWebhook=()=>process.env.NOVA_REPORTS_WEBHOOK||process.env.NOVA_ADMIN_ALERTS_WEBHOOK||process.env.NOVA_REPORTS_DISCORD_WEBHOOK||process.env.NOVA_ADMIN_ALERTS_DISCORD_WEBHOOK||'';
const adminWebhook=()=>process.env.NOVA_ADMIN_ALERTS_WEBHOOK||process.env.NOVA_ADMIN_ALERTS_DISCORD_WEBHOOK||'';

exports.handler=async event=>{try{
  const {getStore}=require('../vercel-store.cjs');
  const store=getStore('mediahub-platform'),social=getStore('mediahub-social');
  const a=auth(event),me=a?.sub?await social.get(`user/${a.sub}`,{type:'json',consistency:'strong'}):null;
  const body=event.httpMethod==='POST'?JSON.parse(event.body||'{}'):{};
  const action=body.action||new URL(event.rawUrl||'https://x/').searchParams.get('action')||'announcements';
  const isAdmin=()=>!!me&&!!String(process.env.MEDIAHUB_ADMIN_USERNAME||'').trim()&&String(process.env.MEDIAHUB_ADMIN_USERNAME).trim().toLowerCase()===String(me.username||'').toLowerCase();
  const requireUser=()=>{if(!me)throw new Error('Sign in required');};
  const loadParty=async c=>await store.get(`game-party/${code(c)}`,{type:'json',consistency:'strong'});
  const saveParty=async p=>{p.updatedAt=Date.now();await store.setJSON(`game-party/${p.code}`,p);};
  const member=(p,id)=>p?.members?.[id]||null;
  const requireMember=p=>{requireUser();if(!member(p,me.id))throw new Error('You are not in this party.');};
  const requireHost=p=>{requireMember(p);if(p.hostId!==me.id)throw new Error('Only the party leader can do that.');};
  const publicParty=async p=>{const members=[];for(const [id,m] of Object.entries(p.members||{})){const u=await social.get(`user/${id}`,{type:'json',consistency:'strong'});members.push({user:pub(u)||{id,username:'user',displayName:'User',avatar:'🎮'},ready:!!m.ready,online:(m.lastSeen||0)>Date.now()-75000,host:id===p.hostId,joinedAt:m.joinedAt||0});}members.sort((x,y)=>Number(y.host)-Number(x.host)||x.joinedAt-y.joinedAt);return{code:p.code,hostId:p.hostId,game:p.game,roomCode:p.roomCode||'',members,launch:p.launch||{seq:0,at:0},chat:Array.isArray(p.chat)?p.chat.slice(-60):[],createdAt:p.createdAt,updatedAt:p.updatedAt};};

  if(action==='announcements'){
    const data=await store.get('announcements/current',{type:'json',consistency:'strong'});
    return{statusCode:200,headers,body:JSON.stringify({items:Array.isArray(data?.items)?data.items:[]})};
  }
  if(action==='channel-report'||action==='report-channel'){
    const row={id:crypto.randomUUID(),at:Date.now(),kind:'Live TV',category:'Live TV',name:txt(body.name,120),subject:`Broken channel: ${txt(body.name,120)||'Unknown channel'}`,details:txt(body.details||'Reported as broken from the Live TV player.',900),url:txt(body.url,700),tvgId:txt(body.tvgId,160),group:txt(body.group,120),userId:me?.id||'',username:me?.username||'guest'};
    if(!row.url)return{statusCode:400,headers,body:JSON.stringify({error:'Missing channel URL'})};
    await store.setJSON(`channel-report/${String(row.at).padStart(13,'0')}-${row.id}`,row);
    const discord=await postDiscord(reportWebhook(),{username:'Nova Math',embeds:[{title:'📺 Broken Live TV report',description:row.details,color:10526880,fields:[{name:'Channel',value:row.name||'Unknown',inline:true},{name:'Group',value:row.group||'Unknown',inline:true},{name:'Reporter',value:row.username?`@${row.username}`:'guest',inline:true},{name:'Stream URL',value:row.url.slice(0,1000),inline:false}],footer:{text:'Nova Math · private report'}}]});
    return{statusCode:200,headers,body:JSON.stringify({ok:true,discordConfigured:discord.configured,discordSent:discord.sent})};
  }
  if(action==='site-report'||action==='report-issue'){
    requireUser();const at=Date.now(),row={id:crypto.randomUUID(),at,kind:'Site issue',category:txt(body.category,60)||'Other',subject:txt(body.subject,120),details:txt(body.details,900),page:txt(body.page,100),userId:me.id,username:me.username};
    if(!row.subject||!row.details)return{statusCode:400,headers,body:JSON.stringify({error:'Add a subject and details.'})};
    await store.setJSON(`site-report/${String(at).padStart(13,'0')}-${row.id}`,row);
    const discord=await postDiscord(reportWebhook(),{username:'Nova Math',embeds:[{title:'🛠 Nova Math issue report',description:row.details,color:12632256,fields:[{name:'Type',value:row.category,inline:true},{name:'Subject',value:row.subject,inline:true},{name:'Reporter',value:`@${row.username}`,inline:true},{name:'Section',value:row.page||'Unknown',inline:false}],footer:{text:'Nova Math · private report'}}]});
    return{statusCode:200,headers,body:JSON.stringify({ok:true,discordConfigured:discord.configured,discordSent:discord.sent})};
  }
  if(action==='event'){
    requireUser();const at=Date.now(),row={id:crypto.randomUUID(),at,userId:me.id,username:me.username,type:txt(body.type,50),gameFile:txt(body.gameFile,240),title:txt(body.title||body.movie||body.channel,160),meta:body.meta&&typeof body.meta==='object'?body.meta:{}};
    await store.setJSON(`event/${String(at).padStart(13,'0')}-${row.id}`,row);
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }

  if(action==='game-party-create'){
    requireUser();const file=txt(body.gameFile,220),title=txt(body.gameTitle,100);if(!file)return{statusCode:400,headers,body:JSON.stringify({error:'Choose a game first.'})};let c='';for(let i=0;i<10;i++){const x=makeCode();if(!await loadParty(x)){c=x;break;}}if(!c)throw new Error('Could not create a party code.');const now=Date.now(),p={code:c,hostId:me.id,game:{file,title:title||'Game'},roomCode:txt(body.roomCode,40),members:{[me.id]:{ready:true,joinedAt:now,lastSeen:now}},launch:{seq:0,at:0},chat:[],createdAt:now,updatedAt:now};await saveParty(p);return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p)})};
  }
  if(action==='game-party-join'){
    requireUser();const p=await loadParty(body.code);if(!p)return{statusCode:404,headers,body:JSON.stringify({error:'Party not found. Check the 6-character code.'})};p.members=p.members||{};if(!p.members[me.id]&&Object.keys(p.members).length>=8)return{statusCode:409,headers,body:JSON.stringify({error:'This party is full.'})};const now=Date.now();p.members[me.id]=p.members[me.id]||{ready:false,joinedAt:now};p.members[me.id].lastSeen=now;await saveParty(p);return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p)})};
  }
  if(action==='game-party-state'){
    const p=await loadParty(body.code);if(!p)return{statusCode:404,headers,body:JSON.stringify({error:'Party ended.'})};requireMember(p);p.members[me.id].lastSeen=Date.now();await saveParty(p);return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p)})};
  }
  if(action==='game-party-ready'){
    const p=await loadParty(body.code);if(!p)return{statusCode:404,headers,body:JSON.stringify({error:'Party ended.'})};requireMember(p);p.members[me.id].ready=!!body.ready;p.members[me.id].lastSeen=Date.now();await saveParty(p);return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p)})};
  }
  if(action==='game-party-room'){
    const p=await loadParty(body.code);if(!p)return{statusCode:404,headers,body:JSON.stringify({error:'Party ended.'})};requireHost(p);p.roomCode=txt(body.roomCode,40);await saveParty(p);return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p)})};
  }
  if(action==='game-party-launch'){
    const p=await loadParty(body.code);if(!p)return{statusCode:404,headers,body:JSON.stringify({error:'Party ended.'})};requireHost(p);const online=Object.entries(p.members||{}).filter(([,m])=>(m.lastSeen||0)>Date.now()-75000);const notReady=online.filter(([id,m])=>id!==p.hostId&&!m.ready);if(notReady.length)return{statusCode:409,headers,body:JSON.stringify({error:`${notReady.length} online member${notReady.length===1?' is':'s are'} not ready.`})};p.launch={seq:Number(p.launch?.seq||0)+1,at:Date.now(),by:me.id};await saveParty(p);return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p)})};
  }
  if(action==='game-party-chat'){
    const p=await loadParty(body.code);if(!p)return{statusCode:404,headers,body:JSON.stringify({error:'Party ended.'})};requireMember(p);const message=txt(body.text,400);if(!message)return{statusCode:400,headers,body:JSON.stringify({error:'Message is empty.'})};p.chat=Array.isArray(p.chat)?p.chat:[];p.chat.push({id:crypto.randomUUID(),from:me.id,name:me.displayName||me.username,avatar:me.avatar||'🎮',text:message,at:Date.now()});p.chat=p.chat.slice(-60);await saveParty(p);return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p)})};
  }
  if(action==='game-party-invite'){
    const p=await loadParty(body.code);if(!p)return{statusCode:404,headers,body:JSON.stringify({error:'Party ended.'})};requireMember(p);const target=txt(body.userId,80);const rel=await social.get(`rel/${me.id}/${target}`,{type:'json',consistency:'strong'});if(rel?.status!=='friends')return{statusCode:403,headers,body:JSON.stringify({error:'Game Party invites are for friends.'})};const at=Date.now(),nid=crypto.randomUUID();await social.setJSON(`notification/${target}/${String(at).padStart(13,'0')}-${nid}`,{id:nid,type:'party',title:`${me.displayName||me.username} invited you to a Game Party`,body:p.game?.title||'Game Party',data:{code:p.code,gameFile:p.game?.file||''},at,read:false});return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  if(action==='game-party-leave'){
    const p=await loadParty(body.code);if(!p)return{statusCode:200,headers,body:JSON.stringify({ok:true})};requireMember(p);delete p.members[me.id];const ids=Object.keys(p.members||{});if(!ids.length){await store.delete(`game-party/${p.code}`);return{statusCode:200,headers,body:JSON.stringify({ok:true,ended:true})};}if(p.hostId===me.id){ids.sort((x,y)=>(p.members[x]?.joinedAt||0)-(p.members[y]?.joinedAt||0));p.hostId=ids[0];}await saveParty(p);return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }

  if(action==='admin-status'||action==='admin-check'){
    requireUser();return{statusCode:200,headers,body:JSON.stringify({isAdmin:isAdmin(),admin:isAdmin(),configured:!!String(process.env.MEDIAHUB_ADMIN_USERNAME||'').trim(),username:me?.username||'',reportsWebhookConfigured:!!reportWebhook(),alertsWebhookConfigured:!!adminWebhook()})};
  }
  if(action==='admin-test-alert'){
    requireUser();if(!isAdmin())return{statusCode:403,headers,body:JSON.stringify({error:'This account is not an admin.'})};
    const discord=await postDiscord(adminWebhook(),{username:'Nova Math',embeds:[{title:'✅ Nova Math admin alert test',description:`Admin alerts are connected for @${me.username}.`,color:12632256,footer:{text:'Nova Math v1.3.1'}}]});
    return{statusCode:200,headers,body:JSON.stringify({ok:true,configured:discord.configured,sent:discord.sent})};
  }
  if(action==='admin-summary'||action==='admin-overview'){
    requireUser();if(!isAdmin())return{statusCode:403,headers,body:JSON.stringify({error:'This account is not an admin.'})};const now=Date.now();
    const usersList=await social.list({prefix:'user/'});const users=[];for(const b of (usersList.blobs||[]).slice(-500)){const u=await social.get(b.key,{type:'json',consistency:'strong'});if(u)users.push({id:u.id,username:u.username,displayName:u.displayName||u.username,createdAt:u.createdAt||0});}
    const presenceList=await social.list({prefix:'presence/'});let active=0;for(const b of presenceList.blobs||[]){const x=await social.get(b.key,{type:'json',consistency:'strong'});if(x?.at>now-90000)active++;}
    const orderList=await store.list({prefix:'food-order/'});const orders=[];for(const b of (orderList.blobs||[]).slice(-80)){const x=await store.get(b.key,{type:'json',consistency:'strong'});if(x)orders.push(x);}orders.sort((a,b)=>b.at-a.at);
    const reportList=await store.list({prefix:'channel-report/'}),siteReportList=await store.list({prefix:'site-report/'});const reports=[];for(const b of (reportList.blobs||[]).slice(-100)){const x=await store.get(b.key,{type:'json',consistency:'strong'});if(x)reports.push({...x,kind:x.kind||'Live TV',category:x.category||'Live TV'});}for(const b of (siteReportList.blobs||[]).slice(-100)){const x=await store.get(b.key,{type:'json',consistency:'strong'});if(x)reports.push({...x,kind:x.kind||'Site issue'});}reports.sort((a,b)=>b.at-a.at);
    const eventList=await store.list({prefix:'event/'});const counts=new Map();for(const b of (eventList.blobs||[]).slice(-1500)){const x=await store.get(b.key,{type:'json',consistency:'strong'});if(x?.type==='game_launch'&&x.gameFile){const v=counts.get(x.gameFile)||{file:x.gameFile,title:x.title||x.gameFile,count:0};v.count++;if(x.title)v.title=x.title;counts.set(x.gameFile,v);}}
    const topGames=[...counts.values()].sort((a,b)=>b.count-a.count).slice(0,12),ann=await store.get('announcements/current',{type:'json',consistency:'strong'});const announcements=Array.isArray(ann?.items)?ann.items:[];
    return{statusCode:200,headers,body:JSON.stringify({counts:{users:users.length,active,orders:orders.length,reports:reports.length},activeUsers:active,totalUsers:users.length,newUsers:users.filter(u=>u.createdAt>now-7*86400000).length,users:users.sort((a,b)=>b.createdAt-a.createdAt).slice(0,20),topGames,orders:orders.slice(0,30),reports:reports.slice(0,40),announcements})};
  }
  if(action==='admin-announcements'||action==='admin-announcements-set'){
    requireUser();if(!isAdmin())return{statusCode:403,headers,body:JSON.stringify({error:'This account is not an admin.'})};const items=(Array.isArray(body.items)?body.items:[]).slice(0,12).map(x=>({id:txt(x.id,80)||crypto.randomUUID(),title:txt(x.title,100),body:txt(x.body,400),at:Number(x.at)||Date.now()})).filter(x=>x.title||x.body);await store.setJSON('announcements/current',{items,updatedAt:Date.now(),by:me.username});return{statusCode:200,headers,body:JSON.stringify({ok:true,items})};
  }
  return{statusCode:400,headers,body:JSON.stringify({error:'Unknown platform action'})};
}catch(e){console.error('platform-api',e);const known=['Sign in required','You are not in this party.','Only the party leader can do that.'].includes(e?.message);return{statusCode:known?401:500,headers,body:JSON.stringify({error:known?e.message:'Platform service unavailable.'})};}};
