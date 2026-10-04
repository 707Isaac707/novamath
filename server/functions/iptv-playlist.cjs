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
    if(line.startsWith('#EXTGRP:')&&pending){pending.group=cleanName(line.slice(8))||pending.group;con¶»§q«^