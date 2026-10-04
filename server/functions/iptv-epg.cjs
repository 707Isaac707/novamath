const GUIDES_URL='https://iptv-org.github.io/api/guides.json';
const CACHE_MS=6*60*60*1000;
let guideCache={at:0,data:[]};
const xmlCache=new Map();
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=120, s-maxage=600, stale-while-revalidate=1800'};
function norm(v=''){return String(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(hd|fhd|uhd|4k|tv|channel|network)\b/g,'').replace(/[^a-z0-9]+/g,'').trim();}
function decodeXml(v=''){return String(v).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function parseTime(v=''){const m=String(v).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4}|Z)?/);if(!m)return NaN;const iso=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]||'00'}${m[7]==='Z'?'Z':m[7]?m[7].slice(0,3)+':'+m[7].slice(3):'Z'}`;return Date.parse(iso);}
async function getGuides(){if(guideCache.data.length&&Date.now()-guideCache.at<CACHE_MS)return guideCache.data;const r=await fetch(GUIDES_URL,{headers:{'User-Agent':'MediaHub/1.0'}});if(!r.ok)throw new Error(`guide index HTTP ${r.status}`);const data=await r.json();guideCache={at:Date.now(),data:Array.isArray(data)?data:[]};return guideCache.data;}
async function getXml(url){const hit=xmlCache.get(url);if(hit&&Date.now()-hit.at<CACHE_MS)return hit.text;const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);try{¶»§q«^