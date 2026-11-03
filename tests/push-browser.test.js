import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createECDH} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

test('Navegador push: cadastro confirmado, renovação, falha e desativação',async()=>{
 const key=createECDH('prime256v1');key.generateKeys();
 const bundle=await build({entryPoints:[new URL('../src/cloud.js',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],bundle:true,write:false,format:'esm',platform:'browser',plugins:[{name:'test-public-key',setup(b){b.onLoad({filter:/config\.js$/},async args=>({contents:(await readFile(args.path,'utf8')).replace("export const PUSH_PUBLIC_KEY = '';",`export const PUSH_PUBLIC_KEY = '${key.getPublicKey().toString('base64url')}';`),loader:'js'}));}}]});
 const allow=new Set(['index.html','theme.js','startup.js','cloud.js','app.css','auth.css','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest']);
 const server=createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!allow.has(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/octet-stream');
  res.end(file==='cloud.js'?bundle.outputFiles[0].contents:await readFile(new URL('../'+file,import.meta.url)));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const user={id:'00000000-0000-4000-8000-000000000001',email:'test@example.invalid',aud:'authenticated',role:'authenticated',factors:[{id:'f1',factor_type:'totp',status:'verified'}]};
  const token=[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,aal:'aal2',exp:Math.floor(Date.now()/1000)+3600,amr:[]})).toString('base64url'),'fake'].join('.');
  await context.addInitScript(({user,token})=>{
   if(!localStorage.getItem('test-seeded')){
    localStorage.setItem('meu-bolso-auth',JSON.stringify({access_token:token,refresh_token:'fake',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user}));
    localStorage.setItem('test-seeded','yes');
   }
   window.Notification=class{static permission='granted';static async requestPermission(){return window.testPermission||'granted';}};
   window.PushManager=class{};
   const json={endpoint:'https://web.push.apple.com/test-browser',keys:{p256dh:'B'.repeat(87),auth:'A'.repeat(22)}};
   const subscription={...json,toJSON:()=>json,unsubscribe:async()=>{localStorage.removeItem('test-sub');return true}};
   const registration={active:{},pushManager:{getSubscription:async()=>localStorage.getItem('test-sub')?subscription:null,subscribe:async()=>{localStorage.setItem('test-sub','yes');return subscription}}};
   Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>registration,register:async()=>registration,addEventListener:()=>{}}});
  },{user,token});
  let subscribed=0,unsubscribed=0,fail=false;
  await context.route('https://ohfqsuqjhkmlooqvifvf.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body={},status=200;
   if(path.endsWith('/auth/v1/user'))body=user;
   else if(path.endsWith('/rpc/bolso_access'))body=true;
   else if(path.endsWith('/rpc/bolso_finance_period'))body={days:0,rows:[]};
   else if(path.endsWith('/rpc/bolso_read'))body={document:{version:2,selectedMonth:'2026-11',months:{'2026-11':[{id:'a',name:'Fictícia',amount:1,category:'Outros',type:'variable',status:'pending',dueDate:'2099-01-01'}]}},revision:1};
   else if(path.endsWith('/rpc/bolso_push_subscribe')){
    subscribed++;assert.equal(route.request().postDataJSON().p_subscription.endpoint,'https://web.push.apple.com/test-browser');
    if(fail){status=403;body={code:'42501'};}
   }else if(path.endsWith('/rpc/bolso_push_unsubscribe')){unsubscribed++;}
   else throw Error('Unexpected API: '+path);
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#due');
  await page.locator('.app-shell').waitFor({state:'visible'});
  assert.equal(await page.locator('#due-panel details').evaluate(e=>e.open),true);
  await page.locator('[data-page="settings"]').click();
  await page.evaluate(()=>{window.testPermission='denied';});
  await page.locator('#enable-reminders').click();
  await page.waitForFunction(()=>document.querySelector('#reminder-status').textContent==='Permissão não concedida.');assert.equal(subscribed,0);
  await page.evaluate(()=>{window.testPermission='granted';});
  fail=true;await page.locator('#enable-reminders').click();
  await page.waitForFunction(()=>document.querySelector('#reminder-status').textContent.startsWith('Não foi possível ativar'));
  assert.equal(await page.evaluate(id=>localStorage.getItem('meu-bolso-reminders:'+id),user.id),null);
  fail=false;await page.locator('#enable-reminders').click();
  await page.waitForFunction(()=>document.querySelector('#reminder-status').textContent.startsWith('Resumo diário ativado'));
  assert.equal(subscribed,2);
  await page.reload();await page.locator('.app-shell').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#reminder-status').textContent.startsWith('Aparelho cadastrado'));
  assert.equal(subscribed,3);
  await page.locator('[data-page="settings"]').click();await page.locator('#disable-reminders').click();
  await page.waitForFunction(()=>document.querySelector('#reminder-status').textContent==='Avisos desativados neste aparelho.');
  assert.equal(unsubscribed,1);assert.equal(await page.evaluate(()=>localStorage.getItem('test-sub')),null);
  await page.reload();await page.locator('.app-shell').waitFor({state:'visible'});assert.equal(subscribed,3);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
