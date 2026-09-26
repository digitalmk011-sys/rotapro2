const CACHE='rotapro-v27';
const TILE_CACHE='rotapro-map-v1';
const ASSETS=['./','./index.html','./style.css','./app.js','./manifest.json','./logo.png','./icon-192.png','./icon-512.png','./header-banner.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k!==TILE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 if(u.hostname==='tile.openstreetmap.org'){
   e.respondWith(caches.open(TILE_CACHE).then(async c=>{
     const hit=await c.match(e.request);
     if(hit)return hit;
     try{const r=await fetch(e.request);if(r&&r.ok)c.put(e.request,r.clone()).catch(()=>{});return r}catch(err){return hit||new Response('',{status:503,statusText:'Offline'})}
   }));
   return;
 }
 e.respondWith(fetch(e.request).then(r=>{
   if(u.origin===location.origin){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{})}
   return r;
 }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
