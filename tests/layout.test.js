import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';

test('Interface: abertura, temas persistentes, responsividade e navegação por teclado',async()=>{
 const allow=new Set(['index.html','theme.js','startup.js','cloud.js','app.css','auth.css','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest','sw.js']);
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!allow.has(path)){res.writeHead(404);res.end();return;}
  const mime={html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',webmanifest:'application/manifest+json'};
  res.setHeader('Content-Type',mime[path.split('.').pop()]);res.end(await readFile(new URL('../'+path,import.meta.url)));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1366,height:1000},colorScheme:'light',reducedMotion:'reduce'});
  const user={id:'00000000-0000-4000-8000-000000000001',email:'conta@example.invalid',user_metadata:{display_name:'Pessoa de teste'},aud:'authenticated',role:'authenticated',factors:[{id:'f1',factor_type:'totp',status:'verified'}]};
  const token=[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,aal:'aal2',exp:Math.floor(Date.now()/1000)+3600,amr:[]})).toString('base64url'),'fake'].join('.');
  const d=new Date(),year=d.getFullYear(),month=d.getMonth();
  const date=n=>new Date(year,month,n,12).toISOString().slice(0,10);
  const monthKey=(offset=0)=>{const x=new Date(year,month+offset,1);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0');};
  const make=(id,name,amount,type,category,status,dueDate=null)=>({id,name,amount,type,category,status,dueDate,paidDate:status==='paid'?date(1):null});
  const doc={version:2,selectedMonth:monthKey(),months:{}};
  for(let n=-5;n<0;n++)doc.months[monthKey(n)]=[make('old'+n,'Exemplo de mês anterior',3900+n*130,'variable','Outros','paid')];
  doc.months[monthKey()]=[make('rent','Aluguel',1450,'fixed','Moradia','paid'),make('internet','Internet residencial',99.9,'fixed','Serviços e contas','paid'),make('market','Compras do mercado',628.75,'variable','Alimentação','paid'),make('card','Cartão de crédito',1248.9,'variable','Cartão de crédito','pending',date(d.getDate()+3)),make('energy','Conta de energia',186.4,'variable','Serviços e contas','pending',date(d.getDate()+3)),make('transport','Transporte',240,'variable','Transporte','pending'),make('gym','Academia',119.9,'fixed','Saúde','pending',date(d.getDate()-1))];
  await context.addInitScript(({user,token})=>{
   if(!localStorage.getItem('meu-bolso-auth'))localStorage.setItem('meu-bolso-auth',JSON.stringify({access_token:token,refresh_token:'fake',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user}));
  },{user,token});
  let release;const gate=new Promise(r=>release=r);let first=true;let writes=0;
  await context.route('https://ohfqsuqjhkmlooqvifvf.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body={};
   if(path.endsWith('/auth/v1/user'))body=user;
   else if(path.endsWith('/rpc/bolso_access'))body=true;
   else if(path.endsWith('/rpc/bolso_read')){if(first){first=false;await gate;}body={document:doc,revision:1};}
   else{writes++;throw Error('Unexpected mutation/API in layout test: '+path);}
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#launch-screen').waitFor({state:'visible'});
  assert.equal(await page.locator('#auth-screen').isVisible(),false);
  assert.equal(await page.locator('.app-shell').isVisible(),false);
  assert.equal((await page.locator('#launch-screen').innerText()).trim(),'');
  await mkdir(new URL('../work/',import.meta.url),{recursive:true});
  const shot=async name=>page.screenshot({path:fileURLToPath(new URL('../work/'+name+'.png',import.meta.url)),fullPage:true});
  await page.setViewportSize({width:390,height:844});await shot('redesign-launch');release();
  await page.locator('.app-shell').waitFor({state:'visible'});assert.equal(await page.locator('#launch-screen').isVisible(),false);
  await shot('redesign-mobile-light');
  await page.setViewportSize({width:1366,height:1000});await shot('redesign-desktop-light');
  await page.locator('#profile-shortcut').click();
  await page.locator('input[name="theme"][value="dark"]').check();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.reload();await page.locator('.app-shell').waitFor({state:'visible'});assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await shot('redesign-desktop-dark');
  await page.locator('[data-page="settings"]').click();
  assert.equal(await page.locator('input[name="theme"][value="dark"]').isChecked(),true);
  await shot('redesign-settings-desktop');
  for(const scheme of ['light','dark']){
   await page.locator('input[name="theme"][value="'+scheme+'"]').check();
   for(const width of [320,390,768,1366]){
    await page.setViewportSize({width,height:900});
    for(const section of ['overview','expenses','history','settings']){
     await page.locator('[data-page="'+section+'"]').click();
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${scheme} ${width} ${section}: horizontal overflow`);
     assert.equal(await page.locator('[data-page="'+section+'"]').getAttribute('aria-current'),'page');
    }
   }
  }
  await page.setViewportSize({width:390,height:844});await shot('redesign-settings-mobile');
  await page.locator('[data-page="overview"]').click();await shot('redesign-mobile-dark');
  await page.locator('[data-page="expenses"]').click();await shot('redesign-expenses-mobile');
  await page.locator('#add-button').click();await page.locator('#f-name').waitFor({state:'visible'});
  await shot('redesign-modal-mobile');
  await page.locator('#close-modal').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#save-expense').evaluate(x=>x===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('#close-modal').evaluate(x=>x===document.activeElement),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#modal-overlay').isVisible(),false);
  await page.locator('[data-page="settings"]').click();await page.locator('input[name="theme"][value="system"]').check();
  await page.emulateMedia({colorScheme:'light'});assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  assert.equal(writes,0);assert.deepEqual(errors,[]);await context.close();
  // Sem sessão, a abertura termina na tela de login; nenhum dado é exibido.
  const anonymous=await browser.newContext({serviceWorkers:'block',colorScheme:'dark',viewport:{width:390,height:844}}),login=await anonymous.newPage();
  await login.goto(origin);await login.locator('#login-form').waitFor({state:'visible'});
  assert.equal(await login.locator('#launch-screen').isVisible(),false);assert.equal(await login.locator('.app-shell').isVisible(),false);
  await login.screenshot({path:fileURLToPath(new URL('../work/redesign-login-dark.png',import.meta.url)),fullPage:true});
  await anonymous.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
