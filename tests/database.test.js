import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Banco: login, MFA, isolamento, validação e conflitos de gravação', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on all functions in schema auth to anon, authenticated;`);
    await db.exec(await readFile(new URL('../supabase/01-banco.sql',import.meta.url),'utf8'));
    // A migração precisa poder ser reaplicada sem apagar dados.
    await db.exec(await readFile(new URL('../supabase/01-banco.sql',import.meta.url),'utf8'));
    const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002', c='00000000-0000-4000-8000-000000000003';
    await db.query('insert into auth.users values ($1),($2),($3)',[a,b,c]);
    await db.query('insert into bolso_private.members values ($1),($2)',[a,b]);
    async function act(role, id, aal, sql, args=[]) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id||'',JSON.stringify({aal,session_id:id})]);
      await db.exec('set role '+role);
      return db.query(sql,args);
    }
    const doc={version:2,selectedMonth:'2026-10',months:{'2026-10':[{id:'test-1',name:'Despesa fictícia',amount:123.45,category:'Outros',type:'variable',status:'pending'}]}};
    const save='select public.bolso_save($1::jsonb,$2) as revision';
    await assert.rejects(act('anon',null,null,'select * from public.bolso_documents'));
    await assert.rejects(act('anon',null,null,save,[doc,0]));
    await assert.rejects(act('authenticated',a,'aal1',save,[doc,0]));
    await assert.rejects(act('authenticated',c,'aal2',save,[doc,0]));
    assert.equal((await act('authenticated',a,'aal2',save,[doc,0])).rows[0].revision,1);
    assert.equal((await act('authenticated',b,'aal2','select * from public.bolso_documents')).rows.length,0);
    assert.equal((await act('authenticated',a,'aal1','select * from public.bolso_documents')).rows.length,0);
    assert.equal((await act('authenticated',a,'aal2','select * from public.bolso_documents')).rows.length,1);
    await assert.rejects(act('authenticated',a,'aal2','update public.bolso_documents set revision=99'));
    await assert.rejects(act('authenticated',b,'aal2','delete from public.bolso_documents'));
    await assert.rejects(act('authenticated',a,'aal2','insert into bolso_private.members values ($1)',[c]));
    assert.equal((await act('authenticated',a,'aal2',save,[doc,0])).rows[0].revision,1, 'retry idempotente');
    const changed=structuredClone(doc);changed.months['2026-10'][0].amount=200;
    assert.equal((await act('authenticated',a,'aal2',save,[changed,1])).rows[0].revision,2);
    await assert.rejects(act('authenticated',a,'aal2',save,[doc,1]), e=>e.code==='40001');
    const invalid=structuredClone(doc);invalid.months['2026-10'][0].amount=-1;
    await assert.rejects(act('authenticated',a,'aal2',save,[invalid,2]),e=>e.code==='22023');
    assert.equal((await act('authenticated',b,'aal2',save,[doc,0])).rows[0].revision,1);
    const rows=await act('authenticated',b,'aal2','select * from public.bolso_documents');
    assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].user_id,b);
    await db.exec('reset role; create table auth.sessions(id uuid primary key,user_id uuid);');
    await db.query('insert into auth.sessions values($1,$1),($2,$2)',[a,b]);
    const protection=await readFile(new URL('../supabase/03-protecao.sql',import.meta.url),'utf8');
    await db.exec(protection);await db.exec(protection);
    await db.exec('create role service_role');
    const bank=(await readFile(new URL('../supabase/06-previa-bancaria.sql',import.meta.url),'utf8')).replaceAll('__OWNER_UUID__',a);
    await db.exec(bank);await db.exec(bank);
    const access='select public.bolso_bank_preview_access($1) as slot';
    const finish='select public.bolso_bank_preview_finish($1,$2::jsonb)';
    for(const [role,id,aal] of [['anon',null,null],['authenticated',a,'aal1'],['authenticated',b,'aal2']]) {
      await assert.rejects(act(role,id,aal,access,[true]),e=>e.code==='42501');
    }
    const {ticket}=(await act('authenticated',a,'aal2',access,[true])).rows[0].slot;
    assert.ok(ticket);
    await assert.rejects(act('authenticated',a,'aal2',access,[true]),e=>e.code==='PT429');
    await assert.rejects(act('authenticated',a,'aal2',finish,[ticket,{}]),e=>e.code==='42501');
    await assert.rejects(act('authenticated',a,'aal2','select * from bolso_private.bank_preview'));
    const sample={movements:[],fetchedAt:'2026-11-03'};
    await act('service_role',null,null,finish,[ticket,sample]);
    assert.deepEqual((await act('authenticated',a,'aal2',access,[true])).rows[0].slot,{preview:sample});
    await assert.rejects(act('authenticated',b,'aal2',access,[false]),e=>e.code==='42501');
    await assert.rejects(act('service_role',null,null,finish,[ticket,sample]));
    await db.exec("reset role; update bolso_private.request_limits set window_start=now()-interval '2 minutes'");
    await assert.rejects(act('authenticated',a,'aal2','select * from public.bolso_documents'));
    await assert.rejects(act('anon',null,null,'select * from public.bolso_read()'));
    await assert.rejects(act('authenticated',a,'aal1','select * from public.bolso_read()'));
    await assert.rejects(act('authenticated',c,'aal2','select * from public.bolso_read()'));
    await assert.rejects(act('authenticated',a,'aal2','select bolso_private.save_document($1,2)',[changed]));
    for(let i=0;i<120;i++) await act('authenticated',a,'aal2','select * from public.bolso_read()');
    await assert.rejects(act('authenticated',a,'aal2','select * from public.bolso_read()'),e=>e.code==='PT429');
    assert.equal((await act('authenticated',b,'aal2','select * from public.bolso_read()')).rows.length,1);
    await db.exec("reset role; update bolso_private.request_limits set window_start=now()-interval '2 minutes'");
    await act('authenticated',a,'aal2','select * from public.bolso_read()');
    for(let i=0;i<30;i++) await act('authenticated',a,'aal2',save,[changed,2]);
    await assert.rejects(act('authenticated',a,'aal2',save,[changed,2]),e=>e.code==='PT429');
    await db.exec('reset role');await db.query('delete from auth.sessions where user_id=$1',[a]);
    await assert.rejects(act('authenticated',a,'aal2','select * from public.bolso_read()'),e=>e.code==='42501');
    await assert.rejects(act('authenticated',a,'aal2',save,[changed,2]),e=>e.code==='42501');
    await assert.rejects(act('authenticated',a,'aal2',access,[true]),e=>e.code==='42501');
  } finally { await db.close(); }
});
