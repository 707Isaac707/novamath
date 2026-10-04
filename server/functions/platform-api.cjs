const crypto=require('crypto');
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const secret=()=>process.env.MEDIAHUB_AUTH_SECRET||process.env.SOCIAL_AUTH_SECRET||'';
function auth(event){try{const raw=String(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/,'');const [p,sig]=raw.split('.');if(!p||!sig||!secret())return null;const good=crypto.createHmac('sha256',secret()).update(p).digest('base64url');if(sig.length!==good.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(good)))return null;const x=JSON.parse(Buffer.from(p,'base64url').toString());if(x.exp<Date.now()/1000)return null;return x;}catch{return null;}}
const txt=(v,n=500)=>String(v==null?'':v).trim().slice(0,n);
const code=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
const makeCode=()=>{const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<6;i++)s+=chars[crypto.randomInt(chars.length)];return s;};
const pub=u=>u?{id:u.id,username:u.username,displayName:u.displayName||u.username,avatar:u.avatar||'ðŸŽ®'}:null;
exports.handler=async event=>{try{
  const {getStore}=require('../vercel-store.cjs');
  const store=getStore('mediahub-platform'),social=getStore('mediahub-social');
  const a=auth(event),me=a?.sub?await social.get(`user/${a.sub}`,{type:'json',consistency:'strong'}):null;
  const body=event.httpMethod==='POST'?JSON.parse(event.body||'{}'):{};
  const action=body.action||new URL(event.r¶»§q«^