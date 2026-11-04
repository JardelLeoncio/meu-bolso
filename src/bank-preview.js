import {localDate} from './dates.js';
import {setupWallet,renderCredit} from './bank-overview.js';
import {categories,categoryFor} from './finance.js';
import {setupFinanceReport} from './finance-report.js';

const el=id=>document.getElementById(id);
const date=value=>value.split('-').reverse().join('/');
const amount=(value,currency)=>/^[A-Z]{3}$/.test(currency)
  ? new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(value)
  : value.toLocaleString('pt-BR');

export function setupBankPreview(client,currentSession) {
  const report=setupFinanceReport(client,currentSession);
  const button=el('bank-load'),status=el('bank-status'), save=el('finance-save');
  const list=el('bank-movements'),results=el('bank-results');
  const more=el('bank-more'),filter=el('bank-filter'),institution=el('bank-institution'),search=el('bank-search');
  let snapshot=null,shown=30,visibleDays=7,controller,attempted=null,lastAttempt=0,archived=null;
  const kind=el('account-kind'), account=el('account-ref');
  const wallet=setupWallet(()=>button.click());
  function populateAccounts(){
    const old=account.value;
    account.replaceChildren(new Option('Todos',''));
    for(const a of snapshot?.accounts||[]){
      if(institution.value && institution.value!==a.bank)continue;
      if(kind.value && kind.value!==(a.type==='CREDIT'?'Cartão':'Conta'))continue;
      account.add(new Option(a.bank+' · '+a.name,a.ref));
    }
    if([...account.options].some(o=>o.value===old))account.value=old;
  }
  function render() {
    const query=search.value.trim().toLocaleLowerCase('pt-BR');
    const today=localDate(), cutoff=new Date(Date.parse(today+'T00:00:00Z')-(visibleDays-1)*86400000).toISOString().slice(0,10);
    const available=(snapshot?.movements||[]).filter(row=>
      (!kind.value || row.account===kind.value) && (!account.value || row.accountRef===account.value) && (!filter.value || row.direction===filter.value) && (!institution.value || row.bank===institution.value) &&
      [row.description,categories[categoryFor(row)]].join(' ').toLocaleLowerCase('pt-BR').includes(query));
    const rows=available.filter(row=>row.date>=cutoff && row.date<=today);
    el('statement-range').textContent='Últimos '+visibleDays+' dias · conta e cartão de crédito';
    list.replaceChildren();
    for(const row of rows.slice(0,shown)){
      const li=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('small'),value=document.createElement('span');
      name.textContent=row.description;
      detail.textContent=[date(row.date),row.bank,row.cardName||row.account,categories[categoryFor(row)],row.pending?'Pendente':''].filter(Boolean).join(' · ');
      li.className=row.direction==='Entrada'?'movement-in':row.direction==='Saída'?'movement-out':'';
      value.textContent=(row.direction==='Entrada'?'+ ':row.direction==='Saída'?'− ':'')+amount(row.amount,row.currency);
      value.setAttribute('aria-label',row.direction+' '+amount(row.amount,row.currency));
      const glyph=document.createElement('span');
      glyph.className='movement-icon';glyph.setAttribute('aria-hidden','true');
      const category=categoryFor(row);
      const paths={market:'M3 10h18l-2 10H5zM7 10l4-7m6 7-4-7',food:'M4 3v6a3 3 0 0 0 6 0V3M7 3v18m12 0V3c-4 2-5 7-4 11h4',fuel:'M3 21h12M5 20V4h9v16M5 10h9m3-5 4 4v9a2 2 0 0 1-4 0v-5h-3'};
      Object.assign(paths,{salary:'M3 7h18v14H3zM8 7V3h8v4M3 12h18M10 12v3h4v-3',health:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',home:'M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7',transport:'M3 16V8h18v8M5 8l2-5h10l2 5M3 16h18M6 16v4m12-4v4',education:'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3zM12 6v16',leisure:'M3 6h18v14H3zM8 2l4 4 4-4',shopping:'M4 7h16v14H4zM8 7V3h8v4',bill:'M3 5h18v14H3zM3 10h18M6 15h4'});
      const path=paths[category] || (row.direction==='Entrada'?'M18 6 6 18m0-10v10h10':'M6 18 18 6m-10 0h10v10');
      glyph.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+path+'"/></svg>';
      li.append(glyph,name,detail,value);list.append(li);
    }
    if(!rows.length){const empty=document.createElement('li');empty.textContent='Nenhuma movimentação nesta seleção.';list.append(empty);}
    more.hidden=shown>=rows.length && !available.some(row=>row.date<cutoff);
  }
  function renderBills(){
    const card=snapshot?.accounts?.find(a=>a.ref===account.value && a.type==='CREDIT');
    renderCredit(snapshot,institution.value,card?.ref||'',amount);
  }
  function pane(name){
    el('statement-pane').hidden=name!=='statement';el('limits-pane').hidden=name!=='limits';
    document.querySelectorAll('[data-bank-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bankView===name)));
  }
  document.querySelectorAll('[data-bank-view]').forEach(b=>b.addEventListener('click',()=>pane(b.dataset.bankView)));
  document.querySelectorAll('[data-bank]').forEach(chip=>chip.addEventListener('click',()=>{
    institution.value=chip.dataset.bank;institution.dispatchEvent(new Event('change'));
  }));
  institution.addEventListener('change',()=>document.querySelectorAll('[data-bank]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bank===institution.value))));
  for(const field of [filter,institution,account,kind,search])field.addEventListener(field===search?'input':'change',()=>{if(field===institution || field===kind)populateAccounts();shown=30;visibleDays=7;render();renderBills();});
  more.addEventListener('click',()=>{shown+=30;visibleDays+=7;render();});
  function clear(){
    controller?.abort();snapshot=null;attempted=null;lastAttempt=0;archived=null;kind.value='';populateAccounts();wallet(null,'');shown=30;filter.value='';institution.value='';search.value='';
    list.replaceChildren();status.textContent='';results.hidden=true;button.disabled=false;save.disabled=true;
    document.querySelectorAll('[data-bank]').forEach(b=>b.setAttribute('aria-pressed',String(!b.dataset.bank)));pane('statement');renderBills();report.clear();
  }
  clear();
  button.addEventListener('click',async()=>{
    const session=currentSession();
    if(session===null || button.disabled)return;
    attempted=session;lastAttempt=Date.now();wallet(snapshot,'Consultando saldo…');
    controller=new AbortController();button.disabled=true;save.disabled=true;status.textContent='Consultando os bancos…';
    try{
      const {data,error}=await client.functions.invoke('bank-preview',{body:{},signal:controller.signal});
      if(error){
        const payload=await error.context?.json?.().catch(()=>null);
        const messages={
          access:'Entre com a conta titular e confirme a verificação em duas etapas.',
          connection:'Confira no Meu Pluggy se as duas conexões estão autorizadas.',
          wait:'Já existe uma consulta recente. Aguarde dois minutos e tente novamente.',
          setup:'Confira a configuração da função e do banco no Supabase.',
          provider:'A Pluggy recusou a consulta. Confira as credenciais e as conexões.',
          limit:'O volume ultrapassou o limite da prévia. A consulta ficou incompleta.',
        };
        throw Error(messages[payload?.error]||'Prévia indisponível. Confira a conexão e a publicação da função bank-preview.');
      }
      if(currentSession()!==session)return;
      snapshot=data;wallet(data);populateAccounts();shown=30;visibleDays=7;render();renderBills();results.hidden=false;
      status.textContent=date(data.from)+' a '+date(data.to)+' · '+data.movements.length+' movimentações · Consulta em '+new Date(data.fetchedAt).toLocaleString('pt-BR');
      if(data.version!==2)status.textContent+=' · Atualize a função bank-preview para guardar o histórico e consultar faturas.';
      save.disabled=data.version!==2;
      if(data.version===2 && archived!==data.fetchedAt){
        const {error:archiveError}=await client.rpc('bolso_finance_archive',{p_fetched_at:data.fetchedAt});
        if(currentSession()!==session)return;
        if(archiveError)status.textContent+=' · Histórico aguardando sincronização. Nova tentativa automática.';
        else {archived=data.fetchedAt;report.invalidate();}
      }
    }catch(error){if(currentSession()===session){snapshot=null;wallet(null,'Saldo indisponível. Tentaremos novamente automaticamente.');populateAccounts();results.hidden=true;list.replaceChildren();renderBills();status.textContent=error.message;}}
    finally{if(currentSession()===session)button.disabled=false;}
  });
  save.addEventListener('click',async()=>{
    const session=currentSession();
    if(session===null || snapshot?.version!==2 || save.disabled)return;
    save.disabled=true;button.disabled=true;
    try{
      const {error}=await client.rpc('bolso_finance_archive',{p_fetched_at:snapshot.fetchedAt});
      if(currentSession()!==session)return;
      if(error)throw error;
      status.textContent='Período guardado. Abra Início e selecione o mês para conferir as categorias.';
      report.invalidate();
    }catch{if(currentSession()===session)status.textContent='Não foi possível guardar o período. Confira se o SQL 07 foi aplicado e consulte os bancos novamente.';}
    finally{if(currentSession()===session){save.disabled=false;button.disabled=false;}}
  });
  document.addEventListener('finance-view',({detail})=>{
    const session=currentSession();
    if(session!==null && ['overview','banks'].includes(detail.page))autoRefresh();
  });
  function autoRefresh(){if(document.visibilityState!=='hidden' && currentSession()!==null && (attempted!==currentSession() || Date.now()-lastAttempt>=300000))button.click();}
  setInterval(autoRefresh,30000);
  document.addEventListener('visibilitychange',autoRefresh);
  window.addEventListener('online',autoRefresh);
  window.addEventListener('focus',autoRefresh);
  return clear;
}
