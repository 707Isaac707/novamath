function json(statusCode, body, cache='public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400') {
  return { statusCode, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':cache }, body: JSON.stringify(body) };
}

function norm(value){
  return String(value||'').toLowerCase().replace(/[™®©]/g,'').replace(/[^a-z0-9]+/g,'');
}
function words(value){
  return String(value||'').toLowerCase().replace(/[™®©]/g,'').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
}
function scoreName(query,name){
  const q=norm(query), n=norm(name);
  if(!q||!n)return 0;
  if(q===n)return 1000;
  if(n.includes(q)||q.includes(n))return 820-Math.abs(n.length-q.length);
  const qw=new Set(words(query)),nw=new Set(words(name));let hit=0;
  qw.forEach(x=>{if(nw.has(x))hit++;});
  return hit*135-Math.abs(n.length-q.length);
}

// Exact App Store IDs for common mobile/browser games. Apple lookups are only
// used for these known titles/aliases so we don't hammer Apple's public API.
const APP_IDS={
  '8ballpool':543186831,
  'adventurecapitalist':927006017,
  'adventurecapatalist':927006017,
  '1v1lol':1508620125,
  'minecraft':479516143,
  'amongus':1351168404,
  'retrobowl':1478902583,
  'geometrydash':625334537,
  'subwaysurfers':512939461,
  'crossyroad':924373886,
  'templerun2':572395608,
  'jetpackjoyride':457446957
};

const ALIASES={
  '8ballpool':'8 Ball Pool',
  'adventurecapitalist':'AdVenture Capitalist',
  'adventurecapatalist':'AdVenture Capitalist',
  '1v1lol':'1v1.LOL',
  'retrobowl':'Retro Bowl',
  'retrobowlcollege':'Retro Bowl College',
  'geometrydash':'Geometry Dash',
  'geometrydashlite':'Geometry Dash Lite',
  'subwaysurfers':'Subway Surfers',
  'templerun':'Temple Run',
  'templerun2':'Temple Run 2',
  'crossyroad':'Crossy Road',
  'jetpackjoyride':'Jetpack Joyride',
  'fruitninja':'Fruit Ninja',
  'cuttherope':'Cut the Rope',
  'amongus':'Among Us',
  'minecraft':'Minecraft',
  'brawlstars':'Brawl Stars',
  'clashroyale':'Clash Royale',
  'clashofclans':'Clash of Clans',
  'pokemonunite':'Pokémon UNITE',
  'pokemongo':'Pokémon GO',
  'fnaf':'Five Nights at Freddy’s',
  'fivenightsatfreddys':'Five Nights at Freddy’s',
  'fivenightsatfreddys2':'Five Nights at Freddy’s 2',
  'plagueinc':'Plague Inc.',
  'terraria':'Terraria',
  'stardewvalley':'Stardew Valley',
  'bloonstd6':'Bloons TD 6',
  'bloonstd5':'Bloons TD 5',
  'monumentvalley':'Monument Valley',
  'plantsvszombies':'Plants vs. Zombies',
  'papasfreezeria':'Papa’s Freezeria To Go!',
  'papaspizzeria':'Papa’s Pizzeria To Go!'
};

async function getJson(url,headers={}){
  const c=new AbortController();const timer=setTimeout(()=>c.abort(),10000);
  try{
    const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'NovaMathGameArt/3.0',...headers},cache:'no-store'});
    const text=await r.text();let data={};try{data=text?JSON.parse(text):{};}catch{}
    if(!r.ok){const err=new Error(data?.error||data?.message||`HTTP ${r.status}`);err.status=r.status;throw err;}
    return data;
  }finally{clearTimeout(timer);}
}

function art512(app){
  let u=app?.artworkUrl512||app?.artworkUrl100||app?.artworkUrl60||'';
  if(!u)return '';
  // Apple image URLs may contain 60x60bb / 100x100bb tokens and sometimes
  // suffix modifiers. Upgrade conservatively to a square 512 asset.
  return u.replace(/\/\d+x\d+bb(?=[._-])/i,'/512x512bb');
}

async function appleKnown(query){
  const key=norm(query);
  const id=APP_IDS[key];
  if(!id)return null;
  const d=await getJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&country=US&entity=software`);
  const app=Array.isArray(d?.results)?d.results[0]:null;
  const art=art512(app);
  if(!app||!art)return null;
  return {provider:'App Store',kind:'app-icon',url:art,iconUrl:art,gameName:app.trackName||ALIASES[key]||query,appStoreId:app.trackId||id,sourceUrl:app.trackViewUrl||''};
}

function pickAsset(list){
  if(!Array.isArray(list))return null;
  return list.find(x=>x?.url&&!x?.nsfw&&!x?.humor&&!x?.epilepsy)||list.find(x=>x?.url&&!x?.nsfw)||list.find(x=>x?.url)||null;
}

async function steamGrid(query,key){
  const auth={Authorization:`Bearer ${key}`};
  const sd=await getJson(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`,auth);
  const games=Array.isArray(sd?.data)?sd.data:[];
  if(!games.length)return null;
  games.sort((a,b)=>scoreName(query,b.name)-scoreName(query,a.name));
  const game=games[0];
  if(scoreName(query,game?.name)<180)return null;

  // Do not require a specific grid dimension. That was causing valid games to
  // return no artwork. We request icons and grids, then use the best available.
  const [iconsResult,gridsResult]=await Promise.allSettled([
    getJson(`https://www.steamgriddb.com/api/v2/icons/game/${game.id}`,auth),
    getJson(`https://www.steamgriddb.com/api/v2/grids/game/${game.id}?types=static`,auth)
  ]);
  const icons=iconsResult.status==='fulfilled'&&Array.isArray(iconsResult.value?.data)?iconsResult.value.data:[];
  const grids=gridsResult.status==='fulfilled'&&Array.isArray(gridsResult.value?.data)?gridsResult.value.data:[];
  const icon=pickAsset(icons);
  // v46: the Games UI uses vertical poster cards, so prefer portrait SteamGridDB grids.
  const safeGrids=grids.filter(x=>x?.url&&!x?.nsfw);
  const portraitExact=safeGrids.find(x=>(x.width===600&&x.height===900)||(x.width===342&&x.height===482)||(x.width===660&&x.height===930));
  const portraitAny=safeGrids
    .filter(x=>Number(x.height)>Number(x.width))
    .sort((a,b)=>Math.abs((a.width/a.height)-(2/3))-Math.abs((b.width/b.height)-(2/3)))[0];
  const preferredGrid=portraitExact||portraitAny||pickAsset(grids);
  const iconUrl=icon?.url||'';
  const backgroundUrl=preferredGrid?.url||iconUrl;
  if(!backgroundUrl)return null;
  return {provider:'SteamGridDB',kind:'poster',url:backgroundUrl,iconUrl,gameName:game.name,sourceUrl:`https://www.steamgriddb.com/game/${game.id}`};
}

async function appleSearchAlias(query){
  const key=norm(query);const alias=ALIASES[key];
  if(!alias)return null;
  const params=new URLSearchParams({term:String(alias).slice(0,80),country:'US',media:'software',entity:'software',limit:'5'});
  const d=await getJson(`https://itunes.apple.com/search?${params.toString()}`);
  const results=Array.isArray(d?.results)?d.results:[];
  if(!results.length)return null;
  results.sort((a,b)=>scoreName(alias,b.trackName)-scoreName(alias,a.trackName));
  const best=results[0];if(scoreName(alias,best?.trackName)<450)return null;
  const art=art512(best);if(!art)return null;
  return {provider:'App Store',kind:'app-icon',url:art,iconUrl:art,gameName:best.trackName||alias,appStoreId:best.trackId||null,sourceUrl:best.trackViewUrl||''};
}

exports.handler=async function(event){
  const query=String(event.queryStringParameters?.q||'').trim().slice(0,100);
  if(!query)return json(400,{error:'Missing game title.'},'no-store');
  try{
    const keyNorm=norm(query);

    // Exact Apple IDs are very reliable and only cost one public API request.
    if(APP_IDS[keyNorm]){
      const apple=await appleKnown(query).catch(()=>null);
      if(apple)return json(200,apple);
    }

    // SteamGridDB is the broad game database and should handle PC/console/web
    // titles that are not mobile App Store games.
    const steamKey=String(process.env.STEAMGRIDDB_API_KEY||'').trim();
    if(steamKey){
      try{const sgdb=await steamGrid(ALIASES[keyNorm]||query,steamKey);if(sgdb)return json(200,sgdb);}
      catch(e){
        if(e?.status===401||e?.status===403)return json(502,{error:'SteamGridDB rejected STEAMGRIDDB_API_KEY. Check the Vercel variable and redeploy.'},'no-store');
        if(e?.status===429)return json(429,{error:'SteamGridDB is rate-limited right now. Try again shortly.'},'no-store');
        console.warn('SteamGridDB lookup failed',e?.message||e);
      }
    }

    // One final Apple search only for titles we explicitly know an alias for.
    if(ALIASES[keyNorm]){
      const apple=await appleSearchAlias(query).catch(()=>null);
      if(apple)return json(200,apple);
    }

    return json(404,{error:'No confident game artwork match found.'});
  }catch(e){
    console.error('game-art',e);
    return json(500,{error:e?.message||'Game artwork lookup failed.'},'no-store');
  }
};
