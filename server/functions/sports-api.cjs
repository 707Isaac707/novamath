const headers={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'public, max-age=15, s-maxage=25, stale-while-revalidate=60'
};

const LEAGUES={
  nfl:{sport:'football',league:'nfl',label:'NFL'},
  nba:{sport:'basketball',league:'nba',label:'NBA'},
  mlb:{sport:'baseball',league:'mlb',label:'MLB'},
  nhl:{sport:'hockey',league:'nhl',label:'NHL'},
  ncaaf:{sport:'football',league:'college-football',label:'NCAAF'},
  ncaam:{sport:'basketball',league:'mens-college-basketball',label:'NCAAM'},
  wnba:{sport:'basketball',league:'wnba',label:'WNBA'},
  mls:{sport:'soccer',league:'usa.1',label:'MLS'}
};

const cache=new Map();
const txt=(v,n=200)=>String(v==null?'':v).trim().slice(0,n);
const num=v=>{const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0};

async function fetchJson(url,ttl=15000){
  const hit=cache.get(url);if(hit&&hit.exp>Date.now())return hit.value;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8500);
  try{
    const r=await fetch(url,{headers:{'User-Agent':'MediaHub/71','Accept':'application/json'},signal:controller.signal});
    if(!r.ok)throw new Error(`ESPN ${r.status}`);
    const value=await r.json();cache.set(url,{value,exp:Date.now()+ttl});return value;
  }finally{clearTimeout(timer);}
}

async function fetchText(url,ttl=300000){
  const k='text:'+url,hit=cache.get(k);if(hit&&hit.exp>Date.now())return hit.value;
  const controller=new AbortController();const timer=setTimeo¶»§q«^