(()=>{
'use strict';
const TOKEN='mh_social_token_v1';
const USER='mh_social_user_v1';
const GUEST='mh_social_guest_session_v1';
const ROOM='mh_social_room_v1';
const SYNC_EXTRA_KEYS=['mediahub_recent_games','mediahub_recent_movies_v1','mediahub_food_requests_v3','mediahub_snack_cart_v1','mh_ui_sfx_v1','mh_ui_sfx_volume_v1'];
let presenceTimer=null,syncTimer=null,chatTimer=null,pendingGateOptions=null;
let sessionVerified=false,sessionVerifyPromise=null;
let currentActivity='Browsing Nova Math',currentGame='',currentRoomCode='';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=()=>localStorage.getItem(TOKEN)||'';
const user=()=>{try{return JSON.parse(localStorage.getItem(USER)||'null')}catch{return null}};
const signedIn=()=>!!(token()&&user());
const activeProfile=()=>localStorage.getItem('mh_active_profile_v1')||'default';

async function call(action,data={},method='POST'){
  const r=await fetch('/api/social-api',{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+token()},body:method==='POST'?JSON.stringify({action,...data}):undefined,cache:'no-store'});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||'Request failed');
  return j;
}

function readAuthFields(source){
  const gate=source==='gate';
  return {
    username:$(gate?'#mhGateUsername':'#mhSocialUsername')?.value.trim()||'',
    displayName:$(gate?'#mhGateDisplay':'#mhSocialDisplay')?.value.trim()||'',
    password:$(gate?'#mhGatePassword':'#mhSocialPassword')?.value||'',
    status:$(gate?'#mhGateStatus':'#mhSocialStatus')
  };
}
async function auth(action,source='modal'){
  const f=readAuthFields(source);
  if(!f.username||!f.password){if(f.status)f.status.textContent='Username and password required.';return;}
  if(f.status)f.status.textContent=action==='signup'?'Creating account…':'Signing in…';
  try{
    const r=await fetch('/api/social-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,username:f.username,password:f.password,displayName:f.displayName||f.username}),cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||'Sign in failed');
    localStorage.setItem(TOKEN,j.token);localStorage.setItem(USER,JSON.stringify(j.user));sessionStorage.removeItem(GUEST);sessionVerified=true;
    if(f.status)f.status.textContent='Signed in · @'+j.user.username;
    startPresence();updateHeader();
    if(source==='gate')finishGateEntry();else render();
    // Authentication is complete before cloud sync starts. Sync failures must never block login.
    Promise.resolve().then(()=>pullSync()).catch(()=>{});
    Promise.resolve().then(()=>pushSharedGames()).catch(()=>{});
  }catch(e){if(f.status)f.status.textContent=e.message||'Account service unavailable.';}
}
function logout(){
  localStorage.removeItem(TOKEN);localStorage.removeItem(USER);sessionStorage.removeItem(GUEST);sessionVerified=false;sessionVerifyPromise=null;
  clearInterval(presenceTimer);presenceTimer=null;clearInterval(chatTimer);chatTimer=null;
  updateHeader();render();
}

function ensureGate(){
  if($('#mhAccountGate'))return;
  const el=document.createElement('section');
  el.id='mhAccountGate';el.className='mh-account-gate';el.hidden=true;
  el.innerHTML=`<div class="mh-gate-card" role="dialog" aria-modal="true" aria-labelledby="mhGateTitle">
    <div class="mh-gate-brand"><span>NOVA</span> MATH</div>
    <div class="mh-gate-copy"><small>NOVA MATH ACCOUNT</small><h2 id="mhGateTitle">Account sign in</h2><p>Username and password. No email required.</p></div>
    <div class="mh-gate-benefits"><span>☁ Cross-device sync</span><span>● Friends online</span><span>🎮 Game activity</span><span>✉ Messages & invites</span></div>
    <div class="mh-gate-form">
      <label>Username<input id="mhGateUsername" maxlength="20" autocomplete="username" placeholder="username"></label>
      <label class="mh-gate-display">Display name<input id="mhGateDisplay" maxlength="30" placeholder="Only needed for a new account"></label>
      <label>Password<input id="mhGatePassword" type="password" maxlength="128" autocomplete="current-password" placeholder="6+ characters"></label>
      <div class="mh-gate-actions"><button class="primary" type="button" id="mhGateLogin">Sign in</button><button type="button" id="mhGateSignup">Create account</button></div>
      <div id="mhGateStatus" class="mh-gate-status">Account data syncs across signed-in devices.</div>
    </div>
    <div class="mh-gate-bottom"><button type="button" id="mhGateGuest">Continue as guest</button><button type="button" id="mhGateBack">Back to Calculator</button></div>
  </div>`;
  document.body.appendChild(el);
  $('#mhGateLogin').onclick=()=>auth('login','gate');
  $('#mhGateSignup').onclick=()=>auth('signup','gate');
  $('#mhGateGuest').onclick=()=>{sessionStorage.setItem(GUEST,'1');finishGateEntry();};
  $('#mhGateBack').onclick=()=>{el.hidden=true;document.body.classList.remove('mh-gate-open');pendingGateOptions=null;};
  $('#mhGatePassword').addEventListener('keydown',e=>{if(e.key==='Enter')auth('login','gate');});
}
async function checkAuthHealth(){
  const status=$('#mhGateStatus');
  try{
    const r=await fetch('/api/social-auth',{headers:{Accept:'application/json'},cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||j.configured===false)throw new Error(j.error||'Account service unavailable.');
    if(status&&!signedIn())status.textContent='Account service ready.';
    return true;
  }catch(e){
    if(status)status.textContent=e.message||'Account service unavailable.';
    return false;
  }
}
async function verifyExistingSession(){
  if(!signedIn())return false;
  if(sessionVerified)return true;
  if(sessionVerifyPromise)return sessionVerifyPromise;
  sessionVerifyPromise=(async()=>{
    try{
      const j=await call('me');
      if(!j?.user)throw new Error('Session unavailable');
      const u=j.user;localStorage.setItem(USER,JSON.stringify({id:u.id,username:u.username,displayName:u.displayName,avatar:u.avatar}));
      sessionVerified=true;updateHeader();return true;
    }catch{
      localStorage.removeItem(TOKEN);localStorage.removeItem(USER);sessionVerified=false;updateHeader();return false;
    }finally{sessionVerifyPromise=null;}
  })();
  return sessionVerifyPromise;
}
function accountGate(options){
  if(options?.skipAccountGate||sessionStorage.getItem(GUEST)==='1')return true;
  if(signedIn()&&sessionVerified)return true;
  ensureGate();pendingGateOptions={...(options||{})};
  $('#mhAccountGate').hidden=false;document.body.classList.add('mh-gate-open');
  const status=$('#mhGateStatus');
  if(signedIn()){
    if(status)status.textContent='Checking saved session…';
    verifyExistingSession().then(ok=>{
      if(ok)finishGateEntry();
      else{if(status)status.textContent='Saved session expired. Sign in again.';checkAuthHealth();setTimeout(()=>$('#mhGateUsername')?.focus(),40);}
    });
  }else{
    checkAuthHealth();setTimeout(()=>$('#mhGateUsername')?.focus(),40);
  }
  return false;
}
function finishGateEntry(){
  ensureGate();$('#mhAccountGate').hidden=true;document.body.classList.remove('mh-gate-open');
  const opts={...(pendingGateOptions||{}),skipAccountGate:true};pendingGateOptions=null;
  if(typeof window.enterMediaHub==='function')window.enterMediaHub(opts);
}

function ensure(){
  if($('#mhSocialModal'))return;
  const el=document.createElement('section');el.id='mhSocialModal';el.className='mh-social-modal';el.hidden=true;
  el.innerHTML=`<div class="mh-social-head"><div><strong>Friends</strong><small id="mhSocialMe">Nova Math Social</small></div><button id="mhSocialClose" aria-label="Close">×</button></div><div id="mhSocialBody"></div>`;
  document.body.appendChild(el);$('#mhSocialClose').onclick=()=>{el.hidden=true;clearInterval(chatTimer);chatTimer=null;};
}
function ensureHeader(){
  const tools=document.querySelector('.hub-tools');if(!tools||$('#mhSocialHeaderBtn'))return;
  const b=document.createElement('button');b.id='mhSocialHeaderBtn';b.className='hub-social-btn';b.type='button';b.onclick=open;
  b.innerHTML='<span class="mh-header-avatar">🎮</span><span class="mh-header-social-copy"><strong>Sign in</strong><small>Friends</small></span><i id="mhSocialBadge" hidden>0</i>';
  tools.insertBefore(b,tools.firstChild);updateHeader();
}
function updateHeader(count){
  ensureHeader();const b=$('#mhSocialHeaderBtn'),u=user();if(!b)return;
  const avatar=b.querySelector('.mh-header-avatar'),strong=b.querySelector('strong'),small=b.querySelector('small'),badge=$('#mhSocialBadge');
  if(u&&token()){if(avatar)avatar.textContent=u.avatar||'🎮';if(strong)strong.textContent=u.displayName||u.username;if(small)small.textContent='@'+u.username;}else{if(avatar)avatar.textContent='👤';if(strong)strong.textContent='Sign in';if(small)small.textContent='Friends';}
  if(typeof count==='number'&&badge){badge.textContent=String(count);badge.hidden=count<1;}
}
function open(){ensure();$('#mhSocialModal').hidden=false;render();}

async function render(){
  ensure();ensureHeader();clearInterval(chatTimer);chatTimer=null;
  const body=$('#mhSocialBody'),u=user();if(!body)return;
  if(!u||!token()){
    body.innerHTML=`<div class="mh-social-auth"><h3>Nova Math account</h3><p>Username and password. No email required.</p><input id="mhSocialUsername" maxlength="20" autocomplete="username" placeholder="Username"><input id="mhSocialDisplay" maxlength="30" placeholder="Display name (new accounts)"><input id="mhSocialPassword" type="password" maxlength="128" autocomplete="current-password" placeholder="Password"><div class="mh-social-actions"><button onclick="mhSocialLogin()">Sign in</button><button onclick="mhSocialSignup()">Create account</button></div><small id="mhSocialStatus">Cross-device sync enabled after sign in.</small></div>`;
    updateHeader(0);return;
  }
  $('#mhSocialMe').textContent=`${u.avatar||'🎮'} ${u.displayName||u.username} · @${u.username}`;
  body.innerHTML=`<div class="mh-social-profile-card"><div class="mh-profile-top"><span class="mh-profile-big-avatar">${esc(u.avatar||'🎮')}</span><div><strong>${esc(u.displayName||u.username)}</strong><small>@${esc(u.username)}</small></div></div><div class="mh-profile-edit-grid"><input id="mhProfileAvatar" maxlength="8" value="${esc(u.avatar||'🎮')}" placeholder="Avatar emoji"><input id="mhProfileDisplay" maxlength="30" value="${esc(u.displayName||u.username)}" placeholder="Display name"><input id="mhProfileStatus" maxlength="60" placeholder="Custom status"><input id="mhProfileBio" maxlength="120" placeholder="Short bio"><select id="mhProfileBanner"><option value="midnight">Midnight banner</option><option value="yellow">Yellow banner</option><option value="purple">Purple banner</option><option value="ocean">Ocean banner</option><option value="sunset">Sunset banner</option></select></div><button onclick="mhSaveSocialProfile()">Save profile</button></div>
  <div id="mhSocialNotifications" class="mh-social-section"><div class="mh-social-title">Notifications <button onclick="mhRefreshFriends()">Refresh</button></div><div id="mhNotificationList">Loading…</div></div>
  <div class="mh-social-toolbar"><input id="mhFriendSearch" maxlength="20" placeholder="Find friend by username"><button onclick="mhFindFriend()">Find</button></div><div id="mhFriendResult"></div>
  <div class="mh-social-section"><div class="mh-social-title">Friends & activity</div><div id="mhActivityFeed" class="mh-activity-feed"></div><div id="mhFriendsList">Loading…</div></div>
  <div class="mh-social-section"><div class="mh-social-title">Party</div><p class="mh-social-help">If a game uses a room or lobby code, share it here. Friends will get the code when they join or accept an invite.</p><div class="mh-party-row"><input id="mhRoomCode" maxlength="40" value="${esc(currentRoomCode||localStorage.getItem(ROOM)||'')}" placeholder="Optional room / lobby code"><button onclick="mhSavePartyCode()">Save</button></div></div>
  <div class="mh-social-section"><div class="mh-social-title">Privacy</div><label><input id="mhAppearOffline" type="checkbox"> Appear offline</label><label><input id="mhShowActivity" type="checkbox" checked> Show current activity</label><button onclick="mhSaveSocialPrivacy()">Save privacy</button></div>
  <button class="mh-social-signout" onclick="mhSocialLogout()">Sign out</button>`;
  try{
    const me=await call('me');
    const nu=me.user;localStorage.setItem(USER,JSON.stringify({id:nu.id,username:nu.username,displayName:nu.displayName,avatar:nu.avatar}));
    $('#mhProfileStatus').value=nu.customStatus||'';$('#mhProfileBio').value=nu.bio||'';if($('#mhProfileBanner'))$('#mhProfileBanner').value=nu.banner||'midnight';$('#mhAppearOffline').checked=!!nu.settings?.appearOffline;$('#mhShowActivity').checked=nu.settings?.showActivity!==false;updateHeader();
  }catch{}
  refreshFriends();
}

async function saveProfile(){
  try{
    const me=await call('me');
    const j=await call('profile',{displayName:$('#mhProfileDisplay')?.value||me.user.displayName,avatar:$('#mhProfileAvatar')?.value||me.user.avatar,bio:$('#mhProfileBio')?.value||'',customStatus:$('#mhProfileStatus')?.value||'',banner:$('#mhProfileBanner')?.value||me.user.banner||'midnight',appearOffline:!!me.user.settings?.appearOffline,showActivity:me.user.settings?.showActivity!==false});
    localStorage.setItem(USER,JSON.stringify({id:j.user.id,username:j.user.username,displayName:j.user.displayName,avatar:j.user.avatar}));updateHeader();render();
  }catch(e){alert(e.message);}
}
async function findFriend(){
  const q=$('#mhFriendSearch')?.value.trim(),out=$('#mhFriendResult');if(!q||!out)return;out.textContent='Searching…';
  try{const j=await call('find',{username:q}),r=j.relationship?.status;out.innerHTML=`<div class="mh-friend-card"><span class="mh-friend-avatar">${esc(j.user.avatar)}</span><div><strong>${esc(j.user.displayName)}</strong><small>@${esc(j.user.username)}</small>${j.user.customStatus?`<em>${esc(j.user.customStatus)}</em>`:''}</div>${r?`<span class="mh-relation">${esc(r)}</span>`:`<button onclick="mhFriendAction('request','${j.user.id}')">Add friend</button>`}</div>`;}catch(e){out.textContent=e.message;}
}
async function action(a,id){try{await call(a,{userId:id});await refreshFriends();}catch(e){alert(e.message);}}
function since(ts){if(!ts)return 'Offline';const s=Math.max(0,Math.floor((Date.now()-ts)/1000));if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}

async function refreshFriends(){
  const box=$('#mhFriendsList'),notes=$('#mhNotificationList'),feed=$('#mhActivityFeed');
  try{
    const [f,p,inv]=await Promise.all([call('friends'),call('friend-presence'),call('invites')]);
    const items=f.items||[],presence=p.items||[],pm=new Map(presence.map(x=>[x.user.id,x]));
    const incoming=items.filter(x=>x.relationship.status==='incoming');const invites=inv.items||[];updateHeader(incoming.length+invites.length);
    if(notes){
      const note=[];
      incoming.forEach(x=>note.push(`<div class="mh-notice"><span>${esc(x.user.avatar)}</span><div><strong>${esc(x.user.displayName)} sent a friend request</strong><small>@${esc(x.user.username)}</small></div><button onclick="mhFriendAction('accept','${x.user.id}')">Accept</button></div>`));
      invites.forEach(x=>note.push(`<div class="mh-notice"><span>🎮</span><div><strong>${esc(x.from.displayName)} invited you to ${esc(x.gameTitle||'a game')}</strong><small>${x.roomCode?'Room '+esc(x.roomCode)+' · ':''}${since(x.at)}</small></div><button onclick="mhAcceptInvite('${x.id}')">Join</button><button class="ghost" onclick="mhDismissInvite('${x.id}')">×</button></div>`));
      try{const food=JSON.parse(localStorage.getItem('mediahub_food_requests_v3')||'[]')[0];if(food)note.push(`<div class="mh-notice muted"><span>🥤</span><div><strong>Snack Drop request pending</strong><small>${esc(food.summary||'Order')} · ${esc(food.window||'')}</small></div></div>`);}catch{}
      notes.innerHTML=note.length?note.join(''):'<div class="mh-social-empty">No new activity.</div>';
    }
    if(feed){
      const live=presence.filter(x=>x.online).sort((a,b)=>Number(!!b.gameFile)-Number(!!a.gameFile));
      feed.innerHTML=live.length?live.map(x=>`<button type="button" class="mh-activity-pill" onclick="mhOpenFriendQuick('${x.user.id}')"><span class="mh-presence online"></span>${esc(x.user.displayName)} · ${esc(x.activity||'Online')}</button>`).join(''):'<span class="mh-social-empty">No friends are online right now.</span>';
    }
    if(box)box.innerHTML='';
    for(const x of items){
      const r=x.relationship.status,pr=pm.get(x.user.id),online=!!pr?.online,activity=pr?.activity||'',join=pr?.gameFile||pr?.joinUrl;
      const card=document.createElement('div');card.className='mh-friend-card mh-friend-live';
      card.innerHTML=`<span class="mh-presence ${online?'online':'offline'}"></span><span class="mh-friend-avatar">${esc(x.user.avatar)}</span><div class="mh-friend-copy"><strong>${esc(x.user.displayName)}</strong><small>@${esc(x.user.username)} · ${r==='incoming'?'Friend request':r==='outgoing'?'Request sent':online?'Online':'Last seen '+since(pr?.lastSeen)}</small>${x.user.customStatus?`<em>${esc(x.user.customStatus)}</em>`:''}${activity?`<em class="activity">${esc(activity)}${pr?.roomCode?' · Room '+esc(pr.roomCode):''}</em>`:''}</div><div class="mh-friend-actions">${r==='incoming'?`<button data-a="accept">Accept</button>`:''}${r==='friends'&&join?`<button data-a="join">Join</button>`:''}${r==='friends'?`<button class="ghost" data-a="profile">Profile</button><button class="ghost" data-a="invite">Invite</button><button class="ghost" data-a="chat">Message</button><button class="ghost" data-a="list">Games</button>`:''}<button class="ghost" data-a="remove">${r==='friends'?'Remove':'Cancel'}</button></div>`;
      card.querySelector('[data-a="accept"]')?.addEventListener('click',()=>action('accept',x.user.id));card.querySelector('[data-a="remove"]')?.addEventListener('click',()=>action('remove',x.user.id));card.querySelector('[data-a="join"]')?.addEventListener('click',()=>joinGame(pr));card.querySelector('[data-a="profile"]')?.addEventListener('click',()=>window.mhOpenProfile?.(x.user.id));card.querySelector('[data-a="invite"]')?.addEventListener('click',()=>inviteFriend(x.user));card.querySelector('[data-a="chat"]')?.addEventListener('click',()=>openChat(x.user));card.querySelector('[data-a="list"]')?.addEventListener('click',()=>showSharedGames(x.user));if(box)box.appendChild(card);
    }
    if(box&&!items.length)box.innerHTML='<div class="mh-social-empty">No friends yet. Search for a username above.</div>';
  }catch(e){if(box)box.textContent=e.message;}
}
function joinGame(p){
  if(p?.roomCode){navigator.clipboard?.writeText?.(p.roomCode).then(()=>window.showToast?.('Room code copied','📋')).catch(()=>{});}
  const g=(window.BUILT_IN_GAMES||[]).find(x=>x.file===p?.gameFile);
  if(g&&(window.mhLaunchGameDirect||window.openGame)){(window.mhLaunchGameDirect||window.openGame)(g);$('#mhSocialModal').hidden=true;}
  else if(p?.joinUrl){location.href=p.joinUrl;}
  else alert('This activity does not have a joinable session.');
}
async function privacy(){try{const me=await call('me');await call('profile',{displayName:me.user.displayName,avatar:me.user.avatar,bio:me.user.bio,customStatus:me.user.customStatus,banner:me.user.banner||'midnight',appearOffline:$('#mhAppearOffline').checked,showActivity:$('#mhShowActivity').checked});await ping();window.showToast?.('Privacy updated','✓');}catch(e){alert(e.message);}}
function savePartyCode(){currentRoomCode=String($('#mhRoomCode')?.value||'').trim().slice(0,40);localStorage.setItem(ROOM,currentRoomCode);ping();window.showToast?.(currentRoomCode?'Party code saved':'Party code cleared','🎮');}
async function inviteFriend(friend){
  if(!currentGame){alert('Open a game first, then send the invite.');return;}
  try{const g=(window.BUILT_IN_GAMES||[]).find(x=>x.file===currentGame);await call('invite',{userId:friend.id,gameFile:currentGame,gameTitle:g?.title||currentActivity.replace(/^Playing\s+/,'')||'Game',roomCode:currentRoomCode||localStorage.getItem(ROOM)||'',joinUrl:''});window.showToast?.('Game invite sent','🎮');}catch(e){alert(e.message);}
}
async function dismissInvite(id){try{await call('invite-remove',{inviteId:id});await refreshFriends();}catch(e){alert(e.message);}}
async function acceptInvite(id){
  try{const j=await call('invites'),inv=(j.items||[]).find(x=>x.id===id);if(!inv)return dismissInvite(id);await call('invite-remove',{inviteId:id});joinGame(inv);}catch(e){alert(e.message);}
}
async function showSharedGames(friend){
  const out=$('#mhFriendResult');if(!out)return;out.innerHTML='<div class="mh-social-empty">Loading shared games…</div>';
  try{const j=await call('friend-shared',{userId:friend.id});const games=j.games||[];out.innerHTML=`<div class="mh-shared-panel"><div class="mh-shared-head"><strong>${esc(friend.displayName)}’s saved games</strong><button onclick="document.getElementById('mhFriendResult').innerHTML=''">×</button></div>${games.length?games.map(g=>`<button class="mh-shared-game" onclick="mhLaunchSharedGame('${esc(g.file).replace(/'/g,'&#39;')}')"><span>▶</span>${esc(g.title||g.file)}</button>`).join(''):'<div class="mh-social-empty">No shared favorites yet.</div>'}</div>`;}catch(e){out.textContent=e.message;}
}
function launchSharedGame(file){const g=(window.BUILT_IN_GAMES||[]).find(x=>x.file===file);if(g&&(window.mhLaunchGameDirect||window.openGame)){(window.mhLaunchGameDirect||window.openGame)(g);$('#mhSocialModal').hidden=true;}else alert('That game is not available in this build.');}
async function pushSharedGames(){
  if(!signedIn())return;
  try{const raw=JSON.parse(localStorage.getItem(`mh:${activeProfile()}:my_games`)||'[]');const map=new Map((window.BUILT_IN_GAMES||[]).map(g=>[g.file,g.title]));const games=(Array.isArray(raw)?raw:[]).slice(0,80).map(file=>({file,title:map.get(file)||file}));await call('share-set',{games});}catch{}
}

async function openChat(friend){
  clearInterval(chatTimer);const body=$('#mhSocialBody');if(!body)return;
  body.innerHTML=`<div class="mh-chat"><div class="mh-chat-head"><button id="mhChatBack">←</button><span class="mh-friend-avatar">${esc(friend.avatar)}</span><div><strong>${esc(friend.displayName)}</strong><small>@${esc(friend.username)}</small></div></div><div id="mhChatMessages" class="mh-chat-messages">Loading…</div><div class="mh-chat-compose"><input id="mhChatInput" maxlength="500" placeholder="Message ${esc(friend.displayName)}"><button id="mhChatSend">Send</button></div></div>`;
  $('#mhChatBack').onclick=render;$('#mhChatSend').onclick=()=>sendMessage(friend);$('#mhChatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage(friend);}});
  await loadMessages(friend);chatTimer=setInterval(()=>loadMessages(friend,true),5000);
}
async function loadMessages(friend,quiet=false){
  const box=$('#mhChatMessages');if(!box)return;
  try{const j=await call('messages',{userId:friend.id});const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;box.innerHTML=(j.items||[]).length?(j.items||[]).map(m=>`<div class="mh-message ${m.from===j.me?'mine':''}"><span>${esc(m.text)}</span><small>${new Date(m.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></div>`).join(''):'<div class="mh-social-empty">No messages yet.</div>';if(!quiet||atBottom)box.scrollTop=box.scrollHeight;}catch(e){if(!quiet)box.textContent=e.message;}
}
async function sendMessage(friend){const input=$('#mhChatInput'),text=input?.value.trim();if(!text)return;input.value='';try{await call('send-message',{userId:friend.id,text});await loadMessages(friend);}catch(e){alert(e.message);}}

function snapshot(){
  const values={};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&(k.startsWith('mh:')||k.startsWith('musicFavorite:')||k==='mh_profiles_v1'||k==='mh_active_profile_v1'||SYNC_EXTRA_KEYS.includes(k)))values[k]=localStorage.getItem(k);}if(localStorage.getItem('mh_game_save_sync_v1')==='1'){let bytes=0;for(let i=0;i<localStorage.length&&bytes<450000;i++){const k=localStorage.key(i);if(!k||Object.prototype.hasOwnProperty.call(values,k)||k==='mh_social_token_v1'||/token|secret|password|auth/i.test(k))continue;const v=localStorage.getItem(k);if(v==null||v.length>100000)continue;bytes+=k.length+v.length;if(bytes<=450000)values[k]=v;}}}catch{}return {values};
}
async function pushSync(){if(!signedIn())return;try{await call('sync-set',{data:snapshot()});await pushSharedGames();}catch{}}
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(pushSync,1200);}
async function pullSync(){if(!signedIn())return;try{const j=await call('sync-get');if(j.data?.values&&Object.keys(j.data.values).length){for(const [k,v] of Object.entries(j.data.values)){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,String(v));}}else await pushSync();}catch{}}
async function refreshBadge(){if(!signedIn())return;try{const [f,inv]=await Promise.all([call('friends'),call('invites')]);const count=(f.items||[]).filter(x=>x.relationship?.status==='incoming').length+(inv.items||[]).length;updateHeader(count);}catch{}}
async function ping(){if(!signedIn())return;try{await call('presence',{activity:currentActivity,gameFile:currentGame,joinUrl:'',roomCode:currentRoomCode||localStorage.getItem(ROOM)||''});}catch(e){if(/sign in/i.test(e.message))logout();}}
function startPresence(){if(!signedIn())return;clearInterval(presenceTimer);ping();refreshBadge();presenceTimer=setInterval(()=>{ping();refreshBadge();if(!$('#mhSocialModal')?.hidden)refreshFriends();},45000);}
function setActivity(activity,file=''){
  const next=file||'';if(next!==currentGame){currentRoomCode='';localStorage.removeItem(ROOM);}currentActivity=activity||'Browsing Nova Math';currentGame=next;ping();
}
function patch(){
  const base=window.openGame;if(base&&!base.__social){const wrapped=function(g,...rest){setActivity(`Playing ${g?.title||'a game'}`,g?.file||'');return base.call(this,g,...rest)};wrapped.__social=true;window.openGame=wrapped;}
  const close=window.closeGamePlayer;if(close&&!close.__social){const wrappedClose=function(...args){const r=close.apply(this,args);setActivity('Browsing Nova Math','');return r};wrappedClose.__social=true;window.closeGamePlayer=wrappedClose;}
  const dash=window.returnToDashboard;if(dash&&!dash.__social){const wrappedDash=function(...args){const r=dash.apply(this,args);setActivity('In Classroom','');return r};wrappedDash.__social=true;window.returnToDashboard=wrappedDash;}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)ping();});
}

window.mhSocialOpen=open;window.mhSocialLogin=()=>auth('login');window.mhSocialSignup=()=>auth('signup');window.mhSocialLogout=logout;
window.mhFindFriend=findFriend;window.mhFriendAction=action;window.mhRefreshFriends=refreshFriends;window.mhSaveSocialPrivacy=privacy;window.mhSaveSocialProfile=saveProfile;window.mhSocialSetActivity=setActivity;
window.mhSavePartyCode=savePartyCode;window.mhAcceptInvite=acceptInvite;window.mhDismissInvite=dismissInvite;window.mhLaunchSharedGame=launchSharedGame;window.mhOpenFriendQuick=()=>open();
window.mhAccountGate=accountGate;window.mhSocialSignedIn=signedIn;window.mhSocialGetUser=user;

document.addEventListener('DOMContentLoaded',()=>{
  ensure();ensureGate();ensureHeader();setTimeout(patch,500);startPresence();
  const old=window.mhScheduleCloudSync;window.mhScheduleCloudSync=()=>{try{old?.()}catch{}scheduleSync();};
  if(signedIn()){pullSync();pushSharedGames();setTimeout(refreshBadge,800);}
});
})();
