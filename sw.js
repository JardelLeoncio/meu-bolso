const CACHE = 'meu-bolso-pwa-v13-blue';
const ASSETS = ['./','./index.html','./app.css','./auth.css','./cloud.js','./theme.js','./startup.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
const allowed = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('meu-bolso-pwa-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  // Nunca interceptar Auth, banco, backups, links com código de recuperação ou outros sites.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || !allowed.has(url.href)) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy))); }
    return response;
  }).catch(async () => (await caches.match(request)) || Response.error()));
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const url=new URL('./#due',self.registration.scope).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
  if(existing){await existing.focus();existing.postMessage({type:'OPEN_DUE'});}
  else await self.clients.openWindow(url);
 })());
});

self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{};}catch{}
 const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
 const next=count(payload.upcoming),overdue=count(payload.overdue);
 const date=typeof payload.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)?payload.date.split('-').reverse().join('/'):'';
 event.waitUntil(self.registration.showNotification('Meu Bolso • Contas a pagar',{
  body:`${next} conta(s) no próximo vencimento${date?' ('+date+')':''}. ${overdue} conta(s) atrasada(s). Abra para conferir.`,
  tag:'meu-bolso-due',icon:'./icon-192.png'
 }));
});
