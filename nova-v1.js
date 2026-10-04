(() => {
  'use strict';

  const LOCK_CODE = '6753';
  const UNLOCK_KEY = 'nova_math_unlocked';
  let expr = '';
  let history = '';
  let justEvaluated = false;
  let unlocking = false;

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

  function displayEl(){ return $('#novaCalcDisplay'); }
  function historyEl(){ return $('#novaCalcHistory'); }
  function updateCalc(){
    const d=displayEl(), h=historyEl();
    if(d) d.textContent = expr || '0';
    if(h) h.textContent = history || '\u00a0';
  }
  function flashKey(key){
    const btn=$(`[data-calc="${CSS.escape(key)}"]`);
    if(!btn) return;
    btn.classList.add('is-pressed');
    setTimeout(()=>btn.classList.remove('is-pressed'),90);
  }
  function resetCalc(){ expr=''; history=''; justEvaluated=false; updateCalc(); }
  function calculatorError(){
    expr='Error'; history=''; justEvaluated=true; updateCalc();
    const w=$('.nova-calc-window');
    if(w){w.classList.remove('nova-calc-error'); void w.offsetWidth; w.classList.add('nova-calc-error'); setTimeout(()=>w.classList.remove('nova-calc-error'),350)}
  }
  function formatNumber(n){
    if(!Number.isFinite(n)) return 'Error';
    const abs=Math.abs(n);
    if((abs!==0 && abs>=1e12) || (abs!==0 && abs<1e-8)) return n.toExponential(8).replace(/\.0+e/,'e');
    return String(Number(n.toFixed(10)));
  }
  function safeEval(raw){
    const s=raw.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
    if(!/^[0-9+\-*/.()%\s]+$/.test(s)) throw new Error('bad expression');
    if(/\/\*|\/\//.test(s)) throw new Error('bad expression');
    // Expression is restricted to numeric operators above.
    const result=Function(`"use strict";return (${s})`)();
    if(typeof result!=='number' || !Number.isFinite(result)) throw new Error('bad result');
    return result;
  }
  function unlockNova(){
    if(unlocking) return;
    unlocking=true;
    const t=$('#novaUnlockTransition');
    document.body.classList.add('nova-unlocking');
    if(t) t.classList.add('active');
    try{navigator.vibrate?.(35)}catch{}
    setTimeout(()=>{
      try{ sessionStorage.setItem(UNLOCK_KEY,'1'); }catch{}
      if(typeof window.enterMediaHub==='function') window.enterMediaHub({skipLoader:true,skipAccountGate:true,tab:'arcade'});
      document.body.classList.remove('nova-unlocking');
      if(t) t.classList.remove('active');
      resetCalc();
      unlocking=false;
    },900);
  }
  function pressCalc(key){
    if(unlocking) return;
    if(expr==='Error') resetCalc();
    if(key==='clear'){ resetCalc(); return; }
    if(key==='sign'){
      if(!expr) return;
      const m=expr.match(/(-?\d*\.?\d+)$/);
      if(m){ const v=m[1]; const repl=v.startsWith('-')?v.slice(1):'-'+v; expr=expr.slice(0,-v.length)+repl; updateCalc(); }
      return;
    }
    if(key==='percent'){
      if(!expr) return;
      const m=expr.match(/(\d*\.?\d+)$/);
      if(m){const n=Number(m[1])/100;expr=expr.slice(0,-m[1].length)+formatNumber(n);updateCalc();}
      return;
    }
    if(key==='backspace'){ expr=expr.slice(0,-1); justEvaluated=false; updateCalc(); return; }
    if(key==='='){
      if(expr.trim()===LOCK_CODE){ history=expr+' ='; updateCalc(); unlockNova(); return; }
      if(!expr) return;
      try{
        const source=expr;
        const result=formatNumber(safeEval(source));
        history=source+' ='; expr=result; justEvaluated=true; updateCalc();
      }catch{ calculatorError(); }
      return;
    }
    const isOp=/^[+\-*/]$/.test(key);
    if(justEvaluated && !isOp){expr='';history='';justEvaluated=false;}
    if(isOp){
      if(!expr && key!=='-') return;
      if(/[+\-*/.]$/.test(expr) && key!=='-') expr=expr.slice(0,-1);
      justEvaluated=false;
    }
    if(key==='.' && /(?:^|[+\-*/])(\d*)\.[0-9]*$/.test(expr)) return;
    if(expr.length>=24) return;
    expr+=key;
    updateCalc();
  }

  function initCalculator(){
    const keys=$('#novaCalcKeys');
    if(!keys) return;
    keys.addEventListener('click',e=>{
      const b=e.target.closest('[data-calc]'); if(!b) return;
      pressCalc(b.dataset.calc);
    });
    document.addEventListener('keydown',e=>{
      if(!document.body.classList.contains('dashboard-mode')) return;
      if(e.ctrlKey||e.metaKey||e.altKey) return;
      let key='';
      if(/^\d$/.test(e.key)) key=e.key;
      else if(['+','-','*','/','.'].includes(e.key)) key=e.key;
      else if(e.key==='Enter'||e.key==='=') key='=';
      else if(e.key==='Backspace') key='backspace';
      else if(e.key==='Escape'||e.key==='Delete') key='clear';
      else if(e.key==='%') key='percent';
      if(!key) return;
      e.preventDefault();
      if(key!=='backspace') flashKey(key);
      pressCalc(key);
    });
    updateCalc();
  }

  function makeNavScrollable(){
    const header=$('.hub-header'), tabs=header?.querySelector('.tabs');
    if(!header||!tabs||tabs.closest('.nova-nav-wrap')) return;
    tabs.tabIndex=0;
    const wrap=document.createElement('div');
    wrap.className='nova-nav-wrap';
    const left=document.createElement('button');
    left.type='button'; left.className='nova-nav-btn'; left.setAttribute('aria-label','Scroll navigation left'); left.textContent='‹';
    const right=document.createElement('button');
    right.type='button'; right.className='nova-nav-btn'; right.setAttribute('aria-label','Scroll navigation right'); right.textContent='›';
    tabs.parentNode.insertBefore(wrap,tabs); wrap.append(left,tabs,right);
    const update=()=>{
      const max=Math.max(0,tabs.scrollWidth-tabs.clientWidth-1);
      left.disabled=tabs.scrollLeft<=2; right.disabled=tabs.scrollLeft>=max-2;
      wrap.classList.toggle('can-left',!left.disabled); wrap.classList.toggle('can-right',!right.disabled);
    };
    const scrollByDir=dir=>tabs.scrollBy({left:dir*Math.max(180,tabs.clientWidth*.55),behavior:'smooth'});
    left.onclick=()=>scrollByDir(-1); right.onclick=()=>scrollByDir(1);
    tabs.addEventListener('scroll',update,{passive:true});
    tabs.addEventListener('wheel',e=>{
      if(Math.abs(e.deltaY)<=Math.abs(e.deltaX)) return;
      if(tabs.scrollWidth<=tabs.clientWidth+4) return;
      e.preventDefault(); tabs.scrollBy({left:e.deltaY*.9,behavior:'auto'});
    },{passive:false});
    const centerActive=()=>tabs.querySelector('.tab-btn.active')?.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});
    const observer=new MutationObserver(centerActive);
    $$('.tab-btn',tabs).forEach(b=>observer.observe(b,{attributes:true,attributeFilter:['class']}));
    window.addEventListener('resize',update,{passive:true});
    requestAnimationFrame(update);
  }

  function initKeyboardNav(){
    document.addEventListener('keydown',e=>{
      if(!document.body.classList.contains('hub-mode')) return;
      if(!(e.ctrlKey||e.metaKey) || !['ArrowLeft','ArrowRight'].includes(e.key)) return;
      const btns=$$('.hub-header .tab-btn');
      const i=btns.findIndex(b=>b.classList.contains('active'));
      if(i<0) return;
      e.preventDefault();
      const next=btns[(i+(e.key==='ArrowRight'?1:-1)+btns.length)%btns.length];
      next?.click(); next?.focus({preventScroll:true});
    });
  }

  function improveHorizontalRows(){
    const install=row=>{
      if(row.dataset.novaScroll==='1') return;
      row.dataset.novaScroll='1';
      row.addEventListener('wheel',e=>{
        if(e.shiftKey || Math.abs(e.deltaX)>=Math.abs(e.deltaY) || row.scrollWidth<=row.clientWidth+8) return;
        e.preventDefault(); row.scrollBy({left:e.deltaY*.75,behavior:'auto'});
      },{passive:false});
    };
    $$('.game-row,.snack-category-chips').forEach(install);
    const mo=new MutationObserver(()=>$$('.game-row,.snack-category-chips').forEach(install));
    mo.observe(document.body,{subtree:true,childList:true});
  }

  function wrapLockReturn(){
    const base=window.returnToDashboard;
    if(typeof base!=='function'||base.__novaWrapped) return;
    const wrapped=function(...args){
      try{ sessionStorage.removeItem(UNLOCK_KEY); }catch{}
      const out=base.apply(this,args);
      resetCalc();
      document.title='Calculator';
      return out;
    };
    wrapped.__novaWrapped=true;
    window.returnToDashboard=wrapped;
  }

  function polishLabels(){
    // Existing CSS class names remain for compatibility; only user-visible text changes.
    $$('.game-classroom-btn').forEach(b=>{if(/classroom/i.test(b.textContent||'')) b.textContent='Lock';});
    const title=$('#mhSettingsTitle'); if(title) title.textContent='Nova Math Settings';
  }

  function init(){
    initCalculator();
    makeNavScrollable();
    initKeyboardNav();
    improveHorizontalRows();
    wrapLockReturn();
    polishLabels();
    document.documentElement.dataset.nova='v1';
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
