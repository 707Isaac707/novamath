function json(statusCode, body, cache='public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400') {
  return { statusCode, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':cache }, body: JSON.stringify(body) };
}

function norm(value){
  return String(value||'').toLowerCase().replace(/[â„¢Â®Â©]/g,'').replace(/[^a-z0-9]+/g,'');
}
function words(value){
  return String(value||'').toLowerCase().replace(/[â„¢Â®Â©]/g,'').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
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
  'adventurecapatalist':'Ad¶»§q«^