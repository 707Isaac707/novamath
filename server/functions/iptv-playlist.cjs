const PLAYLISTS=[
  {label:'IPTV-org Americas',url:'https://iptv-org.github.io/iptv/regions/amer.m3u',source:'iptv-org-americas'},
  {label:'IPTV Cat My List',url:'https://list.iptvcat.com/my_list/43a7920721455a884a8c7d23ee99c27f.m3u8',source:'iptvcat-my-list'}
];
const CACHE_MS=6*60*60*1000;
let memoryCache={at:0,payload:null};

const headers={
  'Content-Type':'application/json; charset=utf-8',
  'Access-Control-Allow-Origin':'*',
  'Cache-Control':'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400'
};

function attr(line,name){
  const m=String(line).match(new RegExp('(?:^|\\s)'+name+'="([^"]*)"','i'));
  return m?m[1].trim():'';
}
function cleanName(value=''){
  return String(value).replace(/^[\s,]+|[\s,]+$/g,'').replace(/\s+/g,' ').trim();
}
function parseM3u(text='',source='playlist'){
  const lines=String(text).replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n');
  const channels=[];
  let pending=null;
  for(const raw of lines){
    const line=raw.trim();
    if(!line)continue;
    if(line.startsWith('#EXTINF:')){
      const comma=line.indexOf(',');
      const name=cleanName(comma>=0?line.slice(comma+1):'Live Channel');
      pending={
        name:name||attr(line,'tvg-name')||'Live Channel',
        group:attr(line,'group-title')||'Live TV',
        logo:attr(line,'tvg-logo')||'',
        tvgId:attr(line,'tvg-id')||''
      };
      continue;
    }
    if(line.startsWith('#EXTGRP:')&&pending){pending.group=cleanName(line.slice(8))||pending.group;continue;}
    if(line.startsWith('#'))continue;
    if(/^https?:\/\//i.test(line)){
      const meta=pending||{name:'Live Channel',group:'Live TV',logo:'',tvgId:''};
      channels.push({...meta,url:line,source});
      pending=null;
    }
  }
  const seen=new Set();
  return channels.filter(c=>{const key=c.url;if(!key||seen.has(key))return false;seen.add(key);return true;});
}

async function fetchPlaylist(entry){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const r=await fetch(entry.url,{redirect:'follow',signal:controller.signal,headers:{'User-Agent':'MediaHub/1.0','Accept':'audio/x-mpegurl,application/vnd.apple.mpegurl,application/text,text/plain,*/*'}});
    const text=await r.text();
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const channels=parseM3u(text,entry.source);
    if(!channels.length)throw new Error('no channels returned');
    return {ok:true,label:entry.label,url:entry.url,channels};
  }catch(error){
    return {ok:false,label:entry.label,url:entry.url,error:String(error?.message||error||'playlist error')};
  }finally{clearTimeout(timer);}
}

exports.handler=async()=>{
  try{
    if(memoryCache.payload&&Date.now()-memoryCache.at<CACHE_MS){
      return {statusCode:200,headers,body:JSON.stringify(memoryCache.payload)};
    }
    const results=await Promise.all(PLAYLISTS.map(fetchPlaylist));
    const good=results.filter(r=>r.ok);
    if(!good.length)throw new Error(results.map(r=>`${r.label}: ${r.error}`).join('; ')||'all playlists failed');

    const seen=new Set();
    const channels=[];
    for(const result of good){
      for(const c of result.channels){
        if(!c.url||seen.has(c.url))continue;
        seen.add(c.url);
        channels.push(c);
      }
    }
    const payload={
      source:good.map(r=>r.label).join(' + '),
      playlists:results.map(r=>({label:r.label,url:r.url,ok:r.ok,count:r.ok?r.channels.length:0,error:r.ok?undefined:r.error})),
      channels,
      fetchedAt:new Date().toISOString()
    };
    memoryCache={at:Date.now(),payload};
    return {statusCode:200,headers,body:JSON.stringify(payload)};
  }catch(error){
    console.error('iptv-playlist error',error);
    return {statusCode:502,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'Could not load the configured IPTV playlists right now.'})};
  }
};
