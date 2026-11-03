import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

test('Navegador: acesso, MFA, gravação, conflito, logout e histórico local', async () => {
  const allow=new Set(['index.html','theme.js','startup.js','cloud.js','app.css','auth.css','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest','sw.js']);
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
  async function setup(aal, allowed=true, enroll=false, storedState=null) {
    const testUser=structuredClone(user);if(enroll)testUser.factors=[];
    const context=await browser.newContext({serviceWorkers:'block', ...(storedState ? {storageState: storedState} : {})});
    let remote=structuredClone(document), rev=1, writes=0, queries=0, refreshes=0, conflict=false, failSave=false;
    const errors=[];
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    if (!storedState) await context.addInitScript(({aal,token,user,document})=>{
      if(!localStorage.getItem('test-seeded')){
        localStorage.setItem('meu-bolso-v2',JSON.stringify(document));
        if(aal)sessionStorage.setItem('meu-bolso-auth',JSON.stringify({access_token:token,refresh_token:'fake-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user}));
        localStorage.setItem('test-seeded','1');
      }
    },{aal,token:jwt(aal),user:testUser,document});
    await context.route('https://ohfqsuqjhkmlooqvifvf.supabase.co/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      let body={},status=200;
      if(path.endsWith('/auth/v1/user')) {
        const change = route.request().method()==='PUT' ? route.request().postDataJSON() : null;
        if(change?.data)testUser.user_metadata={...testUser.user_metadata,...change.data};
        body=testUser;
      }
      else if(path.endsWith('/auth/v1/token')) {
        const refresh = new URL(route.request().url()).searchParams.get('grant_type')==='refresh_token';
        if(refresh)refreshes++;
        body={access_token:jwt(refresh?'aal2':'aal1'),refresh_token:'fake-refresh',token_type:'bearer',expires_in:3600,user:testUser};
      }
      else if(path.endsWith('/auth/v1/factors'))body={id:'factor-new',type:'totp',totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="black"/></svg>',secret:'TESTSECRET'}};
      else if(path.endsWith('/challenge'))body={id:'challenge-new',expires_at:9999999999};
      else if(path.endsWith('/verify')){testUser.factors=user.factors;body={access_token:jwt('aal2'),refresh_token:'fake',token_type:'bearer',expires_in:3600,user:testUser};}
      else if(path.endsWith('/rpc/bolso_access'))body=allowed;
      else if(path.endsWith('/functions/v1/bank-preview'))body={accounts:[],movements:[],version:2,bills:[],from:'2026-11-01',to:'2026-11-30',fetchedAt:new Date().toISOString()};
   else if(path.endsWith('/rpc/bolso_finance_period'))body={days:0,rows:[]};
   else if(path.endsWith('/rpc/bolso_read')){queries++;body={document:remote,revision:rev};}
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
    return{page,context,errors,get writes(){return writes},get queries(){return queries},get refreshes(){return refreshes},conflict:()=>{conflict=true},fail:()=>{failSave=true},recover:()=>{failSave=false}};
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
    await s.page.locator('.app-shell').waitFor({state:'visible'});assert.equal(await s.page.locator('#mfa-secret').innerText(),'');
    assert.deepEqual(s.errors,[]);await s.context.close();
    s=await setup('aal2',false);await s.page.locator('#retry-access').waitFor({state:'visible'});
    assert.equal(s.queries,0);assert.equal(await s.page.locator('.app-shell').isVisible(),false);await s.context.close();
    s=await setup('aal2');await s.page.locator('.app-shell').waitFor({state:'visible'});
    await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');
    assert.equal((await s.page.locator('#hero-total').innerText()).replace(/\s/g,' '),'R$ 123,45');
    await s.page.locator('[data-page="expenses"]').click();await s.page.locator('#add-button').click();await s.page.locator('#f-name').fill('Nova fictícia');await s.page.locator('#f-amount').fill('25,50');
    await s.page.locator('#expense-form button[type="submit"]').click();
    await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');assert.equal(s.writes,1);
    await s.page.reload();await s.page.locator('.app-shell').waitFor({state:'visible'});assert.equal((await s.page.locator('#hero-total').innerText()).replace(/\s/g,' '),'R$ 148,95');
    s.conflict();await s.page.locator('#month-next').click();
    await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('Outro aparelho'));
    assert.equal(await s.page.locator('#overview').evaluate(e=>e.inert),true);
    assert.equal(await s.page.evaluate(()=>!!sessionStorage.getItem('meu-bolso-draft:00000000-0000-4000-8000-000000000001')),true);
    s.page.on('dialog',d=>d.accept());await s.page.locator('#sync-alert-open').click();await s.page.locator('#cloud-reload').click();await s.page.locator('.app-shell').waitFor({state:'visible'});
    await s.page.locator('[data-page="settings"]').click();await s.page.getByText('Sessões e saída',{exact:true}).click();await s.page.locator('#cloud-logout').click();await s.page.locator('#login-form').waitFor({state:'visible'});
    assert.equal(await s.page.locator('.app-shell').isVisible(),false);
    assert.equal(await s.page.evaluate(()=>window.Bolso.get().months && Object.keys(window.Bolso.get().months).length),0);
    assert.deepEqual(s.errors,[]);await s.context.close();
    s=await setup('aal2');await s.page.locator('.app-shell').waitFor({state:'visible'});s.fail();await s.page.locator('#month-next').click();
    await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('Não foi possível'));
    assert.equal(await s.page.locator('#overview').evaluate(e=>e.inert),true);
    s.recover();await s.page.locator('#sync-alert-open').click();await s.page.locator('#sync-retry').click();await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');
    assert.equal(await s.page.locator('#overview').evaluate(e=>e.inert),false);assert.deepEqual(s.errors,[]);await s.context.close();
    s=await setup(null);
    await s.page.locator('#login-email').fill('test@example.invalid');
    await s.page.locator('#login-password').fill('fake-password-for-testing');
    await s.page.locator('#login-form button[type="submit"]').click();
    await s.page.locator('#mfa-form').waitFor({state:'visible'});
    await s.page.locator('#mfa-code').fill('123456');await s.page.locator('#mfa-form button').click();
    await s.page.locator('.app-shell').waitFor({state:'visible'});
    assert.equal(await s.page.locator('#cloud-toolbar').count(),0);
    assert.equal(await s.page.locator('#account-email').isVisible(),false);
    assert.equal(await s.page.evaluate(()=>sessionStorage.getItem('meu-bolso-auth')),null);
    let saved=await s.context.storageState();
    await s.context.close();
    s=await setup(null,true,false,saved);
    await s.page.locator('.app-shell').waitFor({state:'visible'});
    assert.equal(await s.page.locator('#login-form').isVisible(),false);
    assert.equal(await s.page.locator('#mfa-form').isVisible(),false);
    await s.page.locator('[data-page="settings"]').click();
    assert.equal(await s.page.locator('#profile-name').count(),0);
    await s.page.getByText('Senha e verificação em duas etapas',{exact:true}).click();
    await s.page.locator('.password-settings summary').click();
    await s.page.locator('#profile-password').fill('fake-new-password');
    await s.page.locator('#profile-password-confirm').fill('different-password');
    await s.page.locator('#profile-password-form button').click();
    assert.match(await s.page.locator('#profile-password-message').innerText(),/mesma senha/);
    await s.page.locator('#profile-password-confirm').fill('fake-new-password');await s.page.locator('#profile-password-form button').click();
    await s.page.waitForFunction(()=>document.querySelector('#profile-password-message').textContent==='Senha alterada.');
    assert.equal(await s.page.locator('#profile-password').inputValue(),'');
    await s.page.setViewportSize({width:390,height:844});
    assert.equal(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await s.page.screenshot({path:new URL('../work/settings-mobile.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
    saved=await s.context.storageState();
    // Outra aba deve perder o acesso assim que Sair for usado.
    const other=await s.context.newPage();await other.goto(origin);await other.locator('.app-shell').waitFor({state:'visible'});
    await s.page.getByText('Sessões e saída',{exact:true}).click();await s.page.locator('#cloud-logout').click();await s.page.locator('#login-form').waitFor({state:'visible'});
    await other.locator('#login-form').waitFor({state:'visible'});
    assert.equal(await s.page.evaluate(()=>localStorage.getItem('meu-bolso-auth')),null);
    const loggedOut=await s.context.storageState();assert.deepEqual(s.errors,[]);await s.context.close();
    s=await setup(null,true,false,loggedOut);await s.page.locator('#login-form').waitFor({state:'visible'});assert.equal(s.queries,0);
    // Uma aba antiga não pode reimportar uma sessão depois de Sair.
    await s.page.evaluate(value=>sessionStorage.setItem('meu-bolso-auth',value),saved.origins[0].localStorage.find(x=>x.name==='meu-bolso-auth').value);
    await s.page.reload();await s.page.locator('#login-form').waitFor({state:'visible'});assert.equal(s.queries,0);await s.context.close();
    // Uma sessão persistida com access token vencido deve renovar sem pedir senha/MFA.
    const auth=saved.origins[0].localStorage.find(x=>x.name==='meu-bolso-auth');
    const session=JSON.parse(auth.value);session.expires_at=1;auth.value=JSON.stringify(session);
    s=await setup(null,true,false,saved);await s.page.locator('.app-shell').waitFor({state:'visible'});
    assert.equal(s.refreshes,1);
    assert.equal(await s.page.locator('#mfa-form').isVisible(),false);
    await s.page.evaluate(()=>localStorage.clear());await s.page.reload();
    await s.page.locator('#login-form').waitFor({state:'visible'});assert.deepEqual(s.errors,[]);await s.context.close();
    s=await setup('aal2');await s.page.locator('.app-shell').waitFor({state:'visible'});
    const today=await s.page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`});
    await s.page.locator('[data-page="expenses"]').click();await s.page.locator('#add-button').click();await s.page.locator('#f-name').fill('Conta com vencimento');await s.page.locator('#f-amount').fill('10');await s.page.locator('#f-due-date').fill(today);
    await s.page.locator('#expense-form button[type="submit"]').click();await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');
    await s.page.locator('[data-page="overview"]').click();await s.page.locator('#due-panel').waitFor({state:'visible'});assert.match(await s.page.locator('#due-summary').innerText(),/1 conta/);
    await s.page.locator('#due-panel summary').click();await s.page.locator('.due-entry').click();
    await s.page.locator('#f-status').selectOption('paid');assert.equal(await s.page.locator('#f-paid-date').inputValue(),today);
    await s.page.locator('#f-paid-date').fill('2026-10-20');await s.page.locator('#expense-form button[type="submit"]').click();await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');
    await s.page.reload();await s.page.locator('.app-shell').waitFor({state:'visible'});
    assert.equal(await s.page.locator('#due-panel').isVisible(),false);
    const savedItem=await s.page.evaluate(()=>Object.values(window.Bolso.get().months).flat().find(x=>x.name==='Conta com vencimento'));
    assert.equal(savedItem.paidDate,'2026-10-20');assert.equal(savedItem.dueDate,today);
    await s.page.locator('[data-page="expenses"]').click();await s.page.locator('[data-toggle="'+savedItem.id+'"]').click();await s.page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');
    assert.equal(await s.page.evaluate(id=>Object.values(window.Bolso.get().months).flat().find(x=>x.id===id).paidDate,savedItem.id),null);
    await s.page.locator('[data-page="overview"]').click();await s.page.setViewportSize({width:390,height:844});await s.page.locator('#due-panel summary').click();
    assert.equal(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await s.page.screenshot({path:new URL('../work/due-mobile.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
    await s.page.locator('[data-page="settings"]').click();
    await s.page.getByText('Exportação de despesas',{exact:true}).click();const downloadPromise=s.page.waitForEvent('download');await s.page.locator('#export-csv').click();const report=await downloadPromise;
    const csv=await readFile(await report.path(),'utf8');assert.match(csv,/Data de pagamento/);assert.ok(csv.includes(today));
    assert.deepEqual(s.errors,[]);await s.context.close();
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
