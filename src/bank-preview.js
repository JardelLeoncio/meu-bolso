import {movementRow} from './movement-row.js';
import {localDate} from './dates.js';
import {setupWallet,renderCredit,renderClosedBills} from './bank-overview.js';
import {categories,categoryFor} from './finance.js';
import {setupFinanceReport} from './finance-report.js';

const el=id=>document.getElementById(id);
const date=value=>value.split('-').reverse().join('/');
const amount=(value,currency)=>/^[A-Z]{3}$/.test(currency)
  ? new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(value)
  : value.toLocaleString('pt-BR');

export function setupBankPreview(client,currentSession) {
  const report=setupFinanceReport(client,currentSession);
  const status=el('bank-status');
  const list=el('bank-movements'),results=el('bank-results');
  const more=el('bank-more'),filter=el('bank-filter'),institution=el('bank-institution'),search=el('bank-search');
  let snapshot=null,shown=30,visibleDays=7,controller,attempted=null,lastAttempt=0,archived=null,loading=false;
  const kind=el('account-kind'), account=el('account-ref');
  const wallet=setupWallet();
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
      list.append(movementRow(row,amount));
    }
    if(!rows.length){const empty=document.createElement('li');empty.textContent='Nenhuma movimentação nesta seleção.';list.append(empty);}
    more.hidden=shown>=rows.length && !available.some(row=>row.date<cutoff);
  }
  function renderBills(){
    const card=snapshot?.accounts?.find(a=>a.ref===account.value && a.type==='CREDIT');
    renderCredit(snapshot,institution.value,card?.ref||'',amount);
    renderClosedBills(snapshot,el('closed-bank').value,amount);
  }
  el('closed-bank').addEventListener('change',()=>renderClosedBills(snapshot,el('closed-bank').value,amount));
  function pane(name){
    for(const view of ['statement','monthly','closed','limits']) el(view+'-pane').hidden=view!==name;
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
    el('closed-bank').value='';
    controller?.abort();snapshot=null;attempted=null;lastAttempt=0;archived=null;kind.value='';populateAccounts();wallet(null,'');shown=30;filter.value='';institution.value='';search.value='';
    list.replaceChildren();status.textContent='';results.hidden=true;loading=false;
    document.querySelectorAll('[data-bank]').forEach(b=>b.setAttribute('aria-pressed',String(!b.dataset.bank)));pane('statement');renderBills();report.clear();
  }
  clear();
  async function refresh(){
    const session=currentSession();
    if(session===null || loading)return;
    attempted=session;lastAttempt=Date.now();wallet(snapshot,'Consultando saldo…');
    controller=new AbortController();loading=true;status.textContent='Consultando os bancos…';
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
      if(data.version===2 && archived!==data.fetchedAt){
        const {error:archiveError}=await client.rpc('bolso_finance_archive',{p_fetched_at:data.fetchedAt});
        if(currentSession()!==session)return;
        if(archiveError)status.textContent+=' · Histórico aguardando sincronização. Nova tentativa automática.';
        else {archived=data.fetchedAt;report.invalidate();}
      }
    }catch(error){if(currentSession()===session){snapshot=null;wallet(null,'Saldo indisponível. Tentaremos novamente automaticamente.');populateAccounts();results.hidden=true;list.replaceChildren();renderBills();status.textContent=error.message;}}
    finally{if(currentSession()===session)loading=false;}
  }
  document.addEventListener('finance-view',({detail})=>{
    const session=currentSession();
    if(session!==null && ['overview','banks'].includes(detail.page))autoRefresh();
  });
  function autoRefresh(){if(document.visibilityState!=='hidden' && currentSession()!==null && (attempted!==currentSession() || Date.now()-lastAttempt>=300000))void refresh();}
  setInterval(autoRefresh,30000);
  document.addEventListener('visibilitychange',autoRefresh);
  window.addEventListener('online',autoRefresh);
  window.addEventListener('focus',autoRefresh);
  return clear;
}
