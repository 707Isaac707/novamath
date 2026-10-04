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
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8500);
  try{
    const r=await fetch(url,{headers:{'User-Agent':'MediaHub/71','Accept':'application/x-mpegURL,text/plain,*/*'},signal:controller.signal});
    if(!r.ok)throw new Error(`Upstream ${r.status}`);
    const value=await r.text();cache.set(k,{value,exp:Date.now()+ttl});return value;
  }finally{clearTimeout(timer);}
}

function teamRow(c={}){
  return {
    id:txt(c.id||c.team?.id,40),homeAway:txt(c.homeAway,10),score:txt(c.score,16),winner:!!c.winner,
    name:txt(c.team?.displayName||c.team?.shortDisplayName||c.team?.name,100),
    shortName:txt(c.team?.shortDisplayName||c.team?.name,60),abbreviation:txt(c.team?.abbreviation,12),
    logo:txt(c.team?.logo,500),color:txt(c.team?.color,12),record:txt((c.records||[])[0]?.summary,30)
  };
}

function eventRow(e={}){
  const c=e.competitions?.[0]||{},status=c.status||e.status||{},st=status.type||{},teams=(c.competitors||[]).map(teamRow);
  teams.sort((a,b)=>a.homeAway==='away'?-1:b.homeAway==='away'?1:0);
  const broadcasts=(c.broadcasts||[]).flatMap(x=>x.names||[]).map(x=>txt(x,60)).filter(Boolean).slice(0,8);
  return {
    id:txt(e.id,50),name:txt(e.name,140),shortName:txt(e.shortName,80),date:e.date||c.date||'',
    status:{state:txt(st.state,12),name:txt(st.name,40),detail:txt(st.shortDetail||st.detail||st.description,100),clock:txt(status.displayClock,30),period:Number(status.period||0),completed:!!st.completed},
    teams,broadcasts,venue:txt(c.venue?.fullName,100),week:Number(e.week?.number||0),season:Number(e.season?.year||0),
    leaders:(c.leaders||[]).slice(0,4).map(g=>({name:txt(g.displayName||g.shortDisplayName||g.name,50),items:(g.leaders||[]).slice(0,1).map(l=>({name:txt(l.athlete?.displayName||l.athlete?.fullName,70),value:txt(l.displayValue,100),headshot:txt(l.athlete?.headshot,500),position:txt(l.athlete?.position?.abbreviation,10)}))})),
    source:'ESPN site API'
  };
}

function parseM3U(raw,source='playlist'){
  const lines=String(raw||'').split(/\r?\n/),rows=[];let meta=null;
  const attr=(line,key)=>{const m=line.match(new RegExp(`${key}="([^"]*)"`,'i'));return m?m[1]:''};
  for(const line0 of lines){
    const line=line0.trim();if(!line)continue;
    if(line.startsWith('#EXTINF:')){
      const comma=line.indexOf(',');
      meta={name:comma>=0?line.slice(comma+1).trim():'Sports Channel',tvgId:attr(line,'tvg-id'),logo:attr(line,'tvg-logo'),group:attr(line,'group-title'),country:attr(line,'tvg-country'),language:attr(line,'tvg-language')};
      continue;
    }
    if(meta&&!line.startsWith('#')){rows.push({...meta,url:line,source});meta=null;}
  }
  const seen=new Set();return rows.filter(x=>{if(!/^https?:\/\//i.test(x.url)||seen.has(x.url))return false;seen.add(x.url);return true;});
}

function statIndex(group,labelCandidates,fallback=-1){
  const labels=(group.labels||group.keys||group.descriptions||[]).map(x=>String(x||'').toUpperCase().replace(/[^A-Z0-9/]/g,''));
  for(const c of labelCandidates){const needle=String(c).toUpperCase().replace(/[^A-Z0-9/]/g,'');const i=labels.findIndex(x=>x===needle||x.includes(needle));if(i>=0)return i;}
  return fallback;
}

function mergeFantasy(playersById,team,group){
  const name=String(group.name||group.displayName||'').toLowerCase();
  for(const row of group.athletes||[]){
    const a=row.athlete||{},id=String(a.id||a.uid||a.fullName||'');if(!id)continue;
    let p=playersById.get(id);
    if(!p){p={id,name:txt(a.displayName||a.fullName,90),position:txt(a.position?.abbreviation,12),headshot:txt(a.headshot?.href||a.headshot,500),team:txt(team?.abbreviation||team?.displayName,20),passYds:0,passTd:0,int:0,rushYds:0,rushTd:0,rec:0,recYds:0,recTd:0,fumLost:0,twoPt:0};playersById.set(id,p);}
    const s=row.stats||[];
    if(name.includes('pass')){p.passYds+=num(s[statIndex(group,['YDS','PASS YDS','PASSING YARDS'],0)]);p.passTd+=num(s[statIndex(group,['TD','PASS TD'],2)]);p.int+=num(s[statIndex(group,['INT'],3)]);}
    else if(name.includes('rush')){p.rushYds+=num(s[statIndex(group,['YDS','RUSH YDS'],1)]);p.rushTd+=num(s[statIndex(group,['TD','RUSH TD'],3)]);}
    else if(name.includes('receiv')){p.rec+=num(s[statIndex(group,['REC','RECEPTIONS'],0)]);p.recYds+=num(s[statIndex(group,['YDS','REC YDS'],1)]);p.recTd+=num(s[statIndex(group,['TD','REC TD'],3)]);}
    else if(name.includes('fumbl')){p.fumLost+=num(s[statIndex(group,['LOST','FUM LOST'],1)]);}
  }
}

function fantasyRows(summary){
  const map=new Map();
  for(const block of summary?.boxscore?.players||[]){const team=block.team||{};for(const group of block.statistics||[])mergeFantasy(map,team,group);}
  const round=n=>Math.round(n*10)/10;
  return [...map.values()].map(p=>{
    const standard=p.passYds*.04+p.passTd*4-p.int*2+p.rushYds*.1+p.rushTd*6+p.recYds*.1+p.recTd*6-p.fumLost*2+p.twoPt*2;
    const half=standard+p.rec*.5,ppr=standard+p.rec;
    return {...p,standard:round(standard),half:round(half),ppr:round(ppr),average:round((standard+half+ppr)/3)};
  }).filter(p=>p.average!==0||p.rec||p.passYds||p.rushYds||p.recYds).sort((a,b)=>b.average-a.average).slice(0,40);
}

function gameDetails(summary,leagueKey){
  const h=summary?.header?.competitions?.[0]||{},status=h.status||{},teams=(h.competitors||[]).map(teamRow);
  teams.sort((a,b)=>a.homeAway==='away'?-1:b.homeAway==='away'?1:0);
  const scoring=(summary?.scoringPlays||[]).slice(-30).map(x=>({text:txt(x.text,180),period:Number(x.period?.number||0),clock:txt(x.clock?.displayValue,20),awayScore:Number(x.awayScore||0),homeScore:Number(x.homeScore||0)}));
  const leaders=[];
  for(const block of summary?.boxscore?.players||[]){
    for(const group of block.statistics||[]){
      const athletes=(group.athletes||[]).slice(0,3).map(x=>({name:txt(x.athlete?.displayName||x.athlete?.fullName,80),headshot:txt(x.athlete?.headshot?.href||x.athlete?.headshot,500),position:txt(x.athlete?.position?.abbreviation,10),stats:(x.stats||[]).map(v=>txt(v,30)).slice(0,12)}));
      if(athletes.length)leaders.push({name:txt(group.displayName||group.name,60),labels:(group.labels||[]).map(x=>txt(x,20)).slice(0,12),athletes});
    }
  }
  return {
    teams,
    status:{state:txt(status.type?.state,12),detail:txt(status.type?.shortDetail||status.type?.detail||status.type?.description,100),clock:txt(status.displayClock,20),period:Number(status.period||0),completed:!!status.type?.completed},
    scoring,leaders:leaders.slice(0,14),fantasy:leagueKey==='nfl'?fantasyRows(summary):[],
    fantasyScoring:'Estimate: 4 points per passing TD, 0.04 per passing yard, 6 per rushing or receiving TD, 0.1 per rushing or receiving yard, -2 per interception, -2 per lost fumble. Average is the mean of Standard, Half-PPR, and PPR.',
    source:'ESPN site API'
  };
}

const ymd=d=>`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
function defaultDateWindow(){
  const now=new Date(),start=new Date(now.getTime()-2*86400000),end=new Date(now.getTime()+8*86400000);
  return `${ymd(start)}-${ymd(end)}`;
}
function scoreboardUrl(cfg,q={}){
  const url=new URL(`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard`);
  const hasExplicit=!!(q.date||q.week||q.season||q.seasontype);
  if(q.date&&/^\d{8}(?:-\d{8})?$/.test(q.date))url.searchParams.set('dates',q.date);
  if(q.week&&/^\d{1,2}$/.test(q.week))url.searchParams.set('week',q.week);
  if(q.season&&/^\d{4}$/.test(q.season))url.searchParams.set('season',q.season);
  if(q.seasontype&&/^[123]$/.test(q.seasontype))url.searchParams.set('seasontype',q.seasontype);
  if(!hasExplicit)url.searchParams.set('dates',defaultDateWindow());
  url.searchParams.set('limit',(cfg.league==='college-football'||cfg.league==='mens-college-basketball')?'250':'100');
  return url.toString();
}

exports.handler=async event=>{try{
  const q=event.queryStringParameters||{},action=txt(q.action||'scoreboard',30),leagueKey=txt(q.league||'nfl',12).toLowerCase(),cfg=LEAGUES[leagueKey]||LEAGUES.nfl;

  if(action==='scoreboard'){
    const url=scoreboardUrl(cfg,q),data=await fetchJson(url,12000),events=(data?.events||[]).map(eventRow).sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));
    return{statusCode:200,headers,body:JSON.stringify({
      league:leagueKey,label:cfg.label,season:data?.season||null,week:data?.week||null,events,updatedAt:Date.now(),
      source:'ESPN site API',sourceType:'unofficial-public-endpoint',endpoint:`/sports/${cfg.sport}/${cfg.league}/scoreboard`
    })};
  }

  if(action==='game'){
    const id=txt(q.id,60);if(!id)return{statusCode:400,headers,body:JSON.stringify({error:'Missing game id'})};
    const data=await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/summary?event=${encodeURIComponent(id)}`,10000);
    return{statusCode:200,headers,body:JSON.stringify({league:leagueKey,id,details:gameDetails(data,leagueKey),updatedAt:Date.now(),source:'ESPN site API'})};
  }

  if(action==='channels'){
    const SPORTS_URL='https://iptv-org.github.io/iptv/categories/sports.m3u';
    const IPTV_CAT_URL='https://list.iptvcat.com/my_list/43a7920721455a884a8c7d23ee99c27f.m3u8';
    const sportsHint=/(?:\bsports?\b|espn|nfl|nba|wnba|mlb|nhl|mls|ncaa|football|soccer|basketball|baseball|hockey|golf|tennis|racing|motorsport|fight|boxing|ufc|red\s*zone|redzone)/i;
    const settled=await Promise.allSettled([fetchText(SPORTS_URL,300000),fetchText(IPTV_CAT_URL,180000)]);
    const iptvOrg=settled[0].status==='fulfilled'?parseM3U(settled[0].value,'iptv-org-sports'):[];
    const iptvCatAll=settled[1].status==='fulfilled'?parseM3U(settled[1].value,'iptvcat-my-list'):[];
    const iptvCat=iptvCatAll.filter(c=>sportsHint.test(`${c.name} ${c.group||''}`));
    const seen=new Set(),channels=[];
    for(const c of [...iptvCat,...iptvOrg]){if(!c?.url||seen.has(c.url))continue;seen.add(c.url);channels.push(c);}
    channels.sort((a,b)=>Number(/red\s*zone|redzone/i.test(b.name))-Number(/red\s*zone|redzone/i.test(a.name))||String(a.name).localeCompare(String(b.name)));
    const redZone=channels.find(c=>c.source==='iptvcat-my-list'&&/red\s*zone|redzone/i.test(`${c.name} ${c.group||''}`))||null;
    if(!channels.length)throw new Error('No sports channels returned');
    const sourceParts=[];if(iptvOrg.length)sourceParts.push('IPTV-org Sports');if(iptvCat.length)sourceParts.push('IPTV Cat My List');
    return{statusCode:200,headers:{...headers,'Cache-Control':'public, max-age=120, s-maxage=240, stale-while-revalidate=600'},body:JSON.stringify({channels:channels.slice(0,900),redZone,updatedAt:Date.now(),source:sourceParts.join(' + ')||'Sports playlists',sources:{iptvOrg:iptvOrg.length,iptvCat:iptvCat.length,iptvCatUrl:IPTV_CAT_URL}})};
  }

  return{statusCode:400,headers,body:JSON.stringify({error:'Unknown sports action'})};
}catch(e){console.error('sports-api',e);return{statusCode:502,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'Sports feed unavailable',detail:txt(e?.message,120)})};}};
