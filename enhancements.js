(function(){
'use strict';

const PROFILE_LIST_KEY='mh_profiles_v1';
const ACTIVE_PROFILE_KEY='mh_active_profile_v1';
const ART_CACHE_KEY='mh_game_art_cache_v8_poster';
const ART_CACHE_TTL=1000*60*60*24*30;
const SESSION_ART_LIMIT=80;
let currentProfileId='default';
let gameSession=null;
let lastSelectedMovieItem=null;
let installPromptEvent=null;
let artRequests=0, artActive=0, artQueue=[], artApiUnavailable=false, artNextStart=0;
let eqContext=null, eqSource=null, eqNodes=null;
let visualizerFrame=0;

const mhMemoryStorage=new Map();
function storageGet(key){try{return window.localStorage.getItem(key);}catch{return mhMemoryStorage.has(key)?mhMemoryStorage.get(key):null;}}
function storageSet(key,value){try{window.localStorage.setItem(key,String(value));window.mhScheduleCloudSync?.();return true;}catch{mhMemoryStorage.set(key,String(value));return false;}}
function storageRemove(key){try{window.localStorage.removeItem(key);}catch{}mhMemoryStorage.delete(key);}
function readJSON(key,fallback){try{const raw=storageGet(key);if(raw==null)return fallback;const x=JSON.parse(raw);return x==null?fallback:x;}catch{return fallback;}}
function writeJSON(key,value){try{storageSet(key,JSON.stringify(value));}catch{}}

function slugId(){return 'p_'+Math.random().toString(36).slice(2,9);}
function profiles(){let list=readJSON(PROFILE_LIST_KEY,[]);if(!list.length){list=[{id:'default',name:'Default',avatar:'🎮'}];writeJSON(PROFILE_LIST_KEY,list);}return list;}
function initProfile(){const list=profiles();const saved=storageGet(ACTIVE_PROFILE_KEY);currentProfileId=list.some(p=>p.id===saved)?saved:list[0].id;storageSet(ACTIVE_PROFILE_KEY,currentProfileId);}
function pkey(key){return `mh:${currentProfileId}:${key}`;}
function activeProfile(){return profiles().find(p=>p.id===currentProfileId)||profiles()[0];}
function safe(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function formatSeconds(sec){sec=Math.max(0,Math.floor(Number(sec)||0));if(sec<60)return `${sec}s`;const m=Math.floor(sec/60);if(m<60)return `${m}m`;const h=Math.floor(m/60),r=m%60;return `${h}h${r?` ${r}m`:''}`;}
function cleanGameQuery(title){return String(title||'').replace(/\b(unblocked|offline|html5|game)\b/ig,' ').replace(/[_\-]+/g,' ').replace(/\s+/g,' ').trim();}


// Direct App Store artwork fallback -----------------------------------------
// This path does NOT need a server function or API key. Apple documents the
// callback parameter for cross-site iTunes Search API requests, so these known
// mainstream games can get real icons even if the SteamGridDB function is down.
const APPLE_GAME_ALIASES=[
  [/^1v1lol$/i,'1v1.LOL'],
  [/^8ball(pool|classic)?$/i,'8 Ball Pool'],
  [/adventure\s*cap(ital|at)alist/i,'AdVenture Capitalist'],
  [/^among\s*us$/i,'Among Us'],
  [/^retro\s*bowl(\s*2)?$/i,'Retro Bowl'],
  [/^retro\s*bowl\s*college$/i,'Retro Bowl College'],
  [/geometry\s*dash/i,'Geometry Dash'],
  [/^subway\s*surfers/i,'Subway Surfers'],
  [/^crossy\s*road$/i,'Crossy Road'],
  [/temple\s*run\s*2/i,'Temple Run 2'],
  [/jetpack\s*joyride/i,'Jetpack Joyride'],
  [/minecraft|eaglercraft|minceraft/i,'Minecraft'],
  [/fruit\s*ninja/i,'Fruit Ninja'],
  [/cut\s*the\s*rope/i,'Cut the Rope'],
  [/plague\s*inc/i,'Plague Inc.'],
  [/terraria/i,'Terraria'],
  [/stardew\s*valley/i,'Stardew Valley'],
  [/bloons?\s*td\s*6/i,'Bloons TD 6'],
  [/plants?\s*(vs|v)\.?\s*zombies/i,'Plants vs. Zombies'],
  [/papas?\s*freezeria/i,"Papa's Freezeria To Go!"],
  [/papas?\s*pizzeria/i,"Papa's Pizzeria To Go!"]
];
const appleJsonpCache=new Map();
function compactGameName(value){return String(value||'').toLowerCase().replace(/[™®©]/g,'').replace(/[^a-z0-9]+/g,'');}
function appleAliasFor(title){
  const pretty=String(title||'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').trim();
  for(const [re,alias] of APPLE_GAME_ALIASES){if(re.test(pretty))return alias;}
  return '';
}
function appleResultScore(term,item){
  const a=compactGameName(term),b=compactGameName(item?.trackName||'');
  if(!a||!b)return 0;if(a===b)return 1000;if(a.includes(b)||b.includes(a))return 850-Math.abs(a.length-b.length);
  let score=0;for(const w of String(term).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>1)){if(String(item?.trackName||'').toLowerCase().includes(w))score+=120;}
  return score-Math.abs(a.length-b.length);
}
function apple512(url){return String(url||'').replace(/\/\d+x\d+bb(?=[._-])/i,'/512x512bb').replace(/\/\d+x\d+[^/]*\.jpg$/i,'/512x512bb.jpg');}
function appleJsonpSearch(term){
  if(appleJsonpCache.has(term))return appleJsonpCache.get(term);
  const p=new Promise((resolve,reject)=>{
    const cb='__mhApple_'+Math.random().toString(36).slice(2);
    const script=document.createElement('script');
    let done=false;
    const finish=(err,data)=>{if(done)return;done=true;clearTimeout(timer);try{delete window[cb];}catch{}script.remove();err?reject(err):resolve(data);};
    window[cb]=(payload)=>finish(null,payload);
    const params=new URLSearchParams({term,country:'US',media:'software',entity:'software',limit:'5',callback:cb});
    script.src='https://itunes.apple.com/search?'+params.toString();
    script.async=true;script.onerror=()=>finish(new Error('App Store icon lookup failed'));
    const timer=setTimeout(()=>finish(new Error('App Store icon lookup timed out')),9000);
    document.head.appendChild(script);
  });
  appleJsonpCache.set(term,p);return p;
}
async function tryDirectAppleArt(card,game){
  const term=appleAliasFor(game?.title);if(!term)return false;
  const key='apple:'+term.toLowerCase();const cache=readArtCache();const cached=cache[key];
  if(cached&&Date.now()-(cached.ts||0)<ART_CACHE_TTL&&cached.url){applyArt(card,cached);return true;}
  try{
    const payload=await appleJsonpSearch(term);const list=Array.isArray(payload?.results)?payload.results:[];
    list.sort((a,b)=>appleResultScore(term,b)-appleResultScore(term,a));const app=list[0];
    if(!app||appleResultScore(term,app)<350)return false;
    const art=apple512(app.artworkUrl512||app.artworkUrl100||app.artworkUrl60);if(!art)return false;
    const data={provider:'App Store',kind:'app-icon',url:art,iconUrl:art,gameName:app.trackName||term,sourceUrl:app.trackViewUrl||'',ts:Date.now()};
    cache[key]=data;writeArtCache(cache);applyArt(card,data);return true;
  }catch(e){console.warn('Direct App Store artwork lookup failed',game?.title,e);return false;}
}

function gameStats(){return readJSON(pkey('game_stats'),{});} 
function saveGameStats(x){writeJSON(pkey('game_stats'),x);} 
function gameLists(){return readJSON(pkey('my_games'),[]);} 
function movieList(){return readJSON(pkey('my_movies'),[]);} 
function saveMovieList(x){writeJSON(pkey('my_movies'),x);} 
function movieResume(){return readJSON(pkey('movie_resume'),{});} 
function saveMovieResume(x){writeJSON(pkey('movie_resume'),x);} 
function playlists(){return readJSON(pkey('playlists'),{});} 
function savePlaylists(x){writeJSON(pkey('playlists'),x);} 
function unlocked(){return readJSON(pkey('achievements'),{});} 
function saveUnlocked(x){writeJSON(pkey('achievements'),x);} 

const ACHIEVEMENTS=[
 {id:'first_game',icon:'🎮',title:'First Launch',desc:'Launch the first game.'},
 {id:'five_games',icon:'🕹️',title:'Arcade Regular',desc:'Launch 5 games.'},
 {id:'hour_gamer',icon:'⏱️',title:'Locked In',desc:'Spend 1 hour playing games.'},
 {id:'collector',icon:'⭐',title:'Collector',desc:'Save 10 games to My List.'},
 {id:'movie_night',icon:'🍿',title:'Movie Night',desc:'Start 3 different movies or shows.'},
 {id:'playlist',icon:'🎵',title:'DJ Mode',desc:'Create the first music playlist.'},
 {id:'all_tabs',icon:'🧭',title:'Explorer',desc:'Visit Games, Movies, and Music.'}
];
function unlock(id){const all=unlocked();if(all[id])return;const a=ACHIEVEMENTS.find(x=>x.id===id);if(!a)return;all[id]={at:Date.now()};saveUnlocked(all);showAchievement(a);renderAchievements();}
function showAchievement(a){let el=document.getElementById('achievementPop');if(!el){el=document.createElement('div');el.id='achievementPop';el.className='achievement-pop';document.body.appendChild(el);}el.innerHTML=`<div class="icon">${a.icon}</div><div><strong>Achievement unlocked · ${safe(a.title)}</strong><small>${safe(a.desc)}</small></div>`;requestAnimationFrame(()=>el.classList.add('show'));setTimeout(()=>el.classList.remove('show'),3300);}
function checkAchievements(){const stats=gameStats();const entries=Object.values(stats);const launches=entries.reduce((a,b)=>a+(b.launches||0),0);const seconds=entries.reduce((a,b)=>a+(b.seconds||0),0);if(launches>=1)unlock('first_game');if(launches>=5)unlock('five_games');if(seconds>=3600)unlock('hour_gamer');if(gameLists().length>=10)unlock('collector');if(Object.keys(movieResume()).length>=3)unlock('movie_night');if(Object.keys(playlists()).length>=1)unlock('playlist');const tabs=readJSON(pkey('tabs_seen'),[]);if(['arcade','movies','music'].every(x=>tabs.includes(x)))unlock('all_tabs');}

function getRecentGamesProfile(){const stats=gameStats();const map=new Map((window.BUILT_IN_GAMES||[]).map(g=>[g.file,g]));return Object.entries(stats).sort((a,b)=>(b[1].lastPlayed||0)-(a[1].lastPlayed||0)).slice(0,18).map(([file])=>map.get(file)).filter(Boolean);}
function rememberGameProfile(game){if(!game?.file)return;const stats=gameStats();const s=stats[game.file]||{seconds:0,launches:0};s.launches=(s.launches||0)+1;s.lastPlayed=Date.now();s.title=game.title;stats[game.file]=s;saveGameStats(stats);checkAchievements();}
function finalizeGameSession(){if(!gameSession)return;const elapsed=Math.max(0,(Date.now()-gameSession.started)/1000);if(elapsed>=1){const stats=gameStats();const s=stats[gameSession.file]||{seconds:0,launches:1};s.seconds=(s.seconds||0)+elapsed;s.lastPlayed=Date.now();s.title=gameSession.title;stats[gameSession.file]=s;saveGameStats(stats);}gameSession=null;checkAchievements();}
window.mhFinalizeGameSession=finalizeGameSession;
function gamePlaytime(game){return Number(gameStats()[game?.file]?.seconds||0);}
function toggleGameList(game){if(!game?.file)return;let list=gameLists();if(list.includes(game.file))list=list.filter(x=>x!==game.file);else list.unshift(game.file);writeJSON(pkey('my_games'),list.slice(0,250));showToast?.(list.includes(game.file)?'Added to My List':'Removed from My List',list.includes(game.file)?'⭐':'✓');checkAchievements();refreshArcadeSoon();}
function myGames(){const wanted=new Set(gameLists());return (window.BUILT_IN_GAMES||[]).filter(g=>wanted.has(g.file));}

function movieKey(item){return `${item?.media_type||'movie'}:${item?.id||''}`;}
function storableMovie(item){if(!item)return null;const {id,media_type,title,name,overview,poster_path,backdrop_path,release_date,first_air_date}=item;return {id,media_type:media_type||'movie',title,name,overview,poster_path,backdrop_path,release_date,first_air_date};}
function toggleMovieList(item){if(!item?.id)return;const k=movieKey(item);let list=movieList();const exists=list.some(x=>movieKey(x)===k);list=exists?list.filter(x=>movieKey(x)!==k):[storableMovie(item),...list].slice(0,100);saveMovieList(list);showToast?.(exists?'Removed from My List':'Added to My List',exists?'✓':'⭐');renderMoviePersonalRows();}
function isMovieSaved(item){return movieList().some(x=>movieKey(x)===movieKey(item));}

function movieResumeKey(){try{if(!currentMovieContext)return '';let k=`${currentMovieContext.type}:${currentMovieContext.tmdbId}`;if(currentMovieContext.type==='tv'){const s=document.getElementById('movieSeasonSelect')?.value||1,e=document.getElementById('movieEpisodeSelect')?.value||1;k+=`:${s}:${e}`;}return k;}catch{return '';}}
function saveMovieProgress(){const player=document.getElementById('mainVideoPlayer');const k=movieResumeKey();if(!player||!k||!Number.isFinite(player.currentTime)||player.currentTime<3)return;const all=movieResume();const fallback=lastSelectedMovieItem||{id:currentMovieContext?.tmdbId,media_type:currentMovieContext?.type,title:currentMovieContext?.title};all[k]={item:storableMovie(fallback),progress:player.currentTime,duration:Number.isFinite(player.duration)?player.duration:0,updated:Date.now()};saveMovieResume(all);checkAchievements();}
function applyMovieResume(){const player=document.getElementById('mainVideoPlayer');const k=movieResumeKey();if(!player||!k)return;const r=movieResume()[k];if(!r?.progress||r.progress<15)return;const target=r.progress;if(Number.isFinite(player.duration)&&player.duration>0&&target<player.duration-15){try{player.currentTime=target;showToast?.(`Resumed at ${formatSeconds(target)}`,'▶');}catch{}}}
function continueMovies(){const seen=new Set();return Object.values(movieResume()).sort((a,b)=>(b.updated||0)-(a.updated||0)).filter(x=>x?.item?.id&&!seen.has(movieKey(x.item))&&seen.add(movieKey(x.item))).slice(0,18);}

function deterministicGameOfDay(){const games=window.BUILT_IN_GAMES||[];if(!games.length)return null;const d=new Date();const seed=Number(`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`);return games[(seed*2654435761>>>0)%games.length];}
function trendingGames(){const stats=gameStats();return (window.BUILT_IN_GAMES||[]).filter(g=>stats[g.file]).sort((a,b)=>((stats[b.file].launches||0)*20+(stats[b.file].seconds||0)/60)-((stats[a.file].launches||0)*20+(stats[a.file].seconds||0)/60)).slice(0,18);}

function readArtCache(){return readJSON(ART_CACHE_KEY,{});}function writeArtCache(c){writeJSON(ART_CACHE_KEY,c);} 
function ensureArtAttribution(provider){let el=document.getElementById('gameArtAttribution');if(!el){el=document.createElement('div');el.id='gameArtAttribution';el.className='game-art-attribution';document.getElementById('game-container')?.after(el);}if(!el)return;const current=el.dataset.providers?el.dataset.providers.split(','):[];if(!current.includes(provider))current.push(provider);el.dataset.providers=current.join(',');const bits=[];if(current.includes('App Store'))bits.push('<a href="https://www.apple.com/app-store/" target="_blank" rel="noopener">App Store artwork</a>');if(current.includes('SteamGridDB'))bits.push('<a href="https://www.steamgriddb.com/" target="_blank" rel="noopener">SteamGridDB</a>');el.innerHTML=bits.length?`Game artwork from ${bits.join(' + ')}.`:'';}
function applyArt(card,data){const art=card?.querySelector('.game-art');if(!art||!data?.url)return;art.style.backgroundImage=`linear-gradient(180deg,rgba(0,0,0,.18),rgba(0,0,0,.72)),url("${String(data.url).replace(/"/g,'%22')}")`;art.classList.add('has-api-art');const oldIcon=art.querySelector('.game-art-icon');if(oldIcon)oldIcon.style.display='none';if(data.kind==='app-icon'||data.kind==='game-icon'){art.classList.add('has-app-icon-art');let main=art.querySelector('.game-app-icon-main');if(!main){main=document.createElement('img');main.className='game-app-icon-main';main.alt='';main.loading='lazy';art.appendChild(main);}main.src=data.iconUrl||data.url;main.onerror=()=>{main.remove();art.classList.remove('has-app-icon-art');};}else if(data.iconUrl){let icon=art.querySelector('.game-real-icon');if(!icon){icon=document.createElement('img');icon.className='game-real-icon';icon.alt='';icon.loading='lazy';art.appendChild(icon);}icon.src=data.iconUrl;icon.onerror=()=>icon.remove();}let badge=art.querySelector('.game-art-provider');if(!badge){badge=document.createElement('span');badge.className='game-art-provider';art.appendChild(badge);}badge.textContent=data.provider||'ART';ensureArtAttribution(data.provider||'App Store');}
function enqueueArt(card,game){if(artApiUnavailable||artRequests>=SESSION_ART_LIMIT||!game?.title)return;const key=cleanGameQuery(game.title).toLowerCase();if(!key||key.length<2)return;const cache=readArtCache();const c=cache[key];if(c&&Date.now()-(c.ts||0)<ART_CACHE_TTL){if(c.url)applyArt(card,c);return;}artQueue.push({card,game,key});drainArtQueue();}
async function drainArtQueue(){while(artActive<2&&artQueue.length&&!artApiUnavailable&&artRequests<SESSION_ART_LIMIT){const job=artQueue.shift();artActive++;artRequests++;(async()=>{try{const wait=Math.max(0,artNextStart-Date.now());if(wait)await new Promise(r=>setTimeout(r,wait));artNextStart=Date.now()+260;const res=await fetch(`/api/game-art?q=${encodeURIComponent(cleanGameQuery(job.game.title))}`,{headers:{Accept:'application/json'},cache:'default'});const d=await res.json().catch(()=>({}));if(res.status===501){artApiUnavailable=true;return;}if(!res.ok){if(res.status===401||res.status===403){console.warn('Game artwork API authorization failed',d);}return;}const data=d;const cache=readArtCache();cache[job.key]={...data,ts:Date.now()};writeArtCache(cache);if(data.url)applyArt(job.card,data);}catch(e){console.warn('Game artwork lookup failed',e);}finally{artActive--;drainArtQueue();}})();}}
async function resolveGameArtwork(card,game){if(!card||card.dataset.mhArtQueued==='1')return;card.dataset.mhArtQueued='1';const art=card.querySelector('.game-art');art?.classList.add('art-loading');try{const apple=await tryDirectAppleArt(card,game);if(!apple)enqueueArt(card,game);}finally{setTimeout(()=>art?.classList.remove('art-loading'),9000);}}
let artObserver=null;function observeArt(card,game){if(!card||!game)return;if(!('IntersectionObserver'in window)){resolveGameArtwork(card,game);return;}if(!artObserver)artObserver=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){const g=e.target.__mhGame;artObserver.unobserve(e.target);resolveGameArtwork(e.target,g);}});},{rootMargin:'500px'});card.__mhGame=game;artObserver.observe(card);}
function scanGameCardsForArt(){document.querySelectorAll('.netflix-game-card').forEach(card=>{if(card.dataset.mhArtQueued==='1')return;let game=card.__mhGame;const file=card.dataset.gameFile,title=card.dataset.gameTitle;if(!game)game=(window.BUILT_IN_GAMES||[]).find(g=>(file&&g.file===file)||(title&&g.title===title));if(game)observeArt(card,game);});}

function refreshArcadeSoon(){setTimeout(()=>{try{renderArcadeHome();}catch{}},0);} 
function addPersonalGameRows(){const container=document.getElementById('game-container');if(!container||!window.buildGameRow)return;const rows=[];const mine=myGames();if(mine.length)rows.push(['My List',mine.slice(0,24)]);const day=deterministicGameOfDay();if(day)rows.push(['Game of the Day',[day]]);const trend=trendingGames();if(trend.length)rows.push(['Trending',trend]);for(let i=rows.length-1;i>=0;i--){const section=window.buildGameRow(rows[i][0],rows[i][1]);if(rows[i][0]==='Game of the Day'){const t=section.querySelector('.game-row-title');if(t)t.innerHTML+=' <span class="mh-game-day-badge">DAILY PICK</span>';}container.prepend(section);}}

function ensureMovieRows(){const home=document.getElementById('netflixHomeRows');if(!home)return null;let mine=document.getElementById('mhMovieMyList');if(!mine){mine=document.createElement('section');mine.id='mhMovieMyList';mine.className='netflix-row';mine.innerHTML='<h3>My List</h3><div id="mhMovieMyListTrack" class="netflix-row-track"></div>';home.prepend(mine);}let cont=document.getElementById('mhContinueWatching');if(!cont){cont=document.createElement('section');cont.id='mhContinueWatching';cont.className='netflix-row';cont.innerHTML='<h3>Continue Watching</h3><div id="mhContinueWatchingTrack" class="netflix-row-track"></div>';home.prepend(cont);}return {mine,cont};}
function renderMoviePersonalRows(){const rows=ensureMovieRows();if(!rows)return;const myTrack=document.getElementById('mhMovieMyListTrack'),contTrack=document.getElementById('mhContinueWatchingTrack');if(myTrack){myTrack.innerHTML='';const list=movieList();rows.mine.style.display=list.length?'':'none';list.forEach(x=>myTrack.appendChild(window.createNetflixCard(x)));}if(contTrack){contTrack.innerHTML='';const list=continueMovies();rows.cont.style.display=list.length?'':'none';list.forEach(r=>{const card=window.createNetflixCard(r.item);const wrap=card.querySelector('.netflix-poster-wrap');if(wrap&&r.duration>0){const bar=document.createElement('div');bar.className='movie-progress-bar';bar.innerHTML=`<span style="width:${Math.min(100,Math.max(1,(r.progress/r.duration)*100))}%"></span>`;wrap.appendChild(bar);}contTrack.appendChild(card);});}}

function injectUI(){
 const tools=document.querySelector('.hub-tools');
 if(tools&&!document.getElementById('mhProfileChip')){const profile=document.createElement('button');profile.id='mhProfileChip';profile.className='hub-profile-chip';profile.type='button';profile.setAttribute('aria-label','Open profile and settings');profile.addEventListener('click',openSettings);tools.insertBefore(profile,tools.firstChild);}
 if(tools&&!document.getElementById('mhSettingsBtn')){const b=document.createElement('button');b.id='mhSettingsBtn';b.className='hub-settings-btn';b.type='button';b.innerHTML='<span>⚙</span><span>Settings</span>';tools.appendChild(b);}
 const settingsBtn=document.getElementById('mhSettingsBtn');if(settingsBtn&&settingsBtn.dataset.mhBound!=='1'){settingsBtn.dataset.mhBound='1';settingsBtn.addEventListener('click',openSettings);}
 const like=document.getElementById('spLikeBtn');if(like&&!document.getElementById('spPlaylistBtn')){const b=document.createElement('button');b.id='spPlaylistBtn';b.className='sp-icon-btn sp-playlist-btn';b.type='button';b.title='Add to playlist';b.setAttribute('aria-label','Add current song to playlist');b.innerHTML='<span style="font-size:19px;font-weight:300">＋</span>';b.onclick=()=>openPlaylistPicker();like.after(b);}
 const side=document.querySelector('.spotify-sidebar');if(side&&!document.getElementById('spotifyPlaylistsBtn')){const b=document.createElement('button');b.id='spotifyPlaylistsBtn';b.className='spotify-nav-btn';b.type='button';b.innerHTML='<span class="spotify-nav-icon">☷</span><span>Playlists</span>';b.onclick=()=>{openSettings();setTimeout(()=>document.getElementById('mhPlaylistsCard')?.scrollIntoView({behavior:'smooth',block:'center'}),50);};side.appendChild(b);}
 const main=document.querySelector('.spotify-main-panel.music-app');if(main&&!document.getElementById('musicVisualizerShell')){const v=document.createElement('div');v.id='musicVisualizerShell';v.innerHTML='<canvas id="musicVisualizer"></canvas><span class="visualizer-label">NOW PLAYING VISUALIZER</span>';const grid=document.querySelector('#tab-music .music-section-title')||document.getElementById('musicGrid');if(grid&&grid.parentElement===main)main.insertBefore(v,grid);else main.prepend(v);}
 if(!document.getElementById('mhSettingsBackdrop')){document.body.insertAdjacentHTML('beforeend',`<div id="mhSettingsBackdrop" class="mh-backdrop" hidden></div><section id="mhSettings" class="mh-modal" hidden aria-modal="true" aria-labelledby="mhSettingsTitle" role="dialog"><div class="mh-modal-head"><h2 id="mhSettingsTitle">Nova Math Settings</h2><button id="mhSettingsClose" class="mh-close" type="button" aria-label="Close settings">×</button></div><div id="mhSettingsBody" class="mh-settings-grid"></div></section>`);}
 const settingsBack=document.getElementById('mhSettingsBackdrop'),settingsClose=document.getElementById('mhSettingsClose');
 if(settingsBack&&settingsBack.dataset.mhBound!=='1'){settingsBack.dataset.mhBound='1';settingsBack.addEventListener('click',closeSettings);}
 if(settingsClose&&settingsClose.dataset.mhBound!=='1'){settingsClose.dataset.mhBound='1';settingsClose.addEventListener('click',closeSettings);}
 updateProfileChip();
}
function updateProfileChip(){const p=activeProfile();const el=document.getElementById('mhProfileChip');if(el)el.innerHTML=`<span class="hub-profile-avatar">${safe(p.avatar||'🎮')}</span><span class="hub-profile-name">${safe(p.name)}</span>`;}
function openSettings(){
 try{injectUI();}catch(err){console.error('Settings UI init failed',err);}
 const back=document.getElementById('mhSettingsBackdrop'),modal=document.getElementById('mhSettings');
 if(!back||!modal){window.mhSettingsFallback?.();return;}
 back.hidden=false;modal.hidden=false;document.body.classList.add('utility-open');
 try{renderSettings();}catch(err){console.error('Settings render failed',err);const body=document.getElementById('mhSettingsBody');if(body)body.innerHTML='<div class="mh-setting-card wide"><h3>Settings</h3><p>The settings window opened, but one section failed to load.</p><button class="mh-btn secondary" type="button" id="mhSettingsReload">Reload page</button></div>';document.getElementById('mhSettingsReload')?.addEventListener('click',()=>location.reload());}
 setTimeout(()=>document.getElementById('mhSettingsClose')?.focus(),30);
}
function closeSettings(){const back=document.getElementById('mhSettingsBackdrop'),modal=document.getElementById('mhSettings');if(back)back.hidden=true;if(modal)modal.hidden=true;document.body.classList.remove('utility-open');document.getElementById('mhSettingsBtn')?.focus();}

function switchProfile(id){if(!profiles().some(p=>p.id===id))return;storageSet(ACTIVE_PROFILE_KEY,id);location.reload();}
function createProfile(){const input=document.getElementById('mhNewProfile');const name=input?.value.trim();if(!name)return;const list=profiles();const id=slugId();list.push({id,name:name.slice(0,24),avatar:['🎮','🎬','🎧','⚡','👾'][list.length%5]});writeJSON(PROFILE_LIST_KEY,list);storageSet(ACTIVE_PROFILE_KEY,id);location.reload();}
function deleteCurrentProfile(){const list=profiles();if(list.length<=1){showToast?.('Keep at least one profile','⚠');return;}if(!confirm(`Delete local profile “${activeProfile().name}”?`))return;const next=list.filter(p=>p.id!==currentProfileId);writeJSON(PROFILE_LIST_KEY,next);storageSet(ACTIVE_PROFILE_KEY,next[0].id);location.reload();}
function setTheme(v){storageSet(pkey('theme'),v);applyTheme();showSettingsSaved();}
function applyTheme(){const t=storageGet(pkey('theme'))||'oled';document.body.dataset.hubTheme=t;document.body.dataset.reduceMotion=storageGet(pkey('reduce_motion'))==='1'?'1':'0';}
function setReduceMotion(on){storageSet(pkey('reduce_motion'),on?'1':'0');applyTheme();showSettingsSaved();}
function renderAchievements(){const el=document.getElementById('mhAchievementGrid');if(!el)return;const u=unlocked();el.innerHTML=ACHIEVEMENTS.map(a=>`<div class="mh-achievement ${u[a.id]?'unlocked':''}"><span class="mh-achievement-icon">${a.icon}</span><div><strong>${safe(a.title)}</strong><small>${safe(a.desc)}</small></div></div>`).join('');}
function renderSettings(){const body=document.getElementById('mhSettingsBody');if(!body)return;const p=activeProfile(),theme=storageGet(pkey('theme'))||'oled',eq=readJSON(pkey('eq'),{enabled:false,bass:0,mid:0,treble:0});body.innerHTML=`
 <div class="mh-setting-card"><h3>Profile</h3><p>Favorites, playtime, playlists, achievements, and themes sync with the signed-in Nova Math account.</p><div class="mh-profile-list">${profiles().map(x=>`<button class="mh-profile-pill ${x.id===currentProfileId?'active':''}" onclick="switchMediaHubProfile('${x.id}')">${safe(x.avatar)} ${safe(x.name)}</button>`).join('')}</div><div class="mh-setting-row" style="margin-top:10px"><input id="mhNewProfile" maxlength="24" placeholder="New profile name"><button class="mh-btn" onclick="createMediaHubProfile()">Create</button><button class="mh-btn danger" onclick="deleteMediaHubProfile()">Delete</button></div></div>
 <div class="mh-setting-card"><h3>Nova Math account & friends</h3><p>Username/password accounts with cross-device sync, friends, presence, game activity, and supported joins.</p><div class="mh-setting-row"><button class="mh-btn" onclick="mhSocialOpen()">Account & Friends</button><span class="mh-status">Accounts + Watch Party</span></div></div>
 <div class="mh-setting-card"><h3>Theme & motion</h3><p>Change the Nova Math accent and motion settings.</p><div class="mh-setting-row"><select onchange="setMediaHubTheme(this.value)"><option value="red" ${theme==='red'?'selected':''}>Netflix Red</option><option value="green" ${theme==='green'?'selected':''}>Spotify Green</option><option value="purple" ${theme==='purple'?'selected':''}>Purple</option><option value="blue" ${theme==='blue'?'selected':''}>Blue</option><option value="yellow" ${theme==='yellow'?'selected':''}>Yellow</option><option value="oled" ${theme==='oled'?'selected':''}>Nova Chrome</option></select></div><label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:12px;color:#bbb"><input type="checkbox" ${storageGet(pkey('reduce_motion'))==='1'?'checked':''} onchange="setMediaHubReduceMotion(this.checked)"> Reduce animations</label><div id="mhSettingsSaved" class="mh-status">Changes save automatically.</div></div>
 <div class="mh-setting-card"><h3>UI sound effects</h3><p>Subtle clicks for tabs, buttons, and game launches. Turn them off any time.</p><div class="mh-sfx-setting"><label><input type="checkbox" ${window.mhUiSfxEnabled?.()!==false?'checked':''} onchange="mhSetUiSfx(this.checked)"> Interface sounds</label><label>Volume <input type="range" min="0.02" max="0.24" step="0.01" value="${window.mhUiSfxVolume?.()||0.10}" oninput="mhSetUiSfxVolume(this.value)"></label></div></div>
 <div class="mh-setting-card"><h3>Install Nova Math</h3><p>PWA installation and offline caching for supported built-in games.</p><button id="mhInstallBtn" class="mh-btn" onclick="installMediaHub()">Install app</button><div id="mhInstallStatus" class="mh-status"></div></div>
 <div class="mh-setting-card"><h3>Game artwork</h3><p>Game artwork now uses exact App Store matches for common mobile games and SteamGridDB for broader game coverage. Requests are throttled to avoid provider rate limits.</p><button class="mh-btn secondary" onclick="testGameArtApi()">Test artwork lookup</button><div id="mhArtStatus" class="mh-status">App Store exact matches: built in · SteamGridDB: enabled when the key is set</div></div>
 <div class="mh-setting-card"><h3>Assistant</h3><p>Server-side Assistant connection. The API key stays outside the browser.</p><button class="mh-btn secondary" onclick="testMediaHubAI()">Test connection</button><div id="mhAiSettingsStatus" class="mh-status">Env var: UNOROUTER_API_KEY</div></div>
 <div class="mh-setting-card"><h3>Food request alerts</h3><p>Snack requests are saved by the Nova Math server. For instant Discord alerts, add <strong>FOOD_REQUEST_DISCORD_WEBHOOK</strong> in Vercel environment variables.</p><button class="mh-btn secondary" onclick="testFoodRequestNotifications()">Test notification</button><div id="mhFoodNotifyStatus" class="mh-status">Snack orders include estimated menu pricing + the $3 delivery fee.</div></div>
 <div class="mh-setting-card"><h3>Admin access</h3><p>The private dashboard uses your signed-in Nova Math username. In Vercel, <strong>MEDIAHUB_ADMIN_USERNAME</strong> must match that username.</p><div class="mh-setting-row"><button class="mh-btn" onclick="checkNovaAdminAccess()">Check access</button><button class="mh-btn secondary" onclick="window.mhOpenAdmin?.()">Open dashboard</button></div><div id="mhAdminAccessStatus" class="mh-status">Sign in to your Nova Math account, then check access.</div></div>
 <div class="mh-setting-card"><h3>Discord admin alerts</h3><p>Use <strong>NOVA_ADMIN_ALERTS_WEBHOOK</strong> for private admin alerts and <strong>NOVA_REPORTS_WEBHOOK</strong> for user issue reports. The reports webhook falls back to the admin webhook if needed.</p><button class="mh-btn secondary" onclick="testNovaAdminAlert()">Test admin alert</button><div id="mhAdminAlertStatus" class="mh-status">Only an admin account can send a test alert.</div></div>
 <div class="mh-setting-card wide nova-report-card"><h3>Report a Nova Math problem</h3><p>Signed-in users can report a broken game, Movies &amp; TV problem, Live TV issue, app problem, account issue, or other bug. Reports are saved for the Admin Dashboard and sent to Discord when configured.</p><div class="nova-report-grid"><select id="mhReportType"><option>Broken game</option><option>Movies & TV</option><option>Live TV</option><option>Music</option><option>App</option><option>Account</option><option>Other</option></select><input id="mhReportSubject" maxlength="100" placeholder="What is broken?"><textarea id="mhReportDetails" maxlength="900" placeholder="What happened? Include the game, title, channel, or steps if you can."></textarea><button class="mh-btn" type="button" onclick="submitNovaIssueReport()">Send report</button></div><div id="mhReportStatus" class="mh-status">Reports are private to the site admin.</div></div>
 <div class="mh-setting-card"><h3>Service status</h3><p>Check the parts of Nova Math that depend on server functions or network services.</p><button class="mh-btn secondary" onclick="testMediaHubServices()">Run health check</button><div id="mhServiceStatus" class="mh-status">Not checked yet.</div></div>
 <div class="mh-setting-card"><h3>Chromebook & controller controls</h3><p>Keyboard and gamepad shortcuts for faster navigation.</p><div class="mh-shortcuts"><span><kbd>Ctrl</kbd> + <kbd>K</kbd> Quick Launch</span><span><kbd>Alt</kbd> + <kbd>1–6</kbd> switch tabs</span><span><kbd>/</kbd> focus search</span><span><kbd>Esc</kbd> close player or panels</span><span><kbd>←</kbd> <kbd>→</kbd> move through a game row</span><span>Gamepad D-pad navigate · A select · B back · LB/RB tabs</span></div></div>
 <div class="mh-setting-card mh-secret-card"><h3>Secret code</h3><p>Found a code? Enter it here.</p><div class="mh-setting-row"><input id="mhSecretCode" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="Enter code" onkeydown="if(event.key==='Enter')mhTrySecretCode(this.value)"><button class="mh-btn secondary" type="button" onclick="mhTrySecretCode(document.getElementById('mhSecretCode')?.value)">Enter</button></div><div id="mhSecretStatus" class="mh-status">Codes are case-sensitive when letters are used.</div></div>
 <div class="mh-setting-card wide" id="mhPlaylistsCard"><h3>Music Playlists</h3><p>Create local playlists from YouTube, Audius, Jamendo, Archive, Radio, or TIDAL results.</p><div class="mh-setting-row"><input id="mhPlaylistName" maxlength="30" placeholder="Playlist name"><button class="mh-btn" onclick="createMusicPlaylist()">Create</button></div><div id="mhPlaylistList" class="mh-playlist-list"></div></div>
 <div class="mh-setting-card"><h3>Equalizer</h3><p>3-band EQ for compatible direct audio sources. YouTube/TIDAL iframe playback cannot be processed by the page.</p><label style="display:flex;gap:8px;align-items:center;font-size:12px"><input id="mhEqEnabled" type="checkbox" ${eq.enabled?'checked':''} onchange="toggleMediaHubEq(this.checked)"> Enable EQ</label><div style="margin-top:10px"><label>Bass <input id="mhEqBass" class="mh-range" type="range" min="-12" max="12" value="${Number(eq.bass)||0}" oninput="setMediaHubEq()"></label><label>Mid <input id="mhEqMid" class="mh-range" type="range" min="-12" max="12" value="${Number(eq.mid)||0}" oninput="setMediaHubEq()"></label><label>Treble <input id="mhEqTreble" class="mh-range" type="range" min="-12" max="12" value="${Number(eq.treble)||0}" oninput="setMediaHubEq()"></label></div><div id="mhEqStatus" class="mh-status">${eq.enabled?'Saved as enabled. Start direct audio playback to apply it.':'EQ controls are idle.'}</div></div>
 <div class="mh-setting-card"><h3>Stats</h3><p id="mhStatsText">Loading local play stats…</p><button class="mh-btn secondary" onclick="clearMediaHubStats()">Reset play stats</button></div>
 <div class="mh-setting-card wide"><h3>Achievements</h3><p>Everything here is stored locally per profile.</p><div id="mhAchievementGrid" class="mh-achievement-grid"></div></div>`;
 renderPlaylistList();renderAchievements();renderStatsCard();updateInstallStatus();}
function showSettingsSaved(){const el=document.getElementById('mhSettingsSaved');if(!el)return;el.textContent='Saved.';el.className='mh-status ok';clearTimeout(showSettingsSaved._t);showSettingsSaved._t=setTimeout(()=>{if(el.isConnected){el.textContent='Changes save automatically.';el.className='mh-status';}},1200);}
function renderStatsCard(){const el=document.getElementById('mhStatsText');if(!el)return;const stats=gameStats(),entries=Object.values(stats);const launches=entries.reduce((a,b)=>a+(b.launches||0),0),sec=entries.reduce((a,b)=>a+(b.seconds||0),0);el.textContent=`${launches} game launches · ${formatSeconds(sec)} total playtime · ${gameLists().length} saved games · ${movieList().length} saved movies/shows`;}
function clearStats(){if(!confirm('Reset local game playtime and launch counts for this profile?'))return;storageRemove(pkey('game_stats'));showToast?.('Play stats reset','✓');renderSettings();refreshArcadeSoon();}

function createPlaylist(){const input=document.getElementById('mhPlaylistName');const name=input?.value.trim();if(!name)return;const all=playlists();if(!all[name])all[name]=[];savePlaylists(all);if(input)input.value='';renderPlaylistList();checkAchievements();}
function addCurrentToPlaylist(name){if(typeof musicCurrentTrack==='undefined'||!musicCurrentTrack){showToast?.('Play or choose a song first','♪');return;}const all=playlists();all[name]=all[name]||[];const item=typeof storableTrack==='function'?storableTrack(musicCurrentTrack):musicCurrentTrack;const exists=all[name].some(x=>x.provider===item.provider&&String(x.id)===String(item.id));if(!exists)all[name].push(item);savePlaylists(all);showToast?.(`Added to ${name}`,'＋');renderPlaylistList();}
function playPlaylist(name){const all=playlists(),list=all[name]||[];if(!list.length){showToast?.('Playlist is empty','♪');return;}try{musicQueue=list.filter(item=>item.provider==='tidal'||item.provider==='youtube'||item.playUrl);playAnyTrack(musicQueue[0]);closeSettings();switchTab('music',document.querySelector('[data-tab="music"]'));}catch(e){console.error(e);}}
function deletePlaylist(name){if(!confirm(`Delete playlist “${name}”?`))return;const all=playlists();delete all[name];savePlaylists(all);renderPlaylistList();}
function renderPlaylistList(){const el=document.getElementById('mhPlaylistList');if(!el)return;const all=playlists(),names=Object.keys(all);el.innerHTML=names.length?names.map(name=>`<div class="mh-playlist"><div><strong>${safe(name)}</strong><small> · ${(all[name]||[]).length} tracks</small></div><button class="mh-btn secondary" onclick="playMusicPlaylist(${JSON.stringify(name)})">Play</button><button class="mh-btn secondary" onclick="deleteMusicPlaylist(${JSON.stringify(name)})">Delete</button></div>`).join(''):'<div class="mh-status">No playlists yet.</div>';}
function openPlaylistPicker(){if(typeof musicCurrentTrack==='undefined'||!musicCurrentTrack){showToast?.('Choose a track first','♪');return;}const all=playlists(),names=Object.keys(all);if(!names.length){openSettings();setTimeout(()=>document.getElementById('mhPlaylistName')?.focus(),80);showToast?.('Create a playlist first','＋');return;}const name=prompt('Add to playlist:\n'+names.map((n,i)=>`${i+1}. ${n}`).join('\n'),names[0]);if(name&&all[name])addCurrentToPlaylist(name);}

async function testAiApi(){const el=document.getElementById('mhAiSettingsStatus');if(el){el.className='mh-status';el.textContent='Checking…';}try{const res=await fetch('/api/assistant',{headers:{Accept:'application/json'},cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);if(!data.configured)throw new Error('UNOROUTER_API_KEY is not available to the deployed function. Add it in Vercel and redeploy.');if(el){el.className='mh-status ok';el.textContent='Assistant connection ready.';}return true;}catch(e){if(el){el.className='mh-status bad';el.textContent=e.message||'Assistant connection failed.';}return false;}}

async function testArtApi(){const el=document.getElementById('mhArtStatus');if(el){el.className='mh-status';el.textContent='Testing…';}try{const res=await fetch('/api/game-art?q=Fortnite',{cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);if(el){const steam=data.provider==='SteamGridDB';el.className='mh-status '+(steam?'ok':'bad');el.textContent=steam?`SteamGridDB working · found ${data.gameName||'artwork'}`:`Artwork endpoint works, but this test did not use SteamGridDB (${data.provider||'unknown provider'}).`;}artApiUnavailable=false;}catch(e){if(el){el.className='mh-status bad';el.textContent=e.message||'Artwork API is not configured.';}}}

function updateInstallStatus(){const el=document.getElementById('mhInstallStatus'),btn=document.getElementById('mhInstallBtn');if(!el||!btn)return;if(window.matchMedia?.('(display-mode: standalone)').matches){el.textContent='Already installed.';el.className='mh-status ok';btn.disabled=true;}else if(installPromptEvent){el.textContent='Ready to install.';el.className='mh-status ok';}else if(/iphone|ipad|ipod/i.test(navigator.userAgent)){el.textContent='On iPhone/iPad: Safari → Share → Add to Home Screen.';}else el.textContent='Browser menu → Install app if the button is unavailable.';}
async function installApp(){if(installPromptEvent){installPromptEvent.prompt();await installPromptEvent.userChoice.catch(()=>{});installPromptEvent=null;updateInstallStatus();return;}if(/iphone|ipad|ipod/i.test(navigator.userAgent))showToast?.('Safari → Share → Add to Home Screen','📱');else showToast?.('Browser menu → Install app','📱');}

function initEq(){if(eqContext)return true;const audio=document.getElementById('freeMusicAudio');if(!audio)return false;try{eqContext=new (window.AudioContext||window.webkitAudioContext)();eqSource=eqContext.createMediaElementSource(audio);const low=eqContext.createBiquadFilter(),mid=eqContext.createBiquadFilter(),high=eqContext.createBiquadFilter();low.type='lowshelf';low.frequency.value=180;mid.type='peaking';mid.frequency.value=1000;mid.Q.value=.8;high.type='highshelf';high.frequency.value=4200;eqSource.connect(low);low.connect(mid);mid.connect(high);high.connect(eqContext.destination);eqNodes={low,mid,high};return true;}catch(e){console.warn('EQ unavailable',e);return false;}}
function currentEqSettings(){return {enabled:!!document.getElementById('mhEqEnabled')?.checked,bass:Number(document.getElementById('mhEqBass')?.value||0),mid:Number(document.getElementById('mhEqMid')?.value||0),treble:Number(document.getElementById('mhEqTreble')?.value||0)};}
function saveEqSettings(){writeJSON(pkey('eq'),currentEqSettings());showSettingsSaved();}
function toggleEq(on){const el=document.getElementById('mhEqStatus');saveEqSettings();if(on){const ok=initEq();if(el){el.textContent=ok?'EQ enabled for compatible direct audio.':'EQ saved, but this browser did not allow audio processing yet.';el.className='mh-status '+(ok?'ok':'bad');}if(ok)eqContext.resume?.();}else if(el){el.textContent='EQ controls are idle.';el.className='mh-status';}setEq();}
function setEq(){const values=currentEqSettings();writeJSON(pkey('eq'),values);if(eqNodes){eqNodes.low.gain.value=values.bass;eqNodes.mid.gain.value=values.mid;eqNodes.high.gain.value=values.treble;}showSettingsSaved();}

function drawVisualizer(){cancelAnimationFrame(visualizerFrame);const canvas=document.getElementById('musicVisualizer');if(!canvas)return;const ctx=canvas.getContext('2d');function frame(t){const r=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);let playing=false;try{playing=(musicCurrentTrack&&((musicCurrentTrack.provider==='youtube'&&youtubePlayer?.getPlayerState?.()===1)||(musicCurrentTrack.provider!=='youtube'&&!document.getElementById('freeMusicAudio')?.paused)||document.getElementById('spotifyPlayButton')?.classList.contains('is-playing')));}catch{}const bars=Math.max(28,Math.floor(w/18));const gap=3,bw=(w-(bars-1)*gap)/bars;for(let i=0;i<bars;i++){const wave=(Math.sin(t/260+i*.72)+Math.sin(t/430+i*.23)+2)/4;const amp=playing?(0.18+wave*.76):(.07+wave*.08);const bh=Math.max(2,h*amp);const grad=ctx.createLinearGradient(0,h-bh,0,h);grad.addColorStop(0,getComputedStyle(document.documentElement).getPropertyValue('--mh-accent-2').trim()||'#59ed89');grad.addColorStop(1,getComputedStyle(document.documentElement).getPropertyValue('--mh-accent').trim()||'#1ed760');ctx.fillStyle=grad;ctx.fillRect(i*(bw+gap),h-bh,bw,bh);}visualizerFrame=requestAnimationFrame(frame);}visualizerFrame=requestAnimationFrame(frame);}

function registerPwa(){if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js?v=68').catch(()=>{});window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPromptEvent=e;updateInstallStatus();});}

function wrapCore(){
 const baseBuild=window.buildGameCard;if(baseBuild){window.buildGameCard=function(game){const card=baseBuild(game);const art=card.querySelector('.game-art');if(art){const fav=document.createElement('span');fav.className='card-list-toggle'+(gameLists().includes(game.file)?' active':'');fav.setAttribute('role','button');fav.setAttribute('aria-label','Toggle My List');fav.textContent=gameLists().includes(game.file)?'✓':'＋';fav.onclick=e=>{e.preventDefault();e.stopPropagation();toggleGameList(game);};art.appendChild(fav);observeArt(card,game);}const sec=gamePlaytime(game);const copy=card.querySelector('.game-card-copy span');if(copy&&sec>3){copy.classList.add('game-playtime');copy.textContent=`${game.genre||'Arcade'} · ${formatSeconds(sec)} played`;}return card;};}
 const baseRender=window.renderArcadeHome;if(baseRender){window.renderArcadeHome=function(){baseRender();addPersonalGameRows();};}
 const baseOpen=window.openGame;if(baseOpen){window.openGame=function(game,...rest){finalizeGameSession();rememberGameProfile(game);gameSession={file:game?.file,title:game?.title,started:Date.now()};return baseOpen(game,...rest);};}
 const baseClose=window.closeGamePlayer;if(baseClose){window.closeGamePlayer=function(...args){finalizeGameSession();const r=baseClose(...args);refreshArcadeSoon();return r;};}
 window.getRecentGames=getRecentGamesProfile;window.rememberGame=function(){};
 const baseNetflix=window.createNetflixCard;if(baseNetflix){window.createNetflixCard=function(item,...rest){const card=baseNetflix(item,...rest);const original=card.onclick;card.onclick=function(e){lastSelectedMovieItem=storableMovie(item);return original?.call(card,e);};const wrap=card.querySelector('.netflix-poster-wrap');if(wrap){wrap.style.position='relative';const fav=document.createElement('span');fav.className='card-list-toggle'+(isMovieSaved(item)?' active':'');fav.setAttribute('role','button');fav.textContent=isMovieSaved(item)?'✓':'＋';fav.onclick=e=>{e.preventDefault();e.stopPropagation();toggleMovieList(item);};wrap.appendChild(fav);}return card;};}
 const baseHome=window.loadNetflixHome;if(baseHome){window.loadNetflixHome=async function(){const r=await baseHome();renderMoviePersonalRows();return r;};}
 const baseFeatured=window.openNetflixFeatured;if(baseFeatured){window.openNetflixFeatured=function(){try{lastSelectedMovieItem=storableMovie(netflixFeaturedTitle);}catch{}return baseFeatured();};}
 const baseSwitch=window.switchTab;if(baseSwitch){window.switchTab=function(tabId,btn,...rest){const tabs=readJSON(pkey('tabs_seen'),[]);if(!tabs.includes(tabId)){tabs.push(tabId);writeJSON(pkey('tabs_seen'),tabs);checkAchievements();}const r=baseSwitch(tabId,btn,...rest);if(tabId==='movies')setTimeout(renderMoviePersonalRows,250);return r;};}
}

function hookMoviePlayer(){const player=document.getElementById('mainVideoPlayer');if(!player)return;let tick=0;player.addEventListener('timeupdate',()=>{if(Date.now()-tick>4500){tick=Date.now();saveMovieProgress();}});player.addEventListener('pause',saveMovieProgress);player.addEventListener('ended',()=>{const k=movieResumeKey();if(k){const all=movieResume();delete all[k];saveMovieResume(all);renderMoviePersonalRows();}});player.addEventListener('loadedmetadata',()=>setTimeout(applyMovieResume,80));window.addEventListener('beforeunload',()=>{saveMovieProgress();finalizeGameSession();});}



// Apps launcher --------------------------------------------------------------
const MH_CUSTOM_APPS_KEY='mh_custom_apps_v1';
const MH_DEFAULT_APPS=[
 {name:'Web Browser',native:'webproxy',category:'Built-in',emoji:'🌐',desc:'Private browser powered by Scramjet and Wisp'},
 {name:'Assistant',native:'ai',category:'Built-in',emoji:'✦',desc:'Help, explanations, and general questions'},
 {name:'YouTube',native:'youtube',category:'Built-in',emoji:'▶️',desc:'Search and watch YouTube inside Nova Math'},
 {name:'Calculator',native:'calculator',category:'Built-in',emoji:'🧮',desc:'Fast built-in calculator'},
 {name:'Notes',native:'notes',category:'Built-in',emoji:'📝',desc:'Local notes saved to the active profile'},
 {name:'Choices Voices Packs',url:'/apps/choices-voices-packs.html',domain:'choicervoicer.com',category:'Choicer Voicer',emoji:'🎙️',desc:'Browse Choicer Voicer voice packs, dub packs, tools, and guides'},
];
function readCustomApps(){return readJSON(MH_CUSTOM_APPS_KEY,[]).filter(x=>x&&x.name&&x.url);}
function writeCustomApps(v){writeJSON(MH_CUSTOM_APPS_KEY,v.slice(0,40));}
function appIconUrl(app){if(!app?.domain)return '';return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent('https://'+app.domain)}&sz=128`;}
function safeHttpUrl(value){try{let u=String(value||'').trim();if(u.startsWith('/'))return new URL(u,location.origin).href;if(!/^https?:\/\//i.test(u))u='https://'+u;const p=new URL(u);if(!/^https?:$/.test(p.protocol))return null;return p.href;}catch{return null;}}
let mhCurrentAppUrl='';
function ensureAppWindowUI(){
 if(document.getElementById('mhAppWindow'))return;
 const shell=document.createElement('div');
 shell.id='mhAppWindow';shell.className='mh-app-window';shell.hidden=true;
 shell.innerHTML=`<div class="mh-app-window-card" role="dialog" aria-modal="true" aria-label="App window"><div class="mh-app-window-bar"><div class="mh-app-window-title"><span class="mh-app-window-dot"></span><strong id="mhAppWindowName">App</strong></div><div class="mh-app-window-actions"><button type="button" onclick="reloadMediaHubApp()" title="Reload">↻</button><button type="button" onclick="openMediaHubAppExternal()" title="Open separately">↗</button><button type="button" onclick="closeMediaHubApp()" title="Close">×</button></div></div><div class="mh-app-address"><span>🔒</span><div id="mhAppWindowAddress"></div></div><div class="mh-app-frame-wrap"><iframe id="mhAppFrame" title="Embedded app" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-presentation"></iframe><div class="mh-app-embed-note"><strong>App Window</strong><span>Some websites block being shown inside another site. If an app stays blank or says it refused to connect, that site does not allow embedded viewing.</span></div></div></div>`;
 document.body.appendChild(shell);
 shell.addEventListener('click',e=>{if(e.target===shell)closeMediaHubApp();});
}
function launchMediaHubApp(url,name='App'){
 const safeUrl=safeHttpUrl(url);if(!safeUrl){showToast?.('That app URL is not valid','⚠');return;}
 ensureAppWindowUI();mhCurrentAppUrl=safeUrl;
 const shell=document.getElementById('mhAppWindow'),frame=document.getElementById('mhAppFrame');
 document.getElementById('mhAppWindowName').textContent=name||'App';
 document.getElementById('mhAppWindowAddress').textContent=safeUrl;
 if(frame)frame.src=safeUrl;
 if(shell){shell.hidden=false;requestAnimationFrame(()=>shell.classList.add('open'));}
 document.body.classList.add('mh-app-window-open');
}
function closeMediaHubApp(){const shell=document.getElementById('mhAppWindow'),frame=document.getElementById('mhAppFrame');if(shell){shell.classList.remove('open');setTimeout(()=>{shell.hidden=true;},160);}if(frame)frame.src='about:blank';document.body.classList.remove('mh-app-window-open');}
function reloadMediaHubApp(){const frame=document.getElementById('mhAppFrame');if(!frame||!mhCurrentAppUrl)return;frame.src='about:blank';setTimeout(()=>frame.src=mhCurrentAppUrl,20);}
function openMediaHubAppExternal(){if(mhCurrentAppUrl)window.open(mhCurrentAppUrl,'_blank','noopener,noreferrer');}

function renderApps(query=''){const grid=document.getElementById('appsGrid');if(!grid)return;const q=String(query||'').trim().toLowerCase();const all=MH_DEFAULT_APPS.filter(a=>!q||[a.name,a.category,a.desc,a.native].some(v=>String(v||'').toLowerCase().includes(q)));grid.innerHTML='';if(!all.length){grid.innerHTML='<div class="apps-empty">No apps match that search.</div>';return;}all.forEach(app=>{const card=document.createElement('article');card.className='app-card'+(app.native?' app-card-native':'');card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',`Open ${app.name}`);const icon=app.native?`<span class="app-card-emoji">${safe(app.emoji||'✦')}</span>`:app.domain?`<img src="${safe(appIconUrl(app))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><span class="app-card-emoji" style="display:none">${safe(app.emoji||'🔗')}</span>`:`<span class="app-card-emoji">${safe(app.emoji||'🔗')}</span>`;card.innerHTML=`${app.custom?`<button class="app-card-delete" type="button" aria-label="Remove ${safe(app.name)}">×</button>`:''}<div class="app-card-icon-shell">${icon}</div><strong>${safe(app.name)}</strong><small>${safe(app.desc||app.url)}</small><span class="app-card-badge">${safe(app.category||'App')}</span>`;const launch=()=>app.native?window.openNativeApp?.(app.native,app.name):launchMediaHubApp(app.url,app.name);card.onclick=e=>{if(e.target.closest('.app-card-delete'))return;launch();};card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();launch();}};if(app.custom){card.querySelector('.app-card-delete').onclick=e=>{e.preventDefault();e.stopPropagation();removeCustomApp(app.customIndex);};}grid.appendChild(card);});}
function filterApps(q){renderApps(q);}
function toggleAddAppPanel(){const p=document.getElementById('appsAddPanel');if(!p)return;p.hidden=!p.hidden;if(!p.hidden)setTimeout(()=>document.getElementById('customAppName')?.focus(),20);}
function addCustomApp(){const name=document.getElementById('customAppName')?.value.trim(),raw=document.getElementById('customAppUrl')?.value.trim();if(!name||!raw){showToast?.('Enter an app name and URL','⚠');return;}const url=safeHttpUrl(raw);if(!url){showToast?.('Use a valid http/https URL','⚠');return;}let domain='';try{domain=new URL(url).hostname;}catch{}const list=readCustomApps();list.push({name:name.slice(0,28),url,domain,category:'Custom',desc:domain||url,emoji:'🔗'});writeCustomApps(list);document.getElementById('customAppName').value='';document.getElementById('customAppUrl').value='';renderApps(document.getElementById('appsSearch')?.value||'');showToast?.(`${name} added`,'＋');}
function removeCustomApp(index){const list=readCustomApps();const removed=list[index];list.splice(index,1);writeCustomApps(list);renderApps(document.getElementById('appsSearch')?.value||'');showToast?.(removed?`${removed.name} removed`:'App removed','✓');}



// Assistant ------------------------------------------------------------------
const MH_AI_HISTORY_MAX=16;
function aiHistory(){return readJSON(pkey('ai_history'),[]).filter(x=>x&&['user','assistant'].includes(x.role)&&x.content).slice(-MH_AI_HISTORY_MAX);}
function saveAiHistory(list){writeJSON(pkey('ai_history'),list.slice(-MH_AI_HISTORY_MAX));}
function ensureAiUI(){
 if(document.getElementById('mhAiPanel'))return;
 const wrap=document.createElement('div');
 wrap.innerHTML=`<button id="mhAiFab" class="mh-ai-fab" type="button" onclick="toggleMediaHubAI()" aria-label="Open assistant"><span>✦</span></button><section id="mhAiPanel" class="mh-ai-panel" aria-hidden="true"><header><div><span class="mh-ai-logo">✦</span><div><strong>Assistant</strong><small>Nova Math</small></div></div><div class="mh-ai-head-actions"><button type="button" onclick="clearMediaHubAI()" title="Clear chat">⌫</button><button type="button" onclick="closeMediaHubAI()" title="Close">×</button></div></header><div id="mhAiMessages" class="mh-ai-messages"></div><div class="mh-ai-chips"><button onclick="askMediaHubAI('Explain the Nova Math sections.')">Site help</button><button onclick="askMediaHubAI('Suggest a game from the arcade.')">Pick a game</button><button onclick="askMediaHubAI('Explain the music section.')">Music help</button></div><form id="mhAiForm" class="mh-ai-form"><textarea id="mhAiInput" rows="1" maxlength="3000" placeholder="Ask a question…"></textarea><button id="mhAiSend" type="submit" aria-label="Send">➤</button></form><div id="mhAiLiveStatus" class="mh-ai-foot">Assistant service status appears here.</div></section>`;
 document.body.appendChild(wrap);
 document.getElementById('mhAiForm')?.addEventListener('submit',e=>{e.preventDefault();const input=document.getElementById('mhAiInput');const q=input?.value.trim();if(q){input.value='';sendMediaHubAI(q);}});
 document.getElementById('mhAiInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('mhAiForm')?.requestSubmit();}});
 renderAiHistory();
}
function currentHubContext(prompt=''){
 const tab=document.body.dataset.hubTab||'arcade';
 const words=String(prompt).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
 let games=(window.BUILT_IN_GAMES||[]);
 if(words.length){games=games.map(g=>({g,score:words.reduce((n,w)=>n+(String(g.title+' '+(g.genre||'')).toLowerCase().includes(w)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.g);}
 if(!games.length||!words.length){const recent=typeof getRecentGames==='function'?getRecentGames():[];games=[...recent,...(window.BUILT_IN_GAMES||[]).slice(0,24)];}
 const unique=[];const seen=new Set();for(const g of games){if(g?.title&&!seen.has(g.title)){seen.add(g.title);unique.push({title:g.title,genre:g.genre||'Arcade'});}if(unique.length>=24)break;}
 return {currentTab:tab,gameCount:(window.BUILT_IN_GAMES||[]).length,matchingGames:unique,features:['Arcade games','Movies & TV','Music search and playback','Assistant','YouTube mini app','Calculator','Notes','Live TV / IPTV','My List','Profiles','Themes','Achievements','Quick Launch','Game artwork','Continue Watching','Food & Drinks requests']};
}
function renderAiHistory(){const box=document.getElementById('mhAiMessages');if(!box)return;const history=aiHistory();box.innerHTML='';if(!history.length){box.innerHTML='<div class="mh-ai-welcome"><span>✦</span><strong>Assistant</strong><p>Site help, recommendations, explanations, and general questions.</p></div>';return;}history.forEach(m=>appendAiBubble(m.role,m.content,false));box.scrollTop=box.scrollHeight;}
function appendAiBubble(role,content,scroll=true){const box=document.getElementById('mhAiMessages');if(!box)return;const div=document.createElement('div');div.className='mh-ai-msg '+role;div.textContent=content;box.appendChild(div);if(scroll)box.scrollTop=box.scrollHeight;return div;}
function toggleMediaHubAI(){const p=document.getElementById('mhAiPanel');if(!p)return;if(p.classList.contains('open'))closeMediaHubAI();else openMediaHubAI();}
function openMediaHubAI(){ensureAiUI();const p=document.getElementById('mhAiPanel');p?.classList.add('open');p?.setAttribute('aria-hidden','false');checkAiLiveStatus();setTimeout(()=>document.getElementById('mhAiInput')?.focus(),80);}
async function checkAiLiveStatus(){const el=document.getElementById('mhAiLiveStatus');if(!el||el.dataset.checked==='1')return;el.textContent='Checking Assistant connection…';try{const res=await fetch('/api/assistant',{headers:{Accept:'application/json'},cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);el.dataset.checked='1';el.textContent=data.configured?`Assistant ready · ${data.model||'UnoRouter'}`:'Assistant key missing on Vercel · add UNOROUTER_API_KEY and redeploy';el.classList.toggle('bad',!data.configured);}catch(e){el.textContent='Assistant service unavailable · '+(e.message||'connection error');el.classList.add('bad');}}
function closeMediaHubAI(){const p=document.getElementById('mhAiPanel');p?.classList.remove('open');p?.setAttribute('aria-hidden','true');}
function clearMediaHubAI(){saveAiHistory([]);renderAiHistory();showToast?.('AI chat cleared','✦');}
function askMediaHubAI(q){openMediaHubAI();sendMediaHubAI(q);}
async function sendMediaHubAI(q){
 const text=String(q||'').trim();if(!text)return;openMediaHubAI();
 let history=aiHistory();history.push({role:'user',content:text});saveAiHistory(history);appendAiBubble('user',text);
 const typing=appendAiBubble('assistant','Thinking…');typing?.classList.add('typing');
 const send=document.getElementById('mhAiSend');if(send)send.disabled=true;
 try{
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);let res;try{res=await fetch('/api/assistant',{method:'POST',signal:controller.signal,cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history.slice(-10),context:currentHubContext(text)})});}finally{clearTimeout(timeout);}
  const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||`AI request failed (${res.status})`);
  const live=document.getElementById('mhAiLiveStatus');if(live){live.dataset.checked='1';live.classList.remove('bad');live.textContent='Assistant connection ready.';}
  const answer=String(data.message||'').trim()||'I did not get a response. Try again.';
  typing?.remove();appendAiBubble('assistant',answer);history=aiHistory();history.push({role:'assistant',content:answer});saveAiHistory(history);
 }catch(e){typing?.remove();const msg=e?.name==='AbortError'?'The request timed out. Try again.':(e.message||'Try again in a moment.');appendAiBubble('assistant',`I couldn't answer right now. ${msg}`);const live=document.getElementById('mhAiLiveStatus');if(live){live.classList.add('bad');live.textContent=msg;}}finally{if(send)send.disabled=false;}
}

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('mhSettings')?.hidden){e.preventDefault();closeSettings();}});


function novaPlatformToken(){return localStorage.getItem('mh_social_token_v1')||'';}
async function novaPlatformAction(action,data={}){
 const res=await fetch('/api/platform-api',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+novaPlatformToken()},body:JSON.stringify({action,...data})});
 const out=await res.json().catch(()=>({}));if(!res.ok)throw new Error(out.error||`HTTP ${res.status}`);return out;
}
async function checkNovaAdminAccess(){
 const el=document.getElementById('mhAdminAccessStatus');if(el){el.className='mh-status';el.textContent='Checking admin access…';}
 try{const data=await novaPlatformAction('admin-status');if(el){el.className='mh-status '+(data.isAdmin?'ok':'bad');el.textContent=data.isAdmin?`Admin access ready for @${data.username||'account'}.`:data.configured?`Signed in as @${data.username||'account'}, but MEDIAHUB_ADMIN_USERNAME does not match.`:`Set MEDIAHUB_ADMIN_USERNAME in Vercel to ${data.username||'your Nova username'}, redeploy, then check again.`;}return data;}catch(e){if(el){el.className='mh-status bad';el.textContent=e.message==='Sign in required'?'Sign in to your Nova Math account first.':(e.message||'Admin check failed.');}return null;}
}
async function testNovaAdminAlert(){
 const el=document.getElementById('mhAdminAlertStatus');if(el){el.className='mh-status';el.textContent='Sending private test alert…';}
 try{const data=await novaPlatformAction('admin-test-alert');if(el){el.className='mh-status '+(data.sent?'ok':'bad');el.textContent=data.sent?'Discord admin alert sent.':data.configured?'Discord rejected the alert. Check the webhook.':'NOVA_ADMIN_ALERTS_WEBHOOK is not configured in Vercel.';}}catch(e){if(el){el.className='mh-status bad';el.textContent=e.message||'Admin alert test failed.';}}
}
async function submitNovaIssueReport(){
 const type=document.getElementById('mhReportType')?.value||'Other',subject=document.getElementById('mhReportSubject')?.value.trim()||'',details=document.getElementById('mhReportDetails')?.value.trim()||'',el=document.getElementById('mhReportStatus');
 if(!subject||!details){if(el){el.className='mh-status bad';el.textContent='Add a short subject and details first.';}return;}
 if(el){el.className='mh-status';el.textContent='Sending report…';}
 try{const data=await novaPlatformAction('site-report',{category:type,subject,details,page:document.body.dataset.hubTab||location.pathname});if(el){el.className='mh-status ok';el.textContent=data.discordSent?'Report saved and sent to the private Discord reports channel.':'Report saved for the Admin Dashboard.';}const a=document.getElementById('mhReportSubject'),b=document.getElementById('mhReportDetails');if(a)a.value='';if(b)b.value='';}
 catch(e){if(el){el.className='mh-status bad';el.textContent=e.message==='Sign in required'?'Sign in to your Nova Math account before sending a report.':(e.message||'Could not send report.');}}
}

async function testFoodRequestNotifications(){
 const el=document.getElementById('mhFoodNotifyStatus');if(el){el.className='mh-status';el.textContent='Sending test…';}
 try{const res=await fetch('/api/food-notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Nova Math Test',order_items:'1x Test Snack ($2.49 est. each)',estimated_subtotal:2.49,delivery_fee:3,estimated_total:5.49,date:new Date().toISOString().slice(0,10),delivery_window:'Test only',meeting_spot:'Settings',notes:'If you see this, Snack Drop alerts are working.'})});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);if(el){el.className='mh-status '+(data.sent?'ok':'bad');el.textContent=data.sent?'Discord notification sent.':'No Discord webhook is configured yet. Add FOOD_REQUEST_DISCORD_WEBHOOK in Vercel, then redeploy.';}}
 catch(e){if(el){el.className='mh-status bad';el.textContent=e.message||'Notification test failed.';}}
}
async function testMediaHubServices(){
 const el=document.getElementById('mhServiceStatus');if(el){el.className='mh-status';el.textContent='Checking site, Live TV, AI, artwork, and food alerts…';}
 const checks=[
  ['Site',()=>fetch('/index.html',{cache:'no-store'}).then(r=>r.ok)],
  ['Live TV',()=>fetch('/api/iptv-playlist',{cache:'no-store'}).then(r=>r.ok)],
  ['Assistant',()=>fetch('/api/assistant',{cache:'no-store'}).then(r=>r.ok)],
  ['SteamGridDB',()=>fetch('/api/game-art?q=Fortnite',{cache:'no-store'}).then(async r=>{if(!r.ok)return false;const d=await r.json().catch(()=>({}));return d.provider==='SteamGridDB';})],
  ['Food alerts',()=>fetch('/api/food-notify',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.ok)]
 ];
 const out=[];for(const [name,fn] of checks){try{out.push(`${name}: ${(await fn())?'✓':'✕'}`);}catch{out.push(`${name}: ✕`);}}
 if(el){const bad=out.some(x=>x.includes('✕'));el.className='mh-status '+(bad?'bad':'ok');el.textContent=out.join(' · ');}
}
let mhGamepadLoop=0,mhPrevPadButtons=[];
function controllerFocusables(){return [...document.querySelectorAll('button:not([disabled]):not([hidden]),[role="button"][tabindex],input:not([disabled]):not([hidden]),select:not([disabled]):not([hidden]),.netflix-game-card[tabindex]')].filter(el=>el.offsetParent!==null);}
function moveControllerFocus(delta){const all=controllerFocusables();if(!all.length)return;let at=all.indexOf(document.activeElement);if(at<0)at=0;at=Math.max(0,Math.min(all.length-1,at+delta));all[at].focus({preventScroll:true});all[at].scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});}
function switchControllerTab(step){const tabs=['arcade','movies','music','livetv','sports','food','apps'];const current=document.body.dataset.hubTab||'arcade';let i=tabs.indexOf(current);i=(i+step+tabs.length)%tabs.length;window.switchTab?.(tabs[i],document.querySelector(`[data-tab="${tabs[i]}"]`));}
function initGamepadNavigation(){
 const loop=()=>{const gp=navigator.getGamepads?.()[0];if(gp){const b=gp.buttons.map(x=>!!x.pressed);const press=i=>b[i]&&!mhPrevPadButtons[i];if(press(0))document.activeElement?.click?.();if(press(1)){if(document.body.classList.contains('game-open'))window.closeGamePlayer?.();else if(document.getElementById('quickLaunch')?.classList.contains('open'))window.closeQuickLaunch?.();else window.closeMediaHubSettings?.();}if(press(12))moveControllerFocus(-4);if(press(13))moveControllerFocus(4);if(press(14))moveControllerFocus(-1);if(press(15))moveControllerFocus(1);if(press(4))switchControllerTab(-1);if(press(5))switchControllerTab(1);mhPrevPadButtons=b;}mhGamepadLoop=requestAnimationFrame(loop);};
 window.addEventListener('gamepadconnected',()=>{showToast?.('Controller connected','🎮');if(!mhGamepadLoop)loop();},{once:true});
 if(navigator.getGamepads?.()[0])loop();
}
// Username/password account sync is handled by social.js. Legacy email-identity sync removed in v72.
function init(){initProfile();applyTheme();injectUI();ensureAppWindowUI();wrapCore();hookMoviePlayer();registerPwa();drawVisualizer();renderMoviePersonalRows();renderApps();checkAchievements();initGamepadNavigation();setTimeout(()=>{try{renderArcadeHome();scanGameCardsForArt();}catch{}},20);setTimeout(scanGameCardsForArt,500);}

window.testMediaHubAI=testAiApi;window.filterApps=filterApps;window.toggleAddAppPanel=toggleAddAppPanel;window.addCustomApp=addCustomApp;window.removeCustomApp=removeCustomApp;window.launchMediaHubApp=launchMediaHubApp;window.closeMediaHubApp=closeMediaHubApp;window.reloadMediaHubApp=reloadMediaHubApp;window.openMediaHubAppExternal=openMediaHubAppExternal;window.toggleMediaHubAI=toggleMediaHubAI;window.openMediaHubAI=openMediaHubAI;window.closeMediaHubAI=closeMediaHubAI;window.clearMediaHubAI=clearMediaHubAI;window.askMediaHubAI=askMediaHubAI;window.openMediaHubSettings=openSettings;window.closeSettings=closeSettings;window.switchMediaHubProfile=switchProfile;window.createMediaHubProfile=createProfile;window.deleteMediaHubProfile=deleteCurrentProfile;window.setMediaHubTheme=setTheme;window.setMediaHubReduceMotion=setReduceMotion;window.createMusicPlaylist=createPlaylist;window.playMusicPlaylist=playPlaylist;window.deleteMusicPlaylist=deletePlaylist;window.testGameArtApi=testArtApi;window.installMediaHub=installApp;window.toggleMediaHubEq=toggleEq;window.setMediaHubEq=setEq;window.clearMediaHubStats=clearStats;window.testFoodRequestNotifications=testFoodRequestNotifications;window.testMediaHubServices=testMediaHubServices;window.checkNovaAdminAccess=checkNovaAdminAccess;window.testNovaAdminAlert=testNovaAdminAlert;window.submitNovaIssueReport=submitNovaIssueReport;

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
