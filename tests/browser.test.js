import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

test('Navegador: acesso, MFA, gravação, conflito, logout e histórico local', async () => {
  const allow=new Set(['index.html','cloud.js','app.css','auth.css','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest','sw.js']);
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!allow.has(path)){res.writeHead(404);res.end();return;}
    const ext=path.split('.').pop();const types={html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',webmanifest:'application/manifest+json'};
    res.setHeader('Content-Type',types[ext]);res.end(await readFile(new URL('../'+path,import.meta.url)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const origin='http://127.0.0.1:'+server.address().port;
  const user={id:'00000000-0000-4000-8000-000000000001',email:'test@example.invalid',aud:'authenticated',role:'authenticated',factors:[{id:'f1',factor_type:'totp',status:'verified'}]};
  const document={version:2,selectedMonth:'2026-10',months:{'2026-10':[{id:'demo',name:'Teste fictício',amount:123.45,type:'variable',category:'Outros',status:'pending'}]}};
  const jwt=aal=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,aal,exp:Math.floor(Date.now()/1000)+3600,amr:[]})).toString('base64url'),'fake-signature'].join('.');
  async function setup(aal, allowed=true, enroll=false) {
    const testUser=structuredClone(user);if(enroll)testUser.factors=[];
    const context=await browser.newContext({serviceWorkers:'block'});
    let remote=structuredClone(document), rev=1, writes=0, queries=0, conflict=false, failSave=false;
    const errors=[];
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(({aal,token,user,document})=>{
      if(!sessionStorage.getItem('test-seeded')){
        localStorage.setItem('meu-bolso-v2',JSON.stringify(document));
        if(aal)sessionStorage.setItem('meu-bolso-auth',JSON.stringify({access_token:token,refresh_token:'fake-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user}));
        sessionStorage.setItem('test-seeded','1');
      }
    },{aal,token:jwt(aal),user:testUser,document});
    await context.route('https://ohfqsuqjhkmlooqvifvf.supabase.co/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      let body={},status=200;
      if(path.endsWith('/auth/v1/user'))body=testUser;
      else if(path.endsWith('/auth/v1/factors'))body={id:'factor-new',type:'totp',totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="black"/></svg>',secret:'TESTSECRET'}};
      else if(path.endsWith('/challenge'))body={id:'challenge-new',expires_at:9999999999};
      else if(path.endsWith('/verify')){testUser.factors=user.factors;body={access_token:jwt('aal2'),refresh_token:'fake',token_type:'bearer',expires_in:3600,user:testUser};}
      else if(path.endsWith('/rpc/bolso_access'))body=allowed;
      else if(path.endsWith('/bolso_documents')){queries++;body={document:remote,revision:rev};}
      else if(path.endsWith('/rpc/bolso_save')){
        writes++;
        if(failSave){await route.abort('failed');return;}
        if(conflict){status=409;body={code:'40001',message:'conflict'};}
        else{remote=route.request().postDataJSON().p_document;body=++rev;}
      }else if(path.endsWith('/logout')){body={};}
      else throw Error('Unexpected API: '+path);
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(origin);
    return{page,context,errors,get writes(){return writes},get queries(){return queries},conflict:()=>{conflict=true},fail:()=>{failSave=true},recover:()=>{failSave=false}};
  }
  try {
    let s=await setup(null);
    await s.page.locator('#login-form').waitFor({state:'visible'});
    assert.equal(await s.page.locator('.app-shell').isVisible(),false);
    assert.equal(s.queries,0);assert.equal(s.writes,0);
    assert.equal(await s.page.evaluate(()=>JSON.parse(localStorage.getItem('meu-bolso-v2')).months['2026-10'][0].amount),123.45);
    await mkdir(new URL('../work/',import.meta.url),{recursive:true});
    await s.page.screenshot({path:new URL('../work/login.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
    assert.deepEqual(s.errors,[]);await s.context.close();
    s=await setup('aal1');await s.page.locator('#mfa-form').waitFor({state:'visible'});
    assert.equal(s.queries,0);assert.equal(await s.page.locator('.app-shell').isVisible(),false);await s.context.close();
    s=await setup('aal1',true,true);await s.page.locator('#enroll-mfa').waitFor({state:'visible'});
    await s.page.locator('#enroll-mfa').click();await s.page.locator('#mfa-setup').waitFor({state:'visible'});
    await s.page.waitForFunction(()=>document.querySelector('#mfa-qr').naturalWidth>0);
    assert.equal(s.queries,0);await s.page.locator('#mfa-code').fill('123456');await s.page.locator('#mfa-form button').click();
    await s.page.locator('#cloud-toolbar').waitFor({state:'visible'});assert.equal(await s.page.locator('#mfa-secret').innerText(),'');
    assert.deepEqual(s.errors,[]);await s.context.close();
    s=await setup('aal2',false);await s.page.locator('#retry-access').waitFor({state:'visible'});
    assert.equal(s.queries,0);assert.equal(await s.page.locator('.app-shell').isVisible(),false);await s.context.close();
    s=await setup('aal2');await s.page.locator('#cloud-toolbar').waitFor({state:'visible'});
    await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');
    assert.equal((await s.page.locator('#hero-total').innerText()).replace(/\s/g,' '),'R$ 123,45');
    await s.page.locator('#add-button').click();await s.page.locator('#f-name').fill('Nova fictícia');await s.page.locator('#f-amount').fill('25,50');
    await s.page.locator('#expense-form button[type="submit"]').click();
    await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');assert.equal(s.writes,1);
    await s.page.reload();await s.page.locator('#cloud-toolbar').waitFor({state:'visible'});assert.equal((await s.page.locator('#hero-total').innerText()).replace(/\s/g,' '),'R$ 148,95');
    s.conflict();await s.page.locator('#month-next').click();
    await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('Outro aparelho'));
    assert.equal(await s.page.locator('.app-shell').evaluate(e=>e.inert),true);
    assert.equal(await s.page.evaluate(()=>!!sessionStorage.getItem('meu-bolso-draft:00000000-0000-4000-8000-000000000001')),true);
    s.page.on('dialog',d=>d.accept());await s.page.locator('#cloud-reload').click();await s.page.locator('#cloud-toolbar').waitFor({state:'visible'});
    await s.page.locator('#cloud-logout').click();await s.page.locator('#login-form').waitFor({state:'visible'});
    assert.equal(await s.page.locator('.app-shell').isVisible(),false);
    assert.equal(await s.page.evaluate(()=>window.Bolso.get().months && Object.keys(window.Bolso.get().months).length),0);
    assert.deepEqual(s.errors,[]);await s.context.close();
    s=await setup('aal2');await s.page.locator('#cloud-toolbar').waitFor({state:'visible'});s.fail();await s.page.locator('#month-next').click();
    await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('Não foi possível'));
    assert.equal(await s.page.locator('.app-shell').evaluate(e=>e.inert),true);
    s.recover();await s.page.locator('#sync-retry').click();await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');
    assert.equal(await s.page.locator('.app-shell').evaluate(e=>e.inert),false);assert.deepEqual(s.errors,[]);await s.context.close();
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
