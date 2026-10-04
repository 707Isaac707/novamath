(()=>{
'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const profile=()=>localStorage.getItem('mh_active_profile_v1')||'default';
const key=k=>`mh:${profile()}:${k}`;
const read=(k,d)=>{try{const x=JSON.parse(localStorage.getItem(k));return x==null?d:x}catch{return d}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));window.mhScheduleCloudSync?.()}catch{}};
const LEAGUES=[['nfl','NFL'],['nba','NBA'],['mlb','MLB'],['nhl','NHL'],['ncaaf','NCAAF'],['ncaam','NCAAM'],['wnba','WNBA'],['mls','MLS']];
const ESPN_LEAGUES={nfl:['football','nfl','NFL'],nba:['basketball','nba','NBA'],mlb:['baseball','mlb','MLB'],nhl:['hockey','nhl','NHL'],ncaaf:['football','college-football','NCAAF'],ncaam:['basketball','mens-college-basketball','NCAAM'],wnba:['basketball','wnba','WNBA'],mls:['soccer','usa.1','MLS']};
let activeLeague='nfl',scoreTimer=null,channels=[],channelHls=null,currentChannel=null,lastScores=[],mounted=false,gameModal=null,redZoneChannel=null,channelSource='';
const ymd=d=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
function directEventRow(e={}){const c=e.competitions?.[0]||{},st=c.status||e.status||{},type=st.type||{},teams=(c.competitors||[]).map(x=>({id:String(x.id||x.team?.id||''),homeAway:String(x.homeAway||''),score:String(x.score??''),winner:!!x.winner,name:String(x.team?.displayName||x.team?.shortDisplayName||x.team?.name||''),shortName:String(x.team?.shortDisplayName||x.team?.name||''),abbreviation:String(x.team?.abbreviation||''),logo:String(x.team?.logo||''),record:String((x.records||[])[0]?.summary||'')}));return{id:String(e.id||''),name:String(e.name||''),shortName:String(e.shortName||''),date:e.date||c.date||'',status:{state:String(type.state||''),name:String(type.name||''),detail:String(type.shortDetail||type.detail||type.description||''),clock:String(st.displayClock||''),period:Number(st.period||0),completed:!!type.completed},teams,broadcasts:(c.broadcasts||[]).flatMap(x=>x.names||[]),venue:String(c.venue?.fullName||''),source:'ESPN direct fallback'};}
async function directScoreboard(league){const cfg=ESPN_LEAGUES[league]||ESPN_LEAGUES.nfl,url=new URL(`https://site.api.espn.com/apis/site/v2/sports/${cfg[0]}/${cfg[1]}/scoreboard`);url.searchParams.set('limit',(league==='ncaaf'||league==='ncaam')?'250':'100');const r=await fetch(url.toString(),{cache:'no-store'});if(!r.ok)throw new Error('Sports backend unavailable');const raw=await r.json();return{league,label:cfg[2],events:(raw.events||[]).map(directEventRow).sort((a,b)=>new Date(a.date||0)-new Date(b.date||0)),updatedAt:Date.now(),source:'ESPN direct fallback'};}
const api=async(params)=>{const q=new URLSearchParams(params);try{const r=await fetch('/api/sports-api?'+q.toString(),{cache:'no-store'});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Sports backend unavailable');return j;}catch(e){if((params.action||'scoreboard')==='scoreboard')return directScoreboard(params.league||'nfl');throw e;}};
const fmtTime=d=>{const x=new Date(d);return Number.isNaN(x.getTime())?'':x.toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'});};
const favTeams=()=>new Set(read(key('sports_fav_teams_v1'),[]));
const NETWORK_ALIASES=[
  ['espn2',['espn2','espn 2']],
  ['espnu',['espnu','espn u']],
  ['espnews',['espnews','espn news']],
  ['espndeportes',['espn deportes']],
  ['espn',['espn']],
  ['abc',['abc']],
  ['cbs',['cbs']],
  ['fox',['fox']],
  ['nbc',['nbc']],
  ['primevideo',['prime video','amazon prime video']],
  ['peacock',['peacock']],
  ['cw',['cw','the cw']],
  ['fs1',['fs1','fox sports 1']],
  ['fs2',['fs2','fox sports 2']],
  ['foxdeportes',['fox deportes']],
  ['nflnetwork',['nfl network','nfln','nfl net']],
  ['nbatv',['nba tv']],
  ['mlbnetwork',['mlb network']],
  ['nhlnetwork',['nhl network']],
  ['cbs sports network',['cbs sports network','cbssn']],
  ['accnetwork',['acc network','accn']],
  ['secnetwork',['sec network','secn']],
  ['bigtennetwork',['big ten network','btn']],
  ['tnt',['tnt']],
  ['tbs',['tbs']],
  ['trutv',['trutv','tru tv']],
  ['golfchannel',['golf channel']],
  ['usanetwork',['usa network']]
];
function cleanNetworkName(v){
  return String(v||'').toLowerCase()
    .replace(/\([^)]*(?:\d{3,4}p|hd|sd|uhd|4k)[^)]*\)/g,' ')
    .replace(/\b(?:\d{3,4}p|hd|sd|uhd|4k)\b/g,' ')
    .replace(/\b(?:us|usa)\b$/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .trim().replace(/\s+/g,' ');
}
function canonicalNetwork(v){
  const n=cleanNetworkName(v);
  for(const [key,aliases] of NETWORK_ALIASES)if(aliases.includes(n))return key;
  if(/^cbs(?:\s|$)/.test(n)&&!/sports|golazo|news/.test(n))return 'cbs';
  if(/^fox(?:\s|$)/.test(n)&&!/sports|deportes|news|weather|business/.test(n))return 'fox';
  if(/^nbc(?:\s|$)/.test(n)&&!/sports|news/.test(n))return 'nbc';
  if(/^abc(?:\s|$)/.test(n)&&!/news/.test(n))return 'abc';
  if(/^(?:the\s+)?cw(?:\s|$)/.test(n))return 'cw';
  return '';
}
function channelCanonical(c){
  const direct=canonicalNetwork(c?.name);
  if(direct)return direct;
  const tvg=String(c?.tvgId||'').split('@')[0].replace(/[._-]+/g,' ');
  return canonicalNetwork(tvg);
}
function teamTokens(game){
  const out=[];
  for(const t of game?.teams||[]){
    for(const v of [t.abbreviation,t.shortName,t.name]){
      const n=cleanNetworkName(v);
      if(n&&n.length>=2&&!out.includes(n))out.push(n);
    }
  }
  return out;
}
function findGameChannel(game){
  if(!game||game.status?.state!=='in'||!channels.length)return null;

  const broadcasts=(game.broadcasts||[]).map(x=>String(x||'').trim()).filter(Boolean);
  for(const broadcast of broadcasts){
    const key=canonicalNetwork(broadcast);
    if(!key)continue;
    const matches=channels.filter(c=>channelCanonical(c)===key);
    if(matches.length){
      matches.sort((a,b)=>Number(String(b.country||'').toUpperCase()==='US')-Number(String(a.country||'').toUpperCase()==='US')||Number(!!b.logo)-Number(!!a.logo)||String(a.name).length-String(b.name).length);
      return {channel:matches[0],broadcast,key,matchType:'broadcast'};
    }
  }

  const tokens=teamTokens(game);
  const matchupMatches=channels.map(c=>{
    const hay=cleanNetworkName(`${c.name||''} ${c.group||''} ${c.tvgId||''}`);
    let teamHits=0;
    for(const token of tokens)if(token.length>=3&&hay.includes(token))teamHits++;
    return {c,teamHits};
  }).filter(x=>x.teamHits>=2).sort((a,b)=>b.teamHits-a.teamHits||Number(!!b.c.logo)-Number(!!a.c.logo));
  if(matchupMatches.length)return {channel:matchupMatches[0].c,broadcast:'Game feed',key:'matchup',matchType:'matchup'};

  return null;
}
function playGameMatch(match){
  if(!match?.channel)return;
  playChannel(match.channel);
  const status=$('#mhSportsPlayerStatus');
  if(status)status.textContent=`Matched ${match.broadcast} to ${match.channel.name}. Availability depends on the broadcaster.`;
  document.querySelector('.mh-sports-player-card')?.scrollIntoView({behavior:'smooth',block:'center'});
}
function toast(t,i='🏟️'){window.showToast?.(t,i)}
function mount(){
  const root=$('#sportsMount');if(!root)return;
  if(!mounted){mounted=true;root.innerHTML=`
  <section class="mh-sports-page">
    <div class="mh-sports-hero">
      <div><small>LIVE SPORTS</small><h2>Sports Center</h2><p>Pick a matchup to watch when a verified live feed is available. Scores, teams, schedules and playback stay together in one place.</p></div>
      <div class="mh-sports-live-pill"><span></span><strong id="mhSportsLiveCount">0</strong><small>LIVE NOW</small></div>
    </div>
    <div class="mh-sports-leagues" id="mhSportsLeagues"></div>

    <section class="mh-sports-card mh-sports-player-card mh-game-player">
      <div class="mh-sports-card-head"><div><small>GAME STREAM</small><h3 id="mhSportsNowTitle">Choose a live matchup</h3></div><button id="mhSportsPip" title="Picture in Picture">PiP</button></div>
      <div class="mh-sports-video-shell"><video id="mhSportsVideo" controls playsinline webkit-playsinline></video><div id="mhSportsVideoEmpty"><span>▶</span><strong>Select a live game</strong><small>Nova will open its verified matched feed here.</small></div></div>
      <div class="mh-sports-player-actions"><button id="mhSportsFullscreen">Fullscreen</button><button id="mhSportsStop">Stop</button></div>
      <div id="mhSportsPlayerStatus" class="mh-sports-status">Checking fresh live-game streams…</div>
    </section>

    <section class="mh-sports-card mh-redzone-card" id="mhRedZoneCard">
      <div class="mh-sports-card-head"><div><small>NFL LIVE</small><h3>RedZone + Live Tracker</h3></div><div class="mh-redzone-actions"><button id="mhRedZoneWatch" disabled>RedZone unavailable</button><button id="mhRedZoneRefresh">Refresh</button></div></div>
      <p id="mhRedZoneSource" class="mh-sports-sub">Nova will enable RedZone automatically when Botasaurus finds a verified RedZone feed.</p>
      <div id="mhRedZoneGames" class="mh-redzone-games"><div class="mh-sports-loading">Loading NFL games…</div></div>
    </section>

    <section class="mh-sports-card">
      <div class="mh-sports-card-head"><div><small id="mhSportsLeagueKicker">NFL</small><h3>Games</h3></div><span id="mhSportsUpdated">Updating…</span></div>
      <div id="mhSportsScores" class="mh-score-grid"><div class="mh-sports-loading">Loading games…</div></div>
    </section>
  </section>`;
    renderLeagues();
    $('#mhSportsFullscreen').onclick=fullscreen;
    $('#mhSportsPip').onclick=pip;
    $('#mhSportsStop').onclick=stopChannel;
    $('#mhRedZoneRefresh').onclick=()=>{loadRedZone(true);loadChannels(true)};
    $('#mhRedZoneWatch').onclick=()=>{if(redZoneChannel){playChannel(redZoneChannel);document.querySelector('.mh-sports-player-card')?.scrollIntoView({behavior:'smooth',block:'center'});}};
    loadChannels();
  }
  loadScores();loadRedZone();startRefresh();
}
function renderLeagues(){const host=$('#mhSportsLeagues');if(!host)return;host.innerHTML=LEAGUES.map(([id,label])=>`<button data-league="${id}" class="${id===activeLeague?'active':''}">${label}</button>`).join('');host.querySelectorAll('[data-league]').forEach(b=>b.onclick=()=>{activeLeague=b.dataset.league;renderLeagues();loadScores(true);});}
async function loadScores(showLoading=false){const host=$('#mhSportsScores');if(!host)return;if(showLoading)host.innerHTML='<div class="mh-sports-loading">Updating scores…</div>';try{const j=await api({action:'scoreboard',league:activeLeague});lastScores=j.events||[];renderScores(lastScores);const live=lastScores.filter(e=>e.status?.state==='in').length;$('#mhSportsLiveCount').textContent=String(live);$('#mhSportsLeagueKicker').textContent=j.label||activeLeague.toUpperCase();$('#mhSportsUpdated').textContent='Updated '+new Date(j.updatedAt||Date.now()).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' · Live scores';}catch(e){host.innerHTML=`<div class="mh-sports-error">${esc(e.message)} <button onclick="window.mhSportsRefresh?.()">Retry</button></div>`;}}
function renderScores(events){
  const host=$('#mhSportsScores');if(!host)return;
  if(!events.length){host.innerHTML='<div class="mh-sports-empty">No games found for this league right now.</div>';return;}
  const fav=favTeams();
  host.innerHTML=events.map(e=>{
    const away=e.teams?.find(t=>t.homeAway==='away')||e.teams?.[0]||{},home=e.teams?.find(t=>t.homeAway==='home')||e.teams?.[1]||{};
    const live=e.status?.state==='in',pre=e.status?.state==='pre',star=fav.has(away.id)||fav.has(home.id),watch=live?findGameChannel(e):null;
    const playLabel=watch?'▶ Play Live':live?'Live feed unavailable':pre?'Starts '+fmtTime(e.date):'Game ended';
    return `<article class="mh-score-card ${live?'live':''} ${watch?'watchable':''}" data-game="${esc(e.id)}">
      <div class="mh-score-top"><span>${live?'<i></i> LIVE':pre?fmtTime(e.date):esc(e.status?.detail||'Final')}</span><small>${esc((e.broadcasts||[]).join(' · '))}</small><button data-fav-game="${esc(e.id)}" title="Favorite teams">${star?'★':'☆'}</button></div>
      <button class="mh-game-team-button" data-team-play="${esc(e.id)}" ${watch?'':'disabled'}>${teamLine(away)}</button>
      <button class="mh-game-team-button" data-team-play="${esc(e.id)}" ${watch?'':'disabled'}>${teamLine(home)}</button>
      <div class="mh-score-foot"><span>${esc(e.venue||'')}</span><div class="mh-score-actions">
        <button class="${watch?'mh-watch-live':'mh-watch-disabled'}" data-watch-game="${esc(e.id)}" ${watch?'':'disabled'}>${esc(playLabel)}</button>
        <button data-detail="${esc(e.id)}">Game Center</button>
      </div></div>
    </article>`;
  }).join('');

  const play=e=>{
    e.stopPropagation();
    const id=e.currentTarget.dataset.watchGame||e.currentTarget.dataset.teamPlay;
    const ev=events.find(x=>x.id===id),match=findGameChannel(ev);
    if(match)playGameMatch(match);else toast('No verified live feed for this game right now','⚠');
  };
  host.querySelectorAll('[data-watch-game]').forEach(b=>{if(!b.disabled)b.onclick=play});
  host.querySelectorAll('[data-team-play]').forEach(b=>{if(!b.disabled)b.onclick=play});
  host.querySelectorAll('[data-detail]').forEach(b=>b.onclick=e=>{e.stopPropagation();openGame(b.dataset.detail)});
  host.querySelectorAll('[data-fav-game]').forEach(b=>b.onclick=e=>{e.stopPropagation();const ev=events.find(x=>x.id===b.dataset.favGame);if(ev)toggleGameTeams(ev)});
}
function teamLine(t){return `<span class="mh-score-team"><span class="mh-score-logo">${t.logo?`<img src="${esc(t.logo)}" alt="">`:esc(t.abbreviation||'?')}</span><span class="mh-team-copy"><strong>${esc(t.shortName||t.name||'Team')}</strong><small>${esc(t.record||t.abbreviation||'')}</small></span><b>${esc(t.score||'')}</b></span>`;}
function toggleGameTeams(e){const set=favTeams(),ids=(e.teams||[]).map(t=>t.id).filter(Boolean),all=ids.every(id=>set.has(id));ids.forEach(id=>all?set.delete(id):set.add(id));write(key('sports_fav_teams_v1'),[...set]);renderScores(lastScores);toast(all?'Teams removed from favorites':'Teams favorited',all?'☆':'★');}
async function loadRedZone(force=false){const host=$('#mhRedZoneGames');if(!host)return;if(force)host.innerHTML='<div class="mh-sports-loading">Refreshing NFL tracker…</div>';try{const j=await api({action:'scoreboard',league:'nfl'}),events=j.events||[],live=events.filter(e=>e.status?.state==='in');host.innerHTML=(live.length?live:events.filter(e=>e.status?.state==='pre').slice(0,6)).map(e=>{const a=e.teams?.find(t=>t.homeAway==='away')||{},h=e.teams?.find(t=>t.homeAway==='home')||{};return `<button class="mh-redzone-game ${e.status?.state==='in'?'live':''}" data-rz="${esc(e.id)}"><span>${e.status?.state==='in'?'LIVE':fmtTime(e.date)}</span><div><b>${esc(a.abbreviation||a.shortName)} ${esc(a.score||'')}</b><b>${esc(h.abbreviation||h.shortName)} ${esc(h.score||'')}</b></div><small>${esc(e.status?.detail||'')}</small></button>`;}).join('')||'<div class="mh-sports-empty">No NFL games scheduled right now.</div>';host.querySelectorAll('[data-rz]').forEach(b=>b.onclick=()=>openGame(b.dataset.rz,'nfl'));}catch(e){host.innerHTML='<div class="mh-sports-error">NFL tracker unavailable.</div>';}}
function ensureGameModal(){if(gameModal)return gameModal;gameModal=document.createElement('section');gameModal.id='mhSportsGameModal';gameModal.className='mh-sports-modal';gameModal.hidden=true;gameModal.innerHTML='<div class="mh-sports-modal-card"><button id="mhSportsGameClose" class="mh-sports-modal-close">×</button><div id="mhSportsGameBody"></div></div>';document.body.appendChild(gameModal);$('#mhSportsGameClose').onclick=()=>gameModal.hidden=true;gameModal.addEventListener('click',e=>{if(e.target===gameModal)gameModal.hidden=true});return gameModal;}
async function openGame(id,league=activeLeague){const m=ensureGameModal(),body=$('#mhSportsGameBody');m.hidden=false;body.innerHTML='<div class="mh-sports-loading">Loading Game Center…</div>';try{const j=await api({action:'game',league,id}),d=j.details||{};const a=d.teams?.find(t=>t.homeAway==='away')||d.teams?.[0]||{},h=d.teams?.find(t=>t.homeAway==='home')||d.teams?.[1]||{},watch=findGameChannel(d),live=d.status?.state==='in';body.innerHTML=`<div class="mh-gamecenter-head"><small>${league.toUpperCase()} GAME CENTER</small><h2>${esc(a.shortName||a.name)} ${esc(a.score||'')} <span>at</span> ${esc(h.shortName||h.name)} ${esc(h.score||'')}</h2><p>${esc(d.status?.detail||'')}</p>${watch?`<button id="mhGameWatchLive" class="mh-game-watch">▶ Play Live on ${esc(watch.broadcast)}</button>`:live?'<div class="mh-game-stream-missing">Live game — verified playback feed not available yet.</div>':''}</div>${d.fantasy?.length?fantasyTable(d.fantasy,d.fantasyScoring):''}<section class="mh-gamecenter-section"><h3>Scoring</h3>${d.scoring?.length?d.scoring.slice().reverse().map(x=>`<div class="mh-scoring-row"><span>Q${x.period} ${esc(x.clock)}</span><strong>${esc(x.text)}</strong><b>${x.awayScore}-${x.homeScore}</b></div>`).join(''):'<div class="mh-sports-empty">No scoring plays available.</div>'}</section>`;if(watch)$('#mhGameWatchLive').onclick=()=>{m.hidden=true;playGameMatch(watch)};}catch(e){body.innerHTML=`<div class="mh-sports-error">${esc(e.message)}</div>`;}}
function fantasyTable(rows,note){return `<section class="mh-gamecenter-section"><div class="mh-fantasy-head"><div><h3>Fantasy Points</h3><p>Average of Standard, Half-PPR, and PPR estimates.</p></div><span>LIVE ESTIMATE</span></div><div class="mh-fantasy-table"><div class="mh-fantasy-row head"><span>Player</span><b>AVG</b><b>STD</b><b>0.5</b><b>PPR</b></div>${rows.slice(0,18).map(p=>`<div class="mh-fantasy-row"><span>${p.headshot?`<img src="${esc(p.headshot)}" alt="">`:''}<em><strong>${esc(p.name)}</strong><small>${esc(p.team)} ${esc(p.position)}</small></em></span><b>${p.average.toFixed(1)}</b><b>${p.standard.toFixed(1)}</b><b>${p.half.toFixed(1)}</b><b>${p.ppr.toFixed(1)}</b></div>`).join('')}</div><small class="mh-fantasy-note">${esc(note||'')}</small></section>`;}
async function loadChannels(force=false){
  try{
    const j=await api({action:'channels',...(force?{t:Date.now()}: {})});
    channels=j.channels||[];
    redZoneChannel=j.redZone||channels.find(c=>/red\s*zone|redzone/i.test(`${c.name} ${c.group||''}`))||null;
    channelSource=j.source||'';
    updateRedZoneSource();
    if(lastScores.length)renderScores(lastScores);
    const status=$('#mhSportsPlayerStatus');
    if(status&&!currentChannel)status.textContent=channels.length?`${channels.length} verified feeds ready. Pick a live matchup.`:'No verified live feeds are available right now.';
  }catch(e){
    channels=[];redZoneChannel=null;updateRedZoneSource(e.message);
    if(lastScores.length)renderScores(lastScores);
    const status=$('#mhSportsPlayerStatus');if(status)status.textContent='Live playback feeds are unavailable right now.';
  }
}

function sourceLabel(c){
  if(c?.source==='botasaurus-public-page')return 'Botasaurus';
  if(c?.source==='iptvcat-my-list')return 'IPTV Cat';
  if(c?.source==='iptv-org-sports')return 'IPTV-org';
  return 'Public source';
}
function updateRedZoneSource(error=''){
  const btn=$('#mhRedZoneWatch'),note=$('#mhRedZoneSource');
  if(btn){btn.disabled=!redZoneChannel;btn.textContent=redZoneChannel?'▶ Watch RedZone':'RedZone unavailable';btn.classList.toggle('available',!!redZoneChannel);}
  if(note){if(redZoneChannel)note.textContent=`${redZoneChannel.name} found via ${sourceLabel(redZoneChannel)}. Select Watch RedZone to open it in the Sports player.`;else if(error)note.textContent=`Could not check the configured RedZone sources right now. ${error}`;else note.textContent='Configured public sports sources loaded, but no RedZone entry is available right now. Live NFL scores still update below.';}
}
function stopChannel(){try{channelHls?.destroy()}catch{}channelHls=null;const v=$('#mhSportsVideo');if(v){try{v.pause();v.removeAttribute('src');v.load()}catch{}}currentChannel=null;$('#mhSportsVideoEmpty').hidden=false;$('#mhSportsNowTitle').textContent='Choose a live matchup';$('#mhSportsPlayerStatus').textContent='Playback stopped.';}
function playChannel(c){if(!c?.url)return;stopChannel();currentChannel=c;const v=$('#mhSportsVideo'),empty=$('#mhSportsVideoEmpty');if(!v)return;empty.hidden=true;$('#mhSportsNowTitle').textContent=c.name;$('#mhSportsPlayerStatus').textContent='Connecting to '+c.name+'…';const u=c.url,isHls=/\.m3u8(?:$|\?)/i.test(u)||/m3u8/i.test(u);try{if(isHls&&v.canPlayType('application/vnd.apple.mpegurl')){v.src=u;v.play().catch(()=>{});}else if(isHls&&window.Hls?.isSupported()){channelHls=new Hls({enableWorker:true,lowLatencyMode:true,maxBufferLength:20});channelHls.loadSource(u);channelHls.attachMedia(v);channelHls.on(Hls.Events.MANIFEST_PARSED,()=>v.play().catch(()=>{}));channelHls.on(Hls.Events.ERROR,(_,data)=>{if(data?.fatal)$('#mhSportsPlayerStatus').textContent='This public channel is not playing right now.';});}else{v.src=u;v.play().catch(()=>{});}$('#mhSportsPlayerStatus').textContent='Playing '+c.name+'. Availability depends on the broadcaster.';window.mhAwardXP?.(3,'Watched sports',`sports:${c.tvgId||c.name}`);}catch{$('#mhSportsPlayerStatus').textContent='Could not start this channel.';}}
async function fullscreen(){const shell=$('.mh-sports-video-shell'),v=$('#mhSportsVideo');try{if(document.fullscreenElement)return document.exitFullscreen();if(shell?.requestFullscreen)return shell.requestFullscreen();v?.webkitEnterFullscreen?.();}catch{}}
async function pip(){const v=$('#mhSportsVideo');try{if(document.pictureInPictureElement)return document.exitPictureInPicture();if(v?.requestPictureInPicture)return v.requestPictureInPicture();}catch{toast('Picture-in-Picture is unavailable','⚠')}}
function startRefresh(){clearInterval(scoreTimer);scoreTimer=setInterval(()=>{if(document.body.dataset.hubTab==='sports'){loadScores();loadRedZone();loadChannels();}},30000);}
function search(q){q=String(q||'').trim().toLowerCase();const out=[];if(!q)return out;for(const [id,label] of LEAGUES)if(label.toLowerCase().includes(q))out.push({icon:'🏟️',title:label+' Sports',subtitle:'Scores, schedules and live sports',run:()=>{activeLeague=id;window.switchTab?.('sports',document.querySelector('[data-tab="sports"]'));setTimeout(()=>{renderLeagues();loadScores(true)},120)}});return out.slice(0,8);}
window.mountSportsTab=mount;window.mhSportsRefresh=()=>loadScores(true);window.mhSportsSearch=search;window.mhSportsOpenGame=openGame;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{if(document.body.dataset.hubTab==='sports')mount()});
})();
