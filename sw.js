const SHELL='novamath-shell-v1-3-2-hobby-1';
const GAMES='novamath-games-v1-3-2';
const SHELL_FILES=['/','/index.html','/style.css','/enhancements.css','/social.css','/watch-party.css','/platform.css','/platform-v69.css','/sports-v69.css','/enhancements.js','/social.js','/watch-party.js','/platform-v69.js','/sports-v69.js','/native-apps.css','/native-apps.js','/v68-ui.css','/v68-ui.js','/v70-chromebook.css','/nova-v1.css','/nova-v1.js','/assets/nova-logo.png','/assets/secret-6753.jpg','/assets/vine-boom.wav','/games.js','/app-icon-192.png','/app-icon-512.png','/manifest.webmanifest','/apps/choices-voices-packs.html','/assets/retro-bowl-hero.mp4','/assets/retro-bowl-hero-poster.jpg'];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(SHELL).then(c=>c.addAll(SHELL_FILES)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  Promise.all([
    self.clients.claim(),
    caches.keys().then(keys=>Promise.all(keys.filter(k=>![SHELL,GAMES].includes(k)).map(k=>caches.delete(k))))
  ])
));

async function networkFirst(req){
  const cache=await caches.open(SHELL);
  try{
    const fresh=await fetch(req,{cache:'no-store'});
    if(fresh && fresh.ok) cache.put(req,fresh.clone());
    return fresh;
  }catch(err){
    return (await cache.match(req)) || (await cache.match('/index.html')) || Response.error();
  }
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==location.origin) return;

  if(url.pathname.startsWith('/docs/')){
    event.respondWith(caches.open(GAMES).then(async cache=>{
      const hit=await cache.match(req);
      if(hit) return hit;
      try{
        const res=await fetch(req);
        if(res.ok) cache.put(req,res.clone());
        return res;
      }catch{
        return hit || Response.error();
      }
    }));
    return;
  }

  if(req.mode==='navigate' || SHELL_FILES.includes(url.pathname) || url.pathname==='/'){
    event.respondWith(networkFirst(req));
  }
});
