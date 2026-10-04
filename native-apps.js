(function(){
'use strict';

const $=s=>document.querySelector(s);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const profileId=()=>localStorage.getItem('mh_active_profile_v1')||'default';
const pkey=k=>`mh:${profileId()}:${k}`;
let nativeCurrent='';
let iptvChannels=[];
let iptvHls=null;

function ensureNativeShell(){
  if($('#mhNativeApp'))return;
  const shell=document.createElement('div');
  shell.id='mhNativeApp';
  shell.className='mh-native-app';
  shell.hidden=true;
  shell.innerHTML=`<div class="mh-native-card" role="dialog" aria-modal="true" aria-label="Built-in app">
    <div class="mh-native-bar">
      <div class="mh-native-title"><span class="mh-native-dot"></span><strong id="mhNativeTitle">App</strong><span id="mhNativeBadge">BUILT-IN</span></div>
      <div class="mh-native-actions"><button type="button" onclick="closeNativeApp()" title="Close">×</button></div>
    </div>
    <div id="mhNativeBody" class="mh-native-body"></div>
  </div>`;
  document.body.appendChild(shell);
  shell.addEventListener('click',e=>{if(e.target===shell)closeNativeApp();});
}

function openNativeApp(id,name){
  ensureNativeShell();
  nativeCurrent=id;
  const shell=$('#mhNativeApp');
  $('#mhNativeTitle').textContent=name||'App';
  $('#mhNativeBody').innerHTML='<div class="mh-native-loading"><span></span><p>Loading app…</p></div>';
  shell.hidden=false;
  requestAnimationFrame(()=>shell.classList.add('open'));
  document.body.classList.add('mh-native-open');
  setTimeout(()=>renderNativeApp(id),30);
}

function closeNativeApp(){
  stopIptvPlayback();
  const wasProxy=nativeCurrent==='webproxy';
  const shell=$('#mhNativeApp');
  if(shell){shell.classList.remove('open');setTimeout(()=>{shell.hidden=true;$('#mhNativeBody').innerHTML='';},150);}
  nativeCurrent='';
  document.body.classList.remove('mh-native-open');
  if(wasProxy){window.mhFinalizeGameSession?.();window.mhSocialSetActivity?.('Browsing Nova Math','');}
}

function renderNativeApp(id){
  const body=$('#mhNativeBody'); if(!body)return;
  if(id==='webproxy')return renderWebProxy(body);
  if(id==='ai')return renderNativeAI(body);
  if(id==='youtube')return renderYouTube(body);
  if(id==='calculator')return renderCalculator(body);
  if(id==='notes')return renderNotes(body);
  if(id==='iptv')return renderIptv(body);
  body.innerHTML='<div class="mh-native-empty">This built-in app is not available yet.</div>';
}


// Web Browser / Scramjet -----------------------------------------------------
const proxyConfigCache={
  browserUrl:'https://mediahub-proxy.onrender.com',
  wispUrl:'wss://mediahub-proxy.onrender.com/wisp/'
};
let proxyLaunchTarget='';
let proxyLaunchLabel='';
let proxyLaunchGameTitle='';
async function getProxyConfig(){
  return proxyConfigCache;
}
function normalizeBrowserUrl(v){
  let x=String(v||'').trim(); if(!x)return '';
  if(!/^https?:\/\//i.test(x)) x='https://'+x;
  try{return new URL(x).href}catch{return ''}
}
async function renderWebProxy(body){
  const requestedTarget=normalizeBrowserUrl(proxyLaunchTarget);
  const requestedLabel=String(proxyLaunchLabel||'').trim();
  body.innerHTML=`<div class="mh-proxy-browser">
    <div class="mh-proxy-toolbar">
      <button id="proxyBack" type="button" title="Back">←</button><button id="proxyForward" type="button" title="Forward">→</button><button id="proxyReload" type="button" title="Reload">↻</button>
      <div class="mh-proxy-address"><span>🌐</span><input id="proxyAddress" autocomplete="off" spellcheck="false" readonly placeholder="Open a website from Scramjet below"><button id="proxyCopy" type="button">Copy</button></div>
      <button id="proxyFull" type="button" title="Fullscreen">⛶</button>
    </div>
    <div id="proxyStatus" class="mh-proxy-status">Checking Scramjet service…</div>
    <div id="proxyLaunchHelp" class="mh-proxy-launch-help" hidden></div>
    <div class="mh-proxy-frame-shell"><iframe id="proxyFrame" title="Nova Math Web Browser" allow="clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture; gamepad" referrerpolicy="no-referrer"></iframe></div>
  </div>`;
  const cfg=await getProxyConfig(), frame=$('#proxyFrame'), status=$('#proxyStatus'), input=$('#proxyAddress'), help=$('#proxyLaunchHelp');
  const base=String(cfg.browserUrl||'https://mediahub-proxy.onrender.com').replace(/\/$/,'');
  if(!base){status.className='mh-proxy-status bad';status.textContent='Proxy backend is unavailable.';return;}
  status.textContent='Scramjet connected • mediahub-proxy.onrender.com'; status.className='mh-proxy-status ok';
  const target=requestedTarget||normalizeBrowserUrl(localStorage.getItem(pkey('proxy_last_url'))||'');
  input.value=target||base+'/';

  // Scramjet-App currently launches URLs from its own search box. We still pass
  // ?url= for compatibility with forks that support deep links. The stock app
  // ignores it, so the helper below keeps the requested destination one tap away.
  frame.src=requestedTarget?base+'/?url='+encodeURIComponent(requestedTarget):base+'/';

  async function copyTarget(show=true){
    const value=normalizeBrowserUrl(input.value);if(!value)return false;
    try{await navigator.clipboard.writeText(value);if(show)showToast?.('Website link copied','📋');return true;}catch{return false;}
  }
  $('#proxyCopy').onclick=()=>copyTarget(true);
  $('#proxyReload').onclick=()=>{try{frame.contentWindow.location.reload()}catch{frame.src=frame.src}};
  $('#proxyBack').onclick=()=>{try{frame.contentWindow.history.back()}catch{}};
  $('#proxyForward').onclick=()=>{try{frame.contentWindow.history.forward()}catch{}};
  $('#proxyFull').onclick=()=>frame.requestFullscreen?.();

  if(requestedTarget&&help){
    help.hidden=false;
    help.innerHTML=`<strong>${esc(requestedLabel||'Game ready')}</strong><span>If Scramjet opens its home screen instead of the game, paste the prepared link into Scramjet's search box and press Enter.</span><button id="proxyCopyTarget" type="button">Copy game link</button>`;
    $('#proxyCopyTarget').onclick=()=>copyTarget(true);
    // Clipboard writes are allowed only from a user gesture in many browsers.
    // openMediaHubProxyTarget also attempts the copy before this async render.
  }
  proxyLaunchTarget='';proxyLaunchLabel='';proxyLaunchGameTitle='';
}
function openMediaHubProxyTarget(url,label,gameTitle){
  const target=normalizeBrowserUrl(url);if(!target)return;
  proxyLaunchTarget=target;proxyLaunchLabel=String(label||'').trim();proxyLaunchGameTitle=String(gameTitle||'').trim();
  try{localStorage.setItem(pkey('proxy_last_url'),target);}catch{}
  // This runs directly from the game-card click, so browsers that permit
  // clipboard writes on user gestures will have the target ready to paste.
  navigator.clipboard?.writeText?.(target).catch(()=>{});
  openNativeApp('webproxy',gameTitle||label||'Web Browser');
}

// Assistant ------------------------------------------------------------------
const NATIVE_AI_HISTORY_MAX=16;
function nativeAiHistory(){
  try{return JSON.parse(localStorage.getItem(pkey('ai_history'))||'[]').filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string'&&x.content.trim()).slice(-NATIVE_AI_HISTORY_MAX);}catch{return [];}
}
function saveNativeAiHistory(list){
  try{localStorage.setItem(pkey('ai_history'),JSON.stringify(list.slice(-NATIVE_AI_HISTORY_MAX)));}catch{}
}
function nativeAiContext(prompt=''){
  const games=Array.isArray(window.BUILT_IN_GAMES)?window.BUILT_IN_GAMES:[];
  const words=String(prompt).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
  let matches=[];
  if(words.length){
    matches=games.map(g=>({g,score:words.reduce((n,w)=>n+(String((g?.title||'')+' '+(g?.genre||'')).toLowerCase().includes(w)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.g);
  }
  if(!matches.length)matches=games.slice(0,24);
  return {
    currentTab:document.body.dataset.hubTab||'apps',
    gameCount:games.length,
    matchingGames:matches.slice(0,24).map(g=>({title:g.title,genre:g.genre||'Arcade'})),
    features:['Arcade games','Movies & TV','Music search and playback','Assistant','YouTube mini app','Calculator','Notes','Live TV / IPTV','My List','Profiles','Themes','Achievements','Quick Launch','Game artwork','Continue Watching','Food & Drinks requests']
  };
}
function renderNativeAI(body){
  body.innerHTML=`<div class="native-ai">
    <div class="native-ai-head">
      <div><span class="native-ai-logo">✦</span><span><strong>Assistant</strong><small>Help, explanations, and general questions.</small></span></div>
      <div class="native-ai-head-actions"><span id="nativeAiStatus" class="native-ai-status">Checking connection…</span><button id="nativeAiClear" class="native-secondary" type="button">Clear chat</button></div>
    </div>
    <div id="nativeAiMessages" class="native-ai-messages"></div>
    <div class="native-ai-chips"><button type="button" data-q="What can you help me with?">Ask anything</button><button type="button" data-q="Help me understand something for school.">School help</button><button type="button" data-q="Pick a fun game for me from the arcade.">Pick a game</button><button type="button" data-q="How does Live TV work?">IPTV help</button></div>
    <form id="nativeAiForm" class="native-ai-form"><textarea id="nativeAiInput" rows="1" maxlength="3000" placeholder="Ask a question…"></textarea><button id="nativeAiSend" type="submit" aria-label="Send message">➤</button></form>
    <div class="native-ai-foot">Server-side connection. API key stays outside the browser.</div>
  </div>`;
  renderNativeAiMessages();
  $('#nativeAiClear').onclick=()=>{saveNativeAiHistory([]);renderNativeAiMessages();};
  document.querySelectorAll('.native-ai-chips button').forEach(b=>b.onclick=()=>sendNativeAI(b.dataset.q||''));
  $('#nativeAiForm').onsubmit=e=>{e.preventDefault();const input=$('#nativeAiInput');const q=input?.value.trim();if(q){input.value='';sendNativeAI(q);}};
  $('#nativeAiInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#nativeAiForm')?.requestSubmit();}};
  checkNativeAI();
  setTimeout(()=>$('#nativeAiInput')?.focus(),60);
}
function renderNativeAiMessages(){
  const box=$('#nativeAiMessages');if(!box)return;
  const history=nativeAiHistory();box.innerHTML='';
  if(!history.length){box.innerHTML='<div class="native-ai-welcome"><span>✦</span><strong>Assistant</strong><p>School help, explanations, writing, coding, troubleshooting, and Nova Math support.</p></div>';return;}
  history.forEach(m=>appendNativeAiMessage(m.role,m.content,false));
  box.scrollTop=box.scrollHeight;
}
function appendNativeAiMessage(role,content,scroll=true){
  const box=$('#nativeAiMessages');if(!box)return null;
  const div=document.createElement('div');div.className=`native-ai-message ${role}`;div.textContent=content;box.appendChild(div);
  if(scroll)box.scrollTop=box.scrollHeight;
  return div;
}
async function checkNativeAI(){
  const status=$('#nativeAiStatus');if(!status)return;
  status.textContent='Checking connection…';status.classList.remove('ok','bad');
  try{
    const r=await fetch('/api/assistant',{headers:{Accept:'application/json'},cache:'no-store'});const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
    if(!d.configured)throw new Error('Assistant key missing');
    status.textContent='● Assistant ready';status.classList.add('ok');
  }catch(e){status.textContent='● AI unavailable';status.classList.add('bad');status.title=e.message||'Connection failed';}
}
async function sendNativeAI(q){
  const text=String(q||'').trim();if(!text)return;
  let history=nativeAiHistory();history.push({role:'user',content:text});saveNativeAiHistory(history);appendNativeAiMessage('user',text);
  const typing=appendNativeAiMessage('assistant','Thinking…');typing?.classList.add('typing');
  const send=$('#nativeAiSend');if(send)send.disabled=true;
  try{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);let r;
    try{r=await fetch('/api/assistant',{method:'POST',signal:controller.signal,cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history.slice(-10),context:nativeAiContext(text)})});}finally{clearTimeout(timer);}
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`AI request failed (${r.status})`);
    const answer=String(d.message||'').trim()||'I did not get a response. Try again.';
    typing?.remove();appendNativeAiMessage('assistant',answer);history=nativeAiHistory();history.push({role:'assistant',content:answer});saveNativeAiHistory(history);
    const status=$('#nativeAiStatus');if(status){status.textContent='● Assistant ready';status.classList.remove('bad');status.classList.add('ok');}
  }catch(e){
    typing?.remove();const msg=e?.name==='AbortError'?'The request timed out. Try again.':(e.message||'Try again in a moment.');appendNativeAiMessage('assistant',`I couldn't answer right now. ${msg}`);
    const status=$('#nativeAiStatus');if(status){status.textContent='● AI unavailable';status.classList.remove('ok');status.classList.add('bad');status.title=msg;}
  }finally{if(send)send.disabled=false;setTimeout(()=>$('#nativeAiInput')?.focus(),20);}
}

// YouTube -------------------------------------------------------------------
function renderYouTube(body){
  body.innerHTML=`<div class="native-layout native-youtube">
    <div class="native-topline"><form id="nativeYouTubeForm" class="native-search"><input id="nativeYouTubeQuery" placeholder="Search YouTube…" autocomplete="off"><button>Search</button></form><span class="native-hint">Uses the server-side YouTube API key.</span></div>
    <div id="nativeYouTubePlayer" class="native-video-shell"><div class="native-video-placeholder"><span>▶</span><strong>YouTube</strong><small>Search for a video to start watching.</small></div></div>
    <div id="nativeYouTubeResults" class="native-media-grid"></div>
  </div>`;
  $('#nativeYouTubeForm').onsubmit=e=>{e.preventDefault();searchNativeYouTube($('#nativeYouTubeQuery').value);};
  $('#nativeYouTubeQuery').focus();
}
async function searchNativeYouTube(q){
  q=String(q||'').trim();if(!q)return;
  const box=$('#nativeYouTubeResults');box.innerHTML='<div class="native-status">Searching YouTube…</div>';
  try{
    const r=await fetch(`/api/youtube-search?q=${encodeURIComponent(q)}`);const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||`Search failed (${r.status})`);
    const items=Array.isArray(d.items)?d.items:[];
    box.innerHTML=items.length?'':'<div class="native-status">No videos found.</div>';
    items.forEach(v=>{const b=document.createElement('button');b.className='native-media-card';b.type='button';b.innerHTML=`<img src="${esc(v.thumbnail)}" alt="" loading="lazy"><span><strong>${esc(v.title)}</strong><small>${esc(v.channelTitle)}</small></span>`;b.onclick=()=>playNativeYouTube(v);box.appendChild(b);});
  }catch(e){box.innerHTML=`<div class="native-error">${esc(e.message||'YouTube search failed.')}</div>`;}
}
function playNativeYouTube(v){
  const player=$('#nativeYouTubePlayer');if(!player)return;
  player.innerHTML=`<iframe title="${esc(v.title)}" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

// Twitch --------------------------------------------------------------------
function renderTwitch(body){
  body.innerHTML=`<div class="native-layout"><div class="native-topline"><form id="nativeTwitchForm" class="native-search"><input id="nativeTwitchChannel" placeholder="Twitch channel, e.g. shroud" autocomplete="off"><button>Watch</button></form><span class="native-hint">Twitch embeds require the site hostname as the parent.</span></div><div id="nativeTwitchPlayer" class="native-video-shell"><div class="native-video-placeholder"><span>🟣</span><strong>Twitch</strong><small>Enter a channel name to load the live player.</small></div></div></div>`;
  $('#nativeTwitchForm').onsubmit=e=>{e.preventDefault();loadNativeTwitch($('#nativeTwitchChannel').value);};
  $('#nativeTwitchChannel').focus();
}
function loadNativeTwitch(channel){
  channel=String(channel||'').trim().replace(/^@/,'').replace(/[^a-zA-Z0-9_]/g,'');if(!channel)return;
  const parent=location.hostname||'localhost';
  $('#nativeTwitchPlayer').innerHTML=`<iframe title="Twitch ${esc(channel)}" src="https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}&autoplay=false" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
}

// Reddit --------------------------------------------------------------------
function renderReddit(body){
  body.innerHTML=`<div class="native-layout"><div class="native-topline"><form id="nativeRedditForm" class="native-search"><span class="native-prefix">r/</span><input id="nativeRedditSub" value="popular" placeholder="subreddit" autocomplete="off"><button>Browse</button></form><span class="native-hint">Public subreddit posts only.</span></div><div id="nativeRedditResults" class="native-list"></div></div>`;
  $('#nativeRedditForm').onsubmit=e=>{e.preventDefault();loadNativeReddit($('#nativeRedditSub').value);};
  loadNativeReddit('popular');
}
async function loadNativeReddit(sub){
  sub=String(sub||'popular').trim().replace(/^r\//i,'').replace(/[^a-zA-Z0-9_]/g,'').slice(0,40)||'popular';
  $('#nativeRedditSub').value=sub;
  const box=$('#nativeRedditResults');box.innerHTML='<div class="native-status">Loading posts…</div>';
  try{
    const r=await fetch(`/api/reddit?subreddit=${encodeURIComponent(sub)}`);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Reddit failed (${r.status})`);
    const posts=Array.isArray(d.posts)?d.posts:[];box.innerHTML=posts.length?'':'<div class="native-status">No posts found.</div>';
    posts.forEach(p=>{const article=document.createElement('article');article.className='native-post';article.innerHTML=`<div class="native-post-meta"><span>▲ ${Number(p.score||0).toLocaleString()}</span><span>💬 ${Number(p.comments||0).toLocaleString()}</span><span>u/${esc(p.author||'unknown')}</span></div><h3>${esc(p.title)}</h3><div class="native-post-foot"><span>${esc(p.domain||'reddit.com')}</span><button type="button">Open thread</button></div>`;article.querySelector('button').onclick=()=>window.launchMediaHubApp?.(`https://www.reddit.com${p.permalink}`,'Reddit');box.appendChild(article);});
  }catch(e){box.innerHTML=`<div class="native-error">${esc(e.message||'Reddit could not load.')}</div>`;}
}

// Weather -------------------------------------------------------------------
function renderWeather(body){
  body.innerHTML=`<div class="native-layout"><div class="native-topline"><form id="nativeWeatherForm" class="native-search"><input id="nativeWeatherQuery" placeholder="City or ZIP" autocomplete="off"><button>Search</button></form><button id="nativeWeatherLocate" class="native-secondary">Use my location</button></div><div id="nativeWeatherContent" class="native-weather"><div class="native-status">Search a place to see the forecast.</div></div></div>`;
  $('#nativeWeatherForm').onsubmit=e=>{e.preventDefault();searchNativeWeather($('#nativeWeatherQuery').value);};
  $('#nativeWeatherLocate').onclick=()=>useNativeWeatherLocation();
  $('#nativeWeatherQuery').focus();
}
async function searchNativeWeather(q){
  q=String(q||'').trim();if(!q)return;
  const box=$('#nativeWeatherContent');box.innerHTML='<div class="native-status">Finding location…</div>';
  try{
    const r=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);const d=await r.json();const loc=d.results?.[0];if(!loc)throw new Error('Location not found.');
    await loadNativeForecast(loc.latitude,loc.longitude,`${loc.name}${loc.admin1?', '+loc.admin1:''}${loc.country?', '+loc.country:''}`);
  }catch(e){box.innerHTML=`<div class="native-error">${esc(e.message||'Weather search failed.')}</div>`;}
}
function useNativeWeatherLocation(){
  const box=$('#nativeWeatherContent');if(!navigator.geolocation){box.innerHTML='<div class="native-error">Location is not available in this browser.</div>';return;}
  box.innerHTML='<div class="native-status">Requesting location…</div>';
  navigator.geolocation.getCurrentPosition(p=>loadNativeForecast(p.coords.latitude,p.coords.longitude,'Current location'),()=>{box.innerHTML='<div class="native-error">Location permission was not granted.</div>';},{timeout:10000});
}
function weatherCode(code){const m={0:'☀️ Clear',1:'🌤 Mostly clear',2:'⛅ Partly cloudy',3:'☁️ Cloudy',45:'🌫 Fog',48:'🌫 Fog',51:'🌦 Drizzle',53:'🌦 Drizzle',55:'🌧 Drizzle',61:'🌧 Rain',63:'🌧 Rain',65:'🌧 Heavy rain',71:'🌨 Snow',73:'🌨 Snow',75:'❄️ Heavy snow',80:'🌦 Showers',81:'🌧 Showers',82:'⛈ Heavy showers',95:'⛈ Thunderstorm',96:'⛈ Storm',99:'⛈ Storm'};return m[code]||'🌤 Weather';}
async function loadNativeForecast(lat,lon,label){
  const box=$('#nativeWeatherContent');box.innerHTML='<div class="native-status">Loading forecast…</div>';
  try{
    const u=`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
    const r=await fetch(u);const d=await r.json();const c=d.current||{},daily=d.daily||{};
    const days=(daily.time||[]).slice(0,7).map((date,i)=>`<div class="native-day"><strong>${new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short'})}</strong><span>${weatherCode(daily.weather_code?.[i]).split(' ')[0]}</span><b>${Math.round(daily.temperature_2m_max?.[i]||0)}°</b><small>${Math.round(daily.temperature_2m_min?.[i]||0)}° · ${Math.round(daily.precipitation_probability_max?.[i]||0)}% rain</small></div>`).join('');
    box.innerHTML=`<section class="native-weather-now"><div><small>${esc(label)}</small><h2>${Math.round(c.temperature_2m||0)}°F</h2><strong>${esc(weatherCode(c.weather_code))}</strong></div><div class="native-weather-stats"><span>Feels ${Math.round(c.apparent_temperature||0)}°</span><span>Wind ${Math.round(c.wind_speed_10m||0)} mph</span></div></section><div class="native-days">${days}</div><div class="native-source">Weather data: Open-Meteo</div>`;
  }catch(e){box.innerHTML=`<div class="native-error">${esc(e.message||'Forecast failed.')}</div>`;}
}

// Sports --------------------------------------------------------------------
function renderSports(body){
  body.innerHTML=`<div class="native-layout"><div class="native-topline"><div class="native-league-tabs" id="nativeLeagueTabs"><button data-league="nfl">NFL</button><button data-league="nba">NBA</button><button data-league="mlb">MLB</button><button data-league="nhl">NHL</button></div><button class="native-secondary" id="nativeSportsRefresh">Refresh</button></div><div id="nativeSportsResults" class="native-score-list"></div></div>`;
  $('#nativeLeagueTabs').onclick=e=>{const b=e.target.closest('button[data-league]');if(b)loadNativeSports(b.dataset.league);};
  $('#nativeSportsRefresh').onclick=()=>loadNativeSports($('#nativeLeagueTabs .active')?.dataset.league||'nfl');
  loadNativeSports('nfl');
}
async function loadNativeSports(league){
  document.querySelectorAll('#nativeLeagueTabs button').forEach(b=>b.classList.toggle('active',b.dataset.league===league));
  const box=$('#nativeSportsResults');box.innerHTML='<div class="native-status">Loading scores…</div>';
  try{
    const r=await fetch(`/api/sports-api?action=scoreboard&league=${encodeURIComponent(league)}`,{cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Scores failed (${r.status})`);
    const games=Array.isArray(d.events)?d.events:[];box.innerHTML=games.length?'':'<div class="native-status">No games on the current scoreboard.</div>';
    games.forEach(g=>{const away=g.teams?.find(t=>t.homeAway==='away')||g.teams?.[0]||{},home=g.teams?.find(t=>t.homeAway==='home')||g.teams?.[1]||{};const row=document.createElement('article');row.className='native-score-card';row.innerHTML=`<div class="native-score-head"><span>${esc(g.status?.detail||'Scheduled')}</span><small>${g.date?new Date(g.date).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''}</small></div><div class="native-team"><span>${esc(away.name||away.shortName||'Away')}</span><strong>${esc(away.score??'-')}</strong></div><div class="native-team"><span>${esc(home.name||home.shortName||'Home')}</span><strong>${esc(home.score??'-')}</strong></div>`;box.appendChild(row);});
    if(d.source){const source=document.createElement('div');source.className='native-source';source.textContent=d.source;box.appendChild(source);}
  }catch(e){box.innerHTML=`<div class="native-error">${esc(e.message||'Scores could not load.')}</div>`;}
}



// Calculator ----------------------------------------------------------------
function renderCalculator(body){
  body.innerHTML=`<div class="native-calc"><div id="nativeCalcDisplay" class="native-calc-display">0</div><div class="native-calc-grid">
    ${['C','(',')','⌫','7','8','9','÷','4','5','6','×','1','2','3','−','0','.','=','+'].map(x=>`<button type="button" data-calc="${esc(x)}" class="${['÷','×','−','+','='].includes(x)?'op':''}">${esc(x)}</button>`).join('')}
  </div><small>Basic arithmetic only.</small></div>`;
  let expr='';const display=$('#nativeCalcDisplay');
  $('.native-calc-grid').onclick=e=>{const b=e.target.closest('button[data-calc]');if(!b)return;const k=b.dataset.calc;if(k==='C')expr='';else if(k==='⌫')expr=expr.slice(0,-1);else if(k==='='){try{const raw=expr.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');if(!/^[0-9+\-*/().\s]+$/.test(raw)||!raw.trim())throw 0;const n=Function(`"use strict";return (${raw})`)();if(!Number.isFinite(n))throw 0;expr=String(Math.round((n+Number.EPSILON)*1e10)/1e10);}catch{expr='Error';}}else{if(expr==='Error')expr='';expr+=k;}display.textContent=expr||'0';};
}

// Notes ---------------------------------------------------------------------
function renderNotes(body){
  const saved=localStorage.getItem(pkey('native_notes'))||'';
  body.innerHTML=`<div class="native-notes"><div class="native-topline"><div><strong>Quick Notes</strong><small>Saved automatically on this profile and browser.</small></div><div><button id="nativeNotesDownload" class="native-secondary">Export</button><button id="nativeNotesClear" class="native-secondary danger">Clear</button></div></div><textarea id="nativeNotesText" placeholder="Write anything here…">${esc(saved)}</textarea><div id="nativeNotesStatus" class="native-source">Saved locally</div></div>`;
  const ta=$('#nativeNotesText');let t;ta.oninput=()=>{clearTimeout(t);$('#nativeNotesStatus').textContent='Saving…';t=setTimeout(()=>{try{localStorage.setItem(pkey('native_notes'),ta.value);$('#nativeNotesStatus').textContent='Saved locally';}catch{$('#nativeNotesStatus').textContent='Could not save';}},180);};
  $('#nativeNotesClear').onclick=()=>{if(confirm('Clear these local notes?')){ta.value='';localStorage.removeItem(pkey('native_notes'));$('#nativeNotesStatus').textContent='Cleared';}};
  $('#nativeNotesDownload').onclick=()=>{const blob=new Blob([ta.value],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='media-hub-notes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  ta.focus();
}

// LIVE TV ------------------------------------------------------------------
let iptvDash=null;
let iptvCurrentChannel=null;
let iptvClockTimer=null;
let iptvEpgByKey=new Map();
let iptvEpgLoading=false;
let iptvEpgTimer=null;
const IPTV_SOURCE_LABEL='Americas + IPTV Cat';
const IPTV_EXPLICIT_RE=/(?:\bxxx\b|porn|adult\s*(?:tv|channel|only)?|18\+|playboy|penthouse|brazzers|redlight|erotic)/i;

function mountLiveTvTab(){
  const mount=document.getElementById('liveTvMount');
  if(!mount)return;
  renderIptv(mount);
}

function renderIptv(body){
  if(body.dataset.iptvRendered==='1')return;
  body.dataset.iptvRendered='1';
  try{localStorage.removeItem(pkey('iptv_channels'));}catch{}
  body.innerHTML=`<div class="live-tv-experience">
    <section class="live-tv-hero">
      <div class="live-tv-hero-copy">
        <div class="live-tv-eyebrow"><span></span> LIVE TELEVISION</div>
        <h2>Live TV Guide</h2>
        <p>Browse live channels from the Americas playlist plus the configured IPTV Cat list in a cable-style guide. Search, filter, favorite, and play directly inside Nova Math.</p>
      </div>
      <div class="live-tv-source-badge" aria-label="Live TV source">AMERICAS + IPTV CAT</div>
    </section>

    <section class="live-tv-watch-grid">
      <div class="live-tv-player-card">
        <div id="iptvPlayerShell" class="iptv-player-shell live-tv-player-shell">
          <video id="iptvVideo" controls playsinline webkit-playsinline></video>
          <div id="iptvEmpty" class="live-tv-empty"><span>📡</span><strong>Pick a channel</strong><small>Selected stream plays here.</small></div>
          <div class="live-tv-live-badge"><i></i> LIVE</div>
          <button id="iptvFullscreenOverlay" class="iptv-fullscreen-overlay" type="button" title="Fullscreen" aria-label="Fullscreen">⛶</button>
        </div>
        <div class="iptv-now live-tv-now">
          <div><strong id="iptvNowName">Nothing playing</strong><small id="iptvNowGroup">Choose a channel from the guide below</small></div>
          <div class="iptv-now-actions"><button id="iptvFullscreen" class="native-secondary" type="button">⛶ Fullscreen</button><button id="iptvPip" class="native-secondary" type="button">▣ PiP</button><button id="iptvNowFav" class="native-secondary" disabled>☆ Favorite</button><button id="iptvReportBroken" class="native-secondary" disabled>⚠ Hide broken</button></div>
        </div>
      </div>
      <aside class="live-tv-info-card">
        <div class="live-tv-info-icon">TV</div>
        <div><span class="live-tv-info-label">NOW PLAYING</span><strong id="iptvSideNow">Live TV</strong><p id="iptvSideMeta">Select a channel to start watching.</p></div>
        <div id="iptvStatus" class="native-source live-tv-status">Loading live channels…</div>
        <p class="live-tv-safe-note">Nova Math filters obviously explicit channel names. Live streams can still be offline, geo-restricted, HTTP-only, authenticated, DRM-protected, CORS-blocked, or unsupported by the browser.</p>
      </aside>
    </section>

    <section class="live-tv-guide-card">
      <div class="live-tv-guide-head">
        <div><div class="section-kicker">CHANNEL GUIDE</div><h3>What’s Live</h3><span id="iptvChannelCount" class="live-tv-count">Loading…</span></div>
        <div class="live-tv-guide-tools">
          <label class="live-tv-search"><span>⌕</span><input id="iptvSearch" type="search" placeholder="Search live channels…" autocomplete="off"></label>
          <select id="iptvCategory" aria-label="Channel category"><option value="">All categories</option></select>
          <button id="iptvFavOnly" class="live-tv-tool-btn" type="button" title="Show favorites only">☆ Favorites</button>
          <button id="iptvPublicLoad" class="live-tv-tool-btn" type="button" title="Refresh Live TV playlists">↻ Refresh</button>
        </div>
      </div>
      <div class="live-guide-timebar" id="iptvGuideTimebar">
        <div>CHANNEL</div><div>NOW</div><div>+30 MIN</div><div>+60 MIN</div>
      </div>
      <div id="iptvChannelList" class="iptv-channel-list live-guide-list"><div class="native-status">Loading Americas channel guide…</div></div>
    </section>

    <div class="live-tv-footnote"><strong>Sources:</strong> IPTV-org Americas plus the configured IPTV Cat channel list. Duplicate stream URLs are merged automatically.</div>
  </div>`;

  $('#iptvPublicLoad').onclick=()=>loadAmericasIptv(true);
  $('#iptvSearch').oninput=()=>renderIptvChannels();
  $('#iptvCategory').onchange=()=>renderIptvChannels();
  $('#iptvFavOnly').onclick=()=>{const b=$('#iptvFavOnly');b.classList.toggle('active');b.textContent=b.classList.contains('active')?'★ Favorites':'☆ Favorites';renderIptvChannels();};
  $('#iptvNowFav').onclick=()=>{const u=$('#iptvNowFav').dataset.url;if(u){toggleIptvFavorite(u);renderIptvChannels();updateIptvFavButton(u);}};
  $('#iptvPip').onclick=toggleIptvPip;
  $('#iptvReportBroken').onclick=hideCurrentIptvChannel;
  $('#iptvFullscreen').onclick=toggleIptvFullscreen;
  $('#iptvFullscreenOverlay').onclick=toggleIptvFullscreen;
  $('#iptvPlayerShell').ondblclick=e=>{if(e.target?.closest?.('button'))return;toggleIptvFullscreen();};
  document.addEventListener('fullscreenchange',updateIptvFullscreenButton,{once:false});
  document.addEventListener('webkitfullscreenchange',updateIptvFullscreenButton,{once:false});
  updateGuideClock();
  if(!iptvClockTimer)iptvClockTimer=setInterval(()=>{updateGuideClock();renderIptvChannels();},60000);
  if(!iptvEpgTimer)iptvEpgTimer=setInterval(()=>loadIptvEpg(false),10*60*1000);
  loadAmericasIptv(false);
}

function updateGuideClock(){
  const bar=$('#iptvGuideTimebar');if(!bar)return;
  const now=new Date();
  const rounded=new Date(now);rounded.setSeconds(0,0);rounded.setMinutes(now.getMinutes()<30?0:30);
  const fmt=d=>d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  const t1=new Date(rounded.getTime()+30*60000),t2=new Date(rounded.getTime()+60*60000);
  bar.innerHTML=`<div>CHANNEL</div><div><span class="guide-live-dot"></span>${esc(fmt(rounded))}</div><div>${esc(fmt(t1))}</div><div>${esc(fmt(t2))}</div>`;
}

function loadIptvChannels(channels,label){
  const seen=new Set();
  const safe=(Array.isArray(channels)?channels:[]).filter(c=>{
    if(!c||!c.url||!c.name||IPTV_EXPLICIT_RE.test(`${c.name} ${c.group||''}`))return false;
    if(seen.has(c.url))return false;seen.add(c.url);return true;
  });
  if(!safe.length){setIptvStatus('No channels were returned from the configured Live TV playlists right now.',true);return false;}
  iptvChannels=safe;
  updateIptvCategories();renderIptvChannels();setIptvStatus(`Loaded ${safe.length.toLocaleString()} individual channel links from ${label}.`);
  showToast?.(`Loaded ${safe.length.toLocaleString()} live channels`,'📺');
  setTimeout(()=>loadIptvEpg(false),40);
  return true;
}

async function loadAmericasIptv(showToastOnStart=false){
  if(showToastOnStart)showToast?.('Refreshing Live TV playlists…','📺');
  const list=$('#iptvChannelList');if(list)list.innerHTML='<div class="native-status">Loading Live TV playlists…</div>';
  const count=$('#iptvChannelCount');if(count)count.textContent='Loading…';
  setIptvStatus('Loading Live TV playlists…');
  try{
    const r=await fetch('/api/iptv-playlist',{cache:showToastOnStart?'no-store':'default'});
    const data=await r.json().catch(()=>null);
    if(!r.ok)throw new Error(data?.error||`HTTP ${r.status}`);
    if(!loadIptvChannels(data?.channels,data?.source||IPTV_SOURCE_LABEL))throw new Error('channel list was empty');
    const sourceResults=(data?.playlists||[]);
    const loadedSources=sourceResults.filter(p=>p.ok).map(p=>`${p.label} (${Number(p.count||0).toLocaleString()})`).join(' + ');
    const failedSources=sourceResults.filter(p=>!p.ok).map(p=>p.label);
    setIptvStatus(`Loaded ${iptvChannels.length.toLocaleString()} channels${loadedSources?` from ${loadedSources}`:''}.${failedSources.length?` ${failedSources.join(' + ')} is temporarily unavailable.`:''}`,failedSources.length>0);
  }catch(e){
    setIptvStatus(`Could not load the Live TV playlists right now (${e?.message||'playlist error'}). Tap Refresh to try again.`,true);
    if(list)list.innerHTML='<div class="native-status">The Live TV playlists could not be loaded right now. Tap Refresh above to try again.</div>';
    if(count)count.textContent='Unavailable';
  }
}

async function loadDefaultIptv(showToastOnStart=false){return loadAmericasIptv(showToastOnStart);}
function iptvFavorites(){try{return new Set(JSON.parse(localStorage.getItem(pkey('iptv_favorites'))||'[]'));}catch{return new Set();}}
function saveIptvFavorites(s){try{localStorage.setItem(pkey('iptv_favorites'),JSON.stringify([...s].slice(0,700)));window.mhScheduleCloudSync?.();}catch{}}
function toggleIptvFavorite(url){const s=iptvFavorites();s.has(url)?s.delete(url):s.add(url);saveIptvFavorites(s);}
function iptvBroken(){try{return new Set(JSON.parse(localStorage.getItem(pkey('iptv_broken'))||'[]'));}catch{return new Set();}}
function saveIptvBroken(s){try{localStorage.setItem(pkey('iptv_broken'),JSON.stringify([...s].slice(0,700)));window.mhScheduleCloudSync?.();}catch{}}
function hideCurrentIptvChannel(){const c=iptvCurrentChannel,u=c?.url;if(!u)return;fetch('/api/platform-api',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(localStorage.getItem('mh_social_token_v1')||'')},body:JSON.stringify({action:'channel-report',name:c?.name||'',url:u,tvgId:c?.tvgId||'',group:c?.group||''})}).catch(()=>{});const broken=iptvBroken();broken.add(u);saveIptvBroken(broken);stopIptvPlayback();iptvCurrentChannel=null;const empty=$('#iptvEmpty');if(empty)empty.style.display='';if($('#iptvNowName'))$('#iptvNowName').textContent='Nothing playing';if($('#iptvNowGroup'))$('#iptvNowGroup').textContent='Choose a channel from the guide below';if($('#iptvReportBroken'))$('#iptvReportBroken').disabled=true;updateIptvFavButton('');renderIptvChannels();setIptvStatus('Hidden that channel on this profile and sent a broken-channel report.');showToast?.('Broken channel reported and hidden','⚠');}
function updateIptvCategories(){
  const sel=$('#iptvCategory');if(!sel)return;const old=sel.value;const groups=[...new Set(iptvChannels.map(c=>String(c.group||'Other').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));sel.innerHTML='<option value="">All categories</option>'+groups.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');if(groups.includes(old))sel.value=old;
}
function iptvInitials(name){const words=String(name||'TV').replace(/[^a-z0-9 ]/gi,' ').trim().split(/\s+/).filter(Boolean);return (words.slice(0,2).map(w=>w[0]).join('')||'TV').toUpperCase();}
function epgKey(c){return String(c?.tvgId||c?.name||'').trim().toLowerCase();}
function epgProgramsFor(c){return iptvEpgByKey.get(epgKey(c))||[];}
function epgNowNext(c){
  const now=Date.now(), programs=epgProgramsFor(c);
  const current=programs.find(p=>p.start<=now&&p.stop>now)||null;
  const next=programs.find(p=>p.start>now)||null;
  const later=next?programs.find(p=>p.start>=next.stop)||null:null;
  return {current,next,later};
}
function epgTimeRange(p){if(!p)return 'Schedule unavailable';const f=t=>new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});return `${f(p.start)} – ${f(p.stop)}`;}
async function loadIptvEpg(force=false){
  if(iptvEpgLoading||!iptvChannels.length)return;
  iptvEpgLoading=true;
  try{
    const q=($('#iptvSearch')?.value||'').trim().toLowerCase(),group=$('#iptvCategory')?.value||'';
    const broken=iptvBroken();
    const wanted=iptvChannels.filter(c=>(!q||`${c.name} ${c.group}`.toLowerCase().includes(q))&&(!group||c.group===group)&&!broken.has(c.url)).slice(0,120);
    const r=await fetch('/api/iptv-epg',{method:'POST',headers:{'Content-Type':'application/json'},cache:force?'no-store':'default',body:JSON.stringify({channels:wanted.map(c=>({tvgId:c.tvgId||'',name:c.name||''}))})});
    const data=await r.json().catch(()=>null);if(!r.ok)throw new Error(data?.error||`HTTP ${r.status}`);
    for(const [key,programs] of Object.entries(data?.programs||{}))iptvEpgByKey.set(String(key).toLowerCase(),Array.isArray(programs)?programs:[]);
    renderIptvChannels();
    const matched=Number(data?.matched||0);if(matched)setIptvStatus(`Live guide updated with real program data for ${matched} channel${matched===1?'':'s'}. Channels without EPG stay available.`);
  }catch(e){console.warn('EPG load failed',e);}
  finally{iptvEpgLoading=false;}
}
function renderIptvChannels(){
  const box=$('#iptvChannelList');if(!box)return;
  const q=($('#iptvSearch')?.value||'').trim().toLowerCase(),group=$('#iptvCategory')?.value||'',favs=iptvFavorites(),favOnly=$('#iptvFavOnly')?.classList.contains('active');
  const broken=iptvBroken();let list=iptvChannels.filter(c=>(!q||`${c.name} ${c.group}`.toLowerCase().includes(q))&&(!group||c.group===group)&&(!favOnly||favs.has(c.url))&&!broken.has(c.url)&&!IPTV_EXPLICIT_RE.test(`${c.name} ${c.group||''}`));
  const count=$('#iptvChannelCount');if(count)count.textContent=`${list.length.toLocaleString()} channel${list.length===1?'':'s'} · Live TV`;
  if(!list.length){box.innerHTML='<div class="native-status">No channels match that search.</div>';return;}
  box.innerHTML='';
  list.slice(0,400).forEach(c=>{
    const row=document.createElement('button');row.type='button';row.className='live-guide-row'+(iptvCurrentChannel?.url===c.url?' playing':'');
    const art=c.logo?`<img src="${esc(c.logo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">`:'';
    const {current,next,later}=epgNowNext(c);
    const programCell=(p,isLive=false)=>{const progress=isLive&&p?Math.max(0,Math.min(100,((Date.now()-p.start)/(p.stop-p.start))*100)):0;return p?`<span class="guide-program${isLive?' live':''}"${isLive?` style="--live-progress:${progress}%"`:''}><b>${isLive?'<i></i>':''}${esc(p.title||'Program')}</b><small>${esc(epgTimeRange(p))}</small></span>`:`<span class="guide-program${isLive?' live':''}"><b>${isLive?'<i></i>':''}${isLive?'Live stream':'No EPG data'}</b><small>${isLive?esc(c.group||'Live TV'):'Schedule unavailable'}</small></span>`;};
    row.innerHTML=`<span class="guide-channel-cell"><span class="guide-channel-logo">${art}<span class="guide-channel-fallback"${c.logo?' style="display:none"':''}>${esc(iptvInitials(c.name))}</span></span><span class="guide-channel-copy"><strong>${esc(c.name)}</strong><small>${esc(c.group||'Live TV')} ${favs.has(c.url)?' · ★':''}</small></span></span>${programCell(current,true)}${programCell(next)}${programCell(later)}`;
    row.onclick=()=>playIptvChannel(c);box.appendChild(row);
  });
  if(list.length>400){const more=document.createElement('div');more.className='live-guide-more';more.textContent=`Showing first 400 of ${list.length.toLocaleString()} matches. Use search or a category to narrow the guide.`;box.appendChild(more);}
  clearTimeout(renderIptvChannels._epgDebounce);renderIptvChannels._epgDebounce=setTimeout(()=>loadIptvEpg(false),350);
}
function updateIptvFavButton(url){const b=$('#iptvNowFav');if(!b)return;const on=iptvFavorites().has(url);b.disabled=!url;b.dataset.url=url||'';b.textContent=on?'★ Favorited':'☆ Favorite';b.classList.toggle('active',on);}
function setIptvStatus(msg,bad=false){const el=$('#iptvStatus');if(el){el.textContent=msg;el.className='native-source live-tv-status'+(bad?' bad':'');}}
function iptvIsFullscreen(){return document.fullscreenElement||document.webkitFullscreenElement;}
function updateIptvFullscreenButton(){const on=Boolean(iptvIsFullscreen());const b=$('#iptvFullscreen');if(b)b.textContent=on?'⤢ Exit fullscreen':'⛶ Fullscreen';const o=$('#iptvFullscreenOverlay');if(o){o.textContent=on?'⤢':'⛶';o.title=on?'Exit fullscreen':'Fullscreen';}}
async function toggleIptvFullscreen(){const shell=$('#iptvPlayerShell'),video=$('#iptvVideo');if(!shell||!video)return;try{if(iptvIsFullscreen()){if(document.exitFullscreen)await document.exitFullscreen();else if(document.webkitExitFullscreen)document.webkitExitFullscreen();updateIptvFullscreenButton();return;}if(shell.requestFullscreen){await shell.requestFullscreen();updateIptvFullscreenButton();return;}if(shell.webkitRequestFullscreen){shell.webkitRequestFullscreen();updateIptvFullscreenButton();return;}if(typeof video.webkitEnterFullscreen==='function'){video.webkitEnterFullscreen();return;}if(typeof video.requestFullscreen==='function'){await video.requestFullscreen();return;}setIptvStatus('Fullscreen is not supported by this browser.',true);}catch(e){try{if(typeof video.webkitEnterFullscreen==='function'){video.webkitEnterFullscreen();return;}}catch{}setIptvStatus('Could not enter fullscreen. Tap the video once, then try again.',true);}}
async function toggleIptvPip(){const video=$('#iptvVideo');if(!video)return;try{if(document.pictureInPictureElement){await document.exitPictureInPicture();return;}if(!document.pictureInPictureEnabled||typeof video.requestPictureInPicture!=='function'){setIptvStatus('Picture-in-Picture is not supported by this browser.',true);return;}if(video.readyState<1){setIptvStatus('Start a channel before opening Picture-in-Picture.',true);return;}await video.requestPictureInPicture();setIptvStatus('Picture-in-Picture opened. TV continues in Picture-in-Picture while Nova Math stays open.');}catch(e){setIptvStatus('Could not open Picture-in-Picture. Start playback first and try again.',true);}}
function stopIptvPlayback(){try{iptvHls?.destroy();}catch{}iptvHls=null;try{iptvDash?.reset?.();}catch{}iptvDash=null;const v=$('#iptvVideo');if(v){try{v.pause();v.removeAttribute('src');v.load();}catch{}}}

async function playIptvChannel(c){
  const streamUrl=String(c?.url||'').trim();if(!streamUrl)return;
  try{const k=pkey('iptv_recent'),old=JSON.parse(localStorage.getItem(k)||'[]');const list=[{name:c?.name||'Channel',url:streamUrl,logo:c?.logo||'',group:c?.group||'',tvgId:c?.tvgId||'',at:Date.now()},...(Array.isArray(old)?old:[]).filter(x=>x.url!==streamUrl)].slice(0,20);localStorage.setItem(k,JSON.stringify(list));window.mhScheduleCloudSync?.();window.mhPlatformRefreshHome?.();}catch{}
  iptvCurrentChannel=c;
  renderIptvChannels();
  const name=c.name||'Live stream',group=c.group||'Live TV';
  $('#iptvEmpty')?.style.setProperty('display','none');
  if($('#iptvNowName'))$('#iptvNowName').textContent=name;
  if($('#iptvNowGroup'))$('#iptvNowGroup').textContent=group;
  if($('#iptvSideNow'))$('#iptvSideNow').textContent=name;
  if($('#iptvSideMeta')){const ep=epgNowNext(c);$('#iptvSideMeta').textContent=ep.current?`${ep.current.title} · ${epgTimeRange(ep.current)}`:`${group} · Live TV`;}
  updateIptvFavButton(streamUrl);
  if($('#iptvReportBroken'))$('#iptvReportBroken').disabled=false;
  setIptvStatus('Opening live channel…');
  return playResolvedIptvChannel(streamUrl);
}

function playResolvedIptvChannel(url){
  let parsed;try{parsed=new URL(String(url||'').trim());if(!/^https?:$/.test(parsed.protocol))throw 0;}catch{return setIptvStatus('Invalid stream URL.',true);}
  if(location.protocol==='https:'&&parsed.protocol==='http:'){setIptvStatus('This channel uses an HTTP-only stream. Modern browsers block insecure video inside an HTTPS site, so it cannot play here.',true);return;}
  stopIptvPlayback();const video=$('#iptvVideo');if(!video)return;
  const target=parsed.href,isHls=/\.m3u8(?:$|\?)/i.test(parsed.pathname+parsed.search),isDash=/\.mpd(?:$|\?)/i.test(parsed.pathname+parsed.search);
  if(isHls&&video.canPlayType('application/vnd.apple.mpegurl')){video.src=target;video.play().catch(()=>{});setIptvStatus('Playing live channel with native HLS support.');return;}
  if(isHls&&window.Hls?.isSupported?.()){
    try{iptvHls=new Hls({enableWorker:true,lowLatencyMode:true,maxBufferLength:30});iptvHls.loadSource(target);iptvHls.attachMedia(video);iptvHls.on(Hls.Events.MANIFEST_PARSED,()=>{video.play().catch(()=>{});setIptvStatus('Playing HLS live stream.');});iptvHls.on(Hls.Events.ERROR,(_,data)=>{if(data?.fatal)setIptvStatus(`Stream error: ${data.details||data.type||'playback failed'}`,true);});return;}catch(e){setIptvStatus(e.message||'HLS playback failed.',true);return;}
  }
  if(isDash&&window.dashjs?.MediaPlayer){try{iptvDash=dashjs.MediaPlayer().create();iptvDash.initialize(video,target,true);setIptvStatus('Playing DASH live stream.');return;}catch(e){setIptvStatus(e.message||'DASH playback failed.',true);return;}}
  video.src=target;video.play().then(()=>setIptvStatus('Playing live stream.')).catch(()=>setIptvStatus('This stream could not be played by the browser. It may be offline, geo-restricted, CORS-blocked, authenticated, or DRM-protected.',true));
}

window.openNativeApp=openNativeApp;
window.openMediaHubProxyTarget=openMediaHubProxyTarget;
window.closeNativeApp=closeNativeApp;
window.searchNativeYouTube=searchNativeYouTube;
window.loadNativeTwitch=loadNativeTwitch;
window.loadNativeReddit=loadNativeReddit;
window.searchNativeWeather=searchNativeWeather;
window.loadNativeSports=loadNativeSports;
window.toggleIptvFullscreen=toggleIptvFullscreen;window.toggleIptvPip=toggleIptvPip;
window.mountLiveTvTab=mountLiveTvTab;window.mhPlayIptvChannel=playIptvChannel;
window.mhPlayIptvChannel=playIptvChannel;
window.mhGetLiveTvState=()=>({channels:iptvChannels.slice(),current:iptvCurrentChannel,epg:Object.fromEntries(iptvEpgByKey.entries())});

// Let Escape close the built-in app without interfering with other shortcuts.
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#mhNativeApp')?.classList.contains('open')){e.preventDefault();closeNativeApp();}},true);
})();
