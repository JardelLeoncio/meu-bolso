import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {allowedEndpoint,authorized} from '../supabase/functions/send-reminders/security.js';

test('Push: segredo obrigatório e destinos restritos',async()=>{
 const secret='x'.repeat(48);
 assert.equal(await authorized(secret,secret),true);
 for(const value of ['',secret+'x','y'.repeat(48)])assert.equal(await authorized(value,secret),false);
 assert.equal(await authorized('',''),false);
 for(const endpoint of ['https://web.push.apple.com/Q123','https://fcm.googleapis.com/fcm/send/example','https://updates.push.services.mozilla.com/wpush/v2/example'])assert.equal(allowedEndpoint(endpoint),true);
 for(const endpoint of ['http://web.push.apple.com/x','https://web.push.apple.com.evil.test/x','https://user:pass@web.push.apple.com/x','https://127.0.0.1/x','https://web.push.apple.com:123/x','https://evil.test','invalid'])assert.equal(allowedEndpoint(endpoint),false);
});

test('Service worker: recebe push sem página aberta, sem nomes nem valores',async()=>{
 const handlers={},notifications=[],opened=[];
 const scope='https://example.invalid/meu-bolso/';
 const self={registration:{scope,showNotification:async(title,options)=>notifications.push({title,...options})},location:{origin:'https://example.invalid'},addEventListener:(name,fn)=>{handlers[name]=fn},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(await readFile(new URL('../sw.js',import.meta.url),'utf8'),{self,URL});
 let pending;
 handlers.push({data:{json:()=>({upcoming:2,overdue:1,date:'2026-11-20',name:'PRIVATE',amount:999})},waitUntil:p=>pending=p});await pending;
 assert.match(notifications[0].body,/2 conta/);assert.match(notifications[0].body,/20\/11\/2026/);
 assert.match(notifications[0].body,/1 conta\(s\) atrasada/);assert.doesNotMatch(JSON.stringify(notifications),/PRIVATE|999/);
 let closed=false;handlers.notificationclick({notification:{close:()=>{closed=true}},waitUntil:p=>pending=p});await pending;
 assert.equal(closed,true);assert.equal(opened.length,1);assert.ok(opened[0].startsWith(scope));
});

test('Banco push: MFA, isolamento, sessão, datas, deduplicação diária e privilégios',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   grant usage on schema auth,public to anon,authenticated,service_role;
   grant execute on all functions in schema auth to anon,authenticated;`);
  for(const file of ['01-banco.sql','03-protecao.sql','04-notificacoes.sql','04-notificacoes.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
  const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',c='00000000-0000-4000-8000-000000000003';
  await db.query('insert into auth.users values($1),($2),($3)',[a,b,c]);
  await db.query('insert into auth.sessions values($1,$1),($2,$2),($3,$3)',[a,b,c]);
  await db.query('insert into bolso_private.members values($1),($2)',[a,b]);
  async function act(role,id,aal,sql,args=[]){
   await db.exec('reset role');
   await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id||'',JSON.stringify({aal,session_id:id})]);
   await db.exec('set role '+role);return db.query(sql,args);
  }
  const sub=n=>({endpoint:'https://web.push.apple.com/test-'+n,keys:{p256dh:'B'.repeat(87),auth:'A'.repeat(22)}});
  const subscribe='select public.bolso_push_subscribe($1::jsonb)';
  for(const [role,id,aal] of [['anon',null,null],['authenticated',a,'aal1'],['authenticated',c,'aal2']])await assert.rejects(act(role,id,aal,subscribe,[sub(1)]));
  await act('authenticated',a,'aal2',subscribe,[sub(1)]);
  await act('authenticated',a,'aal2',subscribe,[sub(1)]);
  await assert.rejects(act('authenticated',b,'aal2',subscribe,[sub(1)]),e=>e.code==='42501');
  await assert.rejects(act('authenticated',a,'aal2',subscribe,[{...sub(9),endpoint:'https://127.0.0.1/x'}]),e=>e.code==='22023');
  await assert.rejects(act('authenticated',a,'aal2',subscribe,[{...sub(9),keys:{}}]),e=>e.code==='22023');
  await assert.rejects(act('authenticated',a,'aal2','select * from bolso_private.push_subscriptions'));
  await assert.rejects(act('authenticated',a,'aal2','select * from public.bolso_push_batch()'));
  await assert.rejects(act('anon',null,null,'select public.bolso_push_result($1,$2)',[a,'expired']));
  for(let n=2;n<=5;n++)await act('authenticated',a,'aal2',subscribe,[sub(n)]);
  await assert.rejects(act('authenticated',a,'aal2',subscribe,[sub(6)]),e=>e.code==='22023');
  await act('authenticated',b,'aal2','select public.bolso_push_unsubscribe($1)',[sub(1).endpoint]);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from bolso_private.push_subscriptions')).rows[0].n,5);
  const dates=(await db.query(`select to_char((now() at time zone 'America/Sao_Paulo')::date-1,'YYYY-MM-DD') as past,
   to_char((now() at time zone 'America/Sao_Paulo')::date,'YYYY-MM-DD') as today,
   to_char((now() at time zone 'America/Sao_Paulo')::date+20,'YYYY-MM-DD') as next,
   to_char((now() at time zone 'America/Sao_Paulo')::date+21,'YYYY-MM-DD') as later`)).rows[0];
  const item=(id,dueDate,status='pending')=>({id,name:'Fictícia',amount:1,category:'Outros',type:'variable',status,dueDate});
  const doc={version:2,selectedMonth:'2026-11',months:{'2026-11':[item('old',dates.past),item('1',dates.next),item('2',dates.next),item('3',dates.later),item('paid',dates.today,'paid'),item('empty',null),item('invalid','2026-02-31')]}};
  await act('authenticated',a,'aal2','select public.bolso_save($1::jsonb,0)',[doc]);
  let batch=(await act('service_role',null,null,'select * from public.bolso_push_batch()')).rows;
  assert.equal(batch.length,5);
  for(const row of batch){assert.equal(row.upcoming,2);assert.equal(row.overdue,1);assert.equal(row.due_date.toISOString().slice(0,10),dates.next);assert.equal('document' in row,false);}
  assert.equal((await act('service_role',null,null,'select * from public.bolso_push_batch()')).rows.length,0);
  await act('service_role',null,null,'select public.bolso_push_result($1,$2)',[batch[0].id,'failed']);
  assert.equal((await act('service_role',null,null,'select * from public.bolso_push_batch()')).rows.length,0);
  await act('service_role',null,null,'select public.bolso_push_result($1,$2)',[batch[0].id,'expired']);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from bolso_private.push_subscriptions')).rows[0].n,4);
  // Hoje prevalece sobre a próxima data futura. Depois de pagar tudo não há envio.
  doc.months['2026-11'].push(item('today',dates.today));
  await act('authenticated',a,'aal2','select public.bolso_save($1::jsonb,1)',[doc]);
  await db.exec('reset role;update bolso_private.push_subscriptions set last_attempt=null');
  batch=(await act('service_role',null,null,'select * from public.bolso_push_batch()')).rows;
  assert.equal(batch[0].upcoming,1);assert.equal(batch[0].due_date.toISOString().slice(0,10),dates.today);
  for(const x of doc.months['2026-11'])x.status='paid';
  await act('authenticated',a,'aal2','select public.bolso_save($1::jsonb,2)',[doc]);
  await db.exec('reset role;update bolso_private.push_subscriptions set last_attempt=null');
  assert.equal((await act('service_role',null,null,'select * from public.bolso_push_batch()')).rows.length,0);
  await db.exec('reset role');await db.query('delete from auth.sessions where id=$1',[a]);
  assert.equal((await db.query('select count(*)::int as n from bolso_private.push_subscriptions')).rows[0].n,0);
  await assert.rejects(act('authenticated',a,'aal2',subscribe,[sub(1)]),e=>e.code==='42501');
 }finally{await db.close();}
});

test('Edge Function: autenticação antes do banco, envio restrito e limpeza de expirados',async()=>{
 const source=(await readFile(new URL('../supabase/functions/send-reminders/index.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
 const {code}=await transform(source,{loader:'ts',format:'esm'});
 const env={PUSH_CRON_SECRET:'s'.repeat(64),PUSH_PUBLIC_KEY:'test-public',PUSH_PRIVATE_KEY:'test-private',PUSH_SUBJECT:'https://example.invalid',SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-only'};
 let handler,queries=0,sends=0;const results=[];
 const admin={rpc:async(name,args)=>{
  if(name==='bolso_push_result'){results.push(args);return {error:null};}
  queries++;return {data:[{id:'ok',endpoint:'https://web.push.apple.com/ok',upcoming:2,overdue:1,due_date:'2026-11-20'},
   {id:'expired',endpoint:'https://web.push.apple.com/expired',upcoming:1,overdue:0},
   {id:'invalid',endpoint:'https://127.0.0.1/private',upcoming:1,overdue:0}],error:null};
 }};
 const webpush={setVapidDetails:()=>{},sendNotification:async(subscription,payload)=>{
  sends++;assert.deepEqual(Object.keys(JSON.parse(payload)).sort(),subscription.endpoint.endsWith('expired')?['overdue','upcoming']:['date','overdue','upcoming']);
  if(subscription.endpoint.endsWith('expired'))throw {statusCode:410};
 }};
 vm.runInNewContext(code,{Deno:{env:{get:name=>env[name]},serve:fn=>{handler=fn}},createClient:()=>admin,webpush,authorized,allowedEndpoint,Response,console});
 assert.equal((await handler(new Request('https://example.invalid',{method:'POST'}))).status,401);assert.equal(queries,0);
 assert.equal((await handler(new Request('https://example.invalid',{method:'GET'}))).status,405);
 const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{'x-cron-secret':env.PUSH_CRON_SECRET}}));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{sent:1,failed:2});assert.equal(sends,2);
 assert.deepEqual(results.map(x=>x.p_status),['sent','expired','failed']);
});
