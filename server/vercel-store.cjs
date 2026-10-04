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
      const out=Buffer.isBuffer(value)?value.toString('base64'):String(value??'');
      await redis.set(scoped(name,key),out);
    },
    async delete(key){
      const redis=await redisClient();
      await redis.del(scoped(name,key));
    },
    async list(options={}){
      const redis=await redisClient();
      const prefix=String(options?.prefix||'');
      const pattern=scoped(name,prefix)+'*';
      let cursor=0;
      const keys=[];
      do{
        const result=await redis.scan(cursor,{match:pattern,count:500});
        cursor=Number(result?.[0]||0);
        const batch=Array.isArray(result?.[1])?result[1]:[];
        keys.push(...batch);
      }while(cursor!==0&&keys.length<5000);
      keys.sort();
      const blobs=keys.map(k=>({key:unscoped(name,k)}));
      return {blobs,b:blobs,directories:[]};
    }
  };
}

module.exports={getStore};
