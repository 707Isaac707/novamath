const crypto=require('crypto');
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const secret=()=>process.env.MEDIAHUB_AUTH_SECRET||process.env.SOCIAL_AUTH_SECRET||'';
function auth(event){try{const raw=String(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/,'');const [p,sig]=raw.split('.');if(!p||!sig||!secret())return null;const good=crypto.createHmac('sha256',secret()).update(p).digest('base64url');if(sig.length!==good.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(good)))return null;const x=JSON.parse(Buffer.from(p,'base64url').toString());if(x.exp<Date.now()/1000)return null;return x;}catch{return null;}}
const pub=u=>u?{id:u.id,username:u.username,displayName:u.displayName||u.username,avatar:u.avatar||'🎮',bio:u.bio||'',customStatus:String(u.customStatus||'').slice(0,60),banner:String(u.banner||'midnight').slice(0,24),createdAt:u.createdAt||0,favoriteGame:String(u.favoriteGame||'').slice(0,180),badges:Array.isArray(u.badges)?u.badges.slice(0,12).map(x=>String(x).slice(0,40)):[],settings:{appearOffline:!!u.settings?.appearOffline,showActivity:u.settings?.showActivity!==false}}:null;
const pair=(a,b)=>[String(a),String(b)].sort().join('__');
const clampText=(v,n)=>String(v||'').trim().slice(0,n);

exports.handler=async event=>{try{
  const a=auth(event);
  if(!a?.sub)return{statusCode:401,headers,body:JSON.stringify({error:'Sign in required'})};
  const {getStore}=require('../vercel-store.cjs');
  const store=getStore('mediahub-social');
  const me=await store.get(`user/${a.sub}`,{type:'json',consistency:'strong'});
  if(!me)return{statusCode:401,headers,body:JSON.stringify({error:'Account missing'})};
  const body=event.httpMethod==='POST'?JSON.parse(event.body||'{}'):{};
  const action=body.action||new URL(event.rawUrl||'https://x/').searchParams.get('action')||'me';
  const rel=async id=>(await store.get(`rel/${me.id}/${id}`,{type:'json',consistency:'strong'}))||null;
  const mustFriend=async id=>{const r=await rel(id);if(r?.status!=='friends')throw new Error('You must be friends first.');return r;};
  const notify=async(id,type,title,bodyText,data={})=>{if(!id)return;const at=Date.now(),nid=crypto.randomUUID();await store.setJSON(`notification/${id}/${String(at).padStart(13,'0')}-${nid}`,{id:nid,type:clampText(type,30),title:clampText(title,100),body:clampText(bodyText,220),data,at,read:false});};

  if(action==='me')return{statusCode:200,headers,body:JSON.stringify({user:pub(me)})};
  if(action==='profile'){
    me.displayName=clampText(body.displayName||me.displayName,30)||me.username;
    me.avatar=clampText(body.avatar||me.avatar,8)||'🎮';
    me.bio=clampText(body.bio,120);
    me.customStatus=clampText(body.customStatus,60);
    me.banner=clampText(body.banner||me.banner||'midnight',24)||'midnight';
    me.favoriteGame=clampText(body.favoriteGame||me.favoriteGame,180);
    if(Array.isArray(body.badges))me.badges=body.badges.slice(0,12).map(x=>clampText(x,40)).filter(Boolean);
    me.settings={appearOffline:!!body.appearOffline,showActivity:body.showActivity!==false};
    await store.setJSON(`user/${me.id}`,me);
    return{statusCode:200,headers,body:JSON.stringify({user:pub(me)})};
  }
  if(action==='public-profile'){
    const id=String(body.userId||'');await mustFriend(id);
    const u=await store.get(`user/${id}`,{type:'json',consistency:'strong'});
    if(!u)return{statusCode:404,headers,body:JSON.stringify({error:'User not found.'})};
    const shared=await store.get(`shared/${id}`,{type:'json',consistency:'strong'});
    const p=await store.get(`presence/${id}`,{type:'json',consistency:'strong'});
    const online=!u.settings?.appearOffline&&p?.at>Date.now()-90000;
    return{statusCode:200,headers,body:JSON.stringify({user:{...pub(u),sharedGames:shared?.games||[],online,lastSeen:p?.at||0,activity:online&&u.settings?.showActivity!==false?p?.activity:''}})};
  }
  if(action==='find'){
    const q=String(body.username||'').trim().toLowerCase();
    const hit=await store.get(`username/${q}`,{type:'json',consistency:'strong'});
    if(!hit?.id||hit.id===me.id)return{statusCode:404,headers,body:JSON.stringify({error:'User not found.'})};
    const u=await store.get(`user/${hit.id}`,{type:'json',consistency:'strong'});
    return{statusCode:200,headers,body:JSON.stringify({user:pub(u),relationship:await rel(hit.id)})};
  }
  if(action==='request'){
    const id=String(body.userId||'');
    if(!id||id===me.id)return{statusCode:400,headers,body:JSON.stringify({error:'Invalid user.'})};
    const u=await store.get(`user/${id}`,{type:'json',consistency:'strong'});
    if(!u)return{statusCode:404,headers,body:JSON.stringify({error:'User not found.'})};
    const current=await rel(id);
    if(current?.status==='friends')return{statusCode:200,headers,body:JSON.stringify({ok:true})};
    await store.setJSON(`rel/${me.id}/${id}`,{status:'outgoing',updatedAt:Date.now()});
    await store.setJSON(`rel/${id}/${me.id}`,{status:'incoming',updatedAt:Date.now()});
    await notify(id,'friend','Friend request',`${me.displayName||me.username} sent you a friend request.`,{userId:me.id});
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  if(action==='accept'){
    const id=String(body.userId||''),r=await rel(id);
    if(r?.status!=='incoming')return{statusCode:400,headers,body:JSON.stringify({error:'No incoming request.'})};
    await store.setJSON(`rel/${me.id}/${id}`,{status:'friends',updatedAt:Date.now()});
    await store.setJSON(`rel/${id}/${me.id}`,{status:'friends',updatedAt:Date.now()});
    await notify(id,'friend','Friend request accepted',`${me.displayName||me.username} accepted your friend request.`,{userId:me.id});
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  if(action==='remove'){
    const id=String(body.userId||'');
    await store.delete(`rel/${me.id}/${id}`);await store.delete(`rel/${id}/${me.id}`);
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  if(action==='friends'){
    const listed=await store.list({prefix:`rel/${me.id}/`});const out=[];
    for(const b of listed.blobs||[]){const id=b.key.split('/').pop(),r=await rel(id);if(!r)continue;const u=await store.get(`user/${id}`,{type:'json',consistency:'strong'});if(u)out.push({user:pub(u),relationship:r});}
    return{statusCode:200,headers,body:JSON.stringify({items:out})};
  }
  if(action==='sync-get'){
    const data=await store.get(`sync/${me.id}`,{type:'json',consistency:'strong'});
    return{statusCode:200,headers,body:JSON.stringify({data:data||null})};
  }
  if(action==='sync-set'){
    const data=body.data;
    if(!data||typeof data!=='object'||JSON.stringify(data).length>1_000_000)return{statusCode:400,headers,body:JSON.stringify({error:'Invalid sync payload'})};
    await store.setJSON(`sync/${me.id}`,{...data,updatedAt:Date.now()});
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  if(action==='presence'){
    const activity=clampText(body.activity||'Browsing Nova Math',80),gameFile=clampText(body.gameFile,180),joinUrl=clampText(body.joinUrl,300),roomCode=clampText(body.roomCode,40);
    await store.setJSON(`presence/${me.id}`,{at:Date.now(),activity,gameFile,joinUrl,roomCode});
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  if(action==='friend-presence'){
    const listed=await store.list({prefix:`rel/${me.id}/`});const out=[];
    for(const b of listed.blobs||[]){const id=b.key.split('/').pop(),r=await rel(id);if(r?.status!=='friends')continue;const u=await store.get(`user/${id}`,{type:'json',consistency:'strong'});const p=await store.get(`presence/${id}`,{type:'json',consistency:'strong'});if(!u)continue;const online=!u.settings?.appearOffline&&p?.at>Date.now()-90000;const visible=online&&u.settings?.showActivity!==false;out.push({user:pub(u),online,lastSeen:p?.at||0,activity:visible?p?.activity:'',gameFile:visible?p?.gameFile:'',joinUrl:visible?p?.joinUrl:'',roomCode:visible?p?.roomCode:''});}
    return{statusCode:200,headers,body:JSON.stringify({items:out})};
  }
  if(action==='share-set'){
    const games=Array.isArray(body.games)?body.games.filter(x=>x&&typeof x.file==='string').slice(0,80).map(x=>({file:clampText(x.file,180),title:clampText(x.title,80)})):[];
    await store.setJSON(`shared/${me.id}`,{games,updatedAt:Date.now()});
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  if(action==='friend-shared'){
    const id=String(body.userId||'');await mustFriend(id);
    const data=await store.get(`shared/${id}`,{type:'json',consistency:'strong'});
    return{statusCode:200,headers,body:JSON.stringify({games:data?.games||[],updatedAt:data?.updatedAt||0})};
  }
  if(action==='send-message'){
    const id=String(body.userId||'');await mustFriend(id);const text=clampText(body.text,500);
    if(!text)return{statusCode:400,headers,body:JSON.stringify({error:'Message is empty.'})};
    const at=Date.now(),key=`dm/${pair(me.id,id)}/${String(at).padStart(13,'0')}-${crypto.randomUUID()}`;
    await store.setJSON(key,{id:key.split('/').pop(),from:me.id,to:id,text,at});
    await notify(id,'message',`Message from ${me.displayName||me.username}`,text,{userId:me.id});
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  if(action==='messages'){
    const id=String(body.userId||'');await mustFriend(id);const listed=await store.list({prefix:`dm/${pair(me.id,id)}/`});const items=[];
    for(const b of listed.blobs||[]){const m=await store.get(b.key,{type:'json',consistency:'strong'});if(m)items.push(m);}
    items.sort((x,y)=>x.at-y.at);
    return{statusCode:200,headers,body:JSON.stringify({items:items.slice(-80),me:me.id})};
  }
  if(action==='invite'){
    const id=String(body.userId||'');await mustFriend(id);const gameFile=clampText(body.gameFile,180),gameTitle=clampText(body.gameTitle,80),joinUrl=clampText(body.joinUrl,300),roomCode=clampText(body.roomCode,40);
    if(!gameFile&&!joinUrl)return{statusCode:400,headers,body:JSON.stringify({error:'Open a game before sending an invite.'})};
    const inviteId=crypto.randomUUID(),at=Date.now();
    await store.setJSON(`invite/${id}/${inviteId}`,{id:inviteId,from:me.id,gameFile,gameTitle,joinUrl,roomCode,at});
    await notify(id,'game',`${me.displayName||me.username} invited you to play`,gameTitle||'Game',{inviteId,gameFile,roomCode});
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  if(action==='invites'){
    const listed=await store.list({prefix:`invite/${me.id}/`});const items=[];
    for(const b of listed.blobs||[]){const inv=await store.get(b.key,{type:'json',consistency:'strong'});if(!inv)continue;const from=await store.get(`user/${inv.from}`,{type:'json',consistency:'strong'});if(from)items.push({...inv,from:pub(from)});}
    items.sort((x,y)=>y.at-x.at);
    return{statusCode:200,headers,body:JSON.stringify({items:items.slice(0,30)})};
  }

  if(action==='notifications'){
    const listed=await store.list({prefix:`notification/${me.id}/`});const items=[];
    for(const b of listed.blobs||[]){const n=await store.get(b.key,{type:'json',consistency:'strong'});if(n)items.push({...n,_key:b.key});}
    items.sort((x,y)=>y.at-x.at);const recent=items.slice(0,80).map(({_key,...n})=>n);
    return{statusCode:200,headers,body:JSON.stringify({items:recent,unread:recent.filter(x=>!x.read).length})};
  }
  if(action==='notification-read'){
    const id=clampText(body.id,80);const listed=await store.list({prefix:`notification/${me.id}/`});
    for(const b of listed.blobs||[]){const n=await store.get(b.key,{type:'json',consistency:'strong'});if(n?.id===id){n.read=true;await store.setJSON(b.key,n);break;}}
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  if(action==='notifications-read-all'){
    const listed=await store.list({prefix:`notification/${me.id}/`});for(const b of listed.blobs||[]){const n=await store.get(b.key,{type:'json',consistency:'strong'});if(n&&!n.read){n.read=true;await store.setJSON(b.key,n);}}
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }

  if(action==='invite-remove'){
    const id=clampText(body.inviteId,80);if(id)await store.delete(`invite/${me.id}/${id}`);
    return{statusCode:200,headers,body:JSON.stringify({ok:true})};
  }
  return{statusCode:400,headers,body:JSON.stringify({error:'Unknown action'})};
}catch(e){console.error('social-api',e);const msg=e?.message==='You must be friends first.'?e.message:'Social service unavailable.';return{statusCode:500,headers,body:JSON.stringify({error:msg})};}};
