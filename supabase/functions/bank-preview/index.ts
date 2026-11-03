// Personal, read-only preview. The database binds both server-side items to one owner.
const SITE = 'https://jardelleoncio.github.io';
const API = 'https://api.pluggy.ai';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const headers = {
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Cache-Control': 'no-store',
};
class PreviewError extends Error {
  constructor(readonly status: number, readonly reason: string) { super(reason); }
}
function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new PreviewError(503, 'setup');
  return value;
}
function reply(status: number, body: unknown) {
  return Response.json(body, { status, headers });
}
async function jsonRequest(url: string, options: RequestInit) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(9000) });
  if (!response.ok) {
    const fromBank = url.startsWith(API + '/');
    if (!fromBank && response.status === 429) throw new PreviewError(429, 'wait');
    if (!fromBank && [401,403].includes(response.status)) throw new PreviewError(403, 'access');
    throw new PreviewError(503, fromBank ? 'provider' : 'setup');
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
function rpc(name: string, body: unknown, key: string, authorization: string) {
  return jsonRequest(env('SUPABASE_URL') + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey:key, Authorization:authorization, 'Content-Type':'application/json' },
    body: JSON.stringify(body),
  });
}
type Movement = {
  bank: string; account: string; direction: string; date: string; description: string;
  currency: string; amount: number; pending: boolean; ref: string;
  categoryHint: string; operation: string; cardName: string; accountRef: string;
};
type Bill = {ref:string; cardRef:string; bank:string; cardName:string; dueDate:string; amount:number; currency:string};
async function reference(account:string, id:string) {
  const bytes = new TextEncoder().encode(account+'/'+id);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
}
type Summary = {
  ref:string; bank:string; type:'BANK'|'CREDIT'; name:string; currency:string;
  balance:number|null; savings:number|null; limit:number|null; available:number|null;
};
const numberOrNull = (v:unknown):number|null => typeof v==='number' && Number.isFinite(v)?v:null;
function savingsOf(account:{currencyCode?:string; bankData?:{reservedBalances?:Array<{
  name?:string; availableAmounts?:Array<{amount?:number;currency?:string;currencyCode?:string}>;
}>}}) {
  const amounts:number[]=[];
  for(const pot of account.bankData?.reservedBalances ?? []) {
    if(!/\b(cofrinhos?|caixinhas?|cofres?)\b/i.test(pot.name ?? '')) continue;
    for(const entry of pot.availableAmounts ?? []) {
      if((entry.currencyCode ?? entry.currency ?? account.currencyCode)!==account.currencyCode)continue;
      if(typeof entry.amount==='number' && Number.isFinite(entry.amount) && entry.amount>=0)amounts.push(entry.amount);
    }
  }
  return amounts.length?amounts.reduce((sum,n)=>sum+Math.round(100*n),0)/100:null;
}
async function loadPreview() {
  const sources = [
    {bank:'Itaú', item:env('PLUGGY_ITAU_ITEM_ID')},
    {bank:'Mercado Pago', item:env('PLUGGY_MERCADO_PAGO_ITEM_ID')},
  ];
  if (sources.some(s=>!uuid.test(s.item)) || sources[0].item===sources[1].item)
    throw new PreviewError(503, 'setup');
  const auth = await jsonRequest(API+'/auth', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({clientId:env('PLUGGY_CLIENT_ID'), clientSecret:env('PLUGGY_CLIENT_SECRET')}),
  });
  if (!auth?.apiKey) throw new PreviewError(503,'provider');
  const get = (path: string) => jsonRequest(API+path,{headers:{'X-API-KEY':auth.apiKey}});
  const fetchedAt = new Date().toISOString();
  const to = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(fetchedAt));
  const from = new Date(Date.parse(to+'T00:00:00Z') - 29*86400000).toISOString().slice(0,10);
  const movements = new Map<string,Movement>();
  const bills = new Map<string,Bill>();
  const summaries = new Map<string,Summary>();
  const billNotes = new Set<string>();
  const started = Date.now();
  let pages = 0;
  function bounded() {
    if (++pages>40 || Date.now()-started>65000) throw new PreviewError(503,'limit');
  }
  async function loadBills(bank:string, cardName:string, account:string, cardRef:string) {
    let page=1, found=false;
    const cardBills = new Map<string,Bill>();
    try {
      while (true) {
        bounded();
        const data=await get('/bills?'+new URLSearchParams({accountId:account,page:String(page),pageSize:'100'}));
        if(!Array.isArray(data.results)) throw new Error('Invalid bill list');
        for(const bill of data.results) {
          if(!bill.id || !Number.isFinite(bill.totalAmount) || !bill.dueDate) continue;
          cardBills.set(account+'/'+bill.id,{ref:await reference(account,String(bill.id)),bank,cardName,cardRef,dueDate:String(bill.dueDate).slice(0,10),
            amount:bill.totalAmount,currency:String(bill.totalAmountCurrencyCode||'')});
          found=true;
        }
        if(page >= (data.totalPages || 1)) break;
        page++;
      }
      for(const [key,bill] of cardBills)bills.set(key,bill);
      if(!found) billNotes.add(bank+' · '+cardName+': nenhuma fatura informada.');
    } catch(error) {
      if(error instanceof PreviewError && error.reason==='limit') throw error;
      billNotes.add(bank+' · '+cardName+': faturas indisponíveis nesta consulta.');
    }
  }
  for (const {bank,item} of sources) {
    const info = await get('/items/'+item);
    if (info?.id !== item || info.status!=='UPDATED' ||
        (info.consentExpiresAt && Date.parse(info.consentExpiresAt)<=Date.now()))
      throw new PreviewError(503,'connection');
    let accountPage = 1;
    let eligibleAccounts = 0;
    while (true) {
      bounded();
      const accounts = await get('/accounts?itemId='+encodeURIComponent(item)+'&page='+accountPage);
      if (!Array.isArray(accounts.results)) throw new PreviewError(503,'provider');
      for (const account of accounts.results) {
        if (account.itemId!==item || !uuid.test(account.id)) throw new PreviewError(503,'provider');
        if (!['BANK','CREDIT'].includes(account.type)) continue;
        eligibleAccounts++;
        const cardName=account.type==='CREDIT'?String(account.name||'Cartão').slice(0,70):'';
        const accountRef=await reference(account.id,'account');
        summaries.set(accountRef,{ref:accountRef,bank,type:account.type,
          name:String(account.name||cardName||'Conta').slice(0,70),currency:String(account.currencyCode||'').slice(0,3),
          balance:account.type==='BANK'?numberOrNull(account.balance):null,
          savings:account.type==='BANK'?savingsOf(account):null,
          limit:numberOrNull(account.creditData?.creditLimit),available:numberOrNull(account.creditData?.availableCreditLimit)});
        if(cardName) await loadBills(bank,cardName,account.id,accountRef);
        let query = '?'+new URLSearchParams({accountId:account.id,dateFrom:from,dateTo:to});
        while (query) {
          bounded();
          const result = await get('/v2/transactions'+query);
          if (!Array.isArray(result.results)) throw new PreviewError(503,'provider');
          for (const movement of result.results) {
            if (!movement.id || (movement.accountId!=null && movement.accountId!==account.id) || !Number.isFinite(movement.amount))
              throw new PreviewError(503,'provider');
            const date = String(movement.date).slice(0,10);
            if (date<from || date>to) continue;
            movements.set(account.id+'/'+movement.id,{
              bank, account:account.type==='CREDIT'?'Cartão':'Conta', cardName,accountRef,
              ref:await reference(account.id,String(movement.id)),
              categoryHint:String(movement.category||movement.merchant?.category||'').slice(0,100),
              operation:String(movement.operationType||'').slice(0,50),
              direction:movement.type==='CREDIT'?'Entrada':movement.type==='DEBIT'?'Saída':'A conferir',
              date, description:String(movement.description||'Movimentação').slice(0,200),
              currency:String(movement.currencyCode||'').slice(0,3),
              amount:Math.abs(movement.amount), pending:movement.status!=='POSTED',
            });
            if (movements.size>3000) throw new PreviewError(503,'limit');
          }
          query = result.next ?? '';
          if (query && (typeof query!=='string' || !query.startsWith('?') ||
              new URLSearchParams(query).get('accountId')!==account.id)) throw new PreviewError(503,'provider');
        }
      }
      if (accountPage>=accounts.totalPages || !accounts.totalPages) break;
      accountPage++;
    }
    if (!eligibleAccounts) throw new PreviewError(503,'connection');
  }
  return {version:2,from,to,fetchedAt,accounts:[...summaries.values()],bills:[...bills.values()].sort((a,b)=>b.dueDate.localeCompare(a.dueDate)),billNotes:[...billNotes],movements:[...movements.values()].sort((a,b)=>b.date.localeCompare(a.date))};
}
Deno.serve(async request=>{
  if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (request.method!=='POST') return reply(405,{error:'method'});
  const bearer = request.headers.get('authorization') || '';
  if (!/^Bearer [^\s]+$/i.test(bearer)) return reply(401,{error:'access'});
  try {
    const access = (reserve: boolean) => rpc('bolso_bank_preview_access',{p_reserve:reserve},env('SUPABASE_ANON_KEY'),bearer);
    // PostgREST verifies this user's JWT. The RPC verifies owner, membership, MFA and active session.
    const slot = await access(true);
    if (slot.preview) return reply(200,slot.preview);
    if (!uuid.test(slot.ticket ?? '')) throw new PreviewError(503,'setup');
    const preview = await loadPreview();
    await access(false);
    const admin = env('SUPABASE_SERVICE_ROLE_KEY');
    await rpc('bolso_bank_preview_finish',{p_ticket:slot.ticket,p_preview:preview},admin,'Bearer '+admin);
    const confirmed = await access(false);
    if (!confirmed.preview) throw new PreviewError(503,'setup');
    return reply(200,confirmed.preview);
  } catch (error) {
    if (error instanceof PreviewError) return reply(error.status,{error:error.reason});
    return reply(503,{error:'unavailable'});
  }
});
