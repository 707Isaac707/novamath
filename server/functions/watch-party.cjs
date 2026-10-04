const crypto = require('crypto');
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const SECRET = () => process.env.MEDIAHUB_AUTH_SECRET || process.env.SOCIAL_AUTH_SECRET || '';

function auth(event){
  try{
    const raw=String(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/,'');
    const [p,sig]=raw.split('.');
    if(!p||!sig||!SECRET())return null;
    const good=crypto.createHmac('sha256',SECRET()).update(p).digest('base64url');
    if(sig.length!==good.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(good)))return null;
    const x=JSON.parse(Buffer.from(p,'base64url').toString());
    if(x.exp<Date.now()/1000)return null;
    return x;
  }catch{return null;}
}
function text(v,n){return String(v??'').trim().slice(0,n);}
function code(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);}
function makeCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out='';
  const bytes=crypto.randomBytes(6);
  for(const b of bytes)out+=alphabet[b%alphabet.length];
  return out;
}
function cleanMedia(m){
  const type=m?.type==='tv'?'tv':'movie';
  const tmdbId=Number(m?.tmdbId||0);
  if(!Number.isInteger(tmdbId)||tmdbId<1)throw new Error('Pick a movie or TV episode first.');
  return {
    type,tmdbId,
    title:text(m?.title||'Untitled',120),
    season:type==='tv'?Math.max(1,Number(m?.season||1)):0,
    episode:type==='tv'?Math.max(1,Number(m?.episode||1¶»§q«^