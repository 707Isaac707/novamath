const crypto=require('crypto');
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const secret=()=>process.env.MEDIAHUB_AUTH_SECRET||process.env.SOCIAL_AUTH_SECRET||'';
function auth(event){try{const raw=String(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/,'');const [p,sig]=raw.split('.');if(!p||!sig||!secret())return null;const good=crypto.createHmac('sha256',secret()).update(p).digest('base64url');if(sig.length!==good.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(good)))return null;const x=JSON.parse(Buffer.from(p,'base64url').toString());if(x.exp<Date.now()/1000)return null;return x;}catch{return null;}}
const pub=u=>u?{id:u.id,username:u.username,displayName:u.displayName||u.username,avatar:u.avatar||'ðŸŽ®',bio:u.bio||'',customStatus:String(u.customStatus||'').slice(0,60),banner:String(u.banner||'midnight').slice(0,24),createdAt:u.createdAt||0,favoriteGame:String(u.favoriteGame||'').slice(0,180),badges:Array.isArray(u.badges)?u.badges.slice(0,12).map(x=>String(x).slice(0,40)):[],settings:{appearOffline:!!u.settings?.appearOffline,showActivity:u.settings?.showActivity!==false}}:null;
const pair=(a,b)=>[String(a),String(b)].sort().join('__');
const clampText=(v,n)=>String(v||'').trim().slice(0,n);

exports.handler=async event=>{try{
  const a=auth(event);
  if(!a?.sub)return{statusCode:401,headers,body:JSON.stringify({error:'Sign in required'})};
  const {getStore}=require('../ver¶»§q«^