const crypto = require('crypto');
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const SECRET = () => process.env.MEDIAHUB_AUTH_SECRET || process.env.SOCIAL_AUTH_SECRET || '';

function auth(event){
  try{
    const raw=String(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/,'');
    const [p,sig]=raw.split('.');
    if(!p||!sig||!SECRET())return null;
    const good=crypto.createHmac('sha256',SECRET()).update(p).digest('base64url');
    if(sig.length!==good.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(good)))return null;
    const x=JSON.parse(Buffer.from(p,'base64url').toString());
    if(x.exp<Date.now()/1000)return null;
    return x;
  }catch{return null;}
}
function text(v,n){return String(v??'').trim().slice(0,n);}
function code(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);}
function makeCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out='';
  const bytes=crypto.randomBytes(6);
  for(const b of bytes)out+=alphabet[b%alphabet.length];
  return out;
}
function cleanMedia(m){
  const type=m?.type==='tv'?'tv':'movie';
  const tmdbId=Number(m?.tmdbId||0);
  if(!Number.isInteger(tmdbId)||tmdbId<1)throw new Error('Pick a movie or TV episode first.');
  return {
    type,tmdbId,
    title:text(m?.title||'Untitled',120),
    season:type==='tv'?Math.max(1,Number(m?.season||1)):0,
    episode:type==='tv'?Math.max(1,Number(m?.episode||1)):0,
    posterPath:text(m?.posterPath,200),
    backdropPath:text(m?.backdropPath,200),
    year:text(m?.year,10)
  };
}
function safeTime(v){const n=Number(v||0);return Number.isFinite(n)?Math.max(0,Math.min(n,60*60*12)):0;}
function safeDuration(v){const n=Number(v||0);return Number.isFinite(n)?Math.max(0,Math.min(n,60*60*12)):0;}

exports.handler=async event=>{
  try{
    if(event.httpMethod!=='POST')return{statusCode:405,headers,body:JSON.stringify({error:'Method not allowed'})};
    const a=auth(event);
    if(!a?.sub)return{statusCode:401,headers,body:JSON.stringify({error:'Sign in to use Watch Party.'})};
    const {getStore}=require('../vercel-store.cjs');
    const store=getStore('mediahub-watch-parties');
    const social=getStore('mediahub-social');
    const me=await social.get(`user/${a.sub}`,{type:'json',consistency:'strong'});
    if(!me)return{statusCode:401,headers,body:JSON.stringify({error:'Account missing.'})};
    const body=JSON.parse(event.body||'{}');
    const action=String(body.action||'state');
    const now=Date.now();
    const load=async c=>store.get(`party/${c}`,{type:'json',consistency:'strong'});
    const save=async p=>{p.updatedAt=Date.now();await store.setJSON(`party/${p.code}`,p);};
    const member=(p,id=me.id)=>p?.members?.[id]||null;
    const requireMember=p=>{if(!p||!member(p))throw new Error('You are not in this Watch Party.');};
    const requireHost=p=>{requireMember(p);if(p.hostId!==me.id)throw new Error('Only the party host can do that.');};
    const pubUser=u=>u?{id:u.id,username:u.username,displayName:u.displayName||u.username,avatar:u.avatar||'🎮'}:null;
    const publicParty=async p=>{
      const rows=[];
      for(const [id,m] of Object.entries(p.members||{})){
        const u=await social.get(`user/${id}`,{type:'json',consistency:'strong'});
        rows.push({user:pubUser(u)||{id,username:'user',displayName:'User',avatar:'🎮'},ready:!!m.ready,joinedAt:m.joinedAt||0,lastSeen:m.lastSeen||0,online:(m.lastSeen||0)>Date.now()-75000,host:id===p.hostId});
      }
      rows.sort((x,y)=>Number(y.host)-Number(x.host)||(x.joinedAt-y.joinedAt));
      return {code:p.code,hostId:p.hostId,media:p.media,playback:p.playback,members:rows,nextVotes:Array.isArray(p.nextVotes)?p.nextVotes:[],createdAt:p.createdAt,updatedAt:p.updatedAt};
    };

    if(action==='create'){
      const media=cleanMedia(body.media);
      let c='';
      for(let i=0;i<8;i++){const attempt=makeCode();if(!await load(attempt)){c=attempt;break;}}
      if(!c)throw new Error('Could not create a party code.');
      const p={code:c,hostId:me.id,createdAt:now,updatedAt:now,media,playback:{status:'paused',time:safeTime(body.time),duration:safeDuration(body.duration),updatedAt:now,startAt:0,seq:1},members:{[me.id]:{joinedAt:now,lastSeen:now,ready:true}},nextVotes:[]};
      await save(p);
      return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p),serverNow:Date.now()})};
    }

    if(action==='join'){
      const c=code(body.code);const p=await load(c);
      if(!p)return{statusCode:404,headers,body:JSON.stringify({error:'Party not found. Check the code.'})};
      if(!p.members)p.members={};
      if(!p.members[me.id]&&Object.keys(p.members).length>=8)return{statusCode:409,headers,body:JSON.stringify({error:'This party is full.'})};
      p.members[me.id]=p.members[me.id]||{joinedAt:now,ready:false};p.members[me.id].lastSeen=now;
      await save(p);
      return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p),serverNow:Date.now()})};
    }

    if(action==='leave'){
      const c=code(body.code);const p=await load(c);if(!p)return{statusCode:200,headers,body:JSON.stringify({ok:true})};
      if(p.members)delete p.members[me.id];
      const ids=Object.keys(p.members||{});
      if(!ids.length){await store.delete(`party/${c}`);return{statusCode:200,headers,body:JSON.stringify({ok:true,ended:true})};}
      if(p.hostId===me.id){ids.sort((x,y)=>(p.members[x]?.joinedAt||0)-(p.members[y]?.joinedAt||0));p.hostId=ids[0];}
      p.nextVotes=(p.nextVotes||[]).filter(id=>id!==me.id);await save(p);
      return{statusCode:200,headers,body:JSON.stringify({ok:true,hostId:p.hostId})};
    }

    if(action==='state'){
      const c=code(body.code);const p=await load(c);if(!p)return{statusCode:404,headers,body:JSON.stringify({error:'Party ended or no longer exists.'})};
      requireMember(p);p.members[me.id].lastSeen=now;await save(p);
      return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p),serverNow:Date.now()})};
    }

    if(action==='ready'){
      const c=code(body.code);const p=await load(c);requireMember(p);p.members[me.id].ready=!!body.ready;p.members[me.id].lastSeen=now;await save(p);
      return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p),serverNow:Date.now()})};
    }

    if(action==='media'){
      const c=code(body.code);const p=await load(c);requireHost(p);p.media=cleanMedia(body.media);p.playback={status:'paused',time:safeTime(body.time),duration:safeDuration(body.duration),updatedAt:now,startAt:0,seq:Number(p.playback?.seq||0)+1};p.nextVotes=[];
      for(const [id,m] of Object.entries(p.members||{}))m.ready=id===me.id;
      await save(p);return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p),serverNow:Date.now()})};
    }

    if(action==='start'){
      const c=code(body.code);const p=await load(c);requireHost(p);
      const onlineMembers=Object.values(p.members||{}).filter(m=>(m.lastSeen||0)>now-75000);
      const unready=onlineMembers.filter(m=>!m.ready).length;
      if(unready>0&&!body.force)return{statusCode:409,headers,body:JSON.stringify({error:`${unready} online member${unready===1?' is':'s are'} not ready yet.`})};
      p.playback={status:'scheduled',time:safeTime(body.time),duration:safeDuration(body.duration),updatedAt:now,startAt:now+3500,seq:Number(p.playback?.seq||0)+1};
      await save(p);return{statusCode:200,headers,body:JSON.stringify({party:await publicParty(p),serverNow:Date.now()})};
    }

    if(action==='playback'){
      const c=code(body.code);const p=await load(c);requireHost(p);
      const status=['playing','paused','ended'].includes(body.status)?body.status:'paused';
      const bump=body.bump!==false;
      p.playback={status,time:safeTime(body.time),duration:safeDuration(body.duration),updatedAt:now,startAt:0,seq:Number(p.playback?.seq||0)+(bump?1:0)};
      await save(p);return{statusCode:200,headers,body:JSON.stringify({ok:true,seq:p.playback.seq,serverNow:Date.now()})};
    }

    if(action==='chat-send'){
      const c=code(body.code);const p=await load(c);requireMember(p);const msg=text(body.text,400);if(!msg)return{statusCode:400,headers,body:JSON.stringify({error:'Message is empty.'})};
      const id=`${String(now).padStart(13,'0')}-${crypto.randomBytes(4).toString('hex')}`;
      await store.setJSON(`chat/${c}/${id}`,{id,from:me.id,text:msg,at:now});
      return{statusCode:200,headers,body:JSON.stringify({ok:true})};
    }

    if(action==='events'){
      const c=code(body.code);const p=await load(c);requireMember(p);const since=Math.max(0,Number(body.since||0));
      const chatList=await store.list({prefix:`chat/${c}/`});const reactList=await store.list({prefix:`react/${c}/`});
      const chats=[];for(const b of (chatList.blobs||[]).slice(-80)){const row=await store.get(b.key,{type:'json',consistency:'strong'});if(row&&row.at>=since){const u=await social.get(`user/${row.from}`,{type:'json',consistency:'strong'});chats.push({...row,user:pubUser(u)});}}
      const reactions=[];for(const b of (reactList.blobs||[]).slice(-80)){const row=await store.get(b.key,{type:'json',consistency:'strong'});if(row&&row.at>=since){const u=await social.get(`user/${row.from}`,{type:'json',consistency:'strong'});reactions.push({...row,user:pubUser(u)});}}
      chats.sort((a,b)=>a.at-b.at);reactions.sort((a,b)=>a.at-b.at);
      return{statusCode:200,headers,body:JSON.stringify({chats:chats.slice(-60),reactions:reactions.slice(-30),serverNow:Date.now()})};
    }

    if(action==='react'){
      const c=code(body.code);const p=await load(c);requireMember(p);const emoji=['❤️','😂','😮','👏','🔥','🍿'].includes(body.emoji)?body.emoji:'👏';
      const id=`${String(now).padStart(13,'0')}-${crypto.randomBytes(4).toString('hex')}`;await store.setJSON(`react/${c}/${id}`,{id,from:me.id,emoji,at:now});
      return{statusCode:200,headers,body:JSON.stringify({ok:true})};
    }

    if(action==='next-vote'){
      const c=code(body.code);const p=await load(c);requireMember(p);if(p.media?.type!=='tv')return{statusCode:400,headers,body:JSON.stringify({error:'Next Episode voting is only for TV parties.'})};
      const votes=new Set(p.nextVotes||[]);if(votes.has(me.id))votes.delete(me.id);else votes.add(me.id);p.nextVotes=[...votes];await save(p);
      const online=Object.entries(p.members||{}).filter(([,m])=>(m.lastSeen||0)>now-75000).map(([id])=>id);const needed=Math.max(1,Math.ceil(online.length/2));
      return{statusCode:200,headers,body:JSON.stringify({votes:p.nextVotes.length,needed,passed:p.nextVotes.length>=needed,party:await publicParty(p)})};
    }

    if(action==='clear-votes'){
      const c=code(body.code);const p=await load(c);requireHost(p);p.nextVotes=[];await save(p);return{statusCode:200,headers,body:JSON.stringify({ok:true})};
    }

    if(action==='invite'){
      const c=code(body.code);const p=await load(c);requireMember(p);const target=String(body.userId||'');if(!target||target===me.id)return{statusCode:400,headers,body:JSON.stringify({error:'Pick a friend.'})};
      const rel=await social.get(`rel/${me.id}/${target}`,{type:'json',consistency:'strong'});if(rel?.status!=='friends')return{statusCode:403,headers,body:JSON.stringify({error:'Watch Party invites are for friends.'})};
      const id=`${now}-${crypto.randomBytes(4).toString('hex')}`;await store.setJSON(`invite/${target}/${id}`,{id,code:c,from:me.id,media:p.media,at:now});
      const nid=crypto.randomUUID();await social.setJSON(`notification/${target}/${String(now).padStart(13,'0')}-${nid}`,{id:nid,type:'watch-party',title:`${me.displayName||me.username} invited you to a Watch Party`,body:p.media?.title||'Movie or TV party',data:{code:c},at:now,read:false});
      return{statusCode:200,headers,body:JSON.stringify({ok:true})};
    }

    if(action==='invites'){
      const listed=await store.list({prefix:`invite/${me.id}/`});const items=[];
      for(const b of (listed.blobs||[]).slice(-30)){const inv=await store.get(b.key,{type:'json',consistency:'strong'});if(!inv)continue;const p=await load(inv.code);if(!p){await store.delete(b.key);continue;}const from=await social.get(`user/${inv.from}`,{type:'json',consistency:'strong'});items.push({...inv,from:pubUser(from)});}
      items.sort((a,b)=>b.at-a.at);return{statusCode:200,headers,body:JSON.stringify({items})};
    }

    if(action==='invite-remove'){
      const id=text(body.inviteId,80);if(id)await store.delete(`invite/${me.id}/${id}`);return{statusCode:200,headers,body:JSON.stringify({ok:true})};
    }

    return{statusCode:400,headers,body:JSON.stringify({error:'Unknown Watch Party action.'})};
  }catch(e){
    console.error('watch-party',e);
    const msg=['Pick a movie or TV episode first.','You are not in this Watch Party.','Only the party host can do that.'].includes(e?.message)?e.message:(e?.message||'Watch Party service unavailable.');
    return{statusCode:500,headers,body:JSON.stringify({error:msg})};
  }
};
