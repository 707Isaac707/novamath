const crypto=require('crypto');
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const norm=s=>String(s||'').trim().toLowerCase();
const valid=u=>/^[a-z0-9_]{3,20}$/.test(u);
const secret=()=>process.env.MEDIAHUB_AUTH_SECRET||process.env.SOCIAL_AUTH_SECRET||'';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload){const s=secret();if(!s)throw new Error('MEDIAHUB_AUTH_SECRET is not configured');const p=b64(payload),sig=crypto.createHmac('sha256',s).update(p).digest('base64url');return `${p}.${sig}`;}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){const hash=crypto.scryptSync(password,salt,64).toString('hex');return {salt,hash};}
function verify(password,salt,expected){const got=crypto.scryptSync(password,salt,64);const exp=Buffer.from(expected,'hex');return got.length===exp.length&&crypto.timingSafeEqual(got,exp);}
exports.handler=async event=>{try{if(event.httpMethod==='GET'){if(!secret())return{statusCode:503,headers,body:JSON.stringify({ok:false,configured:false,error:'Account service is not configured.'})};const {getStore}=require('../vercel-store.cjs');const store=getStore('mediahub-social');await store.get('__health__',{consistency:'strong'});return{statusCode:200,headers,body:JSON.stringify({ok:true,configured:true})};}if(event.httpMethod!=='POST')return{statusCode:405,headers,body:JSON.stringify({error:'Method not allowed'})};if(!secret())return{statusCode:503,h¶»§q«^