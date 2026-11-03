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
  let archived=false;
  const previewRows=[
    {ref:'a'.repeat(64),bank:'Itaú',account:'Conta',date:date(2),description:'Depósito fictício',direction:'Entrada',currency:'BRL',amount:2500,pending:false},
    {ref:'b'.repeat(64),accountRef:'card',bank:'Mercado Pago',account:'Cartão',date:date(3),description:'Supermercado fictício',direction:'Saída',currency:'BRL',amount:85.5,pending:false},
  ];
  let release;const gate=new Promise(r=>release=r);let first=true;let writes=0,bankWrites=0;
  await context.route('https://ohfqsuqjhkmlooqvifvf.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body={};
   if(path.endsWith('/auth/v1/user'))body=user;
   else if(path.endsWith('/rpc/bolso_access'))body=true;
   else if(path.endsWith('/rpc/bolso_finance_period'))body={days:archived?20:0,rows:archived?previewRows:[]};
   else if(path.endsWith('/rpc/bolso_finance_archive')){archived=true;body=2;}
   else if(path.endsWith('/rpc/bolso_finance_classify')){
    const input=route.request().postDataJSON();previewRows.find(r=>r.ref===input.p_ref).chosen=input.p_category;body=null;
   }
   else if(path.endsWith('/rpc/bolso_save')){
     const changed=route.request().postDataJSON().p_document;
     Object.assign(doc,changed);bankWrites++;body=bankWrites+1;
   }
   else if(path.endsWith('/rpc/bolso_read')){if(first){first=false;await gate;}body={document:doc,revision:1};}
   else if(path.endsWith('/functions/v1/bank-preview'))body={version:2,accounts:[{ref:'bank',bank:'Itaú',type:'BANK',currency:'BRL',balance:3200,savings:null,name:'Conta'}, {ref:'mp',bank:'Mercado Pago',type:'BANK',currency:'BRL',balance:2050,savings:1250,name:'Conta'}, {ref:'card',bank:'Mercado Pago',type:'CREDIT',currency:'BRL',name:'Cartão de teste',limit:4000,available:2800}],from:date(1),to:date(30),fetchedAt:new Date().toISOString(),movements:previewRows,bills:[{ref:'d'.repeat(64),bank:'Mercado Pago',cardName:'Cartão de teste',cardRef:'card',dueDate:date(12),amount:400,currency:'BRL'}],billNotes:[]};
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
  await page.locator('#profile-shortcut').click();await page.getByText('Aparência',{exact:true}).click();
  await page.locator('input[name="theme"][value="dark"]').check();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.reload();await page.locator('.app-shell').waitFor({state:'visible'});assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await shot('redesign-desktop-dark');
  await page.locator('[data-page="settings"]').click();
  await page.getByText('Aparência',{exact:true}).click();assert.equal(await page.locator('input[name="theme"][value="dark"]').isChecked(),true);
  await shot('redesign-settings-desktop');
  for(const scheme of ['light','dark']){
   await page.locator('input[name="theme"][value="'+scheme+'"]').check();
   for(const width of [320,390,768,1366]){
    await page.setViewportSize({width,height:900});
    for(const section of ['overview','banks','expenses','settings']){
     await page.locator('[data-page="'+section+'"]').click();
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${scheme} ${width} ${section}: ${await page.evaluate(()=>[...document.querySelectorAll('.page.active *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(el=>el.tagName+'.'+el.id+' '+el.className).join(', '))}`);
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
  await page.locator('[data-page="banks"]').click();await page.locator('#bank-load').click();
  await page.locator('#bank-results').waitFor({state:'visible'});
  assert.equal(await page.locator('#bank-movements li').count(),2);
  await page.locator('#bank-filter').selectOption('Saída');
  assert.equal(await page.locator('#bank-movements li').count(),1);
  assert.match(await page.locator('#bank-movements').innerText(),/Supermercado fictício/);
  await page.locator('[data-bank-view="limits"]').click();
  assert.match(await page.locator('#finance-bills').innerText(),/400,00/);
  assert.match(await page.locator('#limits-list').innerText(),/2.800,00/);
  await page.locator('[data-bank="Itaú"]').click();assert.equal(await page.locator('#finance-bills article').count(),0);
  await page.locator('[data-bank=""]').click();
  await shot('finance-bills-mobile');
  await page.locator('[data-bank-view="statement"]').click();
  await page.locator('#finance-save').click();await page.waitForFunction(()=>document.querySelector('#bank-status').textContent.includes('Período guardado'));
  await page.locator('[data-page="overview"]').click();await page.locator('#analysis-detail > summary').click();
  const category=page.getByRole('combobox',{name:'Categoria de Depósito fictício'});
  await category.selectOption('salary');
  await page.waitForFunction(()=>document.querySelector('#finance-origins').textContent.includes('Salário'));
  await page.locator('[data-chart="1"]').click();assert.match(await page.locator('#finance-spending').innerText(),/85,50/);
  const exportFile=page.waitForEvent('download');await page.locator('#finance-export').click();
  const csv=await readFile(await (await exportFile).path(),'utf8');
  assert.match(csv,/Salário/);assert.match(csv,/Supermercado/);
  await shot('finance-analysis-mobile');
  await page.locator('[data-page="overview"]').click();
  assert.match(await page.locator('#finance-in').innerText(),/2.500,00/);
  assert.match(await page.locator('#available-total').innerText(),/5.250,00/);
  assert.match(await page.locator('#pot-total').innerText(),/1.250,00/);
  await page.locator('#wallet-eye').click();assert.equal(await page.locator('#available-total').innerText(),'••••');await page.locator('#wallet-eye').click();
  await page.locator('#analysis-detail > summary').click();await page.locator('[data-chart="0"]').click();
  await shot('finance-home-mobile');
  await page.setViewportSize({width:1366,height:1000});await shot('finance-home-desktop');
  await page.locator('[data-page="banks"]').click();
  await page.locator('#finance-bills summary').filter({hasText:'Vincular em Despesas'}).click();
  await page.getByRole('combobox',{name:'Lançamento para esta fatura'}).selectOption('!new');
  await page.locator('#finance-bills button').filter({hasText:'Confirmar'}).click();
  await page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');
  assert.equal(bankWrites,1);
  await page.locator('[data-page="expenses"]').click();await page.locator('[data-expense-filter="1"]').click();
  const linked=page.locator('[data-toggle="bill-'+ 'd'.repeat(64)+'"]');await linked.click();
  await page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Sincronizado');
  await page.locator('[data-page="overview"]').click();
  assert.equal(await page.locator('#debt-total').innerText(), await page.evaluate(()=>{
    const v=window.Bolso.get();
    const sum=v.months[v.selectedMonth].filter(x=>x.status==='pending').reduce((a,x)=>a+x.amount,0);
    return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(sum);
  }));
  await page.reload();await page.locator('.app-shell').waitFor({state:'visible'});
  await page.locator('[data-page="banks"]').click();
  await page.getByText('Vinculada em Despesas',{exact:true}).waitFor({state:'visible'});
  assert.equal(await page.locator('#finance-bills select').count(),0);
  assert.equal(bankWrites,2);
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'meu-bolso-auth',newValue:null})));
  assert.equal(await page.locator('#bank-movements').textContent(),'');
  assert.equal(writes,0);assert.deepEqual(errors,[]);await context.close();
  // Sem sessão, a abertura termina na tela de login; nenhum dado é exibido.
  const anonymous=await browser.newContext({serviceWorkers:'block',colorScheme:'dark',viewport:{width:390,height:844}}),login=await anonymous.newPage();
  await login.goto(origin);await login.locator('#login-form').waitFor({state:'visible'});
  assert.equal(await login.locator('#launch-screen').isVisible(),false);assert.equal(await login.locator('.app-shell').isVisible(),false);
  await login.screenshot({path:fileURLToPath(new URL('../work/redesign-login-dark.png',import.meta.url)),fullPage:true});
  await anonymous.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
