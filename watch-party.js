(()=>{
'use strict';
const TOKEN='mh_social_token_v1';
let code='',state=null,serverOffset=0,lastSeq=-1,lastMediaKey='',pollTimer=null,eventTimer=null,lastEventAt=0,scheduledTimer=null,suppressHostUntil=0,lastHeartbeat=0,applyingRemote=false,lastRenderedChat='',hostIsPlaying=false,lastHostId='';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=()=>localStorage.getItem(TOKEN)||'';
const signedIn=()=>!!(window.mhSocialSignedIn?.()&&token());
const me=()=>window.mhSocialGetUser?.()||null;
const isHost=()=>!!(state&&me()?.id===state.hostId);
const nowServer=()=>Date.now()+serverOffset;

async function call(action,data={}){
  const r=await fetch('/api/watch-party',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token()},body:JSON.stringify({action,...data}),cache:'no-store'});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||'Watch Party request failed.');
  return j;
}
async function socialCall(action,data={}){
  const r=await fetch('/api/social-api',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token()},body:JSON.stringify({action,...data}),cache:'no-store'});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||'Friends request failed.');
  return j;
}
function mediaKey(m){return m?`${m.type}:${m.tmdbId}:${m.season||0}:${m.episode||0}`:'';}
function currentMedia(){return window.mhMoviePartySnapshot?.()||null;}
function expectedTime(p=state?.playback){
  if(!p)return 0;
  let t=Number(p.time||0);
  if(p.status==='playing')t+=Math.max(0,(nowServer()-Number(p.updatedAt||nowServer()))/1000);
  return Math.max(0,t);
}
function fmt(sec){sec=Math.max(0,Math.floor(Number(sec)||0));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;}
function ensureUI(){
  if(!$('#mhWatchPartyModal')){
    const modal=document.createElement('section');modal.id='mhWatchPartyModal';modal.className='mh-watch-modal';modal.hidden=true;
    modal.innerHTML=`<div class="mh-watch-card"><div class="mh-watch-head"><div><small>NOVA MATH</small><strong>Watch Party</strong></div><button id="mhWatchClose" aria-label="Close">×</button></div><div id="mhWatchBody"></div></div>`;
    document.body.appendChild(modal);$('#mhWatchClose').onclick=()=>{modal.hidden=true;};modal.addEventListener('click',e=>{if(e.target===modal)modal.hidden=true;});
  }
  if(!$('#mhWatchCountdown')){const x=document.createElement('div');x.id='mhWatchCountdown';x.className='mh-watch-countdown';x.hidden=true;document.body.appendChild(x);}
  const controls=$('#tvEpisodeControls');
  if(controls&&!$('#mhWatchPartyBtn')){const b=document.createElement('button');b.type='button';b.id='mhWatchPartyBtn';b.className='source-action-btn mh-watch-party-btn';b.textContent='Watch Party';b.onclick=open;controls.appendChild(b);}
  const header=$('.movie-source-header');
  if(header&&!$('#mhWatchPartyBtnMovie')){const b=document.createElement('button');b.type='button';b.id='mhWatchPartyBtnMovie';b.className='source-action-btn mh-watch-party-btn';b.textContent='Watch Party';b.onclick=open;header.appendChild(b);}
  const frame=$('#movieEmbedPlayer');
  if(frame&&!$('#mhWatchPartyBar')){const bar=document.createElement('button');bar.type='button';bar.id='mhWatchPartyBar';bar.className='mh-watch-bar';bar.hidden=true;bar.onclick=open;frame.parentNode.insertBefore(bar,frame);}
  const panel=$('#movieWatchPanel');
  if(panel&&!$('#mhWatchReactionLayer')){const layer=document.createElement('div');layer.id='mhWatchReactionLayer';layer.className='mh-watch-reaction-layer';panel.appendChild(layer);}
}
function open(){ensureUI();$('#mhWatchPartyModal').hidden=false;render();if(signedIn())loadInvites();}
function close(){const m=$('#mhWatchPartyModal');if(m)m.hidden=true;}
function render(){
  ensureUI();const body=$('#mhWatchBody');if(!body)return;
  if(!signedIn()){
    body.innerHTML=`<div class="mh-watch-empty"><span>👥</span><h3>Sign in for Watch Party</h3><p>Watch Parties use Nova Math accounts for friends, chat, party codes, and cross-device playback state.</p><button id="mhWatchSignIn">Open account</button></div>`;
    $('#mhWatchSignIn').onclick=()=>{close();window.mhSocialOpen?.();};return;
  }
  if(!state){
    const m=currentMedia();
    body.innerHTML=`<div class="mh-watch-create"><div class="mh-watch-current"><span>🎬</span><div><small>CURRENT TITLE</small><strong>${m?esc(m.title):'Pick a movie or show first'}</strong><em>${m?esc(m.type==='tv'?`TV · S${m.season}E${m.episode}`:'Movie'):'Open Movies & TV, choose a title, then create a party.'}</em></div></div>
      <button id="mhWatchCreate" class="primary" ${m?'':'disabled'}>Create private party</button>
      <div class="mh-watch-or"><span></span>or<span></span></div>
      <div class="mh-watch-join"><input id="mhWatchJoinCode" maxlength="6" autocomplete="off" placeholder="PARTY CODE"><button id="mhWatchJoin">Join</button></div>
      <div class="mh-watch-invites"><div class="mh-watch-title">Invites</div><div id="mhWatchInviteList">Checking invites…</div></div>
      <p class="mh-watch-foot">Party codes are private. Playback sync uses Stellar's documented start-time and playback-event support.</p></div>`;
    $('#mhWatchCreate').onclick=create;$('#mhWatchJoin').onclick=()=>join($('#mhWatchJoinCode').value);$('#mhWatchJoinCode').addEventListener('keydown',e=>{if(e.key==='Enter')join(e.target.value);});return;
  }
  const m=state.media,p=state.playback,members=state.members||[],online=members.filter(x=>x.online),ready=online.filter(x=>x.ready),myRow=members.find(x=>x.user.id===me()?.id),votes=(state.nextVotes||[]).length,needed=Math.max(1,Math.ceil(online.length/2));
  body.innerHTML=`<div class="mh-watch-active">
    <div class="mh-watch-code-row"><div><small>PARTY CODE</small><strong>${esc(state.code)}</strong></div><button id="mhWatchCopy">Copy</button><button id="mhWatchLeave" class="ghost">Leave</button></div>
    <div class="mh-watch-media"><span>▶</span><div><strong>${esc(m.title)}</strong><small>${m.type==='tv'?`S${m.season} E${m.episode}`:'Movie'} · ${esc(p.status==='scheduled'?'Starting together':p.status==='playing'?`Playing near ${fmt(expectedTime())}`:p.status==='paused'?`Paused near ${fmt(p.time)}`:'Ended')}</small></div><button id="mhWatchResync">Resync</button></div>
    <div class="mh-watch-members">${members.map(x=>`<div class="mh-watch-member ${x.online?'online':''}"><span>${esc(x.user.avatar)}</span><b>${esc(x.user.displayName)}</b><i>${x.host?'Host':x.ready?'Ready':'Not ready'}</i></div>`).join('')}</div>
    <div class="mh-watch-actions"><button id="mhWatchReady" class="${myRow?.ready?'active':''}">${myRow?.ready?'Ready ✓':'I’m ready'}</button>${isHost()?`<button id="mhWatchStart" class="primary">${p.status==='paused'&&Number(p.time)>1?'Resume together':'Start together'}</button>`:''}${m.type==='tv'&&online.length>1?`<button id="mhWatchVote">Next episode ${votes}/${needed}</button>`:''}</div>
    <div class="mh-watch-sync-note">${isHost()?'Host controls drive party sync. Pauses and seeks resync members to the host timestamp.':'The host controls playback. Resync reloads playback at the host timestamp.'}</div>
    <div class="mh-watch-reactions"><button data-r="❤️">❤️</button><button data-r="😂">😂</button><button data-r="😮">😮</button><button data-r="👏">👏</button><button data-r="🔥">🔥</button><button data-r="🍿">🍿</button></div>
    <div class="mh-watch-grid"><section><div class="mh-watch-title">Party chat</div><div id="mhWatchChat" class="mh-watch-chat"><div class="mh-watch-muted">Loading chat…</div></div><div class="mh-watch-compose"><input id="mhWatchChatInput" maxlength="400" placeholder="Message the party"><button id="mhWatchSend">Send</button></div></section><section><div class="mh-watch-title">Invite friends</div><div id="mhWatchFriendList" class="mh-watch-friends"><div class="mh-watch-muted">Loading friends…</div></div></section></div>
  </div>`;
  $('#mhWatchCopy').onclick=()=>navigator.clipboard?.writeText(state.code).then(()=>window.showToast?.('Party code copied','📋')).catch(()=>{});
  $('#mhWatchLeave').onclick=leave;$('#mhWatchResync').onclick=()=>applyPlayback(true);$('#mhWatchReady').onclick=()=>setReady(!myRow?.ready);
  $('#mhWatchStart')?.addEventListener('click',startTogether);$('#mhWatchVote')?.addEventListener('click',voteNext);
  document.querySelectorAll('.mh-watch-reactions button').forEach(b=>b.onclick=()=>react(b.dataset.r));
  $('#mhWatchSend').onclick=sendChat;$('#mhWatchChatInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendChat();}});
  loadFriends();loadEvents(true);updateBar();
}
function updateBar(){
  ensureUI();const bar=$('#mhWatchPartyBar');if(!bar)return;if(!state){bar.hidden=true;return;}bar.hidden=false;const online=(state.members||[]).filter(x=>x.online);bar.innerHTML=`<span class="mh-watch-live-dot"></span><strong>Watch Party ${esc(state.code)}</strong><span>${online.slice(0,5).map(x=>esc(x.user.avatar)).join(' ')} · ${online.length} online</span><em>${esc(state.playback?.status||'paused')}</em>`;
}
async function create(){
  const m=currentMedia();if(!m)return;
  try{const j=await call('create',{media:m,time:m.currentTime||0,duration:m.duration||0});setParty(j);window.showToast?.('Watch Party created','🍿');}catch(e){alert(e.message);}
}
async function join(c){
  c=String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(c.length!==6){alert('Enter the 6-character party code.');return;}
  try{const j=await call('join',{code:c});setParty(j);await syncMediaFromState(true);window.showToast?.('Joined Watch Party','🍿');}catch(e){alert(e.message);}
}
async function leave(){
  if(!code)return;const old=code;stopPolling();state=null;code='';lastSeq=-1;lastMediaKey='';updateBar();render();try{await call('leave',{code:old});}catch{}unlockEpisodeControls();
}
function setParty(j){state=j.party;code=state.code;serverOffset=Number(j.serverNow||Date.now())-Date.now();lastSeq=-1;lastMediaKey='';startPolling();render();syncMediaFromState(true);}
function startPolling(){stopPolling();poll();pollTimer=setInterval(poll,2000);eventTimer=setInterval(()=>loadEvents(false),2200);}
function stopPolling(){clearInterval(pollTimer);clearInterval(eventTimer);clearTimeout(scheduledTimer);pollTimer=eventTimer=scheduledTimer=null;}
async function poll(){
  if(!code||!signedIn())return;
  try{const j=await call('state',{code});const oldMedia=mediaKey(state?.media),oldHost=state?.hostId;state=j.party;serverOffset=Number(j.serverNow||Date.now())-Date.now();const newMedia=mediaKey(state.media),localMedia=mediaKey(currentMedia());if(newMedia!==oldMedia||localMedia!==newMedia)await syncMediaFromState(true);lockEpisodeControls();await applyPlayback(false);updateBar();if(!$('#mhWatchPartyModal')?.hidden){if(oldHost!==state.hostId)render();else renderSoft();}checkVoteAdvance();}
  catch(e){if(/ended|not in/i.test(e.message)){stopPolling();state=null;code='';updateBar();if(!$('#mhWatchPartyModal')?.hidden)render();window.showToast?.('Watch Party ended','🍿');}}
}
function renderSoft(){
  const body=$('#mhWatchBody');if(!body||!state)return;const active=body.querySelector('.mh-watch-active');if(!active){render();return;}
  const m=state.media,p=state.playback,members=state.members||[],online=members.filter(x=>x.online),ready=online.filter(x=>x.ready),myRow=members.find(x=>x.user.id===me()?.id),votes=(state.nextVotes||[]).length,needed=Math.max(1,Math.ceil(online.length/2));
  const media=active.querySelector('.mh-watch-media small');if(media)media.textContent=`${m.type==='tv'?`S${m.season} E${m.episode}`:'Movie'} · ${p.status==='scheduled'?'Starting together':p.status==='playing'?`Playing near ${fmt(expectedTime())}`:p.status==='paused'?`Paused near ${fmt(p.time)}`:'Ended'}`;
  const mem=active.querySelector('.mh-watch-members');if(mem)mem.innerHTML=members.map(x=>`<div class="mh-watch-member ${x.online?'online':''}"><span>${esc(x.user.avatar)}</span><b>${esc(x.user.displayName)}</b><i>${x.host?'Host':x.ready?'Ready':'Not ready'}</i></div>`).join('');
  const readyBtn=$('#mhWatchReady');if(readyBtn){readyBtn.classList.toggle('active',!!myRow?.ready);readyBtn.textContent=myRow?.ready?'Ready ✓':'I’m ready';}
  const vote=$('#mhWatchVote');if(vote)vote.textContent=`Next episode ${votes}/${needed}`;
  const start=$('#mhWatchStart');if(start)start.textContent=p.status==='paused'&&Number(p.time)>1?'Resume together':'Start together';
}
async function setReady(ready){try{const j=await call('ready',{code,ready});state=j.party;render();}catch(e){alert(e.message);}}
async function startTogether(){
  const snap=currentMedia()||{};try{const j=await call('start',{code,time:Number(snap.currentTime||expectedTime()||0),duration:Number(snap.duration||0)});state=j.party;serverOffset=Number(j.serverNow||Date.now())-Date.now();renderSoft();await applyPlayback(false);}catch(e){if(/not ready/i.test(e.message)&&confirm(e.message+' Start anyway?')){try{const j=await call('start',{code,time:Number(snap.currentTime||0),duration:Number(snap.duration||0),force:true});state=j.party;serverOffset=Number(j.serverNow||Date.now())-Date.now();await applyPlayback(false);}catch(x){alert(x.message);}}else alert(e.message);}
}
async function applyPlayback(force){
  if(!state?.playback)return;const p=state.playback;if(!force&&Number(p.seq||0)===lastSeq)return;lastSeq=Number(p.seq||0);
  if(p.status==='scheduled'){
    clearTimeout(scheduledTimer);const delay=Math.max(0,Number(p.startAt||nowServer())-nowServer());showCountdown(delay);
    scheduledTimer=setTimeout(()=>{suppressHostUntil=Date.now()+4500;window.mhMoviePartyResync?.(Number(p.time||0),true);hideCountdown();},delay);return;
  }
  if(isHost()&&!force)return;
  const t=expectedTime(p);applyingRemote=true;try{window.mhMoviePartyResync?.(t,p.status==='playing');}finally{setTimeout(()=>{applyingRemote=false;},1000);}
}
function showCountdown(delay){const el=$('#mhWatchCountdown');if(!el)return;el.hidden=false;const end=Date.now()+delay;const tick=()=>{if(el.hidden)return;const left=Math.max(0,end-Date.now());el.textContent=left>2500?'3':left>1500?'2':left>500?'1':'PLAY';if(left>0)requestAnimationFrame(tick);};tick();}
function hideCountdown(){const el=$('#mhWatchCountdown');if(el)el.hidden=true;}
async function syncMediaFromState(force){
  if(!state?.media)return;const key=mediaKey(state.media);const local=currentMedia();if(!force&&key===mediaKey(local))return;lastMediaKey=key;applyingRemote=true;
  try{await window.mhMoviePartyLoadMedia?.(state.media,{startAt:expectedTime(),autoPlay:false});}finally{setTimeout(()=>{applyingRemote=false;},1200);}lockEpisodeControls();
}
function lockEpisodeControls(){const locked=!!state&&!isHost();['movieSeasonSelect','movieEpisodeSelect','movieNextEpisodeBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=locked;});}
function unlockEpisodeControls(){['movieSeasonSelect','movieEpisodeSelect','movieNextEpisodeBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=false;});}
async function mediaChanged(){
  if(!state||!isHost()||applyingRemote)return;const m=currentMedia();if(!m)return;const key=mediaKey(m);if(key===mediaKey(state.media))return;
  try{const j=await call('media',{code,media:m,time:m.currentTime||0,duration:m.duration||0});state=j.party;lastSeq=-1;renderSoft();}catch(e){console.warn('Watch Party media update failed',e);}
}
async function hostPlayerEvent(ev){
  if(!state||!isHost()||applyingRemote)return;const name=String(ev?.event||'').toLowerCase();const time=Number(ev?.currentTime||0),duration=Number(ev?.duration||0),now=Date.now();
  if(name==='play')hostIsPlaying=true;if(name==='pause'||name==='ended')hostIsPlaying=false;
  if(name==='timeupdate'){if(now-lastHeartbeat<7000)return;lastHeartbeat=now;try{await call('playback',{code,status:hostIsPlaying?'playing':'paused',time,duration,bump:false});}catch{}return;}
  if(now<suppressHostUntil&&name==='play'){try{await call('playback',{code,status:'playing',time,duration,bump:false});}catch{}return;}
  const status=name==='ended'?'ended':name==='pause'?'paused':name==='seeked'?(hostIsPlaying?'playing':'paused'):'playing';if(!['play','pause','seeked','ended'].includes(name))return;
  try{const j=await call('playback',{code,status,time,duration,bump:true});if(state?.playback){state.playback={...state.playback,status,time,duration,updatedAt:j.serverNow,seq:j.seq};lastSeq=j.seq;updateBar();}}catch{}
}
async function loadEvents(force){
  if(!code)return;try{const j=await call('events',{code,since:force?0:lastEventAt});serverOffset=Number(j.serverNow||Date.now())-Date.now();const chats=j.chats||[],reactions=j.reactions||[];if(chats.length||force)renderChat(chats,force);for(const r of reactions){if(r.at>lastEventAt)showReaction(r);}const max=Math.max(lastEventAt,...chats.map(x=>x.at||0),...reactions.map(x=>x.at||0));lastEventAt=max;}catch{}
}
function renderChat(chats,force){
  const box=$('#mhWatchChat');if(!box)return;let rows=chats;if(!force&&chats.length){const existing=box.dataset.rows?JSON.parse(box.dataset.rows):[];const map=new Map(existing.concat(chats).map(x=>[x.id,x]));rows=[...map.values()].sort((a,b)=>a.at-b.at).slice(-60);}box.dataset.rows=JSON.stringify(rows);const html=rows.length?rows.map(x=>`<div class="mh-watch-chat-row ${x.from===me()?.id?'mine':''}"><span>${esc(x.user?.avatar||'🎮')}</span><div><b>${esc(x.user?.displayName||'User')}</b><p>${esc(x.text)}</p><small>${new Date(x.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></div></div>`).join(''):'<div class="mh-watch-muted">No messages yet.</div>';if(html!==lastRenderedChat){const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;box.innerHTML=html;lastRenderedChat=html;if(force||atBottom)box.scrollTop=box.scrollHeight;}}
async function sendChat(){const input=$('#mhWatchChatInput'),msg=input?.value.trim();if(!msg)return;input.value='';try{await call('chat-send',{code,text:msg});await loadEvents(true);}catch(e){alert(e.message);}}
async function react(emoji){try{await call('react',{code,emoji});}catch{}}
function showReaction(r){const layer=$('#mhWatchReactionLayer');if(!layer)return;const el=document.createElement('div');el.className='mh-watch-float-reaction';el.textContent=r.emoji;el.style.left=`${15+Math.random()*70}%`;layer.appendChild(el);setTimeout(()=>el.remove(),2200);}
async function voteNext(){try{const j=await call('next-vote',{code});state=j.party;renderSoft();checkVoteAdvance();}catch(e){alert(e.message);}}
async function checkVoteAdvance(){
  if(!state||!isHost()||state.media?.type!=='tv')return;const online=(state.members||[]).filter(x=>x.online);if(online.length<2)return;const needed=Math.ceil(online.length/2);if((state.nextVotes||[]).length<needed)return;
  try{await call('clear-votes',{code});await window.playNextEpisode?.();setTimeout(mediaChanged,100);}catch(e){console.warn(e);}
}
async function loadFriends(){
  const box=$('#mhWatchFriendList');if(!box||!state)return;try{const j=await socialCall('friends');const friends=(j.items||[]).filter(x=>x.relationship?.status==='friends');box.innerHTML=friends.length?friends.map(x=>`<div class="mh-watch-friend"><span>${esc(x.user.avatar)}</span><b>${esc(x.user.displayName)}</b><button data-id="${esc(x.user.id)}">Invite</button></div>`).join(''):'<div class="mh-watch-muted">Add friends from the Friends menu first.</div>';box.querySelectorAll('button[data-id]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await call('invite',{code,userId:b.dataset.id});b.textContent='Sent ✓';}catch(e){alert(e.message);b.disabled=false;}});}catch(e){box.textContent=e.message;}}
async function loadInvites(){
  const box=$('#mhWatchInviteList');if(!box||state)return;try{const j=await call('invites');const items=j.items||[];box.innerHTML=items.length?items.map(x=>`<div class="mh-watch-invite"><span>${esc(x.from?.avatar||'🎮')}</span><div><b>${esc(x.from?.displayName||'Friend')}</b><small>${esc(x.media?.title||'Watch Party')} · ${esc(x.code)}</small></div><button data-join="${esc(x.code)}" data-id="${esc(x.id)}">Join</button><button class="ghost" data-dismiss="${esc(x.id)}">×</button></div>`).join(''):'<div class="mh-watch-muted">No Watch Party invites.</div>';box.querySelectorAll('[data-join]').forEach(b=>b.onclick=async()=>{await call('invite-remove',{inviteId:b.dataset.id}).catch(()=>{});join(b.dataset.join);});box.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=async()=>{await call('invite-remove',{inviteId:b.dataset.dismiss});loadInvites();});}catch(e){box.textContent=e.message;}}

window.mhWatchPartyOpen=open;
window.mhWatchPartyMediaChanged=mediaChanged;
window.mhWatchPartyHostPlayerEvent=hostPlayerEvent;
window.mhWatchPartyIsApplying=()=>applyingRemote;
window.mhWatchPartyActive=()=>!!state;

document.addEventListener('DOMContentLoaded',()=>{ensureUI();setInterval(()=>{if(!state&&signedIn()&&!$('#mhWatchPartyModal')?.hidden)loadInvites();},10000);});
})();
