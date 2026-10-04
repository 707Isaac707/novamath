(()=>{
'use strict';
const SFX_KEY='mh_ui_sfx_v1',VOL_KEY='mh_ui_sfx_volume_v1';
let audioCtx=null,lastTone=0,rowObserver=null;
const sfxEnabled=()=>localStorage.getItem(SFX_KEY)!=='0';
const sfxVolume=()=>Math.max(.02,Math.min(.24,Number(localStorage.getItem(VOL_KEY)||.10)));
function tone(kind='tap'){
  if(!sfxEnabled()||Date.now()-lastTone<35)return;lastTone=Date.now();
  try{
    audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
    const osc=audioCtx.createOscillator(),gain=audioCtx.createGain(),now=audioCtx.currentTime;
    const freq=kind==='open'?520:kind==='back'?250:kind==='success'?680:380;
    osc.type='sine';osc.frequency.setValueAtTime(freq,now);osc.frequency.exponentialRampToValueAtTime(Math.max(120,freq*(kind==='back'?.72:1.18)),now+.055);
    gain.gain.setValueAtTime(0.0001,now);gain.gain.exponentialRampToValueAtTime(sfxVolume(),now+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+.07);
    osc.connect(gain);gain.connect(audioCtx.destination);osc.start(now);osc.stop(now+.08);
  }catch{}
}
function setSfx(on){localStorage.setItem(SFX_KEY,on?'1':'0');if(on)tone('success');window.showToast?.(on?'UI sounds on':'UI sounds off',on?'🔊':'🔇');}
function setSfxVolume(value){localStorage.setItem(VOL_KEY,String(Math.max(.02,Math.min(.24,Number(value)||.10))));tone('tap');}
function isChromeOS(){return /CrOS/i.test(navigator.userAgent)||((innerWidth>=900&&innerWidth<=1500)&&(innerHeight<=900));}
function slug(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'row';}
function setGenreActive(id){
  document.querySelectorAll('.game-genre-chip').forEach(b=>b.classList.toggle('active',b.dataset.row===id));
  document.querySelectorAll('.game-row-section').forEach(s=>s.classList.toggle('mh-row-current',s.id===id));
  const chip=document.querySelector(`.game-genre-chip[data-row="${CSS.escape(id)}"]`);chip?.scrollIntoView?.({behavior:'smooth',block:'nearest',inline:'center'});
}
function refreshGameGenreNav(){
  const toolbar=document.querySelector('#tab-arcade .games-toolbar'),container=document.getElementById('game-container');if(!toolbar||!container)return;
  let nav=document.getElementById('gameGenreNav');if(!nav){nav=document.createElement('nav');nav.id='gameGenreNav';nav.className='game-genre-nav';nav.setAttribute('aria-label','Game categories');toolbar.after(nav);}
  const sections=[...container.querySelectorAll('.game-row-section')];
  if(!sections.length){nav.hidden=true;return;}nav.hidden=false;
  const used=new Set();sections.forEach((section,i)=>{const title=section.querySelector('.game-row-title')?.textContent?.trim()||`Row ${i+1}`;let id='games-'+slug(title);while(used.has(id))id+='-'+(i+1);used.add(id);section.id=id;section.dataset.rowTitle=title;});
  nav.innerHTML=sections.map((s,i)=>`<button type="button" class="game-genre-chip${i===0?' active':''}" data-row="${s.id}">${s.dataset.rowTitle}</button>`).join('');
  nav.querySelectorAll('.game-genre-chip').forEach(btn=>btn.addEventListener('click',()=>{tone('tap');const section=document.getElementById(btn.dataset.row);if(section){const offset=(document.querySelector('.hub-header')?.offsetHeight||68)+(nav.offsetHeight||48)+12;const y=section.getBoundingClientRect().top+scrollY-offset;scrollTo({top:y,behavior:'smooth'});setGenreActive(section.id);}}));
  rowObserver?.disconnect();rowObserver=new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(visible)setGenreActive(visible.target.id);},{root:null,rootMargin:'-135px 0px -52% 0px',threshold:[0,.08,.25,.55]});sections.forEach(s=>rowObserver.observe(s));
}
function centerTopTab(){const b=document.querySelector('.hub-header .tab-btn.active');b?.scrollIntoView?.({behavior:'smooth',block:'nearest',inline:'center'});}
function patchGlobals(){
  if(typeof window.renderArcadeHome==='function'&&!window.renderArcadeHome.__v68){const base=window.renderArcadeHome;const wrap=function(...args){const r=base.apply(this,args);requestAnimationFrame(refreshGameGenreNav);return r};wrap.__v68=true;window.renderArcadeHome=wrap;}
  if(typeof window.renderGameSearch==='function'&&!window.renderGameSearch.__v68){const base=window.renderGameSearch;const wrap=function(...args){const r=base.apply(this,args);requestAnimationFrame(refreshGameGenreNav);return r};wrap.__v68=true;window.renderGameSearch=wrap;}
  if(typeof window.switchTab==='function'&&!window.switchTab.__v68){const base=window.switchTab;const wrap=function(...args){const r=base.apply(this,args);requestAnimationFrame(()=>{centerTopTab();if(args[0]==='arcade')refreshGameGenreNav();});return r};wrap.__v68=true;window.switchTab=wrap;}
}
function init(){
  if(isChromeOS())document.documentElement.classList.add('mh-chromebook');
  patchGlobals();refreshGameGenreNav();centerTopTab();
  const header=document.querySelector('.hub-header');const onScroll=()=>header?.classList.toggle('mh-scrolled',scrollY>12);onScroll();addEventListener('scroll',onScroll,{passive:true});
  document.addEventListener('click',e=>{const el=e.target.closest?.('.tab-btn,.hub-tools button,.hero-actions button,.netflix-game-card,.game-genre-chip,.mh-btn,.mh-modal button,.mh-social-modal button');if(!el)return;if(el.matches('.netflix-game-card,.hero-play-btn'))tone('open');else if(/back|close|classroom/i.test(el.className+' '+(el.title||'')))tone('back');else tone('tap');},{capture:true});
  new MutationObserver(()=>{if(document.body.dataset.hubTab==='arcade')requestAnimationFrame(refreshGameGenreNav);}).observe(document.getElementById('game-container')||document.body,{childList:true,subtree:false});
}

let secretBusy=false;
function ensureSecretOverlay(){
  let wrap=document.getElementById('mhSecret6753Overlay');
  if(wrap)return wrap;
  wrap=document.createElement('div');
  wrap.id='mhSecret6753Overlay';wrap.className='mh-secret-overlay';wrap.hidden=true;
  wrap.innerHTML='<div class="mh-secret-flash"></div><div class="mh-secret-photo-wrap"><img src="/assets/secret-6753.jpg" alt="Secret image"></div>';
  document.body.appendChild(wrap);return wrap;
}
async function runSecret6753(){
  if(secretBusy)return;secretBusy=true;
  const overlay=ensureSecretOverlay();
  const settings=document.getElementById('mhSettings'),back=document.getElementById('mhSettingsBackdrop');
  if(settings)settings.hidden=true;if(back)back.hidden=true;document.body.classList.remove('utility-open');
  overlay.hidden=false;overlay.classList.remove('show','fade');void overlay.offsetWidth;overlay.classList.add('show');
  try{
    const boom=new Audio('/assets/vine-boom.wav');boom.volume=.92;await boom.play();
  }catch{
    try{tone('back')}catch{}
  }
  if(navigator.vibrate)try{navigator.vibrate([45,30,95])}catch{}
  setTimeout(()=>overlay.classList.add('fade'),1850);
  setTimeout(()=>{overlay.hidden=true;overlay.classList.remove('show','fade');secretBusy=false;},2850);
}
function trySecretCode(value){
  const code=String(value??'').trim();const input=document.getElementById('mhSecretCode'),status=document.getElementById('mhSecretStatus');
  if(code==='6753'){
    if(status){status.textContent='Code accepted.';status.className='mh-status ok';}
    if(input)input.value='';window.mhPlatformSecretFound?.('6753');runSecret6753();return true;
  }
  if(code&&window.mhHandleExtraSecretCode?.(code)){if(status){status.textContent='Code accepted.';status.className='mh-status ok';}if(input)input.value='';return true;}
  if(status){status.textContent=code?'Code not recognized.':'Code required.';status.className='mh-status bad';}
  input?.classList.remove('mh-secret-shake');void input?.offsetWidth;input?.classList.add('mh-secret-shake');
  setTimeout(()=>input?.classList.remove('mh-secret-shake'),380);return false;
}

window.mhSetUiSfx=setSfx;window.mhSetUiSfxVolume=setSfxVolume;window.mhUiSfxEnabled=sfxEnabled;window.mhUiSfxVolume=sfxVolume;window.mhRefreshGameGenreNav=refreshGameGenreNav;window.mhTrySecretCode=trySecretCode;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
