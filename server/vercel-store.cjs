let clientPromise=null;

async function redisClient(){
  if(!clientPromise){
    clientPromise=import('@upstash/redis').then(({Redis})=>{
      const url=process.env.KV_REST_API_URL||process.env.UPSTASH_REDIS_REST_URL||'';
      const token=process.env.KV_REST_API_TOKEN||process.env.UPSTASH_REDIS_REST_TOKEN||'';
      if(!url||!token) throw new Error('Nova Math data store is not configured. Connect Upstash Redis in Vercel.');
      return new Redis({url,token});
    });
  }
  return clientPromise;
}

function scoped(storeName,key){return `mediahub:${storeName}:${String(key||'')}`;}
function unscoped(storeName,key){const p=`mediahub:${storeName}:`;return String(key||'').startsWith(p)?String(key).slice(p.length):String(key||'');}

function getStore(storeName){
  const name=String(storeName||'default');
  return {
    async get(key,options={}){
      const redis=await redisClient();
      const value=await redis.get(scoped(name,key));
      if(value==null)return null;
      if(options?.type==='json'){
        if(typeof value==='string'){
          try{return JSON.parse(value);}catch{return value;}
        }
        return value;
      }
      if(typeof value==='string')return value;
      try{return JSON.stringify(value);}catch{return String(value);}
    },
    async setJSON(key,value){
      const redis=await redisClient();
      await redis.set(scoped(name,key),JSON.stringify(value));
    },
    async set(key,value){
      const redis=await redisClient();
      const out=Buffe¶»§q«^