import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';

test('Prévia Pluggy restringe o titular, percorre páginas e falha sem salvar respostas parciais',async()=>{
  const file=await readFile(new URL('../supabase/functions/bank-preview/index.ts',import.meta.url),'utf8');
  const {code}=await transform(file,{loader:'ts'});
  const ids=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const env={SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'test-anon',
    SUPABASE_SERVICE_ROLE_KEY:'test-admin',PLUGGY_CLIENT_ID:'test-client',PLUGGY_CLIENT_SECRET:'test-secret',
    PLUGGY_ITAU_ITEM_ID:ids(1),PLUGGY_MERCADO_PAGO_ITEM_ID:ids(2)};
  let handler, allowed=false, preview=null, failSecond=true, failBills=false, bankCalls=0;
  async function fakeFetch(input,options){
    const url=new URL(input);
    if(url.pathname.endsWith('preview_access')){
      assert.equal(options.headers.Authorization,'Bearer fake-user');
      return allowed?Response.json(preview?{preview}:{ticket:ids(9)}):Response.json({}, {status:403});
    }
    if(url.pathname.endsWith('preview_finish')){
      assert.equal(options.headers.apikey,'test-admin');
      preview=JSON.parse(options.body).p_preview;
      return new Response(null,{status:204});
    }
    assert.equal(url.origin,'https://api.pluggy.ai');
    bankCalls++;
    if(url.pathname==='/auth')return Response.json({apiKey:'test-api'});
    assert.equal(options.headers['X-API-KEY'],'test-api');
    if(url.pathname.startsWith('/items/'))return Response.json({id:url.pathname.split('/').pop(),status:'UPDATED'});
    if(url.pathname==='/accounts'){
      const item=url.searchParams.get('itemId');
      assert.ok([ids(1),ids(2)].includes(item));
      const first=item===ids(1);
      if(!first&&failSecond)return new Response('private upstream message',{status:403});
      return Response.json({results:[{itemId:item,id:ids(first?3:4),type:first?'BANK':'CREDIT',currencyCode:'BRL',balance:first?3200:400,bankData:{automaticallyInvestedBalance:3200,reservedBalances:[{name:'Bloqueio judicial',availableAmounts:[{amount:800}]},{name:'Cofrinho viagem',availableAmounts:[{amount:90}]}]},creditData:{creditLimit:2200,availableCreditLimit:1500}}],totalPages:1});
    }
    if(url.pathname==='/bills' && failBills)return new Response('',{status:403});
    if(url.pathname==='/bills')return Response.json({results:[{id:'fake',totalAmount:450.25,dueDate:'2026-12-10',totalAmountCurrencyCode:'BRL'}],totalPages:1});
    assert.equal(url.pathname,'/v2/transactions');
    const accountId=url.searchParams.get('accountId');
    const row={accountId,id:ids(7),date:url.searchParams.get('dateTo')+'T12:00:00Z',
      amount:25,type:accountId===ids(3)?'CREDIT':'DEBIT',currencyCode:'BRL',description:'Fictícia',status:'POSTED'};
    const second=url.searchParams.has('after');
    url.searchParams.set('after','cursor');
    return Response.json({results:[row],next:second?null:url.search});
  }
  vm.runInNewContext(code,{Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},fetch:fakeFetch,Response,URL,URLSearchParams,AbortSignal,Intl,Date,crypto,TextEncoder});
  const request=()=>new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer fake-user'},body:JSON.stringify({itemId:ids(8)})});
  assert.equal((await handler(new Request('https://example.invalid',{method:'POST'}))).status,401);
  assert.equal((await handler(request())).status,403);assert.equal(bankCalls,0);
  allowed=true;
  const failure=await handler(request());assert.equal(failure.status,503);
  assert.doesNotMatch(await failure.text(),/private upstream|Fictícia/);assert.equal(preview,null);
  failSecond=false;
  const result=await handler(request());assert.equal(result.status,200);
  const body=await result.json();assert.equal(body.bills[0].amount,450.25);assert.equal(body.version,2);assert.equal(body.accounts[0].balance,3200);assert.equal(body.accounts[0].savings,90);assert.equal(body.accounts[1].balance,null);assert.equal(body.accounts[1].available,1500);assert.match(body.movements[0].ref,/^[a-f0-9]{64}$/);assert.equal(body.movements.length,2);
  assert.deepEqual(body.movements.map(x=>[x.bank,x.direction,x.account]),[['Itaú','Entrada','Conta'],['Mercado Pago','Saída','Cartão']]);
  assert.doesNotMatch(JSON.stringify(body),/00000000-|test-secret|test-api/);
  const calls=bankCalls;assert.equal((await handler(request())).status,200);assert.equal(bankCalls,calls);
  preview=null;failBills=true;
  const withoutBills=await (await handler(request())).json();
  assert.equal(withoutBills.movements.length,2);assert.equal(withoutBills.bills.length,0);
  assert.match(withoutBills.billNotes[0],/indisponíveis/);
});
