import {movementRow} from './movement-row.js';
import {categoryFor} from './finance.js';
const el=id=>document.getElementById(id);
const brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
const valid=Number.isFinite;
export function setupWallet() {
  let accounts=null, concealed=false;
  const sum=values=>values.reduce((n,v)=>n+Math.round(v*100),0)/100;
  function render(){
    const banks=(accounts||[]).filter(a=>a.type==='BANK' && a.currency==='BRL');
    const complete=banks.length>0 && banks.every(a=>valid(a.balance));
    const format=n=>concealed?'••••':valid(n)?brl(n):'—';
    el('available-total').textContent=format(complete?sum(banks.map(a=>a.balance)):null);
    const strip=el('available-banks');strip.replaceChildren();
    for(const institution of [...new Set(banks.map(a=>a.bank))]){
      const values=banks.filter(a=>a.bank===institution).map(a=>a.balance);
      const span=document.createElement('span');
      span.textContent=institution+' '+format(values.every(valid)?sum(values):null);strip.append(span);
    }
    const pots=banks.map(a=>a.savings).filter(valid);
    el('pot-line').hidden=!pots.length;
    el('pot-total').textContent=pots.length?format(sum(pots)):'';
    el('wallet-eye').setAttribute('aria-pressed',String(concealed));
    el('wallet-eye').setAttribute('aria-label',concealed?'Mostrar valores do saldo':'Ocultar valores do saldo');
  }
  el('wallet-eye').addEventListener('click',()=>{concealed=!concealed;render();});
  return (data,message)=>{
    accounts=data?.accounts || null;render();
    el('wallet-status').textContent=message || (accounts?'Consulta em '+new Date(data.fetchedAt).toLocaleString('pt-BR'):'Saldos ainda não informados nesta consulta.');
  };
}

function billControl(tile,bill,card) {
  if(!/^[a-f0-9]{64}$/.test(bill.ref) || bill.currency!=='BRL' || !(bill.amount>0 && bill.amount<=1e9))return;
  const month=bill.dueDate.slice(0,7), id='bill-'+bill.ref;
  const linked=doc=>Object.values(doc.months).some(items=>items.some(row=>row.id===id));
  const data=window.Bolso.get();
  if(linked(data)){const note=document.createElement('small');note.textContent='Vinculada em Despesas';tile.append(note);return;}
  const action=document.createElement('details'),summary=document.createElement('summary');
  summary.textContent='Vincular em Despesas';action.append(summary);
  const select=document.createElement('select');
  select.setAttribute('aria-label','Lançamento para esta fatura');
  select.add(new Option('Escolha um lançamento',''));
  for(const row of data.months[month]||[]){
    if(row.id.startsWith('bill-'))continue;
    select.add(new Option(row.name+' · '+brl(row.amount),row.id));
  }
  select.add(new Option('Criar despesa variável','!new'));
  const button=document.createElement('button');button.type='button';button.textContent='Confirmar';button.disabled=true;
  select.onchange=()=>{button.disabled=!select.value;};
  const feedback=document.createElement('small');feedback.setAttribute('role','status');
  button.onclick=()=>{
    const doc=window.Bolso.get();
    if(linked(doc)){feedback.textContent='Esta fatura já tem um lançamento.';return;}
    const rows=doc.months[month] ||= [];
    if(select.value==='!new'){
      rows.push({id,name:'Fatura '+card.bank+' · '+card.name,amount:bill.amount,type:'variable',category:'Cartão de crédito',status:'pending',dueDate:bill.dueDate,paidDate:null});
    }else{
      const row=rows.find(x=>x.id===select.value && !x.id.startsWith('bill-'));
      if(!row){feedback.textContent='O lançamento mudou. Reabra a fatura.';return;}
      row.id=id;
    }
    try{window.Bolso.commit(doc);window.Bolso.set(doc);action.replaceWith(document.createTextNode('Vinculada em Despesas'));}
    catch{feedback.textContent='Confira a conexão e aguarde a sincronização.';}
  };
  action.append(select,button,feedback);tile.append(action);
}

export function openBill(card, closedBills, movements, today) {
  const due = /^\d{4}-\d{2}-\d{2}$/.test(card.openDueDate) && card.openDueDate >= today ? card.openDueDate : null;


  // The connector assigns a forecast month to purchases and installments in the open cycle.
  const closedPeriods = new Set(closedBills.map(bill => bill.dueDate.slice(0,7)));
  const currentMonth = today.slice(0,7);
  const next = new Date(currentMonth + '-01T12:00:00Z');
  next.setUTCMonth(next.getUTCMonth()+1);
  const nextMonth = next.toISOString().slice(0,7);
  const itemsByPeriod = new Map();
  const totals = new Map();
  for (const row of movements) {
    const period = row.billPeriod;
    if (row.accountRef !== card.ref || !period || closedPeriods.has(period)) continue;
    if (period < currentMonth || period > nextMonth || (due && period !== due.slice(0,7))) continue;
    if (row.currency !== card.currency || !valid(row.amount) || categoryFor(row) === 'bill') continue;
    if (row.direction !== 'Entrada' && row.direction !== 'Saída') continue;
    const cents = Math.round(row.amount*100) * (row.direction === 'Entrada' ? -1 : 1);
    totals.set(period,(totals.get(period) ?? 0)+cents);
    if (!itemsByPeriod.has(period)) itemsByPeriod.set(period,[]);
    itemsByPeriod.get(period).push(row);
  }
  const period = [...totals.keys()].sort()[0];
  const items=itemsByPeriod.get(period) || [];
  return period ? {amount:totals.get(period)/100, period, due, items, estimated:true} : null;
}

export function monthCardActivity(snapshot, card, today) {
  const first = today.slice(0,7)+'-01';
  const rows = [...(snapshot.earlierCardRows || []), ...(snapshot.movements || [])]
    .filter(row => row.account === 'Cartão' && row.accountRef === card.ref && row.date >= first && row.date <= today && categoryFor(row) !== 'bill')
    .sort((a,b) => b.date.localeCompare(a.date));
  const totals = new Map();
  for (const row of rows) {
    if (!valid(row.amount) || !['Entrada','Saída'].includes(row.direction) || !row.currency) continue;
    const sums = totals.get(row.currency) || {posted:0, pending:0, credits:0};
    const field = row.direction === 'Entrada' ? 'credits' : row.pending ? 'pending' : 'posted';
    sums[field] += Math.round(row.amount * 100);
    totals.set(row.currency, sums);
  }
  return {rows, totals, complete:(snapshot.cardFrom || snapshot.from) <= first && snapshot.to >= today};
}

export function renderCredit(snapshot, bank, accountRef, format) {
  const bills=el('finance-bills'),limits=el('limits-list');
  const monthly=el('monthly-list');
  for(const host of [bills,limits,monthly]) host.replaceChildren();
  if(!snapshot){bills.textContent=limits.textContent=monthly.textContent='Consulte os bancos para ver os dados disponíveis.';return;}
  const matches=b=>(!bank||b.bank===bank)&&(!accountRef||b.ref===accountRef||b.cardRef===accountRef);
  const accounts=(snapshot.accounts||[]).filter(a=>a.type==='CREDIT'&&matches(a));
  const availableBills=(snapshot.bills||[]).filter(matches);
  const cards=new Map(accounts.map(a=>[a.ref,a]));
  for(const bill of availableBills){
    const key=bill.cardRef || bill.bank+'/'+bill.cardName;
    if(!cards.has(key))cards.set(key,{bank:bill.bank,name:bill.cardName,ref:key});
  }
  const date=v=>v.split('-').reverse().join('/');
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
  for(const card of cards.values()){
    const rows=availableBills.filter(b=>(b.cardRef||b.bank+'/'+b.cardName)===card.ref).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
    const cycleRows=[...(snapshot.earlierCardRows || []),...(snapshot.movements || []),...(snapshot.cycleRows || [])];
    const current=openBill(card,rows,cycleRows,today);
    const tile=document.createElement('article');
    tile.className='plastic-card'+(card.bank==='Mercado Pago'?' mp':'');
    const name=document.createElement('b'),label=document.createElement('small'),value=document.createElement('strong'),due=document.createElement('small');
    name.textContent=card.bank+' · '+card.name;
    const month=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(today+'T12:00:00Z'));
    label.textContent='Fatura em andamento';
    value.textContent=current ? format(current.amount,card.currency) : '—';
    due.textContent=current ? 'Estimativa parcial do ciclo' : 'Aguardando informações do ciclo';
    if(current?.due) due.textContent+=' · Vence em '+date(current.due);
    else if(current?.period) due.textContent+=' · '+current.period.split('-').reverse().join('/');
    tile.append(name,label,value,due);
    if(current?.items.length){
      const details=document.createElement('details'),summary=document.createElement('summary');
      summary.textContent='Itens identificados nesta fatura';details.append(summary);
      for(const row of current.items){
        const entry=document.createElement('p');
        entry.textContent=[row.description,row.installment?'Parcela '+row.installment:'',row.direction==='Entrada'?'Crédito':'',format(row.amount,row.currency)].filter(Boolean).join(' · ');
        details.append(entry);
      }
      tile.append(details);
    }
    const activity=monthCardActivity(snapshot,card,today);
    const group=document.createElement('article'),heading=document.createElement('h4');
    heading.textContent=name.textContent+' · '+month;group.append(heading);
    for (const [currency,sums] of activity.totals){
      const total=document.createElement('p');
      total.textContent='Gastos '+format((sums.posted+sums.pending)/100,currency)+' · Pendentes '+format(sums.pending/100,currency);
      if(sums.credits) total.textContent+=' · Créditos '+format(sums.credits/100,currency);
      group.append(total);
    }
    if(!activity.complete || !activity.rows.length){
      const note=document.createElement('small');note.textContent=activity.complete?'Nenhum lançamento no mês.':'Cobertura parcial do mês';group.append(note);
    }
    const list=document.createElement('ul');
    list.className='movement-list';
    for(const row of activity.rows) list.append(movementRow(row,format,'Confirmado'));
    group.append(list);
    monthly.append(group);
    bills.append(tile);
    const line=document.createElement('article'),title=document.createElement('b');title.textContent=name.textContent;line.append(title);
    for(const [field,n] of [['Limite total',card.limit],['Disponível',card.available]]){
      const p=document.createElement('p');p.textContent=field+' · '+(valid(n)?format(n,card.currency):'Não informado');line.append(p);
    }
    limits.append(line);
  }
  if(!bills.childElementCount)bills.textContent='Nenhuma fatura disponível nesta seleção.';
  if(!monthly.childElementCount)monthly.textContent='Nenhum cartão nesta seleção.';
  if(!limits.childElementCount)limits.textContent='Limites não informados nesta consulta.';
}

export function renderClosedBills(snapshot,bank,format) {
  const host=el('closed-list');
  host.replaceChildren();
  if (!snapshot) {
    host.textContent='Aguardando a consulta bancária.';
    return;
  }
  const groups=new Map();
  const bills=(snapshot.bills || []).filter(bill=>!bank || bill.bank===bank)
    .sort((a,b)=>b.dueDate.localeCompare(a.dueDate));
  for (const bill of bills) {
    const key=bill.cardRef || bill.bank+'/'+bill.cardName;
    let group=groups.get(key);
    if (!group) {
      group=document.createElement('article');
      const title=document.createElement('h4');
      title.textContent=bill.bank+' · '+bill.cardName;
      group.append(title);host.append(group);groups.set(key,group);
    }
    const entry=document.createElement('div'),caption=document.createElement('p');
    caption.textContent=bill.dueDate.split('-').reverse().join('/')+' · '+format(bill.amount,bill.currency);
    entry.append(caption);billControl(entry,bill,{bank:bill.bank,name:bill.cardName});group.append(entry);
  }
  for (const message of snapshot.billNotes || []) {
    if (bank && !message.startsWith(bank+' · ')) continue;
    const note=document.createElement('p');note.textContent=message;host.append(note);
  }
  if (!host.childElementCount) host.textContent='Nenhuma fatura fechada disponível nesta seleção.';
}
