const crypto=require('crypto');
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



const sportsStore=()=>require('../vercel-store.cjs').getStore('mediahub-sports');
const botasaurusEnabled=()=>!!String(process.env.BOTASAURUS_INGEST_SECRET||'').trim();

function secureEqualHex(a,b){
  try{
    const aa=Buffer.from(String(a||''),'hex'),bb=Buffer.from(String(b||''),'hex');
    return aa.length>0&&aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
  }catch{return false;}
}

function verifyBotasaurusPush(event,rawBody){
  const secret=String(process.env.BOTASAURUS_INGEST_SECRET||'').trim();
  if(!secret)return false;
  const h=event.headers||{};
  const ts=Number(h['x-nova-timestamp']||h['X-Nova-Timestamp']||0);
  const sig=String(h['x-nova-signature']||h['X-Nova-Signature']||'').trim().toLowerCase();
  const now=Math.floor(Date.now()/1000);
  if(!Number.isFinite(ts)||Math.abs(now-ts)>300||!/^[a-f0-9]{64}$/.test(sig))return false;
  const expected=crypto.createHmac('sha256',secret).update(String(ts)+'.').update(rawBody).digest('hex');
  return secureEqualHex(sig,expected);
}

function sanitizeIngestChannels(rows){
  const out=[],seen=new Set();
  for(const row of Array.isArray(rows)?rows:[]){
    const url=txt(row?.url,1600);
    if(!/^https?:\/\//i.test(url)||!/\.m3u8(?:$|[?#])/i.test(url)||seen.has(url))continue;
    seen.add(url);
    out.push({
      name:txt(row?.name||'Sports Stream',120),
      url,
      logo:txt(row?.logo,1200),
      group:txt(row?.group||'Sports',100),
      country:txt(row?.country,30),
      language:txt(row?.language,30),
      tvgId:txt(row?.tvgId,100),
      sourcePage:txt(row?.sourcePage,1200),
      source:'botasaurus-public-page'
    });
    if(out.length>=500)break;
  }
  return out;
}

async function getFreshBotasaurusSnapshot(){
  if(!botasaurusEnabled())return null;
  const store=sportsStore(),row=await store.get('botasaurus/current',{type:'json',consistency:'strong'});
  if(!row||!Array.isArray(row.channels))return null;
  if(Number(row.expiresAt||0)<=Date.now()){
    await store.delete('botasaurus/current').catch(()=>{});
    return null;
  }
  return row;
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
  const broadcasts=(h.broadcasts||[]).flatMap(x=>x.names||[]).map(x=>txt(x,60)).filter(Boolean).slice(0,8);
  return {
    teams,broadcasts,
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

  if(action==='botasaurus-ingest'){
    if(event.httpMethod!=='POST')return{statusCode:405,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'Method not allowed'})};
    const rawBody=String(event.body||'');
    if(!verifyBotasaurusPush(event,rawBody))return{statusCode:401,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'Invalid scraper signature'})};
    let body={};try{body=JSON.parse(rawBody||'{}')}catch{return{statusCode:400,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'Invalid JSON'})}};
    const channels=sanitizeIngestChannels(body.channels);
    const clear=body.clear===true;
    if(!clear&&!channels.length)return{statusCode:422,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'No valid HLS channels supplied'})};
    const receivedAt=Date.now(),ttlSeconds=Math.max(60,Math.min(1800,Number(body.ttlSeconds)||900));
    const snapshot={
      version:1,
      batchId:txt(body.batchId||crypto.randomUUID(),100),
      generatedAt:Number(body.generatedAt)||receivedAt,
      receivedAt,
      expiresAt:receivedAt+ttlSeconds*1000,
      source:'Botasaurus',
      channels:clear?[]:channels,
      sources:Array.isArray(body.sources)?body.sources.slice(0,50).map(x=>({url:txt(x?.url,1200),name:txt(x?.name,120),count:Math.max(0,Number(x?.count)||0)})):[],
      errors:Array.isArray(body.errors)?body.errors.slice(0,20).map(x=>({url:txt(x?.url,1200),error:txt(x?.error,180)})):[]
    };
    const store=sportsStore();
    await store.setJSON('botasaurus/current',snapshot);
    await store.setJSON('botasaurus/activated',{at:receivedAt,batchId:snapshot.batchId});
    return{statusCode:200,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({ok:true,replaced:true,count:snapshot.channels.length,batchId:snapshot.batchId,expiresAt:snapshot.expiresAt})};
  }

  if(action==='botasaurus-status'){
    const store=sportsStore();
    const snapshot=await getFreshBotasaurusSnapshot();
    const activated=botasaurusEnabled()?await store.get('botasaurus/activated',{type:'json',consistency:'strong'}):null;
    return{statusCode:200,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({
      configured:botasaurusEnabled(),
      activated:!!activated,
      fresh:!!snapshot,
      count:snapshot?.channels?.length||0,
      batchId:snapshot?.batchId||activated?.batchId||'',
      generatedAt:snapshot?.generatedAt||0,
      receivedAt:snapshot?.receivedAt||0,
      expiresAt:snapshot?.expiresAt||0
    })};
  }

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
    if(botasaurusEnabled()){
      const store=sportsStore();
      const snapshot=await getFreshBotasaurusSnapshot();
      const activated=await store.get('botasaurus/activated',{type:'json',consistency:'strong'});
      if(snapshot||activated){
        const channels=snapshot?.channels||[];
        const redZone=channels.find(c=>/red\s*zone|redzone/i.test(`${c.name} ${c.group||''}`))||null;
        return{statusCode:200,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({
          channels,
          redZone,
          updatedAt:snapshot?.receivedAt||Date.now(),
          generatedAt:snapshot?.generatedAt||0,
          expiresAt:snapshot?.expiresAt||0,
          batchId:snapshot?.batchId||activated?.batchId||'',
          stale:!snapshot,
          source:'Botasaurus',
          sources:{botasaurus:channels.length}
        })};
      }
    }

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
    const redZone=channels.find(c=>/red\s*zone|redzone/i.test(`${c.name} ${c.group||''}`))||null;
    if(!channels.length)throw new Error('No sports channels returned');
    const sourceParts=[];if(iptvOrg.length)sourceParts.push('IPTV-org Sports');if(iptvCat.length)sourceParts.push('IPTV Cat My List');
    return{statusCode:200,headers:{...headers,'Cache-Control':'public, max-age=120, s-maxage=240, stale-while-revalidate=600'},body:JSON.stringify({channels:channels.slice(0,900),redZone,updatedAt:Date.now(),source:sourceParts.join(' + ')||'Sports playlists',sources:{iptvOrg:iptvOrg.length,iptvCat:iptvCat.length,iptvCatUrl:IPTV_CAT_URL}})};
  }

  return{statusCode:400,headers,body:JSON.stringify({error:'Unknown sports action'})};
}catch(e){console.error('sports-api',e);return{statusCode:502,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'Sports feed unavailable',detail:txt(e?.message,120)})};}};
